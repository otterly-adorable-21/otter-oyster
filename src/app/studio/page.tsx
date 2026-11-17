import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ActionForm } from '@/components/ActionForm';
import { ColorPicker } from '@/components/ColorPicker';
import { getViewer } from '@/lib/auth';
import { getCreatorByUser, postsOf, tiersOf } from '@/lib/creators';
import { ACCENT_SWATCHES, DIVIDER_CHOICES, GRADIENTS, MAIN_SWATCHES, dividerDataUrl } from '@/lib/theme';
import { perksFromJson } from '@/lib/validate';
import { discord, discordConfigured, type DiscordRole } from '@/lib/discord';
import type { CreatorRow, TierRow } from '@/lib/db';
import { createPageAction, deleteAccountAction, disconnectDiscordAction, saveDiscordRolesAction, deletePostAction, savePostAction, saveProfileAction, saveTiersAction } from './actions';
import { PaymentsTab } from './payments-tab';

export const dynamic = 'force-dynamic';
const appUrl = () => (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const field = { display: 'grid', gap: 4 } as const;

export default async function Studio({ searchParams }: { searchParams: Promise<{ tab?: string; edit?: string; d?: string }> }) {
  const v = await getViewer();
  if (!v) redirect('/login?next=/studio');
  const c = getCreatorByUser(v.user.id);
  const wrap = { maxWidth: 860, margin: '24px auto', padding: '0 16px', display: 'grid', gap: 16 } as const;

  if (!c) {
    return (
      <div style={wrap}>
        <h1>Start your page</h1>
        <ActionForm action={createPageAction} submit="Create my page">
          <div style={field}><label htmlFor="name">Display name</label><input id="name" name="name" maxLength={60} required /></div>
          <div style={field}><label htmlFor="handle">Handle (your link)</label><input id="handle" name="handle" required pattern="[a-zA-Z0-9][a-zA-Z0-9_-]{1,28}[a-zA-Z0-9]" /><span className="hint">{appUrl()}/yourhandle</span></div>
          <label className="check"><input type="checkbox" name="adult" /> I am 18 or older.</label>
          <label className="check"><input type="checkbox" name="rules" /> I own or have the rights to everything I post, and I have read the <Link href="/rules">content rules</Link>.</label>
        </ActionForm>
      </div>
    );
  }

  const q = await searchParams;
  const tab = q.tab === 'post' || q.tab === 'payments' || q.tab === 'discord' ? q.tab : 'page';
  const tiers = tiersOf(c.id), posts = postsOf(c.id);
  const editing = q.edit ? posts.find((p) => p.id === q.edit) : undefined;
  const tabLink = (id: string, label: string) => <Link key={id} className={`btn${tab === id ? ' btn-brand' : ''}`} href={`/studio?tab=${id}`}>{label}</Link>;
  const share = `${appUrl()}/${c.handle}`;

  return (
    <div style={wrap}>
      <h1>Creator studio</h1>
      <div className="field"><label htmlFor="share">Your page link</label><input id="share" readOnly value={share} /> <Link href={`/${c.handle}`}>Open my page</Link></div>
      <nav style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{tabLink('page', 'Page')}{tabLink('post', 'Posts')}{tabLink('payments', 'Payments')}{tabLink('discord', 'Discord')}</nav>

      {tab === 'page' && (<>
        <ActionForm action={saveProfileAction} submit="Save page">
          <div style={field}><label htmlFor="n">Display name</label><input id="n" name="name" defaultValue={c.name} maxLength={60} /></div>
          <div style={field}><label htmlFor="b">About you</label><textarea id="b" name="bio" defaultValue={c.bio} rows={4} maxLength={1200} /></div>
          <ColorPicker name="mainColor" label="Main color" swatches={MAIN_SWATCHES} value={c.mainColor} />
          <ColorPicker name="accentColor" label="Accent color" swatches={ACCENT_SWATCHES} value={c.accentColor} />
          <div style={field}><label htmlFor="g">Banner when no image</label>
            <select id="g" name="bannerGrad" defaultValue={c.bannerGrad}>{GRADIENTS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></div>
          <div style={field}><label htmlFor="sh">Profile picture shape</label>
            <select id="sh" name="avatarShape" defaultValue={c.avatarShape}><option value="circle">Circle</option><option value="rounded">Rounded</option><option value="square">Square</option></select></div>
          <fieldset className="tier-ed"><legend>Section divider</legend>
            <div className="swatches">{DIVIDER_CHOICES.map((d) => (
              <label key={d.id} className="swatch wide"><input type="radio" name="dividerKind" value={d.id} defaultChecked={c.dividerKind === d.id} />
                <span className="divprev" style={d.id === 'none' ? undefined : { backgroundImage: `url("${dividerDataUrl(d.id, c.accentColor === '#ffffff' ? '#0a7e86' : c.accentColor)}")` }} /><em>{d.n}</em></label>))}
              {c.dividerFile && <label className="swatch wide"><input type="radio" name="dividerKind" value="upload" defaultChecked={c.dividerKind === 'upload'} /><span className="divprev" style={{ backgroundImage: `url("/media/file/${c.dividerFile}")` }} /><em>My upload</em></label>}
            </div>
            <label htmlFor="dvf">Or upload your own</label><input id="dvf" type="file" name="divider" accept="image/png,image/jpeg,image/webp,image/gif" />
          </fieldset>
          {([['banner', 'Banner image', c.bannerFile], ['avatar', 'Profile picture', c.avatarFile], ['logo', 'Footer logo', c.logoFile]] as const).map(([k, label, cur]) => (
            <div key={k} style={field}><label htmlFor={`f-${k}`}>{label}</label><input id={`f-${k}`} type="file" name={k} accept="image/png,image/jpeg,image/webp,image/gif" />
              {cur && <label className="check"><input type="checkbox" name={`clear_${k}`} /> Remove current image</label>}</div>
          ))}
          <label className="check"><input type="checkbox" name="mascotOn" defaultChecked={!!c.mascotOn} /> Show my profile picture as a mascot with speech bubbles</label>
          <div style={field}><label htmlFor="ml">Mascot lines (one per line, up to 4)</label><textarea id="ml" name="mascotLines" defaultValue={c.mascotLines} rows={3} /></div>
        </ActionForm>

        <h2>Tiers</h2>
        <p className="hint">You start with none. Add up to 3. Leave a name empty to remove a tier. Use the same names (or the same prices) on Ko-fi, Buy Me a Coffee or SubscribeStar, and payments match your tiers by themselves.</p>
        <ActionForm action={saveTiersAction} submit="Save tiers">
          {[0, 1, 2].map((i) => {
            const t = tiers[i];
            return (
              <fieldset key={i} className="tier-ed"><legend>Tier {i + 1}</legend>
                <input type="hidden" name={`id${i}`} defaultValue={t?.id ?? ''} />
                <div style={field}><label htmlFor={`tn${i}`}>Name</label><input id={`tn${i}`} name={`name${i}`} defaultValue={t?.name ?? ''} maxLength={40} /></div>
                <div style={field}><label htmlFor={`tp${i}`}>Price per month (whole dollars)</label><input id={`tp${i}`} name={`price${i}`} type="number" min={1} max={10000} defaultValue={t?.price ?? ''} /></div>
                <div style={field}><label htmlFor={`tf${i}`}>What is included (one per line)</label><textarea id={`tf${i}`} name={`perks${i}`} rows={3} defaultValue={t ? perksFromJson(t.perks).join('\n') : ''} /></div>
                <div style={field}><label htmlFor={`tl${i}`}>Payment link for this tier (optional)</label><input id={`tl${i}`} name={`link${i}`} defaultValue={t?.payUrl ?? ''} placeholder="https://" inputMode="url" /></div>
              </fieldset>
            );
          })}
        </ActionForm>

        <h2>Delete my account</h2>
        <p className="hint">This permanently deletes your page, tiers, posts, images and sign-in. Fans' payments stay with the platforms they paid on. It cannot be undone.</p>
        <ActionForm action={deleteAccountAction} submit="Delete everything">
          <div style={field}><label htmlFor="cf">Type your handle ({c.handle}) to confirm</label><input id="cf" name="confirm" autoComplete="off" /></div>
        </ActionForm>
      </>)}

      {tab === 'post' && (<>
        <h2>{editing ? 'Edit post' : 'New post'}</h2>
        <ActionForm action={savePostAction} submit={editing ? 'Save changes' : 'Publish post'} key={editing?.id ?? 'new'}>
          <input type="hidden" name="id" defaultValue={editing?.id ?? ''} />
          <div style={field}><label htmlFor="pt">Title</label><input id="pt" name="title" defaultValue={editing?.title} maxLength={120} required /></div>
          <div style={field}><label htmlFor="pb">Text</label><textarea id="pb" name="body" rows={6} defaultValue={editing?.body} /></div>
          <div style={field}><label htmlFor="pi">Image</label><input id="pi" type="file" name="image" accept="image/png,image/jpeg,image/webp,image/gif" />
            {editing?.imageFile && <label className="check"><input type="checkbox" name="clearImage" /> Remove current image</label>}</div>
          <div style={field}><label htmlFor="pa">Image description (for screen readers)</label><input id="pa" name="imageAlt" defaultValue={editing?.imageAlt} maxLength={200} /></div>
          <div style={field}><label htmlFor="ptier">Who can see it</label>
            <select id="ptier" name="tierId" defaultValue={editing?.tierId ?? ''}><option value="">Everyone</option>{tiers.map((t) => <option key={t.id} value={t.id}>{t.name} and up</option>)}</select></div>
          <label className="check"><input type="checkbox" name="nsfw" defaultChecked={!!editing?.nsfw} /> This post is 18+ (adult content)</label>
        </ActionForm>
        <h2>Your posts</h2>
        {posts.length === 0 && <p className="hint">No posts yet.</p>}
        {posts.map((p) => (
          <div key={p.id} className="tier-ed" style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <span><strong>{p.title}</strong>{p.nsfw ? ' · 18+' : ''}{p.hidden ? ' · removed by admin' : ''}</span>
            <span style={{ display: 'flex', gap: 8 }}>
              <Link className="btn" href={`/studio?tab=post&edit=${p.id}`}>Edit</Link>
              <form action={deletePostAction}><input type="hidden" name="id" value={p.id} /><button className="btn">Delete</button></form>
            </span>
          </div>
        ))}
      </>)}

      {tab === 'discord' && <DiscordTab c={c} tiers={tiers} note={q.d} />}

      {tab === 'payments' && <PaymentsTab c={c} tiers={tiers} />}
    </div>
  );
}

const DISCORD_NOTES: Record<string, [boolean, string]> = {
  added: [true, 'The bot is in your server. Now choose a role for each tier below.'],
  cancelled: [false, 'You cancelled on Discord, so nothing changed.'],
  taken: [false, 'That Discord server is already connected to another page here.'],
  failed: [false, 'Something went wrong adding the bot. Try again. If it keeps happening, check that you picked a server where you can manage the server.'],
};

async function DiscordTab({ c, tiers, note }: { c: CreatorRow; tiers: TierRow[]; note?: string }) {
  const n = note ? DISCORD_NOTES[note] : undefined;
  const banner = n && <p role="status" style={{ color: n[0] ? 'inherit' : 'var(--danger)', fontWeight: 700 }}>{n[1]}</p>;
  if (!discordConfigured()) {
    return <><p className="note">Discord roles are not switched on for this site yet. The site owner needs to finish the Discord setup first.</p></>;
  }
  if (!c.discordGuildId) {
    return (<>
      {banner}
      <p className="note">Give your supporters a role in your own Discord server automatically. The role matches their tier, and it is taken away if their plan ends.</p>
      <ol className="guide">
        <li className="gstep"><h4>Step 1: Add the Otter &amp; Oyster bot to your server</h4><p>You pick the server on Discord. You need to be able to manage that server. The bot only asks for permission to manage roles and to invite people. It does not read messages.</p></li>
        <li className="gstep"><h4>Step 2: Choose a role for each tier</h4><p>The bot can make the roles for you, or you can pick roles you already have.</p></li>
        <li className="gstep"><h4>Step 3: Supporters press “Get my Discord role”</h4><p>That button appears on your page for people with a paid plan. They sign in with Discord, and the bot adds them to your server with their role.</p></li>
      </ol>
      <div><a className="btn btn-brand" href="/api/discord/start?kind=install">Add the bot to my Discord server</a></div>
      {tiers.length === 0 && <p className="hint">You have no tiers yet. Add tiers on the Page tab so there is something to give roles for.</p>}
    </>);
  }
  let roles: DiscordRole[] = [];
  let problem = '';
  try { roles = await discord.manageableRoles(c.discordGuildId); }
  catch { problem = 'We could not read your server. The bot may have been removed from it. Disconnect and add it again.'; }
  return (<>
    {banner}
    {c.discordProblem && <p className="note" role="alert"><strong>Needs your attention:</strong> {c.discordProblem}</p>}
    <p>Connected server: <strong>{c.discordGuildName || 'your server'}</strong></p>
    <div style={field}><label htmlFor="dj">Your supporter Discord link</label>
      <input id="dj" readOnly value={`${appUrl()}/${c.handle}/discord`} />
      <span className="hint">Share this instead of a normal Discord invite, for example in your membership welcome message on Ko-fi, Buy Me a Coffee or SubscribeStar. Supporters sign in, link their Discord once and are added with their role. Keep your server&apos;s own invite links private, because anyone with one can join without a role.</span></div>
    {problem && <p role="status" style={{ color: 'var(--danger)', fontWeight: 700 }}>{problem}</p>}
    {tiers.length === 0 ? <p className="hint">Add tiers on the Page tab first.</p> : (
      <ActionForm action={saveDiscordRolesAction} submit="Save roles">
        {tiers.map((t) => (
          <div key={t.id} style={field}>
            <label htmlFor={`role_${t.id}`}>{t.name} (${t.price}/mo) gets this role</label>
            <select id={`role_${t.id}`} name={`role_${t.id}`} defaultValue={roles.some((r) => r.id === t.discordRoleId) ? t.discordRoleId : ''}>
              <option value="">No role</option>
              <option value="__new__">Make a new role called “{t.name}”</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
        ))}
        <p className="hint">A supporter gets the role for their highest tier only. Roles change as soon as a payment, refund or cancellation comes in. Everything is also re-checked every half hour, which is when a role is removed after a plan runs out. To use a role you already have, it must sit below the bot&apos;s own role in your server&apos;s role list. Roles the bot makes always work.</p>
      </ActionForm>
    )}
    <details className="adv"><summary className="btn">Disconnect this server</summary>
      <div className="advin" style={{ display: 'grid', gap: 8, marginTop: 8 }}>
        <p className="hint">The bot leaves your server. People who already have a role keep it until you remove it yourself.</p>
        <form action={disconnectDiscordAction}><button className="btn">Disconnect</button></form>
      </div></details>
  </>);
}
