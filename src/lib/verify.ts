import dns from 'node:dns/promises';
import net from 'node:net';

// Checks that a creator really controls the Gank page they entered: we fetch the public page and
// look for the one-time code they were asked to put in their bio.
//
// The server fetches a URL a user typed, so this is guarded against server-side request forgery:
// https only, host must be on the allowed list, every address it resolves to must be public, and
// redirects are followed by hand with the same checks. Size and time are capped.

export function allowedHosts(): string[] {
  return (process.env.GANK_ALLOWED_HOSTS || 'ganknow.com').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function hostAllowed(hostname: string, list: string[] = allowedHosts()): boolean {
  const h = hostname.toLowerCase();
  return list.some((a) => h === a || h.endsWith('.' + a));
}

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const x = ip.toLowerCase();
    if (x === '::1' || x === '::') return true;
    if (x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe8') || x.startsWith('fe9') || x.startsWith('fea') || x.startsWith('feb')) return true;
    const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateIp(mapped[1]) : false;
  }
  return true; // not an IP we understand: treat as unsafe
}

export interface FetchDeps {
  lookup?: (host: string) => Promise<string[]>;
  fetchFn?: typeof fetch;
  hosts?: string[];
}

const defaultLookup = async (host: string): Promise<string[]> => (await dns.lookup(host, { all: true })).map((a) => a.address);

export class VerifyError extends Error {}

async function assertSafe(u: URL, deps: FetchDeps): Promise<void> {
  if (u.protocol !== 'https:') throw new VerifyError('The link must start with https://');
  if (!hostAllowed(u.hostname, deps.hosts)) throw new VerifyError('That is not a Gank address we accept.');
  const addrs = await (deps.lookup ?? defaultLookup)(u.hostname);
  if (!addrs.length || addrs.some(isPrivateIp)) throw new VerifyError('That address is not allowed.');
}

export async function fetchPageText(url: string, deps: FetchDeps = {}): Promise<string> {
  const f = deps.fetchFn ?? fetch;
  let current = new URL(url);
  for (let hop = 0; hop < 4; hop++) {
    await assertSafe(current, deps);
    const res = await f(current.toString(), {
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
      headers: { 'user-agent': 'OtterOysterVerifier/1.0', accept: 'text/html,*/*' },
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new VerifyError('The page redirected without a destination.');
      current = new URL(loc, current);
      continue;
    }
    if (!res.ok) throw new VerifyError(`The page answered with status ${res.status}.`);
    const reader = res.body?.getReader();
    if (!reader) return await res.text();
    const dec = new TextDecoder();
    let out = '';
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 1_000_000) { await reader.cancel(); break; }
      out += dec.decode(value, { stream: true });
    }
    return out;
  }
  throw new VerifyError('The page redirected too many times.');
}

export async function verifyCodeOnPage(url: string, code: string, deps: FetchDeps = {}): Promise<{ ok: boolean; reason: string }> {
  try {
    const text = await fetchPageText(url, deps);
    if (text.includes(code)) return { ok: true, reason: '' };
    return {
      ok: false,
      reason: 'We could not find the code on your page. Check that it is saved in your public bio, then try again. Some pages only show their bio after scripts run, which this check cannot see.',
    };
  } catch (e) {
    if (e instanceof VerifyError) return { ok: false, reason: e.message };
    return { ok: false, reason: 'We could not reach your page. Try again in a minute.' };
  }
}
