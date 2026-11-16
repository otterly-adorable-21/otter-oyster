import { createHmac } from 'node:crypto';
import { safeEqual, signatureValid } from '../gank';
import { normalizeEmail } from '../validate';
import type { ProviderId } from './providers';

// Turns each platform's webhook message into one shape we can act on.
// Field names come from each platform's public docs and community examples. Anything marked VERIFY
// should be checked against a real message (the studio stores the last messages in webhook_events.raw).

export type PayKind = 'subscription_payment' | 'one_time_purchase' | 'subscription_ended' | 'refund' | 'ignored';

export interface PaymentEvent {
  eventId: string;
  eventName: string;
  kind: PayKind;
  email: string;
  /** Stable key for "which tier on the platform": an id, a tier name, or a price. Null if the message has none. */
  tierRef: string | null;
  /** How to describe that tier to the creator, e.g. `Ko-fi tier "Gold"`. */
  tierLabel: string;
  tierName: string | null;
  amountCents: number | null;
  currency: string;
  months: number | null;
  /** When the platform says the paid period ends. Beats our own month count when present. */
  paidUntil: Date | null;
  /** When the payment happened, if the platform says. */
  at: Date | null;
  /** A test message sent from the platform's settings page. Proves the link works; grants nothing. */
  isTest: boolean;
  /** Ko-fi puts its verification token inside the message itself. */
  bodyToken?: string;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const cents = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number.parseFloat(str(v));
  return Number.isFinite(n) && n >= 0 && n < 10_000_000 ? Math.round(n * 100) : null;
};
const money = (c: number | null, cur: string): string => (c === null ? '' : `${(c / 100).toFixed(2)}${cur && cur.toUpperCase() !== 'USD' ? ' ' + cur.toUpperCase() : ''}`);
const dollarSign = (cur: string): string => (!cur || cur.toUpperCase() === 'USD' ? '$' : '');
/** Accepts unix seconds, unix milliseconds or an ISO string. */
function when(v: unknown): Date | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : /^\d+$/.test(str(v)) ? Number(v) : NaN;
  const d = Number.isFinite(n) ? new Date(n < 1e12 ? n * 1000 : n) : new Date(str(v));
  return Number.isNaN(d.getTime()) ? null : d;
}
const clip = (s: string, n = 100): string => s.slice(0, n);

// ---------------- Ko-fi ----------------
// Ko-fi posts a form with one field, `data`, holding JSON. We also accept plain JSON in case that changes.
// Ko-fi sends no refund or cancel messages: a membership simply stops renewing, and access runs out on its own.

export function readKofiBody(raw: string): Json | null {
  const t = raw.trim();
  try {
    if (t.startsWith('{')) {
      const j = obj(JSON.parse(t));
      return typeof j.data === 'string' ? obj(JSON.parse(j.data)) : j;
    }
    const data = new URLSearchParams(t).get('data');
    return data ? obj(JSON.parse(data)) : null;
  } catch {
    return null;
  }
}

// VERIFY: Ko-fi's test buttons send a made-up supporter. These are the values seen in Ko-fi's test messages.
const KOFI_TEST_TX = '00000000-1111-2222-3333-444444444444';

export function parseKofi(raw: string): PaymentEvent | null {
  const j = readKofiBody(raw);
  if (!j) return null;
  const eventId = str(j.message_id) || str(j.kofi_transaction_id);
  if (!eventId) return null;
  const type = str(j.type);
  const email = normalizeEmail(j.email) ?? '';
  const amountCents = cents(j.amount);
  const currency = str(j.currency).toUpperCase();
  const tierName = str(j.tier_name).trim() || null;
  const isSub = j.is_subscription_payment === true || /subscription/i.test(type);
  const kind: PayKind = isSub ? 'subscription_payment' : /donation|shop|commission/i.test(type) ? 'one_time_purchase' : 'ignored';
  const tierRef = tierName ? `name:${tierName.toLowerCase()}` : amountCents !== null ? `amount:${amountCents}:${currency}` : null;
  return {
    eventId: clip(eventId), eventName: clip(type || 'Ko-fi'), kind, email,
    tierRef: tierRef && clip(tierRef, 120),
    tierLabel: tierName ? `Ko-fi tier “${clip(tierName, 60)}”` : `${dollarSign(currency)}${money(amountCents, currency)} monthly Ko-fi membership`,
    tierName, amountCents, currency, months: 1, paidUntil: null, at: when(j.timestamp),
    isTest: str(j.kofi_transaction_id) === KOFI_TEST_TX || /@example\.(com|org|net)$/.test(email),
    bodyToken: str(j.verification_token),
  };
}

// ---------------- Buy Me a Coffee ----------------
// Envelope: { type, live_mode, event_id, created, data: {...} }. live_mode is false for test sends.
// VERIFY: the field names inside `data` against a real message. Older messages used `response` instead of `data`.

export function parseBmc(raw: string): PaymentEvent | null {
  let root: Json;
  try { root = obj(JSON.parse(raw)); } catch { return null; }
  const type = str(root.type) || str(root.event);
  const d = obj(root.data ?? root.response);
  if (!type) return null;
  const eventId = str(root.event_id) || str(root.id) || (str(d.id) && `${type}:${str(d.id)}:${str(root.created)}`);
  if (!eventId) return null;
  const email = normalizeEmail(d.supporter_email ?? d.payer_email ?? d.email ?? obj(d.supporter).email) ?? '';
  const currency = str(d.currency ?? d.support_currency).toUpperCase();
  const amountCents = cents(d.amount ?? d.membership_amount ?? d.total_amount_charged);
  const levelId = str(d.membership_level_id ?? obj(d.membership_level).id);
  const tierName = (str(d.membership_level_name ?? obj(d.membership_level).name).trim()) || null;
  const status = str(d.status).toLowerCase();
  const canceled = d.canceled === true || d.cancelled === true || d.canceled === 'true' || /cancel/.test(status);

  let kind: PayKind = 'ignored';
  if (/refund|dispute|chargeback/i.test(type)) kind = 'refund';
  else if (/^(membership|subscription)\.(cancel|end|expire)/i.test(type)) kind = 'subscription_ended';
  else if (/^(membership|subscription)\./i.test(type)) kind = canceled ? 'subscription_ended' : /\.(started|updated|renewed|created|payment)/i.test(type) ? 'subscription_payment' : 'ignored';
  else if (/^(donation|extra_purchase|extras?|commission|wishlist|recurring_donation)/i.test(type) && !/cancel/i.test(type)) kind = 'one_time_purchase';

  const yearly = /year|annual/i.test(str(d.duration_type ?? d.membership_duration_type ?? d.interval));
  const tierRef = levelId ? `id:${levelId}` : tierName ? `name:${tierName.toLowerCase()}` : amountCents !== null ? `amount:${amountCents}:${currency}` : null;
  return {
    eventId: clip(eventId), eventName: clip(type), kind, email,
    tierRef: tierRef && clip(tierRef, 120),
    tierLabel: tierName ? `Buy Me a Coffee level “${clip(tierName, 60)}”` : `${dollarSign(currency)}${money(amountCents, currency)} Buy Me a Coffee membership`,
    tierName, amountCents, currency, months: yearly ? 12 : 1,
    paidUntil: when(d.current_period_end ?? d.membership_period_end ?? d.next_billing_date),
    at: when(d.current_period_start ?? d.created_at ?? root.created),
    isTest: root.live_mode === false,
  };
}

// ---------------- SubscribeStar ----------------
// { event, project, timestamp, payload: { subscription?, subscriber?, payment?, pledger? } }. Money is in cents.
// Messages carry the pledge price but no tier id, so tiers are matched by price.

export function parseSubscribeStar(raw: string): PaymentEvent | null {
  let root: Json;
  try { root = obj(JSON.parse(raw)); } catch { return null; }
  const event = str(root.event);
  if (!event) return null;
  const p = obj(root.payload);
  const sub = obj(p.subscription), pay = obj(p.payment);
  const email = normalizeEmail(obj(p.subscriber).email ?? obj(p.pledger).email) ?? '';
  const refId = str(pay.id) || str(sub.id);
  if (!refId) return null;
  const eventId = `${event}:${refId}:${str(root.timestamp)}`;
  const intCents = (v: unknown): number | null => { const n = Number(v); return Number.isInteger(n) && n >= 0 ? n : null; };

  let kind: PayKind = 'ignored';
  let amountCents: number | null = null;
  let at: Date | null = when(root.timestamp);
  if (event === 'payment_disputed') kind = 'refund';
  else if (event === 'payment_succeed') {
    const t = str(pay.type);
    kind = t === 'subscription_fee' ? 'subscription_payment' : t === 'tip' || t === 'contribution' ? 'one_time_purchase' : 'ignored';
    amountCents = intCents(pay.amount);
    at = when(pay.authorized_at_timestamp) ?? at;
  } else if (event === 'subscription_cancelled') kind = 'subscription_ended';
  else if (event === 'new_subscription' || event === 'email_shared' || event === 'recurring_pledge_increased' || event === 'recurring_pledge_decreased' || event === 'subscription_restored') {
    // These say a pledge is live, and email_shared is often the first time we learn who it is.
    kind = sub.cancelled === true ? 'subscription_ended' : 'subscription_payment';
    amountCents = intCents(sub.cost);
    at = when(sub.charged_at_timestamp) ?? when(sub.extended_at_timestamp) ?? at;
  }
  const tierRef = amountCents !== null ? `amount:${amountCents}:USD` : null;
  return {
    eventId: clip(eventId, 100), eventName: clip(event), kind, email, tierRef,
    tierLabel: `$${money(amountCents, '')} SubscribeStar pledge`,
    tierName: null, amountCents, currency: 'USD', months: 1, paidUntil: null, at, isTest: false,
  };
}

export function parseFor(provider: ProviderId, raw: string): PaymentEvent | null {
  return provider === 'kofi' ? parseKofi(raw) : provider === 'bmc' ? parseBmc(raw) : parseSubscribeStar(raw);
}

// ---------------- authenticity ----------------

/** BMC signs the raw body with HMAC-SHA256 (hex). VERIFY: header name; docs mention both. */
export function bmcSignatureValid(raw: string, headers: Headers, secret: string): boolean {
  const h = headers.get('x-signature-sha256') ?? headers.get('x-bmc-signature');
  return signatureValid(raw, h, secret);
}

/** SubscribeStar: hex HMAC of the raw body. Their docs show MD5; we also accept SHA-256 in case that changes. */
export function subscribeStarSignatureValid(raw: string, headers: Headers, secret: string): boolean {
  const h = (headers.get('x-subscribestar-signature') || '').trim().toLowerCase();
  if (!h || !secret) return false;
  const md5 = createHmac('md5', secret).update(raw).digest('hex');
  return safeEqual(h, md5) || signatureValid(raw, h, secret);
}
