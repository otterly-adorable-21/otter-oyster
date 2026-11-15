import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { all, get, run, tx, newId, nowIso, type UserRow } from './db';
import { sendMail } from './email';
import { normalizeEmail } from './validate';

// Passwordless sign-in. A one-time link goes to the email; opening it starts a session.
// Only hashes of tokens are stored, so a copy of the database cannot be used to sign in.

export const SESSION_COOKIE = 'oo_session';
const LOGIN_MINUTES = 15;
const SESSION_DAYS = 30;
const MAX_LINKS_PER_HOUR = 5;

export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
const token = (): string => randomBytes(32).toString('base64url');
const appUrl = (): string => (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');

export class RateLimited extends Error {}

/** Creates a one-time token and emails the link. Returns nothing about whether the email already has an account. */
export async function sendLoginLink(emailRaw: string, purpose: 'login' | 'link' = 'login', userId?: string, next?: string): Promise<void> {
  const email = normalizeEmail(emailRaw);
  if (!email) throw new Error('invalid email');
  const since = new Date(Date.now() - 3600_000).toISOString();
  const n = get<{ n: number }>('SELECT COUNT(*) AS n FROM login_tokens WHERE email = ? AND createdAt > ?', email, since)?.n ?? 0;
  if (n >= MAX_LINKS_PER_HOUR) throw new RateLimited();
  const raw = token();
  run(
    'INSERT INTO login_tokens (id, tokenHash, email, purpose, userId, expiresAt, createdAt) VALUES (?,?,?,?,?,?,?)',
    newId(), sha256(raw), email, purpose, userId ?? null,
    new Date(Date.now() + LOGIN_MINUTES * 60_000).toISOString(), nowIso(),
  );
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? `&next=${encodeURIComponent(next)}` : '';
  const link = `${appUrl()}/auth/verify?token=${raw}${safeNext}`;
  const what = purpose === 'link' ? 'Confirm this email address' : 'Sign in';
  await sendMail(
    email,
    `${what} to Otter & Oyster`,
    `${what} by opening this link. It works once and expires in ${LOGIN_MINUTES} minutes.\n\n${link}\n\nIf you did not ask for this, you can ignore this email.`,
  );
}

interface TokenRow { id: string; email: string; purpose: string; userId: string | null; expiresAt: string; usedAt: string | null }

/** Spends a token. Returns its row once, or null if it is unknown, used or expired. */
export function consumeToken(raw: string): TokenRow | null {
  const row = get<TokenRow>('SELECT id, email, purpose, userId, expiresAt, usedAt FROM login_tokens WHERE tokenHash = ?', sha256(raw));
  if (!row || row.usedAt || row.expiresAt < nowIso()) return null;
  const r = run('UPDATE login_tokens SET usedAt = ? WHERE id = ? AND usedAt IS NULL', nowIso(), row.id);
  return r.changes === 1 ? row : null;
}

export function findOrCreateUserByEmail(email: string): string {
  return tx(() => {
    const existing = get<{ userId: string }>('SELECT userId FROM user_emails WHERE email = ?', email);
    if (existing) return existing.userId;
    const userId = newId();
    run('INSERT INTO users (id, createdAt) VALUES (?,?)', userId, nowIso());
    run('INSERT INTO user_emails (id, userId, email, createdAt) VALUES (?,?,?,?)', newId(), userId, email, nowIso());
    return userId;
  });
}

/** Adds an extra verified email to an account. False if another account already owns it. */
export function linkEmail(userId: string, email: string): boolean {
  const owner = get<{ userId: string }>('SELECT userId FROM user_emails WHERE email = ?', email);
  if (owner) return owner.userId === userId;
  run('INSERT INTO user_emails (id, userId, email, createdAt) VALUES (?,?,?,?)', newId(), userId, email, nowIso());
  return true;
}

export async function startSession(userId: string): Promise<void> {
  const raw = token();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  run('INSERT INTO sessions (id, tokenHash, userId, expiresAt, createdAt) VALUES (?,?,?,?,?)', newId(), sha256(raw), userId, expires.toISOString(), nowIso());
  (await cookies()).set(SESSION_COOKIE, raw, {
    httpOnly: true, sameSite: 'lax', secure: appUrl().startsWith('https://'), path: '/', expires,
  });
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  if (raw) run('DELETE FROM sessions WHERE tokenHash = ?', sha256(raw));
  jar.delete(SESSION_COOKIE);
}

export interface Viewer { user: UserRow; emails: string[] }

export async function getViewer(): Promise<Viewer | null> {
  const raw = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const user = get<UserRow>(
    'SELECT u.id, u.createdAt FROM sessions s JOIN users u ON u.id = s.userId WHERE s.tokenHash = ? AND s.expiresAt > ?',
    sha256(raw), nowIso(),
  );
  if (!user) return null;
  const emails = all<{ email: string }>('SELECT email FROM user_emails WHERE userId = ? ORDER BY createdAt', user.id).map((e) => e.email);
  return { user, emails };
}

export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}
export function isAdminEmail(emails: string[]): boolean {
  const list = adminEmails();
  return emails.some((e) => list.includes(e));
}
