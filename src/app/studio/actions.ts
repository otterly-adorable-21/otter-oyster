'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { endSession, getViewer } from '@/lib/auth';
import { assignTierRef } from '@/lib/gank';
import {
  createCreator, deleteAccount, deletePost, getCreatorByUser, markVerified, saveTiers, savePost, setGankLink, setImageField, updateProfile, type TierInput,
} from '@/lib/creators';
import { deleteImage, ImageError, saveImage, type ImageKind } from '@/lib/images';
import { verifyCodeOnPage, VerifyError } from '@/lib/verify';
import { run } from '@/lib/db';

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

export async function verifyGankAction(): Promise<Msg> {
  const c = await mine();
  if (!c.gankUrl) return fail('Add your Gank page link first.');
  try {
    const r = await verifyCodeOnPage(c.gankUrl, c.verifyCode);
    if (!r.ok) return fail(r.reason);
  } catch (e) {
    if (e instanceof VerifyError) return fail(e.message);
    console.error('verify failed', e);
    return fail('Could not check that page right now. Try again in a minute.');
  }
  const m = markVerified(c);
  if (!m.ok) return fail(m.error);
  revalidatePath('/studio'); revalidatePath(`/${c.handle}`);
  return done('Verified. Fans can now pay from your page.');
}

export async function assignTierAction(form: FormData) {
  const c = await mine();
  const tierId = String(form.get('tierId') || ''), ref = String(form.get('priceRef') || '');
  if (tierId && ref) assignTierRef(c.id, tierId, ref);
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
  const files = deleteAccount(v.user.id);
  for (const f of files) await deleteImage(f);
  await endSession();
  redirect('/');
}
