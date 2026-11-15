import Link from 'next/link';
import { ensureExample } from '@/lib/seed';
import { getCreatorByHandle } from '@/lib/creators';
import { loadPage } from '@/lib/view';
import { CreatorPage } from '@/components/CreatorPage';

export const dynamic = 'force-dynamic';

export default async function Home() {
  ensureExample();
  const c = getCreatorByHandle('otterlyadorable')!;
  const d = await loadPage(c);
  return (
    <>
      <section style={{ maxWidth: 860, margin: '28px auto 12px', padding: '0 16px', display: 'grid', gap: 12, textAlign: 'center' }}>
        <img src="/brand/oo-wordmark.webp" alt="Otter & Oyster" style={{ maxWidth: 320, margin: '0 auto', height: 'auto' }} />
        <p>Your own page, memberships and tips. Customize it, post for your supporters, and share one link.</p>
        <p><Link className="btn btn-brand" href="/studio">Start your page</Link></p>
        <p className="hint">Below is a demo page, so you can see what yours could look like.</p>
      </section>
      <CreatorPage d={d} path="/" />
    </>
  );
}
