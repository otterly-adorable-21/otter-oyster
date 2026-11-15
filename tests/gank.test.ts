import { beforeEach, describe, expect, it } from 'vitest';
process.env.DB_FILE = ':memory:';
import { resetDbForTests, run, get, all, newId, nowIso } from '../src/lib/db';
import { parseGankPayload, processGankEvent, assignTierRef, signatureValid, addMonths, paidThroughFor } from '../src/lib/gank';
import { createHmac } from 'node:crypto';

const sub = (over: Record<string, unknown> = {}, id = 'H1', event = 'USER_MEMBERSHIP.TX_SUCCEED') => ({
  event,
  data: {
    human_id: id, payment_status: 'SUCCEED',
    usecase_data: { data: { creator_user_id: 'u1', creator_user_nickname: 'Otterly', subscriber_user_email: 'Fan@Example.com', price_event_id: 'price-1', billing_period: 1, ...over } },
  },
});
const raw = (o: unknown) => JSON.stringify(o);

function seed(verified = 1) {
  const uid = newId(), cid = newId(), tid = newId();
  run("INSERT INTO users (id, createdAt) VALUES (?, ?)", uid, nowIso());
  run(`INSERT INTO creators (id,userId,handle,name,gankNick,gankVerified,verifyCode,hookSecret,createdAt) VALUES (?,?,?,?,?,?,?,?,?)`,
    cid, uid, 'otterly', 'Otterly', 'otterly', verified, 'code', 'hs-' + cid, nowIso());
  run('INSERT INTO tiers (id,creatorId,position,name,price) VALUES (?,?,?,?,?)', tid, cid, 0, 'Pebble', 5);
  return { cid, tid };
}

beforeEach(() => resetDbForTests());

describe('parseGankPayload', () => {
  it('parses a membership payment', () => {
    const e = parseGankPayload(sub())!;
    expect(e.kind).toBe('subscription_payment');
    expect(e.email).toBe('fan@example.com');
    expect(e.creatorNick).toBe('otterly');
    expect(e.priceRef).toBe('price-1');
  });
  it('parses a digital goods purchase as a one-time purchase', () => {
    const e = parseGankPayload({ event: 'DIGITAL_GOODS.TX_SUCCEED', data: { human_id: 'D1', payment_status: 'SUCCEED', usecase_data: { data: { creator_user_nickname: 'x', buyer_user_email: 'a@b.co', catalog_id: 'c1' } } } })!;
    expect(e.kind).toBe('one_time_purchase');
    expect(e.itemRef).toBe('c1');
  });
  it('ignores unpaid and unknown events', () => {
    expect(parseGankPayload({ ...sub(), data: { ...sub().data, payment_status: 'PENDING' } })!.kind).toBe('ignored');
    expect(parseGankPayload(sub({}, 'H2', 'SOMETHING.ELSE'))!.kind).toBe('ignored');
  });
  it('rejects junk', () => {
    expect(parseGankPayload(null)).toBeNull();
    expect(parseGankPayload({ event: 'x' })).toBeNull();
    expect(parseGankPayload('str')).toBeNull();
  });
});

describe('processGankEvent', () => {
  it('grants access once tier matches, and dedupes', () => {
    const { cid, tid } = seed();
    run('UPDATE tiers SET gankTierRef = ? WHERE id = ?', 'price-1', tid);
    const now = new Date('2026-01-31T00:00:00Z');
    const r = processGankEvent(parseGankPayload(sub())!, raw(sub()), { now });
    expect(r.outcome).toBe('processed');
    const ent = get<{ tierId: string; paidThrough: string }>('SELECT * FROM entitlements WHERE creatorId = ?', cid)!;
    expect(ent.tierId).toBe(tid);
    expect(ent.paidThrough).toBe(paidThroughFor(now, 1).toISOString());
    expect(processGankEvent(parseGankPayload(sub())!, raw(sub()), { now }).outcome).toBe('duplicate');
  });
  it('holds unmatched tiers until the creator assigns them', () => {
    const { cid, tid } = seed();
    const now = new Date();
    expect(processGankEvent(parseGankPayload(sub())!, raw(sub()), { now }).outcome).toBe('unmatched');
    expect(get('SELECT 1 FROM entitlements WHERE creatorId = ?', cid)).toBeUndefined();
    expect(assignTierRef(cid, tid, 'price-1')).toBe(1);
    expect(get('SELECT 1 x FROM entitlements WHERE creatorId = ?', cid)).toBeDefined();
    expect(get<{ status: string }>("SELECT status FROM webhook_events WHERE providerEventId = 'H1'")!.status).toBe('processed');
  });
  it('does not trust an unverified creator name', () => {
    seed(0);
    expect(processGankEvent(parseGankPayload(sub())!, raw(sub())).outcome).toBe('unmatched');
    expect(all('SELECT * FROM entitlements')).toHaveLength(0);
  });
  it('a forced creator id (per-creator address) works without a name match', () => {
    const { cid, tid } = seed(0);
    run('UPDATE tiers SET gankTierRef = ? WHERE id = ?', 'price-1', tid);
    const p = sub({ creator_user_nickname: 'whatever' });
    expect(processGankEvent(parseGankPayload(p)!, raw(p), { forcedCreatorId: cid }).outcome).toBe('processed');
  });
  it('renewals extend and an old event cannot shorten access', () => {
    const { cid, tid } = seed();
    run('UPDATE tiers SET gankTierRef = ? WHERE id = ?', 'price-1', tid);
    processGankEvent(parseGankPayload(sub({}, 'N'))!, raw(sub({}, 'N')), { now: new Date('2026-03-01T00:00:00Z') });
    processGankEvent(parseGankPayload(sub({}, 'O'))!, raw(sub({}, 'O')), { now: new Date('2026-01-01T00:00:00Z') });
    const ent = get<{ paidThrough: string }>('SELECT paidThrough FROM entitlements WHERE creatorId = ?', cid)!;
    expect(ent.paidThrough).toBe(paidThroughFor(new Date('2026-03-01T00:00:00Z'), 1).toISOString());
  });
  it('refund revokes, records tips', () => {
    const { cid, tid } = seed();
    run('UPDATE tiers SET gankTierRef = ? WHERE id = ?', 'price-1', tid);
    processGankEvent(parseGankPayload(sub())!, raw(sub()));
    const ref = sub({}, 'R1', 'USER_MEMBERSHIP.REFUND_SUCCEED');
    expect(processGankEvent(parseGankPayload(ref)!, raw(ref)).outcome).toBe('processed');
    expect(get<{ status: string }>('SELECT status FROM entitlements WHERE creatorId = ?', cid)!.status).toBe('revoked');
    const tip = { event: 'DIGITAL_GOODS.TX_SUCCEED', data: { human_id: 'T1', payment_status: 'SUCCEED', usecase_data: { data: { creator_user_nickname: 'otterly', buyer_user_email: 'a@b.co', catalog_id: 'c' } } } };
    expect(processGankEvent(parseGankPayload(tip)!, raw(tip)).outcome).toBe('processed');
    expect(all('SELECT * FROM donations')).toHaveLength(1);
  });
});

describe('helpers', () => {
  it('addMonths clamps to month end', () => {
    expect(addMonths(new Date('2026-01-31T00:00:00Z'), 1).toISOString().slice(0, 10)).toBe('2026-02-28');
  });
  it('signature check', () => {
    const body = '{"a":1}';
    const hex = createHmac('sha256', 's').update(body).digest('hex');
    expect(signatureValid(body, hex, 's')).toBe(true);
    expect(signatureValid(body, 'sha256=' + hex, 's')).toBe(true);
    expect(signatureValid(body, hex, 'other')).toBe(false);
    expect(signatureValid(body, null, 's')).toBe(false);
  });
});
