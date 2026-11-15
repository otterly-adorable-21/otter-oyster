import { isPrivateName, isSafeName, readImage } from '@/lib/images';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  // Post images ("p-") are never served here; they go through the access-checked route.
  if (!isSafeName(name) || isPrivateName(name)) return new Response('Not found', { status: 404 });
  const buf = await readImage(name);
  if (!buf) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(buf), { headers: { 'content-type': 'image/webp', 'cache-control': 'public, max-age=3600', 'x-content-type-options': 'nosniff' } });
}
