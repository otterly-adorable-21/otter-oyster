import { NextResponse } from 'next/server';
import { get } from '@/lib/db';
import { handleGankRequest } from '@/lib/webhook-http';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ secret: string }> }) {
  const { secret } = await ctx.params;
  const c = get<{ id: string; gankSigningKey: string }>('SELECT id, gankSigningKey FROM creators WHERE hookSecret = ? AND suspended = 0', secret);
  if (!c) return NextResponse.json({ ok: false }, { status: 404 });
  return handleGankRequest(req, { forcedCreatorId: c.id, signingKey: c.gankSigningKey });
}
