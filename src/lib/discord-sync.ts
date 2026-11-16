import { randomBytes } from 'node:crypto';
import { all, get, nowIso, run } from './db';
import type { CreatorRow } from './db';
import { tierRanks, viewerRank } from './access';
import { creatorEmails, tiersOf } from './creators';
import { DC, DiscordError, botLostServer, discord, discordConfigured, type DiscordClient } from './discord';
import { sendMail } from './email';

// Keeps Discord roles in step with who has paid. The rules reuse the same access check as locked posts,
// so a fan holds a role exactly while they can open that creator's posts.

const STATE_MINUTES = 10;

/** Starts a Discord sign-in that only this signed-in user can finish. */
export function createState(kind: 'install' | 'join', userId: string, creatorId: string): string {
  run('DELETE FROM discord_states WHERE expiresAt < ?', nowIso());
  const state = randomBytes(24).toString('base64url');
  run('INSERT INTO discord_states (state, kind, userId, creatorId, expiresAt) VALUES (?,?,?,?,?)',
    state, kind, userId, creatorId, new Date(Date.now() + STATE_MINUTES * 60_000).toISOString());
  return state;
}
/** Spends a state. It works once, within ten minutes. */
export function consumeState(state: string): { kind: 'install' | 'join'; userId: string; creatorId: string } | null {
  const row = get<{ kind: string; userId: string; creatorId: string; expiresAt: string }>('SELECT * FROM discord_states WHERE state = ?', state);
  if (!row) return null;
  const spent = run('DELETE FROM discord_states WHERE state = ?', state).changes === 1;
  if (!spent || row.expiresAt < nowIso()) return null;
  return { kind: row.kind as 'install' | 'join', userId: row.userId, creatorId: row.creatorId };
}

/** What this person has paid for with this creator right now: their tier rank (0 = nothing) and that tier's role, if the creator picked one. */
export function planFor(creator: CreatorRow, userId: string, now: Date = new Date()): { rank: number; roleId: string | null } {
  const emails = all<{ email: string }>('SELECT email FROM user_emails WHERE userId = ?', userId).map((r) => r.email);
  const tiers = tiersOf(creator.id);
  const ranks = tierRanks(tiers);
  const rank = viewerRank(creator.id, emails, ranks, now);
  if (!rank) return { rank: 0, roleId: null };
  return { rank, roleId: tiers.find((t) => ranks.get(t.id) === rank)?.discordRoleId || null };
}

/** The Discord role this person should hold in this creator's server right now, or null. Highest paid tier wins. */
export const wantedRole = (creator: CreatorRow, userId: string, now: Date = new Date()): string | null => planFor(creator, userId, now).roleId;

/**
 * added / swapped / unchanged: they hold the right role.
 * no-role: they have paid, but the creator has not picked a role for their tier (they are still let into the server when they click).
 * no-plan: nothing paid. removed: a role was taken away because the plan ended.
 * not-in-server: they have not joined the server yet; their next click on the join link fixes it.
 */
export type SyncResult = 'added' | 'swapped' | 'removed' | 'unchanged' | 'no-role' | 'no-plan' | 'not-in-server' | 'no-link' | 'no-server';

/** Runs a Discord call where "that member or role is already gone" counts as done. Anything else (like the bot being kicked) is passed on. */
const quiet = async (fn: () => Promise<void>) => {
  try { await fn(); } catch (e) {
    if (!(e instanceof DiscordError && (e.code === DC.UNKNOWN_MEMBER || e.code === DC.UNKNOWN_ROLE))) throw e;
  }
};

export interface SyncOptions {
  /** The fan's fresh Discord sign-in, from clicking the join link. With it we can also add them to the server. */
  accessToken?: string;
  now?: Date;
  /** Roles known to exist and be usable. A tier whose role is not in here is treated as having no role. */
  usableRoles?: Set<string>;
}

/** Brings one person's role in one server in line with what they have paid for. */
export async function syncMember(creator: CreatorRow, userId: string, api: DiscordClient = discord, opts: SyncOptions = {}): Promise<SyncResult> {
  const guild = creator.discordGuildId;
  if (!guild) return 'no-server';
  const link = get<{ discordUserId: string }>('SELECT discordUserId FROM discord_links WHERE userId = ?', userId);
  if (!link) return 'no-link';
  const plan = planFor(creator, userId, opts.now);
  const want = plan.roleId && (!opts.usableRoles || opts.usableRoles.has(plan.roleId)) ? plan.roleId : null;
  const have = get<{ roleId: string }>('SELECT roleId FROM discord_grants WHERE userId = ? AND creatorId = ?', userId, creator.id);
  const forget = () => run('DELETE FROM discord_grants WHERE userId = ? AND creatorId = ?', userId, creator.id);

  if (!want) {
    if (have) { await quiet(() => api.removeRole(guild, link.discordUserId, have.roleId)); forget(); }
    if (plan.rank > 0) {
      // They paid. Let them into the server now; the role follows once the creator picks one.
      if (opts.accessToken) await api.addMember(guild, link.discordUserId, opts.accessToken, null);
      return 'no-role';
    }
    return have ? 'removed' : 'no-plan';
  }
  // With a fresh sign-in (the fan just clicked) we always re-add them, in case they left the server.
  if (have?.roleId === want && !opts.accessToken) return 'unchanged';
  if (have && have.roleId !== want) await quiet(() => api.removeRole(guild, link.discordUserId, have.roleId));
  try {
    if (opts.accessToken) await api.addMember(guild, link.discordUserId, opts.accessToken, want);
    else await api.addRole(guild, link.discordUserId, want);
  } catch (e) {
    // They are not in the server yet. Nothing to record; their next click on the join link adds them.
    if (e instanceof DiscordError && e.code === DC.UNKNOWN_MEMBER) { forget(); return 'not-in-server'; }
    throw e;
  }
  run('INSERT INTO discord_grants (userId, creatorId, roleId, grantedAt) VALUES (?,?,?,?) ON CONFLICT (userId, creatorId) DO UPDATE SET roleId = excluded.roleId, grantedAt = excluded.grantedAt',
    userId, creator.id, want, nowIso());
  return !have ? 'added' : have.roleId === want ? 'unchanged' : 'swapped';
}

// ---------- server health ----------

export const BOT_GONE = 'The bot can no longer reach your Discord server. It may have been removed from the server. Disconnect below, then add the bot again.';

export interface ServerCheck { problem: string; botGone: boolean; usableRoles: Set<string> }

/** Can the bot still reach the server, and does every tier's role still exist below the bot's own role? */
export async function checkServer(creator: CreatorRow, api: DiscordClient = discord): Promise<ServerCheck> {
  let roles;
  try { roles = await api.manageableRoles(creator.discordGuildId); }
  catch (e) {
    if (botLostServer(e)) return { problem: BOT_GONE, botGone: true, usableRoles: new Set() };
    throw e;
  }
  const usableRoles = new Set(roles.map((r) => r.id));
  const broken = tiersOf(creator.id).filter((t) => t.discordRoleId && !usableRoles.has(t.discordRoleId)).map((t) => `“${t.name}”`);
  const problem = broken.length
    ? `The Discord role for ${broken.join(', ')} was deleted, or now sits above the bot's own role in your server's role list. Pick a role for ${broken.length === 1 ? 'that tier' : 'those tiers'} again below.`
    : '';
  return { problem, botGone: false, usableRoles };
}

/** Saves the problem for the studio. Emails the creator the first time a new problem appears, not every half hour. */
export async function recordProblem(creator: CreatorRow, problem: string): Promise<void> {
  const before = get<{ p: string }>('SELECT discordProblem p FROM creators WHERE id = ?', creator.id)?.p ?? '';
  if (before === problem) return;
  run('UPDATE creators SET discordProblem = ? WHERE id = ?', problem, creator.id);
  if (!problem) return;
  const site = (process.env.APP_URL || '').replace(/\/$/, '');
  for (const to of creatorEmails(creator.userId)) {
    await sendMail(to, 'Your Discord roles need attention',
      `Hi ${creator.name},\n\n${problem}\n\nUntil it is fixed, supporters may not get their Discord roles.\n\nFix it here: ${site}/studio?tab=discord`)
      .catch((e) => console.error('discord problem email failed', e));
  }
}

// ---------- whole server ----------

/** Everyone who is linked and has (or had) something with this creator. */
function peopleFor(creatorId: string): string[] {
  return all<{ userId: string }>(
    `SELECT l.userId FROM discord_links l JOIN user_emails e ON e.userId = l.userId JOIN entitlements n ON n.email = e.email AND n.creatorId = ?
     UNION SELECT userId FROM discord_grants WHERE creatorId = ?`, creatorId, creatorId).map((r) => r.userId);
}

export async function syncCreator(creator: CreatorRow, api: DiscordClient = discord, now: Date = new Date()): Promise<Record<string, number>> {
  if (!creator.discordGuildId) return {};
  const check = await checkServer(creator, api);
  await recordProblem(creator, check.problem);
  // With the bot gone every call would fail, so there is nothing useful to do until the creator reconnects.
  if (check.botGone) return { 'bot-gone': 1 };
  const counts: Record<string, number> = {};
  for (const userId of peopleFor(creator.id)) {
    try {
      const r = await syncMember(creator, userId, api, { now, usableRoles: check.usableRoles });
      counts[r] = (counts[r] || 0) + 1;
    } catch (e) {
      counts.error = (counts.error || 0) + 1;
      console.error(`discord sync failed for creator ${creator.handle}:`, e instanceof Error ? e.message : e);
    }
  }
  return counts;
}

export async function syncAll(api: DiscordClient = discord, now: Date = new Date()): Promise<void> {
  const creators = all<CreatorRow>("SELECT * FROM creators WHERE discordGuildId != '' AND suspended = 0");
  for (const c of creators) {
    try { await syncCreator(c, api, now); }
    catch (e) { console.error(`discord sync failed for creator ${c.handle}:`, e instanceof Error ? e.message : e); }
  }
}

// ---------- right away, after something changes ----------

/** After a payment, refund or cancel for this email: update that fan's role now instead of at the next half-hourly check. */
export async function syncEmail(creatorId: string, email: string, api: DiscordClient = discord): Promise<void> {
  const creator = get<CreatorRow>("SELECT * FROM creators WHERE id = ? AND discordGuildId != '' AND suspended = 0", creatorId);
  if (!creator) return;
  const users = all<{ userId: string }>('SELECT e.userId FROM user_emails e JOIN discord_links l ON l.userId = e.userId WHERE e.email = ?', email);
  for (const u of users) await syncMember(creator, u.userId, api);
}

/** After a fan adds another email to their account: their roles everywhere may change. */
export async function syncUser(userId: string, api: DiscordClient = discord): Promise<void> {
  if (!get('SELECT 1 FROM discord_links WHERE userId = ?', userId)) return;
  const creators = all<CreatorRow>(
    `SELECT DISTINCT c.* FROM creators c WHERE c.discordGuildId != '' AND c.suspended = 0 AND (
       c.id IN (SELECT creatorId FROM discord_grants WHERE userId = ?) OR
       c.id IN (SELECT n.creatorId FROM entitlements n JOIN user_emails e ON e.email = n.email WHERE e.userId = ?))`, userId, userId);
  for (const c of creators) await syncMember(c, userId, api);
}

/** Fire-and-forget wrapper: never slows down or breaks the request that triggered it. */
export function soon(what: string, fn: () => Promise<unknown>): void {
  if (!discordConfigured()) return;
  fn().catch((e) => console.error(`discord ${what} failed:`, e instanceof Error ? e.message : e));
}

// ---------- leaving ----------

/** Takes back every role we gave this person. Best effort. */
export async function revokeAllFor(userId: string, api: DiscordClient = discord): Promise<void> {
  const link = get<{ discordUserId: string }>('SELECT discordUserId FROM discord_links WHERE userId = ?', userId);
  if (!link) return;
  const rows = all<{ roleId: string; guild: string }>(
    'SELECT g.roleId, c.discordGuildId AS guild FROM discord_grants g JOIN creators c ON c.id = g.creatorId WHERE g.userId = ?', userId);
  for (const r of rows) await quiet(() => api.removeRole(r.guild, link.discordUserId, r.roleId)).catch(() => {});
}

/** A fan unlinks their Discord account: roles are taken back and the link is forgotten. */
export async function unlinkDiscord(userId: string, api: DiscordClient = discord): Promise<void> {
  await revokeAllFor(userId, api);
  run('DELETE FROM discord_grants WHERE userId = ?', userId);
  run('DELETE FROM discord_links WHERE userId = ?', userId);
}

export async function leaveQuietly(guildId: string, api: DiscordClient = discord): Promise<void> {
  if (guildId) await api.leaveGuild(guildId).catch(() => {});
}

let timer: ReturnType<typeof setInterval> | undefined;
/** Checks every server on a timer, so roles are removed when a plan runs out. Runs once per server process. */
export function startDiscordSync(): void {
  if (timer || !discordConfigured()) return;
  const minutes = Math.max(5, Number(process.env.DISCORD_SYNC_MINUTES) || 30);
  const tick = () => { syncAll().catch((e) => console.error('discord sync round failed', e)); };
  timer = setInterval(tick, minutes * 60_000);
  timer.unref();
  setTimeout(tick, 2 * 60_000).unref();
}
