import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getViewer } from '@/lib/auth';
import { getCreatorByHandle } from '@/lib/creators';
import { ClaimForm } from './form';

export const dynamic = 'force-dynamic';

export default async function Claim({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const c = getCreatorByHandle(handle);
  if (!c || c.suspended) notFound();
  const v = await getViewer();
  return (
    <div className="wrap" style={{ maxWidth: 560, margin: '32px auto', padding: '0 16px', display: 'grid', gap: 16 }}>
      <h1>Claim your access to {c.name}</h1>
      <p>If you paid on Gank with a different email than the one you sign in with, add that email here. We will send a confirmation link to it. Once confirmed, your posts unlock.</p>
      {v ? <ClaimForm handle={c.handle} /> : <p><Link className="btn btn-brand" href={`/login?next=/${c.handle}/claim`}>Sign in first</Link></p>}
      <p><Link href={`/${c.handle}`}>Back to the page</Link></p>
    </div>
  );
}
