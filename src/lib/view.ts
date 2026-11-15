import { cookies } from 'next/headers';
import { getViewer } from './auth';
import { postState, tierRanks, viewerRank, type PostState } from './access';
import { postsOf, tiersOf } from './creators';
import type { CreatorRow, PostRow, TierRow } from './db';
import { perksFromJson } from './validate';
import { discordConfigured } from './discord';

export interface PostView {
  id: string; title: string; date: string; nsfw: boolean; tierName: string | null; tierPrice: number | null; tierId: string | null;
  state: PostState;
  // Only filled when state is 'open'. Locked, age-gated and hidden posts never carry their text or image to the browser.
  body?: string; hasImage?: boolean; imageAlt?: string;
}
export interface TierView { id: string; name: string; price: number; perks: string[]; joinUrl: string | null; rank: number }
export interface PageData {
  creator: CreatorRow; tiers: TierView[]; posts: PostView[]; rank: number; isOwner: boolean; signedIn: boolean;
  ageOk: boolean; hideNsfw: boolean; canPay: boolean; tipUrl: string | null; discordJoin: boolean;
}

const safeLink = (u: string): string | null => (/^https:\/\//i.test(u) ? u : null);

export async function loadPage(creator: CreatorRow): Promise<PageData> {
  const viewer = await getViewer();
  const jar = await cookies();
  const ageOk = jar.get('oo_age')?.value === '1';
  const hideNsfw = jar.get('oo_hide')?.value === '1';
  const isOwner = !!viewer && viewer.user.id === creator.userId;
  const tiers: TierRow[] = tiersOf(creator.id);
  const ranks = tierRanks(tiers);
  const rank = viewer ? viewerRank(creator.id, viewer.emails, ranks) : 0;
  // Payment links are only offered once the creator has proven the Gank page is theirs (the example page is a demo).
  const canPay = !!creator.gankUrl && (creator.gankVerified === 1 || creator.isExample === 1);
  const byId = new Map(tiers.map((t) => [t.id, t]));
  const posts = postsOf(creator.id).map((p: PostRow): PostView => {
    const state = postState({ tierId: p.tierId, nsfw: !!p.nsfw, hidden: !!p.hidden }, { ranks, rank, isOwner, ageOk, hideNsfw });
    const t = p.tierId ? byId.get(p.tierId) : undefined;
    const base: PostView = { id: p.id, title: p.title, date: p.createdAt, nsfw: !!p.nsfw, tierName: t?.name ?? null, tierPrice: t?.price ?? null, tierId: p.tierId, state };
    if (state === 'open') { base.body = p.body; base.hasImage = !!p.imageFile; base.imageAlt = p.imageAlt; }
    return base;
  }).filter((p) => p.state !== 'removed');
  return {
    creator, posts, rank, isOwner, signedIn: !!viewer, ageOk, hideNsfw, canPay,
    // Offered only to people who currently have a paid plan with this creator.
    discordJoin: !!creator.discordGuildId && rank > 0 && discordConfigured(),
    tiers: tiers.map((t) => ({ id: t.id, name: t.name, price: t.price, perks: perksFromJson(t.perks), joinUrl: canPay ? safeLink(t.gankUrl) ?? safeLink(creator.gankUrl) : null, rank: ranks.get(t.id) ?? 0 })),
    tipUrl: canPay ? safeLink(creator.tipUrl) ?? safeLink(creator.gankUrl) : null,
  };
}
