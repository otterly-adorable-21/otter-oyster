import { cookies } from 'next/headers';
import { getViewer } from './auth';
import { postState, tierRanks, viewerRank, type PostState } from './access';
import { postsOf, tiersOf } from './creators';
import type { CreatorRow, PostRow, TierRow } from './db';
import { perksFromJson } from './validate';
import { discordConfigured } from './discord';
import { linksOf, linkReady } from './payments/process';
import { PROVIDERS, PROVIDER_ORDER, isProvider } from './payments/providers';

export interface PostView {
  id: string; title: string; date: string; nsfw: boolean; tierName: string | null; tierPrice: number | null; tierId: string | null;
  state: PostState;
  // Only filled when state is 'open'. Locked, age-gated and hidden posts never carry their text or image to the browser.
  body?: string; hasImage?: boolean; imageAlt?: string;
}
/** ownUrl: the creator's own payment link for just this tier, if they set one. */
export interface TierView { id: string; name: string; price: number; perks: string[]; ownUrl: string | null; rank: number }
export interface PageData {
  creator: CreatorRow; tiers: TierView[]; posts: PostView[]; rank: number; isOwner: boolean; signedIn: boolean;
  ageOk: boolean; hideNsfw: boolean; canPay: boolean; discordJoin: boolean;
  /** A separate tip link, only when the creator set one. Otherwise tips happen on the payment sites. */
  tipUrl: string | null;
  /** Every place a fan can pay this creator, in a fixed order. */
  payPages: { id: string; name: string; url: string }[];
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
  // A payment site is only offered once its webhook link works, so a fan's payment really unlocks something.
  // The example page is a demo: it shows every site, and the buttons go nowhere real.
  const links = linksOf(creator.id);
  const payPages = creator.isExample
    ? PROVIDER_ORDER.map((p) => ({ id: p, name: PROVIDERS[p].name, url: 'https://example.com/' }))
    : PROVIDER_ORDER.flatMap((p) => {
      const l = links.find((x) => x.provider === p);
      return l && isProvider(l.provider) && linkReady(l) && safeLink(l.pageUrl) ? [{ id: p, name: PROVIDERS[p].name, url: l.pageUrl }] : [];
    });
  const canPay = payPages.length > 0;
  const byId = new Map(tiers.map((t) => [t.id, t]));
  const posts = postsOf(creator.id).map((p: PostRow): PostView => {
    const state = postState({ tierId: p.tierId, nsfw: !!p.nsfw, hidden: !!p.hidden }, { ranks, rank, isOwner, ageOk, hideNsfw });
    const t = p.tierId ? byId.get(p.tierId) : undefined;
    const base: PostView = { id: p.id, title: p.title, date: p.createdAt, nsfw: !!p.nsfw, tierName: t?.name ?? null, tierPrice: t?.price ?? null, tierId: p.tierId, state };
    if (state === 'open') { base.body = p.body; base.hasImage = !!p.imageFile; base.imageAlt = p.imageAlt; }
    return base;
  }).filter((p) => p.state !== 'removed');
  return {
    creator, posts, rank, isOwner, signedIn: !!viewer, ageOk, hideNsfw, canPay, payPages,
    // Offered only to people who currently have a paid plan with this creator.
    discordJoin: !!creator.discordGuildId && rank > 0 && discordConfigured(),
    tiers: tiers.map((t) => ({ id: t.id, name: t.name, price: t.price, perks: perksFromJson(t.perks), ownUrl: canPay ? safeLink(t.payUrl) : null, rank: ranks.get(t.id) ?? 0 })),
    tipUrl: canPay ? safeLink(creator.tipUrl) : null,
  };
}
