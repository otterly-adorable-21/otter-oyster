import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ActionForm } from '@/components/ActionForm';
import { getViewer } from '@/lib/auth';
import { getCreatorByUser, postsOf, tiersOf, unmatchedPrices } from '@/lib/creators';
import { ACCENT_SWATCHES, DIVIDER_CHOICES, GRADIENTS, MAIN_SWATCHES } from '@/lib/theme';
import { perksFromJson } from '@/lib/validate';
import { assignTierAction, createPageAction, deletePostAction, rotateHookAction, saveGankAction, savePostAction, saveProfileAction, saveTiersAction, verifyGankAction } from './actions';
import { VerifyButton } from './verify-button';

export const dynamic = 'force-dynamic';
const appUrl = () => (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const field = { display: 'grid', gap: 4 } as const;

export default async function Studio({ searchParams }: { searchParams: Promise<{ tab?: string; edit?: string }> }) {
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
  const tab = q.tab === 'post' || q.tab === 'payments' ? q.tab : 'page';
  const tiers = tiersOf(c.id), posts = postsOf(c.id);
  const editing = q.edit ? posts.find((p) => p.id === q.edit) : undefined;
  const tabLink = (id: string, label: string) => <Link key={id} className={`btn${tab === id ? ' btn-brand' : ''}`} href={`/studio?tab=${id}`}>{label}</Link>;
  const share = `${appUrl()}/${c.handle}`;

  return (
    <div style={wrap}>
      <h1>Creator studio</h1>
      <div className="field"><label htmlFor="share">Your page link</label><input id="share" readOnly value={share} /> <Link href={`/${c.handle}`}>Open my page</Link></div>
      <nav style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{tabLink('page', 'Page')}{tabLink('post', 'Posts')}{tabLink('payments', 'Payments')}</nav>

      {tab === 'page' && (<>
        <ActionForm action={saveProfileAction} submit="Save page">
          <div style={field}><label htmlFor="n">Display name</label><input id="n" name="name" defaultValue={c.name} maxLength={60} /></div>
          <div style={field}><label htmlFor="b">About you</label><textarea id="b" name="bio" defaultValue={c.bio} rows={4} maxLength={1200} /></div>
          <div style={field}><label htmlFor="mc">Main color</label><input id="mc" name="mainColor" type="color" defaultValue={c.mainColor} />
            <span className="hint">Ideas: {MAIN_SWATCHES.map((s) => `${s.n} ${s.c}`).join(', ')}</span></div>
          <div style={field}><label htmlFor="ac">Accent color</label><input id="ac" name="accentColor" type="color" defaultValue={c.accentColor} />
            <span className="hint">Ideas: {ACCENT_SWATCHES.map((s) => `${s.n} ${s.c}`).join(', ')}</span></div>
          <div style={field}><label htmlFor="g">Banner when no image</label>
            <select id="g" name="bannerGrad" defaultValue={c.bannerGrad}>{GRADIENTS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></div>
          <div style={field}><label htmlFor="sh">Profile picture shape</label>
            <select id="sh" name="avatarShape" defaultValue={c.avatarShape}><option value="circle">Circle</option><option value="rounded">Rounded</option><option value="square">Square</option></select></div>
          <div style={field}><label htmlFor="dv">Section divider</label>
            <select id="dv" name="dividerKind" defaultValue={c.dividerKind}>{DIVIDER_CHOICES.map((d) => <option key={d.id} value={d.id}>{d.n}</option>)}{c.dividerFile && <option value="upload">My upload</option>}</select>
            <label htmlFor="dvf">Or upload your own</label><input id="dvf" type="file" name="divider" accept="image/png,image/jpeg,image/webp,image/gif" /></div>
          {([['banner', 'Banner image', c.bannerFile], ['avatar', 'Profile picture', c.avatarFile], ['logo', 'Footer logo', c.logoFile]] as const).map(([k, label, cur]) => (
            <div key={k} style={field}><label htmlFor={`f-${k}`}>{label}</label><input id={`f-${k}`} type="file" name={k} accept="image/png,image/jpeg,image/webp,image/gif" />
              {cur && <label className="check"><input type="checkbox" name={`clear_${k}`} /> Remove current image</label>}</div>
          ))}
          <label className="check"><input type="checkbox" name="mascotOn" defaultChecked={!!c.mascotOn} /> Show my profile picture as a mascot with speech bubbles</label>
          <div style={field}><label htmlFor="ml">Mascot lines (one per line, up to 4)</label><textarea id="ml" name="mascotLines" defaultValue={c.mascotLines} rows={3} /></div>
        </ActionForm>

        <h2>Tiers</h2>
        <p className="hint">You start with none. Add up to 3. Leave a name empty to remove a tier. Use the same names and prices on Gank.</p>
        <ActionForm action={saveTiersAction} submit="Save tiers">
          {[0, 1, 2].map((i) => {
            const t = tiers[i];
            return (
              <fieldset key={i} className="tier-ed"><legend>Tier {i + 1}</legend>
                <input type="hidden" name={`id${i}`} defaultValue={t?.id ?? ''} />
                <div style={field}><label htmlFor={`tn${i}`}>Name</label><input id={`tn${i}`} name={`name${i}`} defaultValue={t?.name ?? ''} maxLength={40} /></div>
                <div style={field}><label htmlFor={`tp${i}`}>Price per month (whole dollars)</label><input id={`tp${i}`} name={`price${i}`} type="number" min={1} max={10000} defaultValue={t?.price ?? ''} /></div>
                <div style={field}><label htmlFor={`tf${i}`}>What is included (one per line)</label><textarea id={`tf${i}`} name={`perks${i}`} rows={3} defaultValue={t ? perksFromJson(t.perks).join('\n') : ''} /></div>
                <div style={field}><label htmlFor={`tl${i}`}>Gank link for this tier (optional)</label><input id={`tl${i}`} name={`link${i}`} defaultValue={t?.gankUrl ?? ''} placeholder="https://" inputMode="url" /></div>
              </fieldset>
            );
          })}
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

      {tab === 'payments' && (() => {
        const waiting = unmatchedPrices(c.id);
        return (<>
          <p className="note">Payments run through Gank. Fans pay there, then sign in here with the same email and their posts unlock.</p>
          <ol className="guide">
            <li className="gstep"><h4>Step 1: Create your tiers on Gank</h4><p>Use the same names and prices you set on the Page tab.</p></li>
            <li className={`gstep${c.gankUrl ? ' is-done' : ''}`}><h4>Step 2: Paste your public Gank page link below</h4></li>
            <li className="gstep"><h4>Step 3: Put your verification code in your Gank bio</h4><p>This proves the page is yours.</p></li>
            <li className={`gstep${c.gankVerified ? ' is-done' : ''}`}><h4>Step 4: Press Check my Gank page</h4></li>
            <li className="gstep"><h4>Step 5: Match your tiers (only if asked)</h4><p>After the first payment arrives, a box below asks which of your tiers it belongs to.</p></li>
          </ol>
          <h2>1. Your Gank page</h2>
          <ActionForm action={saveGankAction} submit="Save links">
            <div style={field}><label htmlFor="gu">Gank page link</label><input id="gu" name="gankUrl" defaultValue={c.gankUrl} placeholder="https://" inputMode="url" autoCapitalize="off" />
              {c.gankNick && <span className="hint">We read your Gank name as: {c.gankNick}</span>}</div>
            <div style={field}><label htmlFor="gt">Gank tip link (optional)</label><input id="gt" name="tipUrl" defaultValue={c.tipUrl} placeholder="https://" inputMode="url" autoCapitalize="off" />
              <span className="hint">The Leave a tip button goes here. If empty, it goes to your Gank page.</span></div>
          </ActionForm>
          <h2>2. Prove it is yours</h2>
          <p>Add this code to your Gank bio or page description:</p>
          <p><code style={{ fontSize: '1.25rem', fontWeight: 800 }}>{c.verifyCode}</code></p>
          <p className="hint">Status: {c.gankVerified ? 'Verified' : 'Not verified yet'}</p>
          <VerifyButton action={verifyGankAction} disabled={!c.gankUrl} />
          <h2>3. Unmatched payments</h2>
          {waiting.length === 0 ? <p className="hint">Nothing waiting.</p> : waiting.map((w) => (
            <form key={w.priceRef} action={assignTierAction} className="tier-ed" style={{ display: 'grid', gap: 8 }}>
              <p>{w.n} payment{w.n === 1 ? '' : 's'} came in for a Gank tier we could not match yet. Which of your tiers is it?</p>
              <input type="hidden" name="priceRef" value={w.priceRef} />
              <select name="tierId" aria-label="Your tier">{tiers.map((t) => <option key={t.id} value={t.id}>{t.name} (${t.price}/mo)</option>)}</select>
              <div><button className="btn btn-brand">Match this tier</button></div>
            </form>
          ))}
          <details className="adv"><summary className="btn">Advanced: your own webhook address</summary>
            <div className="advin" style={{ display: 'grid', gap: 8, marginTop: 8 }}>
              <p className="hint">Most creators can skip this. Use it only if automatic unlocking is not working or Gank asks for it. Keep it private.</p>
              <input readOnly value={`${appUrl()}/api/webhooks/gank/${c.hookSecret}`} aria-label="Webhook URL" />
              <form action={rotateHookAction}><button className="btn">Make a new address</button></form>
            </div></details>
        </>);
      })()}
    </div>
  );
}
