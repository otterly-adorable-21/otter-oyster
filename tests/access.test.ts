import { beforeEach, describe, expect, it } from 'vitest';
process.env.DB_FILE = ':memory:';
import { resetDbForTests, run, newId, nowIso, type TierRow } from '../src/lib/db';
import { postState, tierRanks, viewerRank } from '../src/lib/access';
import { validHandle, normalizeEmail, nickFromUrl, httpsUrl } from '../src/lib/validate';
import { isPrivateIp, hostAllowed, verifyCodeOnPage } from '../src/lib/verify';

const tier = (id: string, position: number) => ({ id, position }) as TierRow;
const base = { ranks: tierRanks([tier('a', 0), tier('b', 1)]), rank: 0, isOwner: false, ageOk: true, hideNsfw: false };

describe('postState', () => {
  it('orders removed, owner, hidden, age, lock', () => {
    const p = { tierId: 'b', nsfw: true, hidden: false };
    expect(postState(p, { ...base, ageOk: false })).toBe('age');
    expect(postState(p, { ...base, hideNsfw: true })).toBe('hidden');
    expect(postState(p, base)).toBe('locked');
    expect(postState(p, { ...base, rank: 2 })).toBe('open');
    expect(postState(p, { ...base, rank: 1 })).toBe('locked');
    expect(postState(p, { ...base, isOwner: true, ageOk: false })).toBe('open');
    expect(postState({ ...p, hidden: true }, { ...base, rank: 2 })).toBe('removed');
  });
  it('a deleted-tier reference stays locked, never public', () => {
    expect(postState({ tierId: 'gone', nsfw: false, hidden: false }, { ...base, rank: 2 })).toBe('locked');
  });
  it('public posts are open', () => {
    expect(postState({ tierId: null, nsfw: false, hidden: false }, base)).toBe('open');
  });
});

describe('viewerRank', () => {
  beforeEach(() => resetDbForTests());
  function setup() {
    const uid = newId(), cid = newId(), t = newId();
    run('INSERT INTO users (id, createdAt) VALUES (?,?)', uid, nowIso());
    run('INSERT INTO creators (id,userId,handle,name,verifyCode,hookSecret,createdAt) VALUES (?,?,?,?,?,?,?)', cid, uid, 'h', 'n', 'c', 's', nowIso());
    run('INSERT INTO tiers (id,creatorId,position,name,price) VALUES (?,?,?,?,?)', t, cid, 0, 'T', 5);
    return { cid, t };
  }
  const ent = (cid: string, t: string, status: string, through: string, email = 'a@b.co') =>
    run('INSERT INTO entitlements (id,creatorId,email,tierId,status,paidThrough,sourceEventId,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?)', newId(), cid, email, t, status, through, 'e', nowIso(), nowIso());
  const future = new Date(Date.now() + 86400_000).toISOString(), past = new Date(Date.now() - 86400_000).toISOString();

  it('active and canceled keep access until the date; revoked and expired do not', () => {
    const { cid, t } = setup();
    const ranks = new Map([[t, 1]]);
    ent(cid, t, 'canceled', future);
    expect(viewerRank(cid, ['a@b.co'], ranks)).toBe(1);
    resetDbForTests();
    const s = setup(); ent(s.cid, s.t, 'revoked', future);
    expect(viewerRank(s.cid, ['a@b.co'], new Map([[s.t, 1]]))).toBe(0);
    resetDbForTests();
    const u = setup(); ent(u.cid, u.t, 'active', past);
    expect(viewerRank(u.cid, ['a@b.co'], new Map([[u.t, 1]]))).toBe(0);
  });
  it('matches any of the viewer\'s linked emails', () => {
    const { cid, t } = setup(); ent(cid, t, 'active', future, 'second@b.co');
    expect(viewerRank(cid, ['first@b.co', 'second@b.co'], new Map([[t, 1]]))).toBe(1);
    expect(viewerRank(cid, ['first@b.co'], new Map([[t, 1]]))).toBe(0);
  });
});

describe('validate', () => {
  it('handles', () => {
    expect(validHandle('@Otter_1')).toBe('otter_1');
    expect(validHandle('my-page')).toBe('my-page');
    for (const bad of ['ab', '-bad', 'bad-', 'has space', 'studio', 'a/b', '../x']) expect(validHandle(bad)).toBeNull();
  });
  it('emails and urls', () => {
    expect(normalizeEmail(' Fan@Example.COM ')).toBe('fan@example.com');
    expect(normalizeEmail('nope')).toBeNull();
    expect(httpsUrl('http://x.com')).toBeNull();
    expect(httpsUrl('javascript:alert(1)')).toBeNull();
    expect(httpsUrl('https://ganknow.com/otterly')).toBeTruthy();
    expect(nickFromUrl('https://ganknow.com/Otterly/')).toBe('otterly');
  });
});

describe('verify', () => {
  it('blocks private addresses and unlisted hosts', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '169.254.169.254', '::1', '172.16.0.1']) expect(isPrivateIp(ip)).toBe(true);
    expect(isPrivateIp('8.8.8.8')).toBe(false);
    expect(hostAllowed('evil.com', ['ganknow.com'])).toBe(false);
    expect(hostAllowed('ganknow.com', ['ganknow.com'])).toBe(true);
  });
  it('rejects a non-allowed host before any request', async () => {
    const r = await verifyCodeOnPage('https://evil.example.org/x', 'code');
    expect(r.ok).toBe(false);
  });
});
