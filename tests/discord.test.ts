import { beforeEach, describe, expect, it, vi } from 'vitest';
process.env.DB_FILE = ':memory:';
import { resetDbForTests, run, get, newId, nowIso, type CreatorRow } from '../src/lib/db';
import { DC, DiscordError, type DiscordClient, type DiscordRole } from '../src/lib/discord';
import { BOT_GONE, syncCreator, syncEmail, syncMember, syncUser, unlinkDiscord } from '../src/lib/discord-sync';

vi.mock('../src/lib/email', () => ({ sendMail: vi.fn(async () => {}) }));
import { sendMail } from '../src/lib/email';

const GUILD = 'g1';

/** A pretend Discord server that records what the bot did. */
function fakeDiscord(opts: { roles?: string[]; members?: string[]; gone?: boolean } = {}) {
  const roles = new Set(opts.roles ?? ['r-pebble', 'r-pearl']);
  const members = new Map<string, Set<string>>((opts.members ?? []).map((m) => [m, new Set()]));
  const log: string[] = [];
  const lost = () => { if (opts.gone) throw new DiscordError(403, 'Missing Access', DC.MISSING_ACCESS); };
  const api: DiscordClient = {
    async addRole(_g, u, r) {
      lost(); log.push(`add ${u} ${r}`);
      if (!roles.has(r)) throw new DiscordError(404, 'Unknown Role', DC.UNKNOWN_ROLE);
      const m = members.get(u); if (!m) throw new DiscordError(404, 'Unknown Member', DC.UNKNOWN_MEMBER);
      m.add(r);
    },
    async removeRole(_g, u, r) {
      lost(); log.push(`remove ${u} ${r}`);
      const m = members.get(u); if (!m) throw new DiscordError(404, 'Unknown Member', DC.UNKNOWN_MEMBER);
      m.delete(r);
    },
    async addMember(_g, u, _t, r) {
      lost(); log.push(`join ${u} ${r ?? '-'}`);
      const m = members.get(u) ?? new Set<string>(); members.set(u, m); if (r) m.add(r);
    },
    async roles() { lost(); return [...roles].map((id, i) => ({ id, name: id, position: i + 1, managed: false }) as DiscordRole); },
    async manageableRoles() { return api.roles(GUILD); },
    async createRole(_g, name) { const id = 'r-' + name; roles.add(id); return { id, name, position: 1, managed: false }; },
    async leaveGuild() {},
  };
  return { api, log, members, roles };
}

let creator: CreatorRow;
let pebble: string, pearl: string;

function seed() {
  const uid = newId(), cid = newId();
  pebble = newId(); pearl = newId();
  run('INSERT INTO users (id, createdAt) VALUES (?, ?)', uid, nowIso());
  run('INSERT INTO user_emails (id, userId, email, createdAt) VALUES (?,?,?,?)', newId(), uid, 'creator@x.co', nowIso());
  run('INSERT INTO creators (id,userId,handle,name,verifyCode,hookSecret,discordGuildId,createdAt) VALUES (?,?,?,?,?,?,?,?)', cid, uid, 'otterly', 'Otterly', 'c', 'h' + cid, GUILD, nowIso());
  run("INSERT INTO tiers (id,creatorId,position,name,price,discordRoleId) VALUES (?,?,0,'Pebble',5,'r-pebble')", pebble, cid);
  run("INSERT INTO tiers (id,creatorId,position,name,price,discordRoleId) VALUES (?,?,1,'Pearl',10,'r-pearl')", pearl, cid);
  creator = get<CreatorRow>('SELECT * FROM creators WHERE id = ?', cid)!;
}
function fan(email: string, discordId: string): string {
  const uid = newId();
  run('INSERT INTO users (id, createdAt) VALUES (?, ?)', uid, nowIso());
  run('INSERT INTO user_emails (id, userId, email, createdAt) VALUES (?,?,?,?)', newId(), uid, email, nowIso());
  run('INSERT INTO discord_links (userId, discordUserId, username, createdAt) VALUES (?,?,?,?)', uid, discordId, discordId, nowIso());
  return uid;
}
function pay(email: string, tierId: string, days = 30, status = 'active') {
  const through = new Date(Date.now() + days * 86400_000).toISOString();
  run(`INSERT INTO entitlements (id, creatorId, email, tierId, status, paidThrough, sourceEventId, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT (creatorId, email) DO UPDATE SET tierId = excluded.tierId, status = excluded.status, paidThrough = excluded.paidThrough`,
    newId(), creator.id, email, tierId, status, through, 'e', nowIso(), nowIso());
}
const fresh = () => get<CreatorRow>('SELECT * FROM creators WHERE id = ?', creator.id)!;

beforeEach(() => { resetDbForTests(); seed(); vi.mocked(sendMail).mockClear(); });

describe('joining with the link', () => {
  it('a paying fan is added with their tier role', async () => {
    const d = fakeDiscord();
    const u = fan('a@x.co', 'd-a'); pay('a@x.co', pearl);
    expect(await syncMember(creator, u, d.api, { accessToken: 't' })).toBe('added');
    expect(d.members.get('d-a')?.has('r-pearl')).toBe(true);
  });
  it('a fan with no plan is not told they are in, and is not added', async () => {
    const d = fakeDiscord();
    const u = fan('a@x.co', 'd-a');
    expect(await syncMember(creator, u, d.api, { accessToken: 't' })).toBe('no-plan');
    expect(d.log).toEqual([]);
  });
  it('a paying fan whose tier has no role yet is still let into the server', async () => {
    const d = fakeDiscord();
    run("UPDATE tiers SET discordRoleId = '' WHERE id = ?", pearl);
    const u = fan('a@x.co', 'd-a'); pay('a@x.co', pearl);
    expect(await syncMember(creator, u, d.api, { accessToken: 't' })).toBe('no-role');
    expect(d.log).toEqual(['join d-a -']);
  });
});

describe('keeping roles in step', () => {
  it('swaps the role on upgrade and removes it when the plan runs out', async () => {
    const d = fakeDiscord({ members: ['d-a'] });
    const u = fan('a@x.co', 'd-a'); pay('a@x.co', pebble);
    expect(await syncMember(creator, u, d.api)).toBe('added');
    pay('a@x.co', pearl);
    expect(await syncMember(creator, u, d.api)).toBe('swapped');
    expect([...d.members.get('d-a')!]).toEqual(['r-pearl']);
    pay('a@x.co', pearl, -10); // lapsed
    expect(await syncMember(creator, u, d.api)).toBe('removed');
    expect(d.members.get('d-a')!.size).toBe(0);
  });
  it('someone who left the server is not an error', async () => {
    const d = fakeDiscord();
    const u = fan('a@x.co', 'd-a'); pay('a@x.co', pearl);
    expect(await syncMember(creator, u, d.api)).toBe('not-in-server');
    expect(get('SELECT 1 FROM discord_grants')).toBeUndefined();
  });
  it('syncEmail updates a fan right after a payment or refund', async () => {
    const d = fakeDiscord({ members: ['d-a'] });
    fan('a@x.co', 'd-a'); pay('a@x.co', pebble);
    await syncEmail(creator.id, 'a@x.co', d.api);
    expect(d.members.get('d-a')!.has('r-pebble')).toBe(true);
    run("UPDATE entitlements SET status = 'revoked'");
    await syncEmail(creator.id, 'a@x.co', d.api);
    expect(d.members.get('d-a')!.size).toBe(0);
  });
  it('syncUser picks up a plan found through a newly claimed email', async () => {
    const d = fakeDiscord({ members: ['d-a'] });
    const u = fan('a@x.co', 'd-a'); pay('paid-with@x.co', pearl);
    await syncUser(u, d.api);
    expect(d.log).toEqual([]);
    run('INSERT INTO user_emails (id, userId, email, createdAt) VALUES (?,?,?,?)', newId(), u, 'paid-with@x.co', nowIso());
    await syncUser(u, d.api);
    expect(d.members.get('d-a')!.has('r-pearl')).toBe(true);
  });
  it('unlinking takes the roles back and forgets the account', async () => {
    const d = fakeDiscord({ members: ['d-a'] });
    const u = fan('a@x.co', 'd-a'); pay('a@x.co', pearl);
    await syncMember(creator, u, d.api);
    await unlinkDiscord(u, d.api);
    expect(d.members.get('d-a')!.size).toBe(0);
    expect(get('SELECT 1 FROM discord_links')).toBeUndefined();
  });
});

describe('server problems', () => {
  it('notices when the bot was kicked, tells the creator once, and stops trying', async () => {
    const d = fakeDiscord({ gone: true });
    fan('a@x.co', 'd-a'); pay('a@x.co', pearl);
    expect(await syncCreator(creator, d.api)).toEqual({ 'bot-gone': 1 });
    expect(fresh().discordProblem).toBe(BOT_GONE);
    expect(sendMail).toHaveBeenCalledTimes(1);
    await syncCreator(fresh(), d.api);
    expect(sendMail).toHaveBeenCalledTimes(1); // not every half hour
  });
  it('warns about a deleted role but still serves the other tiers', async () => {
    const d = fakeDiscord({ roles: ['r-pebble'], members: ['d-a', 'd-b'] });
    fan('a@x.co', 'd-a'); pay('a@x.co', pebble);
    fan('b@x.co', 'd-b'); pay('b@x.co', pearl);
    const counts = await syncCreator(creator, d.api);
    expect(counts.added).toBe(1);
    expect(counts['no-role']).toBe(1);
    expect(counts.error).toBeUndefined();
    expect(fresh().discordProblem).toContain('Pearl');
  });
  it('clears the warning once things are fixed', async () => {
    run('UPDATE creators SET discordProblem = ? WHERE id = ?', BOT_GONE, creator.id);
    await syncCreator(fresh(), fakeDiscord().api);
    expect(fresh().discordProblem).toBe('');
  });
});
