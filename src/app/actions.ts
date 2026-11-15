'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { endSession, RateLimited, sendLoginLink } from '@/lib/auth';
import { normalizeEmail } from '@/lib/validate';

const YEAR = 60 * 60 * 24 * 365;
const opts = { path: '/', maxAge: YEAR, sameSite: 'lax' as const, httpOnly: true, secure: process.env.NODE_ENV === 'production' };

function back(form: FormData): string {
  const p = String(form.get('path') || '/');
  return p.startsWith('/') && !p.startsWith('//') ? p : '/';
}

export async function confirmAge(form: FormData) {
  (await cookies()).set('oo_age', '1', opts);
  revalidatePath(back(form));
}
export async function toggleHide(form: FormData) {
  const jar = await cookies();
  if (jar.get('oo_hide')?.value === '1') jar.delete('oo_hide'); else jar.set('oo_hide', '1', opts);
  revalidatePath(back(form));
}
export async function logout() {
  await endSession();
  redirect('/');
}
export async function requestLogin(_prev: { msg: string; ok: boolean } | null, form: FormData) {
  const email = normalizeEmail(form.get('email'));
  if (!email) return { ok: false, msg: 'Enter a valid email address.' };
  try {
    await sendLoginLink(email, 'login', undefined, String(form.get('next') || '/'));
  } catch (e) {
    if (e instanceof RateLimited) return { ok: false, msg: 'Too many requests. Try again in a little while.' };
    console.error('login link failed', e);
  }
  // Same answer whether or not the address is known.
  return { ok: true, msg: 'If that address can receive mail, a sign-in link is on its way. It works for 15 minutes.' };
}
