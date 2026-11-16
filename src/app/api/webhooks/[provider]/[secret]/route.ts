import { NextResponse } from 'next/server';
import { run } from '@/lib/db';
import { soon, syncEmail } from '@/lib/discord-sync';
import { bmcSignatureValid, parseFor, subscribeStarSignatureValid } from '@/lib/payments/parse';
import { kofiTokenOk, linkBySecret, processPaymentEvent } from '@/lib/payments/process';
import { isProvider } from '@/lib/payments/providers';

export const dynamic = 'force-dynamic';
const MAX_BODY = 100 * 1024;
const no = (status: number) => NextResponse.json({ ok: false }, { status });

// One private address per creator per platform: /api/webhooks/kofi/<secret>, /bmc/<secret>, /subscribestar/<secret>.
// (Gank keeps its own route at /api/webhooks/gank.)
export async function POST(req: Request, ctx: { params: Promise<{ provider: string; secret: string }> }) {
  const { provider, secret } = await ctx.params;
  if (!isProvider(provider)) return no(404);
  const link = linkBySecret(provider, secret);
  if (!link) return no(404);

  if (Number(req.headers.get('content-length') || 0) > MAX_BODY) return no(413);
  const raw = await req.text();
  if (raw.length > MAX_BODY) return no(413);

  // When the creator saved the platform's secret, every message must carry a matching signature.
  if (link.signingKey && provider === 'bmc' && !bmcSignatureValid(raw, req.headers, link.signingKey)) return no(401);
  if (link.signingKey && provider === 'subscribestar' && !subscribeStarSignatureValid(raw, req.headers, link.signingKey)) return no(401);

  const ev = parseFor(provider, raw);
  if (!ev) return no(400);

  if (provider === 'kofi') {
    const t = kofiTokenOk(link, ev.bodyToken);
    if (t === 'bad') return no(401);
    if (t === 'learn') {
      run("UPDATE payment_links SET signingKey = ? WHERE id = ? AND signingKey = ''", ev.bodyToken!.slice(0, 200), link.id);
    }
  }

  try {
    const r = processPaymentEvent(link, ev, raw);
    // Give or take the Discord role now, not at the next half-hourly check.
    if (r.outcome === 'processed' && r.creatorId && ev.email) soon('role update', () => syncEmail(r.creatorId!, ev.email));
    return NextResponse.json({ ok: true, outcome: r.outcome });
  } catch (e) {
    console.error(`${provider} webhook failed`, e);
    // 500 lets the platform retry; our dedupe makes a retry safe.
    return no(500);
  }
}
