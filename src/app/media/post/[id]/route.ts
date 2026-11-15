import { cookies } from 'next/headers';
import { getViewer } from '@/lib/auth';
import { postState, tierRanks, viewerRank } from '@/lib/access';
import { get, type PostRow } from '@/lib/db';
import { tiersOf } from '@/lib/creators';
import { readImage } from '@/lib/images';

export const dynamic = 'force-dynamic';
const NF = () => new Response('Not found', { status: 404 });

// Same rule function as the page. A locked or age-gated post's image is never sent.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const p = get<PostRow>('SELECT * FROM posts WHERE id = ?', id);
  if (!p || !p.imageFile) return NF();
  const owner = get<{ userId: string; suspended: number }>('SELECT userId, suspended FROM creators WHERE id = ?', p.creatorId);
  if (!owner || owner.suspended) return NF();
  const viewer = await getViewer();
  const jar = await cookies();
  const isOwner = !!viewer && viewer.user.id === owner.userId;
  const ranks = tierRanks(tiersOf(p.creatorId));
  const rank = viewer ? viewerRank(p.creatorId, viewer.emails, ranks) : 0;
  const state = postState({ tierId: p.tierId, nsfw: !!p.nsfw, hidden: !!p.hidden }, {
    ranks, rank, isOwner, ageOk: jar.get('oo_age')?.value === '1', hideNsfw: jar.get('oo_hide')?.value === '1',
  });
  if (state !== 'open') return NF();
  const buf = await readImage(p.imageFile);
  if (!buf) return NF();
  return new Response(new Uint8Array(buf), { headers: { 'content-type': 'image/webp', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
}
