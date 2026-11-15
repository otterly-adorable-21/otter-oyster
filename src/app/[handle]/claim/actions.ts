'use server';
import { getViewer, RateLimited, sendLoginLink } from '@/lib/auth';
import { normalizeEmail } from '@/lib/validate';

export async function claimEmail(_p: { msg: string } | null, form: FormData) {
  const v = await getViewer();
  if (!v) return { msg: 'Please sign in first.' };
  const email = normalizeEmail(form.get('email'));
  if (!email) return { msg: 'Enter a valid email address.' };
  const handle = String(form.get('handle') || '').replace(/[^a-z0-9-]/gi, '');
  try {
    await sendLoginLink(email, 'link', v.user.id, `/${handle}`);
  } catch (e) {
    if (e instanceof RateLimited) return { msg: 'Too many requests. Try again later.' };
    console.error(e);
  }
  return { msg: 'If that address can receive mail, a confirmation link is on its way.' };
}
