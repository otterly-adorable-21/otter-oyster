import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { CreatorPage } from '@/components/CreatorPage';
import { getCreatorByHandle } from '@/lib/creators';
import { loadPage } from '@/lib/view';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }): Promise<Metadata> {
  const c = getCreatorByHandle((await params).handle);
  if (!c || c.suspended) return {};
  // Never put post content in the preview: only the creator's own name and bio.
  return { title: `${c.name} | Otter & Oyster`, description: c.bio.slice(0, 150) };
}

export default async function Page({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const c = getCreatorByHandle(handle);
  if (!c || c.suspended) notFound();
  const d = await loadPage(c);
  return <CreatorPage d={d} path={`/${c.handle}`} />;
}
