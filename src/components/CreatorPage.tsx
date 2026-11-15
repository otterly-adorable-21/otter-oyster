import type { CSSProperties } from 'react';
import Link from 'next/link';
import { bannerGradient, dividerDataUrl, themeVars } from '@/lib/theme';
import type { PageData, PostView } from '@/lib/view';
import { confirmAge, toggleHide } from '@/app/actions';

const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';
const dateText = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const fileUrl = (n: string | null) => (n ? `/media/file/${n}` : null);

const RAYS: [number, number, number, number][] = [[6, 7, -16, 0], [22, 12, -16, -2.2], [40, 8, -14, -4.5], [58, 14, -17, -6.7], [78, 9, -15, -3.3]];
const BUBBLES = { L: [6, 12, 19, 27, 34, 41, 49, 56, 63, 70, 77, 84, 91, 96], W: [8, 5, 12, 7, 10, 5, 14, 6, 9, 12, 6, 10, 7, 5], D: [0, 2.5, 5.5, 3.5, 8, 1.2, 4.4, 9, 1.8, 6.5, 3, 7.5, 0.6, 5] };

function Art({ seed, blur }: { seed: string; blur?: boolean }) {
  let n = 0; for (const ch of seed) n = (n * 31 + ch.charCodeAt(0)) % 9973;
  const h = n % 360, cx = 40 + (n % 80);
  return (
    <div className={`art${blur ? ' blur' : ''}`} style={{ '--h': h } as CSSProperties} aria-hidden="true">
      <svg viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice"><circle cx={cx} cy="34" r="20" /><path d="M0 90L48 54l40 24 32-28 40 40z" /></svg>
    </div>
  );
}

function Post({ p, d, path }: { p: PostView; d: PageData; path: string }) {
  const head = (
    <>
      <h3>{p.title}</h3>
      <div className="meta">
        <span>{dateText(p.date)}</span>
        <span className="badge">{p.tierName ? `Tier: ${p.tierName}` : 'Public'}</span>
        {p.nsfw && <span className="badge nsfw">18+</span>}
      </div>
    </>
  );
  const hideBtn = (label: string) => (
    <form action={toggleHide}><input type="hidden" name="path" value={path} /><button className="btn">{label}</button></form>
  );
  if (p.state === 'hidden') {
    return <article className="post solo"><div className="post-text">{head}<p>Hidden because you chose to hide 18+ posts.</p>{hideBtn('Show 18+ posts')}</div></article>;
  }
  if (p.state === 'age') {
    return (
      <article className="post">
        <div className="post-media"><div className="art" style={{ background: '#0a3f43' }} aria-hidden="true" /></div>
        <div className="post-text">{head}<p>This post is for adults. You must be 18 or older to view it.</p>
          <div className="row">
            <form action={confirmAge}><input type="hidden" name="path" value={path} /><button className="btn btn-creator">I am 18 or older</button></form>
            {hideBtn('Hide 18+ posts')}
          </div></div>
      </article>
    );
  }
  if (p.state === 'locked') {
    const t = d.tiers.find((x) => x.id === p.tierId);
    return (
      <article className="post">
        <div className="post-media"><Art seed={p.id} blur /><div className="lockdot" aria-hidden="true">🔒</div></div>
        <div className="post-text">{head}
          <p>{p.tierName} tier and up. Join for ${p.tierPrice}/mo to unlock this post.</p>
          {t?.joinUrl && <div><a className="btn btn-creator" href={t.joinUrl} target="_blank" rel="noopener noreferrer">Unlock with {t.name}</a></div>}
        </div>
      </article>
    );
  }
  return (
    <article className="post">
      <div className="post-media">
        {p.hasImage ? <img className="post-img" src={`/media/post/${p.id}`} alt={p.imageAlt || p.title} /> : <Art seed={p.id} />}
      </div>
      <div className="post-text">{head}<p style={{ whiteSpace: 'pre-wrap' }}>{p.body}</p></div>
    </article>
  );
}

export function CreatorPage({ d, path, background }: { d: PageData; path: string; background?: string }) {
  const c = d.creator;
  const vars = themeVars(c.mainColor, c.accentColor) as CSSProperties;
  const bannerUrl = fileUrl(c.bannerFile) ?? (c.isExample ? '/example/pond.webp' : null);
  const avatarUrl = fileUrl(c.avatarFile) ?? (c.isExample ? '/example/otter.webp' : null);
  const logoUrl = fileUrl(c.logoFile) ?? (c.isExample ? '/example/wordmark.webp' : '/brand/oo-wordmark.webp');
  const divUrl = c.dividerKind === 'upload' ? fileUrl(c.dividerFile)
    : c.dividerKind === 'lily' ? '/example/divider.webp'
    : c.dividerKind === 'none' ? null : dividerDataUrl(c.dividerKind, c.accentColor) || null;
  const lines = c.mascotLines.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 4);
  const cur = d.rank;
  return (
    <div className="themed" style={vars}>
      <div className="page" style={background ? { backgroundImage: `url(${background})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}>
        <div className="rays" aria-hidden="true">{RAYS.map((r, i) => <span key={i} style={{ left: `${r[0]}%`, width: `${r[1]}%`, transform: `rotate(${r[2]}deg)`, animationDelay: `${r[3]}s` }} />)}</div>
        <div className="bubbles" aria-hidden="true">{BUBBLES.L.map((l, i) => <span key={i} style={{ left: `${l}%`, width: BUBBLES.W[i], height: BUBBLES.W[i], animationDelay: `${BUBBLES.D[i]}s` }} />)}</div>
        <div className="page-in">
          <div className="card">
            {bannerUrl ? <img className="banner-img" src={bannerUrl} alt="Page banner" /> : <div className="banner-grad" style={{ background: bannerGradient(c.mainColor, c.bannerGrad) }} role="img" aria-label="Page banner" />}
            <div className="head">
              {avatarUrl ? <img className={`avatar av-${c.avatarShape}`} src={avatarUrl} alt="Profile picture" /> : <div className={`avatar av-${c.avatarShape}`} aria-hidden="true">{initials(c.name)}</div>}
              <div className="who-info">
                <h1>{c.name}</h1>
                <div className="handle">@{c.handle}</div>
                <p className="bio" style={{ whiteSpace: 'pre-wrap' }}>{c.bio}</p>
                <div className="who-actions">
                  {d.discordJoin && <a className="btn btn-brand" href={`/api/discord/start?kind=join&creator=${c.handle}`}>Get my Discord role</a>}
                  <Link className="btn" href={`/${c.handle}/claim`}>Already paid? Claim access</Link>
                  <Link className="btn btn-ghost" href={`/report?creator=${c.handle}`}>Report</Link>
                </div>
              </div>
            </div>
          </div>
          <div className="cols top"><div>
            {divUrl && <div className="divider" style={{ backgroundImage: `url("${divUrl}")` }} aria-hidden="true" />}
            <div className="sec-h"><h2>Posts</h2>
              <form action={toggleHide}><input type="hidden" name="path" value={path} />
                <label className="check"><input type="checkbox" defaultChecked={d.hideNsfw} /> Hide 18+ posts</label>
                <button className="btn btn-ghost">Apply</button></form>
            </div>
            <div className="feed">
              {d.posts.length === 0 && <p className="hint">No posts yet.</p>}
              {d.posts.map((p) => <Post key={p.id} p={p} d={d} path={path} />)}
            </div>
          </div></div>
          <div className="foot"><img src={logoUrl} alt={`${c.name} logo`} /></div>
          <div className="dock">
            <h2>{c.name}</h2>
            <div className="dock-tiers">
              {d.tiers.length === 0 || !d.canPay ? <span className="dock-note">Memberships are not open yet</span> : d.tiers.map((t, i) => {
                const idx = i + 1;
                if (idx === cur) return <button key={t.id} className="btn chip" disabled>{t.name}: your plan</button>;
                if (idx < cur) return <button key={t.id} className="btn chip" disabled>{t.name}: included</button>;
                return t.joinUrl ? <a key={t.id} className="btn btn-creator chip" href={t.joinUrl} target="_blank" rel="noopener noreferrer">{t.name} ${t.price}/mo</a> : null;
              })}
            </div>
            {d.tiers.length > 0 && (
              <details className="perkbox"><summary className="btn">What is included</summary>
                <div className="perkpanel">{d.tiers.map((t) => <section key={t.id}><h3>{t.name} <span>${t.price}/mo</span></h3><ul className="perks">{t.perks.map((x, i) => <li key={i}><span>{x}</span></li>)}</ul></section>)}</div>
              </details>
            )}
            {d.tipUrl && <a className="btn btn-creator" href={d.tipUrl} target="_blank" rel="noopener noreferrer">Leave a tip</a>}
          </div>
        </div>
      </div>
      {c.mascotOn === 1 && avatarUrl && lines.length > 0 && (
        <div className="mascot-wrap" aria-hidden="true"><img className="mascot" src={avatarUrl} alt="" />
          {lines.length === 1 ? <div className="speech solo">{lines[0]}</div> : [0, 1, 2, 3].map((i) => <div key={i} className="speech" style={{ animationDelay: `${i * 1.6}s` }}>{lines[i % lines.length]}</div>)}
        </div>
      )}
    </div>
  );
}
