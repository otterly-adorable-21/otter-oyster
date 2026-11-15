import { all, type EntitlementRow, type TierRow } from './db';

// Who can see what. The rules live here, in plain functions, so they can be tested without a browser.

export type PostState = 'open' | 'locked' | 'age' | 'hidden' | 'removed';

/** Tiers in order, cheapest first. Rank 0 means public; rank N means the Nth tier and anything above it. */
export function tierRanks(tiers: TierRow[]): Map<string, number> {
  const sorted = [...tiers].sort((a, b) => a.position - b.position);
  return new Map(sorted.map((t, i) => [t.id, i + 1]));
}

/** Highest paid tier rank across the viewer's emails. Canceled plans keep access until paidThrough; revoked plans do not. */
export function viewerRank(creatorId: string, emails: string[], ranks: Map<string, number>, now: Date = new Date()): number {
  if (!emails.length) return 0;
  const marks = emails.map(() => '?').join(',');
  const rows = all<EntitlementRow>(
    `SELECT * FROM entitlements WHERE creatorId = ? AND email IN (${marks}) AND status IN ('active','canceled') AND paidThrough > ?`,
    creatorId, ...emails, now.toISOString(),
  );
  return rows.reduce((best, r) => Math.max(best, ranks.get(r.tierId) ?? 0), 0);
}

export interface PostFacts { tierId: string | null; nsfw: boolean; hidden: boolean }

/**
 * Order matters and matches the prototype: removed by an admin, hidden by the fan's own setting,
 * 18+ gate, tier lock, then open. The page and the media route both call this, so an image can
 * never be fetched when the post around it is locked.
 */
export function postState(p: PostFacts, o: { ranks: Map<string, number>; rank: number; isOwner: boolean; ageOk: boolean; hideNsfw: boolean }): PostState {
  if (p.hidden && !o.isOwner) return 'removed';
  if (o.isOwner) return 'open';
  if (p.nsfw && o.hideNsfw) return 'hidden';
  if (p.nsfw && !o.ageOk) return 'age';
  const need = p.tierId ? (o.ranks.get(p.tierId) ?? Number.MAX_SAFE_INTEGER) : 0;
  return o.rank >= need ? 'open' : 'locked';
}
