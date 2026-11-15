import { createHmac, timingSafeEqual } from 'node:crypto';
import { all, get, run, tx, newId, nowIso, type CreatorRow, type TierRow, type WebhookEventRow } from './db';
import { normalizeEmail } from './validate';

// Gank adapter: turns Gank's webhook payloads into our own events, then into entitlements.
// Based on two sample payloads. Anything marked VERIFY needs confirming against Gank's docs.

export type Kind = 'subscription_payment' | 'one_time_purchase' | 'subscription_ended' | 'refund' | 'ignored';

export interface GankEvent {
  providerEventId: string;
  eventName: string;
  kind: Kind;
  creatorNick: string;
  creatorUserId: string;
  email: string;
  priceRef: string | null;
  itemRef: string | null;
  billingPeriod: number | null;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export function parseGankPayload(body: unknown): GankEvent | null {
  const root = obj(body);
  const eventName = str(root.event);
  const data = obj(root.data);
  const providerEventId = str(data.human_id);
  if (!eventName || !providerEventId || providerEventId.length > 100) return null;
  const inner = obj(obj(data.usecase_data).data);
  const paid = str(data.payment_status).toUpperCase() === 'SUCCEED';

  let kind: Kind = 'ignored';
  if (eventName === 'USER_MEMBERSHIP.TX_SUCCEED' && paid) kind = 'subscription_payment';
  else if (eventName === 'DIGITAL_GOODS.TX_SUCCEED' && paid) kind = 'one_time_purchase';
  // VERIFY: Gank's real names for refunds, chargebacks and cancellations are unknown. These patterns are a guess.
  else if (/REFUND|CHARGEBACK|DISPUTE/i.test(eventName)) kind = 'refund';
  else if (/MEMBERSHIP.*(CANCEL|EXPIRE|END)/i.test(eventName)) kind = 'subscription_ended';

  const email = normalizeEmail(inner.subscriber_user_email ?? inner.buyer_user_email) ?? '';
  const period = Number(inner.billing_period);
  return {
    providerEventId,
    eventName,
    kind,
    creatorNick: str(inner.creator_user_nickname).toLowerCase(),
    creatorUserId: str(inner.creator_user_id),
    email,
    priceRef: str(inner.price_event_id) || null,
    itemRef: str(inner.catalog_id) || null,
    billingPeriod: Number.isInteger(period) && period > 0 && period <= 24 ? period : null,
  };
}

// ---------- authenticity ----------

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** HMAC-SHA256 check for when Gank signs its webhooks. Accepts hex or base64, with or without a "sha256=" prefix. */
export function signatureValid(rawBody: string, header: string | null, secret: string): boolean {
  if (!header || !secret) return false;
  const given = header.trim().replace(/^sha256=/i, '');
  const mac = createHmac('sha256', secret).update(rawBody).digest();
  return safeEqual(given.toLowerCase(), mac.toString('hex')) || safeEqual(given, mac.toString('base64'));
}

// ---------- processing ----------

export type Outcome = 'processed' | 'unmatched' | 'ignored' | 'rejected' | 'duplicate';
export interface ProcessResult { outcome: Outcome; note: string }

const GRACE_DAYS = 3;

export function addMonths(d: Date, months: number): Date {
  const out = new Date(d.getTime());
  const day = out.getUTCDate();
  out.setUTCDate(1);
  out.setUTCMonth(out.getUTCMonth() + months);
  const last = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(day, last));
  return out;
}

export const paidThroughFor = (at: Date, months: number | null): Date =>
  new Date(addMonths(at, months ?? 1).getTime() + GRACE_DAYS * 86400_000);

function grant(creatorId: string, email: string, tierId: string, at: Date, months: number | null, sourceEventId: string): void {
  const through = paidThroughFor(at, months).toISOString();
  const now = nowIso();
  const existing = get<{ id: string; paidThrough: string }>('SELECT id, paidThrough FROM entitlements WHERE creatorId = ? AND email = ?', creatorId, email);
  if (!existing) {
    run('INSERT INTO entitlements (id, creatorId, email, tierId, status, paidThrough, sourceEventId, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?)',
      newId(), creatorId, email, tierId, 'active', through, sourceEventId, now, now);
  } else {
    // A renewal only ever pushes the date forward; a late-arriving older event cannot shorten access.
    const best = existing.paidThrough > through ? existing.paidThrough : through;
    run("UPDATE entitlements SET tierId = ?, status = 'active', paidThrough = ?, sourceEventId = ?, updatedAt = ? WHERE id = ?",
      tierId, best, sourceEventId, now, existing.id);
  }
}

export interface ProcessOptions {
  /** Set when the request came in on a creator's own webhook address: that creator is trusted without a name match. */
  forcedCreatorId?: string;
  now?: Date;
}

export function processGankEvent(ev: GankEvent, raw: string, opts: ProcessOptions = {}): ProcessResult {
  const at = opts.now ?? new Date();
  return tx((): ProcessResult => {
    const dup = get<{ id: string }>('SELECT id FROM webhook_events WHERE provider = ? AND providerEventId = ?', 'gank', ev.providerEventId);
    if (dup) return { outcome: 'duplicate', note: 'already processed' };

    const creator = opts.forcedCreatorId
      ? get<CreatorRow>('SELECT * FROM creators WHERE id = ? AND suspended = 0', opts.forcedCreatorId)
      : ev.creatorNick
        ? get<CreatorRow>('SELECT * FROM creators WHERE gankNick = ? AND gankVerified = 1 AND suspended = 0', ev.creatorNick)
        : undefined;

    const save = (outcome: Outcome, note: string): ProcessResult => {
      run(`INSERT INTO webhook_events (id, provider, providerEventId, eventName, creatorNick, creatorId, email, priceRef, billingPeriod, status, note, raw, receivedAt)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        newId(), 'gank', ev.providerEventId, ev.eventName, ev.creatorNick, creator?.id ?? null, ev.email, ev.priceRef, ev.billingPeriod,
        outcome, note, raw.slice(0, 20000), at.toISOString());
      return { outcome, note };
    };

    if (ev.kind === 'ignored') return save('ignored', 'event type not used');
    if (!ev.email) return save('rejected', 'no valid email in the payload');
    if (!creator) return save('unmatched', 'no verified creator matches this Gank name');

    if (ev.kind === 'one_time_purchase') {
      run('INSERT OR IGNORE INTO donations (id, creatorId, email, providerEventId, itemRef, createdAt) VALUES (?,?,?,?,?,?)',
        newId(), creator.id, ev.email, ev.providerEventId, ev.itemRef, at.toISOString());
      return save('processed', 'recorded as a tip or purchase');
    }
    if (ev.kind === 'refund') {
      run("UPDATE entitlements SET status = 'revoked', paidThrough = ?, updatedAt = ? WHERE creatorId = ? AND email = ?", at.toISOString(), nowIso(), creator.id, ev.email);
      return save('processed', 'access revoked');
    }
    if (ev.kind === 'subscription_ended') {
      run("UPDATE entitlements SET status = 'canceled', updatedAt = ? WHERE creatorId = ? AND email = ? AND status = 'active'", nowIso(), creator.id, ev.email);
      return save('processed', 'canceled, access continues until the paid date');
    }
    // subscription_payment
    if (!ev.priceRef) return save('unmatched', 'no tier reference in the payload');
    const tier = get<TierRow>('SELECT * FROM tiers WHERE creatorId = ? AND gankTierRef = ?', creator.id, ev.priceRef);
    if (!tier) return save('unmatched', 'this Gank tier has not been matched to one of your tiers yet');
    grant(creator.id, ev.email, tier.id, at, ev.billingPeriod, ev.providerEventId);
    return save('processed', 'access granted');
  });
}

/** Creator picks which of their tiers a Gank tier reference belongs to; earlier unmatched payments are then applied. */
export function assignTierRef(creatorId: string, tierId: string, priceRef: string): number {
  return tx(() => {
    const tier = get<TierRow>('SELECT * FROM tiers WHERE id = ? AND creatorId = ?', tierId, creatorId);
    if (!tier) return 0;
    run('UPDATE tiers SET gankTierRef = NULL WHERE creatorId = ? AND gankTierRef = ?', creatorId, priceRef);
    run('UPDATE tiers SET gankTierRef = ? WHERE id = ?', priceRef, tierId);
    const waiting = all<WebhookEventRow>(
      "SELECT * FROM webhook_events WHERE creatorId = ? AND priceRef = ? AND status = 'unmatched' ORDER BY receivedAt",
      creatorId, priceRef,
    );
    for (const w of waiting) {
      grant(creatorId, w.email, tierId, new Date(w.receivedAt), w.billingPeriod, w.providerEventId);
      run("UPDATE webhook_events SET status = 'processed', note = 'access granted after tier was matched' WHERE id = ?", w.id);
    }
    return waiting.length;
  });
}
