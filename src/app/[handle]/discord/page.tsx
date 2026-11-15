import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getViewer } from '@/lib/auth';
import { getCreatorByHandle, tiersOf } from '@/lib/creators';
import { tierRanks, viewerRank } from '@/lib/access';
import { discordConfigured } from '@/lib/discord';

export const dynamic = 'force-dynamic';

// The link a creator shares with supporters instead of a normal Discord invite.
// Signing in and linking Discord here is what lets the bot give the right role on arrival.
export default async function JoinDiscord({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const c = getCreatorByHandle(handle);
  if (!c || c.suspended) notFound();
  const v = await getViewer();
  const live = !!c.discordGuildId && discordConfigured();
  const rank = v ? viewerRank(c.id, v.emails, tierRanks(tiersOf(c.id))) : 0;
  const wrap = { maxWidth: 560, margin: '32px auto', padding: '0 16px', display: 'grid', gap: 16 } as const;

  return (
    <div style={wrap}>
      <h1>Join {c.name}&apos;s Discord</h1>
      {!live && <p>This creator has not opened a Discord server here yet.</p>}
      {live && !v && (<>
        <p>Sign in with the email you used to support {c.name}. Then link your Discord account and you will be added to the server with your role.</p>
        <p><Link className="btn btn-brand" href={`/login?next=/${c.handle}/discord`}>Sign in</Link></p>
      </>)}
      {live && v && rank > 0 && (<>
        <p>You are a supporter. Link your Discord account and we will add you to the server with your tier&apos;s role. You only need to do this once. After that, your role follows your plan.</p>
        <p><a className="btn btn-brand" href={`/api/discord/start?kind=join&creator=${c.handle}`}>Link Discord and join</a></p>
      </>)}
      {live && v && rank === 0 && (<>
        <p>We could not find an active plan for the email you are signed in with. If you have just paid, it can take a few minutes. If you paid with a different email, claim your access first.</p>
        <p style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link className="btn" href={`/${c.handle}/claim`}>Claim access</Link>
          <Link className="btn btn-ghost" href={`/${c.handle}`}>See {c.name}&apos;s page</Link>
        </p>
      </>)}
    </div>
  );
}
