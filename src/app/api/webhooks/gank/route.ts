import { NextResponse } from 'next/server';
import { handleGankRequest, platformKeyOk } from '@/lib/webhook-http';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!platformKeyOk(req)) return NextResponse.json({ ok: false }, { status: 401 });
  return handleGankRequest(req, {});
}
