'use server';
import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth';
import { unlinkDiscord } from '@/lib/discord-sync';

/** A fan disconnects their Discord account. Every role we gave them is taken back. */
export async function unlinkDiscordAction(form: FormData) {
  const v = await getViewer();
  const handle = String(form.get('handle') || '').replace(/[^a-z0-9_-]/gi, '');
  if (!v) redirect('/login');
  await unlinkDiscord(v.user.id);
  redirect(`/${handle}/discord?unlinked=1`);
}
