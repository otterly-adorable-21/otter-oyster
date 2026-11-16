import { beforeEach, describe, expect, it } from 'vitest';
process.env.DB_FILE = ':memory:';
import { createHmac } from 'node:crypto';
import { resetDbForTests, run, get, all, newId, nowIso, type EntitlementRow } from '../src/lib/db';
import { parseBmc, parseKofi, parseSubscribeStar, bmcSignatureValid, subscribeStarSignatureValid } from '../src/lib/payments/parse';
import { assignProviderRef, confirmLink, rotateLink, ensureLink, kofiTokenOk, linkBySecret, linkReady, processPaymentEvent, savePageUrl } from '../src/lib/payments/process';
import { unmatchedPrices } from '../src/lib/creators';

function seed() {
  const uid = newId(), cid = newId();
  run('INSERT INTO users (id, createdAt) VALUES (?, ?)', uid, nowIso());
  run('INSERT INTO creators (id,userId,handle,name,verifyCode,hookSecret,createdAt) VALUES (?,?,?,?,?,?,?)', cid, uid, 'otterly', 'Otterly', 'code', 'hs-' + cid, nowIso());
  const t1 = newId(), t2 = newId();
  run('INSERT INTO tiers (id,creatorId,position,name,price) VALUES (?,?,?,?,?)', t1, cid, 0, 'Pebble', 5);
  run('INSERT INTO tiers (id,creatorId,position,name,price) VALUES (?,?,?,?,?)', t2, cid, 1, 'Pearl', 10);
  return { cid, t1, t2 };
}
const ent = (cid: string, email: string) => get<EntitlementRow>('SELECT * FROM entitlements WHERE creatorId = ? AND email = ?', cid, email);

const kofiForm = (o: Record<string, unknown>) => new URLSearchParams({ data: JSON.stringify({
  verification_token: 'tok-1', message_id: newId(), timestamp: new Date().toISOString(), type: 'Subscription',
  is_subscription_payment: true, email: 'Fan@Mail.com', amount: '5.00', currency: 'USD', kofi_transaction_id: newId(), tier_name: null, ...o,
}) }).toString();

beforeEach(() => resetDbForTests());

describe('Ko-fi', () => {
  it('reads the form-encoded body', () => {
    const e = parseKofi(kofiForm({ tier_name: 'Pearl' }))!;
    expect(e.kind).toBe('subscription_payment');
    expect(e.email).toBe('fan@mail.com');
    expect(e.tierRef).toBe('name:pearl');
    expect(e.bodyToken).toBe('tok-1');
    expect(e.isTest).toBe(false);
  });
  it('also reads plain JSON', () => {
    expect(parseKofi(JSON.stringify({ message_id: 'm', type: 'Donation', email: 'a@b.co', amount: '3' }))!.kind).toBe('one_time_purchase');
  });
  it('spots test messages', () => {
    expect(parseKofi(kofiForm({ email: 'jo.example@example.com' }))!.isTest).toBe(true);
  });
  it('learns the token from the first message, then requires it', () => {
    const { cid } = seed();
    const l = ensureLink(cid, 'kofi');
    expect(kofiTokenOk(l, 'tok-1')).toBe('learn');
    run('UPDATE payment_links SET signingKey = ? WHERE id = ?', 'tok-1', l.id);
    const l2 = linkBySecret('kofi', l.hookSecret)!;
    expect(kofiTokenOk(l2, 'tok-1')).toBe('ok');
    expect(kofiTokenOk(l2, 'forged')).toBe('bad');
    expect(kofiTokenOk(l2, undefined)).toBe('bad');
  });
  it('a test message connects the link but grants nothing', () => {
    const { cid } = seed();
    const l = ensureLink(cid, 'kofi');
    expect(linkReady(l)).toBe(false);
    const raw = kofiForm({ email: 'jo.example@example.com' });
    expect(processPaymentEvent(l, parseKofi(raw)!, raw).outcome).toBe('ignored');
    expect(linkReady(linkBySecret('kofi', l.hookSecret))).toBe(true);
    expect(all('SELECT * FROM entitlements')).toHaveLength(0);
    // The token is not stored in the saved copy of the message.
    expect(get<{ raw: string }>('SELECT raw FROM webhook_events')!.raw).not.toContain('tok-1');
  });
  it('matches the tier by name, then by price', () => {
    const { cid, t1, t2 } = seed();
    const l = ensureLink(cid, 'kofi');
    let raw = kofiForm({ tier_name: ' pearl ' });
    expect(processPaymentEvent(l, parseKofi(raw)!, raw).outcome).toBe('processed');
    expect(ent(cid, 'fan@mail.com')!.tierId).toBe(t2);
    raw = kofiForm({ email: 'two@mail.com', amount: '5.00' });
    expect(processPaymentEvent(l, parseKofi(raw)!, raw).outcome).toBe('processed');
    expect(ent(cid, 'two@mail.com')!.tierId).toBe(t1);
  });
  it('asks the creator when nothing matches, then applies waiting payments', () => {
    const { cid, t2 } = seed();
    const l = ensureLink(cid, 'kofi');
    const raw = kofiForm({ tier_name: 'Golden Otter', amount: '7.00' });
    expect(processPaymentEvent(l, parseKofi(raw)!, raw).outcome).toBe('unmatched');
    const w = unmatchedPrices(cid);
    expect(w).toHaveLength(1);
    expect(w[0].provider).toBe('kofi');
    expect(w[0].label).toContain('Golden Otter');
    expect(assignProviderRef(cid, 'kofi', w[0].priceRef, t2)).toBe(1);
    expect(ent(cid, 'fan@mail.com')!.tierId).toBe(t2);
    // Next month's payment matches by itself.
    const raw2 = kofiForm({ tier_name: 'Golden Otter', amount: '7.00' });
    expect(processPaymentEvent(l, parseKofi(raw2)!, raw2).outcome).toBe('processed');
  });
  it('ignores a repeated message', () => {
    const { cid } = seed();
    const l = ensureLink(cid, 'kofi');
    const raw = kofiForm({ message_id: 'same' });
    processPaymentEvent(l, parseKofi(raw)!, raw);
    expect(processPaymentEvent(l, parseKofi(raw)!, raw).outcome).toBe('duplicate');
  });
});

describe('Buy Me a Coffee', () => {
  const bmc = (type: string, data: Record<string, unknown>, live = true) => JSON.stringify({ type, live_mode: live, event_id: Math.floor(Math.random() * 1e9), created: 1763000000, data });
  it('grants on membership start using the paid-up date', () => {
    const { cid, t2 } = seed();
    const l = ensureLink(cid, 'bmc');
    const end = Math.floor(Date.now() / 1000) + 40 * 86400;
    const raw = bmc('membership.started', { supporter_email: 'b@c.co', membership_level_id: 77, membership_level_name: 'Pearl', amount: 10, currency: 'USD', current_period_end: end, status: 'active' });
    expect(processPaymentEvent(l, parseBmc(raw)!, raw).outcome).toBe('processed');
    const e = ent(cid, 'b@c.co')!;
    expect(e.tierId).toBe(t2);
    expect(new Date(e.paidThrough).getTime()).toBeGreaterThan((end + 2 * 86400) * 1000);
  });
  it('cancel keeps access to the paid date; refund removes it', () => {
    const { cid } = seed();
    const l = ensureLink(cid, 'bmc');
    let raw = bmc('membership.started', { supporter_email: 'b@c.co', membership_level_name: 'Pebble', amount: 5 });
    processPaymentEvent(l, parseBmc(raw)!, raw);
    raw = bmc('membership.cancelled', { supporter_email: 'b@c.co' });
    processPaymentEvent(l, parseBmc(raw)!, raw);
    expect(ent(cid, 'b@c.co')!.status).toBe('canceled');
    raw = bmc('donation.refunded', { supporter_email: 'b@c.co' });
    processPaymentEvent(l, parseBmc(raw)!, raw);
    expect(ent(cid, 'b@c.co')!.status).toBe('revoked');
  });
  it('treats live_mode false as a test', () => {
    expect(parseBmc(bmc('membership.started', { supporter_email: 'b@c.co' }, false))!.isTest).toBe(true);
  });
  it('checks the signature', () => {
    const body = bmc('donation.created', {});
    const sig = createHmac('sha256', 's3cret').update(body).digest('hex');
    expect(bmcSignatureValid(body, new Headers({ 'x-signature-sha256': sig }), 's3cret')).toBe(true);
    expect(bmcSignatureValid(body, new Headers({ 'x-signature-sha256': sig }), 'other')).toBe(false);
  });
});

describe('SubscribeStar', () => {
  const ss = (event: string, payload: Record<string, unknown>) => JSON.stringify({ event, project: 'subscribestar', timestamp: Math.floor(Date.now() / 1000), payload });
  it('grants on a new subscription, matched by price', () => {
    const { cid, t2 } = seed();
    const l = ensureLink(cid, 'subscribestar');
    const raw = ss('new_subscription', { subscription: { id: 9, cost: 1000, charged_at_timestamp: Math.floor(Date.now() / 1000) }, subscriber: { email: 's@s.co' } });
    expect(processPaymentEvent(l, parseSubscribeStar(raw)!, raw).outcome).toBe('processed');
    expect(ent(cid, 's@s.co')!.tierId).toBe(t2);
  });
  it('renews on a subscription fee payment and revokes on a dispute', () => {
    const { cid } = seed();
    const l = ensureLink(cid, 'subscribestar');
    let raw = ss('payment_succeed', { payment: { id: 1, amount: 500, type: 'subscription_fee', authorized_at_timestamp: Math.floor(Date.now() / 1000) }, pledger: { email: 's@s.co' } });
    expect(processPaymentEvent(l, parseSubscribeStar(raw)!, raw).outcome).toBe('processed');
    raw = ss('payment_disputed', { payment: { id: 1, amount: 500 }, pledger: { email: 's@s.co' } });
    processPaymentEvent(l, parseSubscribeStar(raw)!, raw);
    expect(ent(cid, 's@s.co')!.status).toBe('revoked');
  });
  it('rejects a message with no email (supporter did not share it)', () => {
    const { cid } = seed();
    const l = ensureLink(cid, 'subscribestar');
    const raw = ss('new_subscription', { subscription: { id: 3, cost: 500 }, subscriber: {} });
    expect(processPaymentEvent(l, parseSubscribeStar(raw)!, raw).outcome).toBe('rejected');
  });
  it('checks the MD5 signature from their docs', () => {
    const body = ss('new_subscription', { subscription: { id: 1 } });
    const sig = createHmac('md5', 'k').update(body).digest('hex');
    expect(subscribeStarSignatureValid(body, new Headers({ 'x-subscribestar-signature': sig }), 'k')).toBe(true);
    expect(subscribeStarSignatureValid(body, new Headers({ 'x-subscribestar-signature': 'nope' }), 'k')).toBe(false);
  });
});

describe('page links', () => {
  it('only accepts the platform\'s own site, and adds https://', () => {
    const { cid } = seed();
    expect(savePageUrl(cid, 'kofi', 'ko-fi.com/otterly').ok).toBe(true);
    expect(get<{ pageUrl: string }>("SELECT pageUrl FROM payment_links WHERE provider = 'kofi'")!.pageUrl).toBe('https://ko-fi.com/otterly');
    expect(savePageUrl(cid, 'kofi', 'https://evil.example/ko-fi.com').ok).toBe(false);
    expect(savePageUrl(cid, 'subscribestar', 'https://subscribestar.adult/otterly').ok).toBe(true);
    expect(savePageUrl(cid, 'subscribestar', 'https://subscribestar.art/otterly-adorable').ok).toBe(true);
    expect(savePageUrl(cid, 'subscribestar', 'https://subscribestar.evil/otterly').ok).toBe(false);
  });
  it('SubscribeStar is ready once the creator says the link is added, until the link is replaced', () => {
    const { cid } = seed();
    ensureLink(cid, 'subscribestar');
    const ready = () => linkReady(get('SELECT * FROM payment_links WHERE provider = ?', 'subscribestar'));
    expect(ready()).toBe(false);
    confirmLink(cid, 'subscribestar');
    expect(ready()).toBe(true);
    rotateLink(cid, 'subscribestar');
    expect(ready()).toBe(false);
  });
  it('a suspended creator gets nothing', () => {
    const { cid } = seed();
    const l = ensureLink(cid, 'kofi');
    run('UPDATE creators SET suspended = 1 WHERE id = ?', cid);
    const raw = kofiForm({ tier_name: 'Pearl' });
    expect(processPaymentEvent(l, parseKofi(raw)!, raw).outcome).toBe('rejected');
  });
});
