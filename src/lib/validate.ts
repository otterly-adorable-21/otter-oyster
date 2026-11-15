// Small, dependency-free input checks. Everything that reaches the database goes through one of these.

const RESERVED = new Set([
  'studio', 'login', 'logout', 'admin', 'api', 'media', 'auth', 'report', 'rules', 'terms', 'privacy',
  'claim', 'about', 'help', 'support', 'static', 'public', '_next', 'favicon', 'robots', 'sitemap',
  'otter', 'oyster', 'otterandoyster', 'settings', 'account', 'signup', 'signin', 'explore', 'search', 'discord',
]);

export function normalizeEmail(raw: unknown): string | null {
  const e = String(raw ?? '').trim().toLowerCase();
  if (e.length > 254 || e.length < 5) return null;
  return /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]{2,}$/.test(e) ? e : null;
}

export function validHandle(raw: unknown): string | null {
  const h = String(raw ?? '').trim().replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$/.test(h)) return null;
  if (RESERVED.has(h)) return null;
  return h;
}

export function validHex(raw: unknown): string | null {
  const h = String(raw ?? '').trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(h) ? h : null;
}

export function clamp(raw: unknown, max: number): string {
  return String(raw ?? '').replace(/\u0000/g, '').trim().slice(0, max);
}

/** Returns the cleaned https URL, or null if it is not a plain https link. */
export function httpsUrl(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s || s.length > 500) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' || !u.hostname || u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** The Gank name is the last part of the page link path (VERIFY against Gank's real link format). */
export function nickFromUrl(url: string): string {
  try {
    const seg = new URL(url).pathname.split('/').filter(Boolean);
    return (seg[seg.length - 1] || '').replace(/^@/, '').toLowerCase().slice(0, 60);
  } catch {
    return '';
  }
}

export function parsePerks(raw: unknown): string[] {
  return String(raw ?? '')
    .split('\n')
    .map((s) => s.replace(/\u0000/g, '').trim().slice(0, 120))
    .filter(Boolean)
    .slice(0, 6);
}

export function perksFromJson(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map((x) => String(x)).slice(0, 6) : [];
  } catch {
    return [];
  }
}

export function intInRange(raw: unknown, min: number, max: number): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

export const MAX_TIERS = 3;
