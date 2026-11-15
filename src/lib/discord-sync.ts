import { randomBytes } from 'node:crypto';
import { all, get, nowIso, run } from './db';
import type { CreatorRow } from './db';
import { tierRanks, viewerRank } from './access';
import { tiersOf } from './creators';
import { DiscordError, discord, discordConfigured, type DiscordClient } from './discord';

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

/** The Discord role this person should hold in this creator's server right now, or null. Highest paid tier wins. */
export function wantedRole(creator: CreatorRow, userId: string, now: Date = new Date()): string | null {
  const emails = all<{ email: string }>('SELECT email FROM user_emails WHERE userId = ?', userId).map((r) => r.email);
  const tiers = tiersOf(creator.id);
  const ranks = tierRanks(tiers);
  const rank = viewerRank(creator.id, emails, ranks, now);
  if (!rank) return null;
  return tiers.find((t) => ranks.get(t.id) === rank)?.discordRoleId || null;
}

export type SyncResult = 'added' | 'swapped' | 'removed' | 'unchanged' | 'not-in-server' | 'no-link' | 'no-server';

const quiet = async (fn: () => Promise<void>) => {
  try { await fn(); } catch (e) { if (!(e instanceof DiscordError && e.status === 404)) throw e; }
};

/** Brings one person's role in one server in line with what they have paid for. Pass their OAuth token to also add them to the server. */
export async function syncMember(creator: CreatorRow, userId: string, api: DiscordClient = discord, opts: { accessToken?: string; now?: Date } = {}): Promise<SyncResult> {
  const guild = creator.discordGuildId;
  if (!guild) return 'no-server';
  const link = get<{ discordUserId: string }>('SELECT discordUserId FROM discord_links WHERE userId = ?', userId);
  if (!link) return 'no-link';
  const want = wantedRole(creator, userId, opts.now);
  const have = get<{ roleId: string }>('SELECT roleId FROM discord_grants WHERE userId = ? AND creatorId = ?', userId, creator.id);

  if (!want) {
    if (!have) return 'unchanged';
    await quiet(() => api.removeRole(guild, link.discordUserId, have.roleId));
    run('DELETE FROM discord_grants WHERE userId = ? AND creatorId = ?', userId, creator.id);
    return 'removed';
  }
  // With a fresh OAuth token (the fan just clicked the button) we always re-add them, in case they left the server.
  if (have?.roleId === want && !opts.accessToken) return 'unchanged';
  if (have && have.roleId !== want) await quiet(() => api.removeRole(guild, link.discordUserId, have.roleId));
  try {
    if (opts.accessToken) await api.addMemberWithRole(guild, link.discordUserId, opts.accessToken, want);
    else await api.addRole(guild, link.discordUserId, want);
  } catch (e) {
    // Not in the server yet (or the role was deleted). Nothing to record; a later sync or their next click tries again.
    if (e instanceof DiscordError && e.status === 404) { run('DELETE FROM discord_grants WHERE userId = ? AND creatorId = ?', userId, creator.id); return 'not-in-server'; }
    throw e;
  }
  run('INSERT INTO discord_grants (userId, creatorId, roleId, grantedAt) VALUES (?,?,?,?) ON CONFLICT (userId, creatorId) DO UPDATE SET roleId = excluded.roleId, grantedAt = excluded.grantedAt',
    userId, creator.id, want, nowIso());
  return !have ? 'added' : have.roleId === want ? 'unchanged' : 'swapped';
}

/** Everyone who is linked and has (or had) something with this creator. */
function peopleFor(creatorId: string): string[] {
  return all<{ userId: string }>(
    `SELECT l.userId FROM discord_links l JOIN user_emails e ON e.userId = l.userId JOIN entitlements n ON n.email = e.email AND n.creatorId = ?
     UNION SELECT userId FROM discord_grants WHERE creatorId = ?`, creatorId, creatorId).map((r) => r.userId);
}

export async function syncCreator(creator: CreatorRow, api: DiscordClient = discord, now: Date = new Date()): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const userId of peopleFor(creator.id)) {
    try {
      const r = await syncMember(creator, userId, api, { now });
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
  for (const c of creators) await syncCreator(c, api, now);
}

/** When someone deletes their account: take back every role we gave them. Best effort. */
export async function revokeAllFor(userId: string, api: DiscordClient = discord): Promise<void> {
  const link = get<{ discordUserId: string }>('SELECT discordUserId FROM discord_links WHERE userId = ?', userId);
  if (!link) return;
  const rows = all<{ roleId: string; guild: string }>(
    'SELECT g.roleId, c.discordGuildId AS guild FROM discord_grants g JOIN creators c ON c.id = g.creatorId WHERE g.userId = ?', userId);
  for (const r of rows) await quiet(() => api.removeRole(r.guild, link.discordUserId, r.roleId)).catch(() => {});
}

export async function leaveQuietly(guildId: string, api: DiscordClient = discord): Promise<void> {
  if (guildId) await api.leaveGuild(guildId).catch(() => {});
}

let timer: ReturnType<typeof setInterval> | undefined;
/** Checks every server on a timer, so roles are removed when a plan lapses. Runs once per server process. */
export function startDiscordSync(): void {
  if (timer || !discordConfigured()) return;
  const minutes = Math.max(5, Number(process.env.DISCORD_SYNC_MINUTES) || 30);
  const tick = () => { syncAll().catch((e) => console.error('discord sync round failed', e)); };
  timer = setInterval(tick, minutes * 60_000);
  timer.unref();
  setTimeout(tick, 2 * 60_000).unref();
}
