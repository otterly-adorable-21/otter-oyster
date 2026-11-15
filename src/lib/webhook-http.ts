import { NextResponse } from 'next/server';
import { gankSignatureValid, parseGankPayload, processGankEvent, safeEqual, signatureValid } from './gank';

const MAX_BODY = 100 * 1024;

/** Shared by both webhook addresses. Reads a capped body, checks any signature, and always answers fast. */
export async function handleGankRequest(req: Request, opts: { forcedCreatorId?: string; signingKey?: string }): Promise<NextResponse> {
  const len = Number(req.headers.get('content-length') || 0);
  if (len > MAX_BODY) return NextResponse.json({ ok: false }, { status: 413 });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ ok: false }, { status: 413 });

  // A creator's own signing key (from Gank when they registered the webhook): enforced whenever it is set.
  if (opts.signingKey && !gankSignatureValid(raw, req.headers.get('gank-signature'), opts.signingKey)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  // Optional platform-wide HMAC, only enforced when a signing secret is configured.
  const signingSecret = process.env.GANK_SIGNING_SECRET || '';
  if (signingSecret) {
    const header = req.headers.get(process.env.GANK_SIGNATURE_HEADER || 'x-signature');
    if (!signatureValid(raw, header, signingSecret)) return NextResponse.json({ ok: false }, { status: 401 });
  }

  let body: unknown;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }
  const ev = parseGankPayload(body);
  if (!ev) return NextResponse.json({ ok: false }, { status: 400 });

  try {
    const r = processGankEvent(ev, raw, { forcedCreatorId: opts.forcedCreatorId });
    return NextResponse.json({ ok: true, outcome: r.outcome });
  } catch (e) {
    console.error('gank webhook failed', e);
    // 500 lets the sender retry; our own dedupe makes a retry safe.
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

export function platformKeyOk(req: Request): boolean {
  const want = process.env.GANK_WEBHOOK_SECRET || '';
  if (!want) return false;
  const given = new URL(req.url).searchParams.get('key') || '';
  return safeEqual(given, want);
}
