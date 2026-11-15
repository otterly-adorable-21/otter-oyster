import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth';
import { getCreatorByHandle, getCreatorByUser } from '@/lib/creators';
import { discordConfigured, fanUrl, installUrl } from '@/lib/discord';
import { createState } from '@/lib/discord-sync';

export const dynamic = 'force-dynamic';
const appUrl = () => (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const go = (path: string) => NextResponse.redirect(appUrl() + path, 303);

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const kind = q.get('kind');
  const v = await getViewer();
  if (!v) return go('/login?next=/studio');
  if (!discordConfigured()) return go('/discord?s=off');

  if (kind === 'install') {
    const c = getCreatorByUser(v.user.id);
    if (!c) return go('/studio');
    return NextResponse.redirect(installUrl(createState('install', v.user.id, c.id)), 303);
  }
  if (kind === 'join') {
    const c = getCreatorByHandle(q.get('creator') || '');
    if (!c || c.suspended || !c.discordGuildId) return go('/discord?s=none');
    return NextResponse.redirect(fanUrl(createState('join', v.user.id, c.id)), 303);
  }
  return go('/');
}
