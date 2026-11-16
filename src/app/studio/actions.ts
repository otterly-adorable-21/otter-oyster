'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { endSession, getViewer } from '@/lib/auth';
import { assignTierRef } from '@/lib/gank';
import {
  createCreator, deleteAccount, deletePost, getCreatorByUser, tiersOf, markVerified, requestReview, saveTiers, savePost, setGankLink, setImageField, updateProfile, type TierInput,
} from '@/lib/creators';
import { deleteImage, ImageError, saveImage, type ImageKind } from '@/lib/images';
import { sendMail } from '@/lib/email';
import { adminEmails } from '@/lib/auth';
import { run } from '@/lib/db';
import { discord } from '@/lib/discord';
import { leaveQuietly, revokeAllFor, syncCreator } from '@/lib/discord-sync';
import { assignProviderRef, ensureLink, removeLink, rotateLink, savePageUrl, saveSigningKey } from '@/lib/payments/process';
import { isProvider, PROVIDERS, type ProviderId } from '@/lib/payments/providers';

export interface Msg { ok: boolean; msg: string }
const fail = (msg: string): Msg => ({ ok: false, msg });
const done = (msg: string): Msg => ({ ok: true, msg });

async function me() {
  const v = await getViewer();
  if (!v) redirect('/login?next=/studio');
  return { v, creator: getCreatorByUser(v.user.id) };
}
async function mine() {
  const { creator } = await me();
  if (!creator) redirect('/studio');
  return creator;
}
const file = (f: FormData, key: string): File | null => {
  const x = f.get(key);
  return x instanceof File && x.size > 0 ? x : null;
};
async function store(f: File, kind: ImageKind): Promise<string> {
  return saveImage(Buffer.from(await f.arrayBuffer()), kind);
}

export async function createPageAction(_p: Msg | null, form: FormData): Promise<Msg> {
  const { v } = await me();
  if (form.get('adult') !== 'on' || form.get('rules') !== 'on') return fail('Please confirm both statements to continue.');
  const r = createCreator(v.user.id, String(form.get('handle') || ''), String(form.get('name') || ''));
  if (!r.ok) return fail(r.error);
  redirect('/studio');
}

export async function saveProfileAction(_p: Msg | null, form: FormData): Promise<Msg> {
  const c = await mine();
  try {
    updateProfile(c, {
      name: String(form.get('name') || ''), bio: String(form.get('bio') || ''),
      mainColor: String(form.get('mainColor') || ''), accentColor: String(form.get('accentColor') || ''),
      bannerGrad: String(form.get('bannerGrad') || ''), avatarShape: String(form.get('avatarShape') || ''),
      dividerKind: String(form.get('dividerKind') || ''), mascotOn: form.get('mascotOn') === 'on', mascotLines: String(form.get('mascotLines') || ''),
    });
    const fields: [string, 'bannerFile' | 'avatarFile' | 'logoFile' | 'dividerFile', ImageKind][] = [
      ['banner', 'bannerFile', 'banner'], ['avatar', 'avatarFile', 'avatar'], ['logo', 'logoFile', 'logo'], ['divider', 'dividerFile', 'divider'],
    ];
    for (const [key, col, kind] of fields) {
      const up = file(form, key);
      if (up) await deleteImage(setImageField(c.id, col, await store(up, kind)));
      else if (form.get(`clear_${key}`) === 'on') await deleteImage(setImageField(c.id, col, null));
    }
    if (file(form, 'divider')) run("UPDATE creators SET dividerKind = 'upload' WHERE id = ?", c.id);
  } catch (e) {
    if (e instanceof ImageError) return fail(e.message);
    throw e;
  }
  revalidatePath('/studio'); revalidatePath(`/${c.handle}`);
  return done('Saved.');
}

export async function saveTiersAction(_p: Msg | null, form: FormData): Promise<Msg> {
  const c = await mine();
  const tiers: TierInput[] = [];
  for (let i = 0; i < 3; i++) {
    const name = String(form.get(`name${i}`) || '').trim();
    if (!name) continue;
    tiers.push({ id: String(form.get(`id${i}`) || '') || undefined, name, price: form.get(`price${i}`), perks: String(form.get(`perks${i}`) || ''), gankUrl: String(form.get(`link${i}`) || '') });
  }
  try {
    const r = saveTiers(c.id, tiers);
    if (!r.ok) return fail(r.error);
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Could not save tiers.');
  }
  revalidatePath('/studio'); revalidatePath(`/${c.handle}`);
  return done('Tiers saved.');
}

export async function savePostAction(_p: Msg | null, form: FormData): Promise<Msg> {
  const c = await mine();
  let img: string | null | undefined;
  try {
    const up = file(form, 'image');
    if (up) img = await store(up, 'post');
    else if (form.get('clearImage') === 'on') img = null;
  } catch (e) {
    if (e instanceof ImageError) return fail(e.message);
    throw e;
  }
  const r = savePost(c.id, {
    id: String(form.get('id') || '') || undefined, title: String(form.get('title') || ''), body: String(form.get('body') || ''),
    nsfw: form.get('nsfw') === 'on', tierId: String(form.get('tierId') || '') || null, imageAlt: String(form.get('imageAlt') || ''),
  }, img);
  if (!r.ok) { if (img) await deleteImage(img); return fail(r.error); }
  await deleteImage(r.prevImage);
  revalidatePath('/studio'); revalidatePath(`/${c.handle}`);
  return done('Post saved.');
}

export async function deletePostAction(form: FormData) {
  const c = await mine();
  await deleteImage(deletePost(c.id, String(form.get('id') || '')));
  revalidatePath('/studio'); revalidatePath(`/${c.handle}`);
}

export async function saveGankAction(_p: Msg | null, form: FormData): Promise<Msg> {
  const c = await mine();
  const r = setGankLink(c, String(form.get('gankUrl') || ''), String(form.get('tipUrl') || ''));
  if (!r.ok) return fail(r.error);
  revalidatePath('/studio');
  return done('Saved. If you changed the page link, check it again below.');
}

export async function assignTierAction(form: FormData) {
  const c = await mine();
  const tierId = String(form.get('tierId') || ''), ref = String(form.get('priceRef') || '');
  const provider = String(form.get('provider') || 'gank');
  if (tierId && ref) {
    if (provider === 'gank') assignTierRef(c.id, tierId, ref);
    else if (isProvider(provider)) assignProviderRef(c.id, provider, ref, tierId);
  }
  revalidatePath('/studio');
}

export async function rotateHookAction() {
  const c = await mine();
  const { randomBytes } = await import('node:crypto');
  run('UPDATE creators SET hookSecret = ? WHERE id = ?', randomBytes(24).toString('hex'), c.id);
  revalidatePath('/studio');
}


export async function deleteAccountAction(_p: Msg | null, form: FormData): Promise<Msg> {
  const { v, creator } = await me();
  if (creator && String(form.get('confirm') || '').trim().toLowerCase() !== creator.handle) {
    return fail('Type your handle exactly to confirm.');
  }
  // Take back Discord roles first, and leave the creator's server, while we still know about them.
  await revokeAllFor(v.user.id);
  if (creator?.discordGuildId) await leaveQuietly(creator.discordGuildId);
  const files = deleteAccount(v.user.id);
  for (const f of files) await deleteImage(f);
  await endSession();
  redirect('/');
}

export async function requestReviewAction(_p: Msg | null, form: FormData): Promise<Msg> {
  const c = await mine();
  if (!c.gankUrl) return fail('Save your Gank page link first.');
  if (!requestReview(c, String(form.get('note') || ''))) return fail('Your page is already verified or waiting for review.');
  // Tell the admins there is a ticket. Best effort: the ticket is saved even if the email fails.
  const site = (process.env.APP_URL || '').replace(/\/$/, '');
  for (const to of adminEmails()) {
    sendMail(to, `Gank page waiting for review: @${c.handle}`,
      `@${c.handle} asked for a review.\n\nGank page: ${c.gankUrl}\nCode to find in their bio: ${c.verifyCode}\n\nReview it here: ${site}/admin`)
      .catch((e) => console.error('admin notice failed', e));
  }
  revalidatePath('/studio');
  return done('Sent. We will check your Gank bio for your code. Keep the code there until you hear back.');
}

export async function saveSigningKeyAction(_p: Msg | null, form: FormData): Promise<Msg> {
  const c = await mine();
  const key = String(form.get('key') || '').trim();
  if (key.length > 300 || /\s/.test(key)) return fail('That does not look like a signing key. It is one long string with no spaces.');
  run('UPDATE creators SET gankSigningKey = ? WHERE id = ?', key, c.id);
  revalidatePath('/studio');
  return done(key ? 'Saved. Payment messages are now checked against this key.' : 'Key removed.');
}

export async function saveDiscordRolesAction(_p: Msg | null, form: FormData): Promise<Msg> {
  const c = await mine();
  if (!c.discordGuildId) return fail('Add the bot to your Discord server first.');
  let allowed;
  try { allowed = await discord.manageableRoles(c.discordGuildId); }
  catch { return fail('Could not reach your server. Check that the bot is still in it, then try again.'); }
  const okIds = new Set(allowed.map((r) => r.id));
  const chosen = new Map<string, string>();
  for (const t of tiersOf(c.id)) {
    const v = String(form.get(`role_${t.id}`) || '');
    if (v === '__new__') {
      try { chosen.set(t.id, (await discord.createRole(c.discordGuildId, t.name)).id); }
      catch { return fail(`Could not create the "${t.name}" role. The bot needs the Manage Roles permission in your server.`); }
    } else if (v === '') chosen.set(t.id, '');
    else if (okIds.has(v)) chosen.set(t.id, v);
    else return fail(`That role for "${t.name}" is not available. The bot can only use roles that sit below its own role in your server's role list.`);
  }
  for (const [id, role] of chosen) run('UPDATE tiers SET discordRoleId = ? WHERE id = ? AND creatorId = ?', role, id, c.id);
  revalidatePath('/studio');
  // Fans who are already linked get moved to the new roles in the background.
  const fresh = getCreatorByUser(c.userId);
  if (fresh) syncCreator(fresh).catch((e) => console.error('discord sync failed', e));
  return done('Saved. Fans who connect their Discord get these roles.');
}

export async function disconnectDiscordAction() {
  const c = await mine();
  await leaveQuietly(c.discordGuildId);
  run("UPDATE tiers SET discordRoleId = '' WHERE creatorId = ?", c.id);
  run('DELETE FROM discord_grants WHERE creatorId = ?', c.id);
  run("UPDATE creators SET discordGuildId = '', discordGuildName = '' WHERE id = ?", c.id);
  revalidatePath('/studio');
}

// ---------- Ko-fi, Buy Me a Coffee, SubscribeStar ----------

const providerOf = (form: FormData): ProviderId | null => {
  const p = String(form.get('provider') || '');
  return isProvider(p) ? p : null;
};

/** Step 1 for a platform: save the public page link and make the private webhook link. */
export async function savePayPageAction(_p: Msg | null, form: FormData): Promise<Msg> {
  const c = await mine();
  const p = providerOf(form);
  if (!p) return fail('Unknown platform.');
  const r = savePageUrl(c.id, p, String(form.get('pageUrl') || ''));
  if (!r.ok) return fail(r.error);
  revalidatePath('/studio'); revalidatePath(`/${c.handle}`);
  return done('Saved. Now do step 2 below.');
}

/** Starts a platform without a page link yet, so the creator can see their webhook link straight away. */
export async function startPayAction(form: FormData) {
  const c = await mine();
  const p = providerOf(form);
  if (p) ensureLink(c.id, p);
  revalidatePath('/studio');
}

export async function savePaySecretAction(_p: Msg | null, form: FormData): Promise<Msg> {
  const c = await mine();
  const p = providerOf(form);
  if (!p) return fail('Unknown platform.');
  const key = String(form.get('key') || '').trim();
  if (key.length > 300 || /\s/.test(key)) return fail('That does not look right. It should be one long piece of text with no spaces.');
  saveSigningKey(c.id, p, key);
  revalidatePath('/studio'); revalidatePath(`/${c.handle}`);
  return done(key ? `Saved. Every message from ${PROVIDERS[p].name} is now checked against it.` : 'Removed.');
}

export async function rotatePayLinkAction(form: FormData) {
  const c = await mine();
  const p = providerOf(form);
  if (p) rotateLink(c.id, p);
  revalidatePath('/studio'); revalidatePath(`/${c.handle}`);
}

export async function removePayLinkAction(form: FormData) {
  const c = await mine();
  const p = providerOf(form);
  if (p) removeLink(c.id, p);
  revalidatePath('/studio'); revalidatePath(`/${c.handle}`);
}
