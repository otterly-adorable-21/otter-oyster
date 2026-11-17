import { createHmac, timingSafeEqual } from 'node:crypto';
import { get, run, newId, nowIso } from '../db';

// Shared by every payment platform: constant-time compares, signature checks, and turning a payment into access.

// ---------- authenticity ----------

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** HMAC-SHA256 of the raw body. Accepts hex or base64, with or without a "sha256=" prefix. */
export function signatureValid(rawBody: string, header: string | null, secret: string): boolean {
  if (!header || !secret) return false;
  const given = header.trim().replace(/^sha256=/i, '');
  const mac = createHmac('sha256', secret).update(rawBody).digest();
  return safeEqual(given.toLowerCase(), mac.toString('hex')) || safeEqual(given, mac.toString('base64'));
}

// ---------- processing ----------

export type Outcome = 'processed' | 'unmatched' | 'ignored' | 'rejected' | 'duplicate';
export interface ProcessResult { outcome: Outcome; note: string; creatorId?: string }

const GRACE_DAYS = 3;

export function addMonths(d: Date, months: number): Date {
  const out = new Date(d.getTime());
  const day = out.getUTCDate();
  out.setUTCDate(1);
  out.setUTCMonth(out.getUTCMonth() + months);
  const last = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(day, last));
  return out;
}

export const paidThroughFor = (at: Date, months: number | null): Date =>
  new Date(addMonths(at, months ?? 1).getTime() + GRACE_DAYS * 86400_000);

export function grant(creatorId: string, email: string, tierId: string, at: Date, months: number | null, sourceEventId: string, until?: Date): void {
  // A platform that tells us the paid-up date exactly (plus grace) beats our own month count.
  const through = (until ? new Date(until.getTime() + GRACE_DAYS * 86400_000) : paidThroughFor(at, months)).toISOString();
  const now = nowIso();
  const existing = get<{ id: string; paidThrough: string }>('SELECT id, paidThrough FROM entitlements WHERE creatorId = ? AND email = ?', creatorId, email);
  if (!existing) {
    run('INSERT INTO entitlements (id, creatorId, email, tierId, status, paidThrough, sourceEventId, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?)',
      newId(), creatorId, email, tierId, 'active', through, sourceEventId, now, now);
  } else {
    // A renewal only ever pushes the date forward; a late-arriving older event cannot shorten access.
    const best = existing.paidThrough > through ? existing.paidThrough : through;
    run("UPDATE entitlements SET tierId = ?, status = 'active', paidThrough = ?, sourceEventId = ?, updatedAt = ? WHERE id = ?",
      tierId, best, sourceEventId, now, existing.id);
  }
}
