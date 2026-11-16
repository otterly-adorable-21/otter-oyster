import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Plain SQLite through Node's built-in driver: no native packages, one file on disk.
// Columns are camelCase so rows map straight onto the types below. Booleans are 0 or 1.

export function dataDir(): string {
  return path.resolve(process.env.DATA_DIR || './data');
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS user_emails (
  id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE, createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS login_tokens (
  id TEXT PRIMARY KEY, tokenHash TEXT NOT NULL UNIQUE, email TEXT NOT NULL,
  purpose TEXT NOT NULL, userId TEXT, expiresAt TEXT NOT NULL, usedAt TEXT, createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_tokens_email ON login_tokens(email, createdAt);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, tokenHash TEXT NOT NULL UNIQUE,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expiresAt TEXT NOT NULL, createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS creators (
  id TEXT PRIMARY KEY, userId TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  handle TEXT NOT NULL UNIQUE, name TEXT NOT NULL, bio TEXT NOT NULL DEFAULT '',
  mainColor TEXT NOT NULL DEFAULT '#00ffd5', accentColor TEXT NOT NULL DEFAULT '#ffffff',
  bannerFile TEXT, bannerGrad TEXT NOT NULL DEFAULT 'match',
  avatarFile TEXT, avatarShape TEXT NOT NULL DEFAULT 'circle',
  dividerKind TEXT NOT NULL DEFAULT 'line', dividerFile TEXT, logoFile TEXT,
  bannerStatic TEXT, avatarStatic TEXT, logoStatic TEXT,
  mascotOn INTEGER NOT NULL DEFAULT 0, mascotLines TEXT NOT NULL DEFAULT 'Thanks for stopping by!',
  gankUrl TEXT NOT NULL DEFAULT '', gankNick TEXT NOT NULL DEFAULT '',
  gankVerified INTEGER NOT NULL DEFAULT 0, verifyCode TEXT NOT NULL,
  tipUrl TEXT NOT NULL DEFAULT '', hookSecret TEXT NOT NULL UNIQUE, gankSigningKey TEXT NOT NULL DEFAULT '',
  reviewNote TEXT NOT NULL DEFAULT '', reviewRequestedAt TEXT, reviewResult TEXT NOT NULL DEFAULT '',
  discordGuildId TEXT NOT NULL DEFAULT '', discordGuildName TEXT NOT NULL DEFAULT '',
  isExample INTEGER NOT NULL DEFAULT 0, suspended INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tiers (
  id TEXT PRIMARY KEY, creatorId TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  position INTEGER NOT NULL, name TEXT NOT NULL, price INTEGER NOT NULL,
  perks TEXT NOT NULL DEFAULT '[]', gankUrl TEXT NOT NULL DEFAULT '', gankTierRef TEXT, discordRoleId TEXT NOT NULL DEFAULT '',
  UNIQUE (creatorId, gankTierRef)
);
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY, creatorId TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  -- RESTRICT: deleting a tier must never silently make its posts public.
  tierId TEXT REFERENCES tiers(id) ON DELETE RESTRICT,
  title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', nsfw INTEGER NOT NULL DEFAULT 0,
  imageFile TEXT, imageAlt TEXT NOT NULL DEFAULT '', hidden INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_creator ON posts(creatorId, createdAt);
CREATE TABLE IF NOT EXISTS entitlements (
  id TEXT PRIMARY KEY, creatorId TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  email TEXT NOT NULL, tierId TEXT NOT NULL REFERENCES tiers(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active', paidThrough TEXT NOT NULL, sourceEventId TEXT NOT NULL,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, UNIQUE (creatorId, email)
);
CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY, provider TEXT NOT NULL, providerEventId TEXT NOT NULL,
  eventName TEXT NOT NULL, creatorNick TEXT NOT NULL DEFAULT '',
  creatorId TEXT REFERENCES creators(id) ON DELETE SET NULL,
  email TEXT NOT NULL DEFAULT '', priceRef TEXT, billingPeriod INTEGER,
  status TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', raw TEXT NOT NULL, receivedAt TEXT NOT NULL,
  UNIQUE (provider, providerEventId)
);
CREATE TABLE IF NOT EXISTS donations (
  id TEXT PRIMARY KEY, creatorId TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  email TEXT NOT NULL, providerEventId TEXT NOT NULL UNIQUE, itemRef TEXT, createdAt TEXT NOT NULL
);
-- A fan's proven Discord account (OAuth), one per site account and one site account per Discord account.
CREATE TABLE IF NOT EXISTS discord_links (
  userId TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  discordUserId TEXT NOT NULL UNIQUE, username TEXT NOT NULL DEFAULT '', createdAt TEXT NOT NULL
);
-- The role we gave a fan in a creator's server, so we know what to take back.
CREATE TABLE IF NOT EXISTS discord_grants (
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  creatorId TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  roleId TEXT NOT NULL, grantedAt TEXT NOT NULL, PRIMARY KEY (userId, creatorId)
);
-- One-time OAuth state, so a Discord callback can only finish a flow this site started for this signed-in user.
CREATE TABLE IF NOT EXISTS discord_states (
  state TEXT PRIMARY KEY, kind TEXT NOT NULL, userId TEXT NOT NULL, creatorId TEXT NOT NULL, expiresAt TEXT NOT NULL
);
-- A creator's connection to Ko-fi, Buy Me a Coffee or SubscribeStar. The private hookSecret in the
-- webhook address is what ties incoming payments to this creator, so no page review is needed.
CREATE TABLE IF NOT EXISTS payment_links (
  id TEXT PRIMARY KEY, creatorId TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, pageUrl TEXT NOT NULL DEFAULT '', hookSecret TEXT NOT NULL UNIQUE,
  signingKey TEXT NOT NULL DEFAULT '', lastEventAt TEXT, confirmedAt TEXT, createdAt TEXT NOT NULL,
  UNIQUE (creatorId, provider)
);
-- Which of a creator's tiers a platform's tier (or price) belongs to. Filled automatically by name or price, or by the creator.
CREATE TABLE IF NOT EXISTS tier_refs (
  creatorId TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE, provider TEXT NOT NULL, ref TEXT NOT NULL,
  tierId TEXT NOT NULL REFERENCES tiers(id) ON DELETE CASCADE, PRIMARY KEY (creatorId, provider, ref)
);
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY, postId TEXT, creatorHandle TEXT NOT NULL, reason TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '', reporterEmail TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open', createdAt TEXT NOT NULL
);
`;

const g = globalThis as unknown as { __oo_db?: DatabaseSync };

function open(): DatabaseSync {
  const file = process.env.DB_FILE || path.join(dataDir(), 'app.db');
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const d = new DatabaseSync(file);
  d.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  d.exec(SCHEMA);
  // Upgrade older databases: add columns that were introduced later.
  const cols = d.prepare('PRAGMA table_info(creators)').all() as { name: string }[];
  const addCol = (name: string, def: string) => { if (!cols.some((c) => c.name === name)) d.exec(`ALTER TABLE creators ADD COLUMN ${name} ${def}`); };
  addCol('gankSigningKey', "TEXT NOT NULL DEFAULT ''");
  addCol('reviewNote', "TEXT NOT NULL DEFAULT ''");
  addCol('reviewRequestedAt', 'TEXT');
  addCol('reviewResult', "TEXT NOT NULL DEFAULT ''");
  addCol('discordGuildId', "TEXT NOT NULL DEFAULT ''");
  addCol('discordGuildName', "TEXT NOT NULL DEFAULT ''");
  // Set when the role check finds something the creator must fix (bot kicked, role deleted). Shown in the studio.
  addCol('discordProblem', "TEXT NOT NULL DEFAULT ''");
  const tcols = d.prepare('PRAGMA table_info(tiers)').all() as { name: string }[];
  if (!tcols.some((c) => c.name === 'discordRoleId')) d.exec("ALTER TABLE tiers ADD COLUMN discordRoleId TEXT NOT NULL DEFAULT ''");
  const pcols = d.prepare('PRAGMA table_info(payment_links)').all() as { name: string }[];
  if (!pcols.some((c) => c.name === 'confirmedAt')) d.exec('ALTER TABLE payment_links ADD COLUMN confirmedAt TEXT');
  const wcols = d.prepare('PRAGMA table_info(webhook_events)').all() as { name: string }[];
  if (!wcols.some((c) => c.name === 'refLabel')) d.exec("ALTER TABLE webhook_events ADD COLUMN refLabel TEXT NOT NULL DEFAULT ''");
  // A Discord server can belong to only one creator page.
  d.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_creators_guild ON creators(discordGuildId) WHERE discordGuildId != ''");
  return d;
}

export function getDb(): DatabaseSync {
  if (!g.__oo_db) g.__oo_db = open();
  return g.__oo_db;
}

/** Tests only: throw the database away and start clean. */
export function resetDbForTests(): void {
  if (g.__oo_db) g.__oo_db.close();
  g.__oo_db = undefined;
}

export type Param = SQLInputValue | boolean | undefined;
function clean(params: Param[]): SQLInputValue[] {
  return params.map((p) => (typeof p === 'boolean' ? (p ? 1 : 0) : p === undefined ? null : p));
}

export function all<T>(sql: string, ...params: Param[]): T[] {
  return getDb().prepare(sql).all(...clean(params)) as T[];
}
export function get<T>(sql: string, ...params: Param[]): T | undefined {
  return getDb().prepare(sql).get(...clean(params)) as T | undefined;
}
export function run(sql: string, ...params: Param[]): { changes: number } {
  const r = getDb().prepare(sql).run(...clean(params));
  return { changes: Number(r.changes) };
}
/** Run a block atomically. The block must be synchronous. */
export function tx<T>(fn: () => T): T {
  const d = getDb();
  d.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    d.exec('COMMIT');
    return out;
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
}

export const newId = (): string => randomUUID();
export const nowIso = (): string => new Date().toISOString();

// ---- row types ----
export interface UserRow { id: string; createdAt: string }
export interface CreatorRow {
  id: string; userId: string; handle: string; name: string; bio: string;
  mainColor: string; accentColor: string; bannerFile: string | null; bannerGrad: string;
  avatarFile: string | null; avatarShape: string; dividerKind: string; dividerFile: string | null;
  logoFile: string | null; bannerStatic: string | null; avatarStatic: string | null; logoStatic: string | null;
  mascotOn: number; mascotLines: string; gankUrl: string; gankNick: string; gankVerified: number;
  verifyCode: string; tipUrl: string; hookSecret: string; gankSigningKey: string; reviewNote: string; reviewRequestedAt: string | null; reviewResult: string; discordGuildId: string; discordGuildName: string; discordProblem: string; isExample: number; suspended: number; createdAt: string;
}
export interface TierRow {
  id: string; creatorId: string; position: number; name: string; price: number;
  perks: string; gankUrl: string; gankTierRef: string | null; discordRoleId: string;
}
export interface PostRow {
  id: string; creatorId: string; tierId: string | null; title: string; body: string; nsfw: number;
  imageFile: string | null; imageAlt: string; hidden: number; createdAt: string;
}
export interface EntitlementRow {
  id: string; creatorId: string; email: string; tierId: string; status: string;
  paidThrough: string; sourceEventId: string; createdAt: string; updatedAt: string;
}
export interface WebhookEventRow {
  id: string; provider: string; providerEventId: string; eventName: string; creatorNick: string;
  creatorId: string | null; email: string; priceRef: string | null; billingPeriod: number | null;
  status: string; note: string; raw: string; receivedAt: string; refLabel: string;
}
export interface PaymentLinkRow {
  id: string; creatorId: string; provider: string; pageUrl: string; hookSecret: string;
  signingKey: string; lastEventAt: string | null; confirmedAt: string | null; createdAt: string;
}
