import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { getViewer } from '@/lib/auth';
import { getCreatorByUser } from '@/lib/creators';
import { logout } from './actions';

export const metadata: Metadata = {
  title: 'Otter & Oyster',
  description: 'Pages, memberships and tips for creators.',
  robots: { index: true, follow: true },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const v = await getViewer();
  const mine = v ? getCreatorByUser(v.user.id) : undefined;
  return (
    <html lang="en">
      <body>
        <header className="bar"><div className="bar-in">
          <Link className="brand" href="/"><img className="brandmark" src="/brand/oo-mark.webp" alt="" /><span>Otter &amp; Oyster</span></Link>
          <nav className="who" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {mine && <Link className="btn" href={`/${mine.handle}`}>My page</Link>}
            {v ? <Link className="btn" href="/studio">{mine ? 'Creator studio' : 'Start a page'}</Link> : <Link className="btn" href="/login">Sign in</Link>}
            {v && <form action={logout}><button className="btn btn-ghost">Sign out</button></form>}
          </nav>
        </div></header>
        <main>{children}</main>
        <footer style={{ padding: '24px 16px', textAlign: 'center', fontSize: '.875rem', color: 'var(--muted)' }}>
          <Link href="/rules">Content rules</Link> · <Link href="/terms">Terms</Link> · <Link href="/report">Report content</Link>
        </footer>
      </body>
    </html>
  );
}
