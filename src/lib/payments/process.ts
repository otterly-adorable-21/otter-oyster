import { randomBytes } from 'node:crypto';
import { all, get, run, tx, newId, nowIso, type CreatorRow, type PaymentLinkRow, type TierRow, type WebhookEventRow } from '../db';
import { grant, safeEqual, type Outcome, type ProcessResult } from './core';
import { httpsUrl } from '../validate';
import { PROVIDERS, pageHostOk, type ProviderId } from './providers';
import type { PaymentEvent } from './parse';

// Ko-fi, Buy Me a Coffee and SubscribeStar all work the same way here:
// each creator gets one private webhook link per platform. A message that arrives on that link can only
// belong to that creator, so there is no name matching and no page review. The creator proves the link
// works by sending a test from the platform, and the studio turns green.

// ---------- links ----------

export const linksOf = (creatorId: string): PaymentLinkRow[] =>
  all<PaymentLinkRow>('SELECT * FROM payment_links WHERE creatorId = ? ORDER BY createdAt', creatorId);

export const linkOf = (creatorId: string, provider: ProviderId): PaymentLinkRow | undefined =>
  get<PaymentLinkRow>('SELECT * FROM payment_links WHERE creatorId = ? AND provider = ?', creatorId, provider);

export const linkBySecret = (provider: ProviderId, secret: string): PaymentLinkRow | undefined =>
  /^[a-f0-9]{48}$/.test(secret) ? get<PaymentLinkRow>('SELECT * FROM payment_links WHERE provider = ? AND hookSecret = ?', provider, secret) : undefined;

/**
 * Connected = the platform has reached us at least once, or the creator saved the platform's secret (proof they opened
 * its webhook settings), or, for a platform with no test button, the creator told us they added the link there.
 */
export const linkReady = (l: PaymentLinkRow | undefined): boolean => !!l && (!!l.lastEventAt || !!l.signingKey || !!l.confirmedAt);

/** The creator says they pasted the link into a platform that cannot send a test (SubscribeStar). */
export function confirmLink(creatorId: string, provider: ProviderId): void {
  run('UPDATE payment_links SET confirmedAt = ? WHERE creatorId = ? AND provider = ?', nowIso(), creatorId, provider);
}

const secret = (): string => randomBytes(24).toString('hex');

/** Makes the creator's private link for a platform if they do not have one yet. */
export function ensureLink(creatorId: string, provider: ProviderId): PaymentLinkRow {
  run('INSERT OR IGNORE INTO payment_links (id, creatorId, provider, hookSecret, createdAt) VALUES (?,?,?,?,?)', newId(), creatorId, provider, secret(), nowIso());
  return linkOf(creatorId, provider)!;
}

export function savePageUrl(creatorId: string, provider: ProviderId, raw: string): { ok: true } | { ok: false; error: string } {
  const p = PROVIDERS[provider];
  let url = '';
  if (raw.trim()) {
    const withScheme = /^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`;
    const u = httpsUrl(withScheme.replace(/^http:\/\//i, 'https://'));
    if (!u || !pageHostOk(provider, new URL(u).hostname)) return { ok: false, error: `That does not look like a ${p.name} link. It should look like ${p.pageExample}` };
    url = u;
  }
  ensureLink(creatorId, provider);
  run('UPDATE payment_links SET pageUrl = ? WHERE creatorId = ? AND provider = ?', url, creatorId, provider);
  return { ok: true };
}

export function saveSigningKey(creatorId: string, provider: ProviderId, key: string): void {
  ensureLink(creatorId, provider);
  run('UPDATE payment_links SET signingKey = ? WHERE creatorId = ? AND provider = ?', key, creatorId, provider);
}

/** New private link (if the old one leaked). The saved secret is cleared too, so a Ko-fi token is learned again. */
export function rotateLink(creatorId: string, provider: ProviderId): void {
  run("UPDATE payment_links SET hookSecret = ?, signingKey = '', lastEventAt = NULL, confirmedAt = NULL WHERE creatorId = ? AND provider = ?", secret(), creatorId, provider);
}

export function removeLink(creatorId: string, provider: ProviderId): void {
  run('DELETE FROM payment_links WHERE creatorId = ? AND provider = ?', creatorId, provider);
}

// ---------- tiers ----------

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Finds the creator's tier for this payment: a saved match, else the same name, else the only tier with that price. */
export function resolveTier(creatorId: string, provider: string, ev: Pick<PaymentEvent, 'tierRef' | 'tierName' | 'amountCents' | 'currency'>): TierRow | null {
  if (!ev.tierRef) return null;
  const saved = get<TierRow>('SELECT t.* FROM tier_refs r JOIN tiers t ON t.id = r.tierId WHERE r.creatorId = ? AND r.provider = ? AND r.ref = ?', creatorId, provider, ev.tierRef);
  if (saved) return saved;
  const tiers = all<TierRow>('SELECT * FROM tiers WHERE creatorId = ? ORDER BY position', creatorId);
  let found: TierRow | undefined;
  if (ev.tierName) found = tiers.find((t) => norm(t.name) === norm(ev.tierName!));
  if (!found && ev.amountCents !== null && (!ev.currency || ev.currency === 'USD')) {
    const same = tiers.filter((t) => t.price * 100 === ev.amountCents);
    if (same.length === 1) found = same[0];
  }
  if (!found) return null;
  // Remember it, so a later rename on either side does not break renewals.
  run('INSERT OR REPLACE INTO tier_refs (creatorId, provider, ref, tierId) VALUES (?,?,?,?)', creatorId, provider, ev.tierRef, found.id);
  return found;
}

// ---------- processing ----------

/** Ko-fi's token arrives inside each message. The first message on a private link teaches us the token; after that it must match. */
export function kofiTokenOk(link: PaymentLinkRow, token: string | undefined): 'ok' | 'learn' | 'bad' {
  if (!token) return link.signingKey ? 'bad' : 'ok';
  if (!link.signingKey) return 'learn';
  return safeEqual(token, link.signingKey) ? 'ok' : 'bad';
}

const redact = (raw: string, token?: string): string => (token ? raw.split(token).join('[token]') : raw).slice(0, 20000);

export function processPaymentEvent(link: PaymentLinkRow, ev: PaymentEvent, raw: string, opts: { now?: Date } = {}): ProcessResult {
  const now = opts.now ?? new Date();
  const at = ev.at && ev.at.getTime() <= now.getTime() + 86400_000 ? ev.at : now;
  const provider = link.provider;
  return tx((): ProcessResult => {
    run('UPDATE payment_links SET lastEventAt = ? WHERE id = ?', now.toISOString(), link.id);
    // Event ids are only unique per platform account, so they are kept apart per link.
    const key = `${link.id}:${ev.eventId}`;
    if (get('SELECT 1 FROM webhook_events WHERE provider = ? AND providerEventId = ?', provider, key)) return { outcome: 'duplicate', note: 'already processed' };
    const creator = get<CreatorRow>('SELECT * FROM creators WHERE id = ? AND suspended = 0', link.creatorId);

    const save = (outcome: Outcome, note: string): ProcessResult => {
      run(`INSERT INTO webhook_events (id, provider, providerEventId, eventName, creatorNick, creatorId, email, priceRef, billingPeriod, status, note, raw, receivedAt, refLabel)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        newId(), provider, key, ev.eventName, '', creator?.id ?? null, ev.email, ev.tierRef, ev.months,
        outcome, note, redact(raw, ev.bodyToken), at.toISOString(), ev.tierLabel);
      return { outcome, note, creatorId: creator?.id };
    };

    if (!creator) return save('rejected', 'this page is suspended');
    if (ev.isTest) return save('ignored', 'test message: the connection works');
    if (ev.kind === 'ignored') return save('ignored', 'event type not used');
    if (!ev.email) return save('rejected', 'no email in the message (the supporter may not have shared it)');

    if (ev.kind === 'one_time_purchase') {
      run('INSERT OR IGNORE INTO donations (id, creatorId, email, providerEventId, itemRef, createdAt) VALUES (?,?,?,?,?,?)',
        newId(), creator.id, ev.email, `${provider}:${key}`, null, at.toISOString());
      return save('processed', 'recorded as a tip or purchase');
    }
    if (ev.kind === 'refund') {
      run("UPDATE entitlements SET status = 'revoked', paidThrough = ?, updatedAt = ? WHERE creatorId = ? AND email = ?", now.toISOString(), nowIso(), creator.id, ev.email);
      return save('processed', 'access revoked');
    }
    if (ev.kind === 'subscription_ended') {
      run("UPDATE entitlements SET status = 'canceled', updatedAt = ? WHERE creatorId = ? AND email = ? AND status = 'active'", nowIso(), creator.id, ev.email);
      return save('processed', 'canceled, access continues until the paid date');
    }
    const tier = resolveTier(creator.id, provider, ev);
    if (!tier) return save('unmatched', ev.tierRef ? 'this tier has not been matched to one of your tiers yet' : 'no tier or price in the message');
    grant(creator.id, ev.email, tier.id, at, ev.months, key, ev.paidUntil ?? undefined);
    return save('processed', 'access granted');
  });
}

/** The creator says which of their tiers a platform tier belongs to. Payments that were waiting are then applied. */
export function assignProviderRef(creatorId: string, provider: string, ref: string, tierId: string): number {
  return tx(() => {
    if (!get('SELECT 1 FROM tiers WHERE id = ? AND creatorId = ?', tierId, creatorId)) return 0;
    run('INSERT OR REPLACE INTO tier_refs (creatorId, provider, ref, tierId) VALUES (?,?,?,?)', creatorId, provider, ref, tierId);
    const waiting = all<WebhookEventRow>(
      "SELECT * FROM webhook_events WHERE creatorId = ? AND provider = ? AND priceRef = ? AND status = 'unmatched' ORDER BY receivedAt",
      creatorId, provider, ref,
    );
    for (const w of waiting) {
      grant(creatorId, w.email, tierId, new Date(w.receivedAt), w.billingPeriod, w.providerEventId);
      run("UPDATE webhook_events SET status = 'processed', note = 'access granted after tier was matched' WHERE id = ?", w.id);
    }
    return waiting.length;
  });
}
