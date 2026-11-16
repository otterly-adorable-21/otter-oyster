import Link from 'next/link';
import { getCreatorByHandle } from '@/lib/creators';

export const dynamic = 'force-dynamic';

// Plain results page after a fan links Discord. Only fixed messages are shown, never text from the address.
const TEXT: Record<string, string> = {
  ok: 'You are in. Your role is on your Discord account. Open the server to see your channels.',
  norole: 'You are in the server. This creator has not picked a Discord role for your tier yet. You will get it by yourself as soon as they do.',
  botgone: 'The Otter & Oyster bot is no longer in this creator\'s Discord server, so we could not add you. We have let the creator know.',
  nopay: 'Your Discord is linked, but we could not find an active membership for the email you signed in with. If you paid with a different email, use "Already paid? Claim access" on the creator page, then try again.',
  used: 'That Discord account is already linked to a different Otter & Oyster account.',
  cancelled: 'Discord sign-in was cancelled. Nothing was changed.',
  expired: 'That link expired or was started from a different sign-in. Please start again from the creator page.',
  error: 'Something went wrong talking to Discord. Please try again in a minute.',
  none: 'This creator has not connected a Discord server.',
  off: 'Discord roles are not switched on for this site yet.',
};

export default async function DiscordDone({ searchParams }: { searchParams: Promise<{ s?: string; c?: string }> }) {
  const q = await searchParams;
  const msg = TEXT[q.s || ''] || TEXT.error;
  const creator = q.c ? getCreatorByHandle(q.c) : undefined;
  return (
    <div style={{ maxWidth: 560, margin: '48px auto', padding: '0 16px', display: 'grid', gap: 12 }}>
      <h1>Discord</h1>
      <p role="status">{msg}</p>
      <p>{creator ? <Link className="btn btn-brand" href={`/${creator.handle}`}>Back to {creator.name}</Link> : <Link className="btn" href="/">Back to the site</Link>}</p>
    </div>
  );
}
