import { redirect } from 'next/navigation';
import { consumeToken, findOrCreateUserByEmail, linkEmail, startSession } from '@/lib/auth';

// The link opens a confirm page and only a button press (POST) spends the token, so mail scanners that
// pre-open links cannot use it up.
async function confirm(form: FormData) {
  'use server';
  const row = consumeToken(String(form.get('token') || ''));
  const next = String(form.get('next') || '/');
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  if (!row) redirect('/auth/verify?expired=1');
  if (row.purpose === 'link' && row.userId) {
    if (!linkEmail(row.userId, row.email)) redirect('/auth/verify?taken=1');
    await startSession(row.userId);
  } else {
    await startSession(findOrCreateUserByEmail(row.email));
  }
  redirect(safeNext);
}

export default async function Verify({ searchParams }: { searchParams: Promise<{ token?: string; next?: string; expired?: string; taken?: string }> }) {
  const q = await searchParams;
  return (
    <div style={{ maxWidth: 480, margin: '40px auto', padding: '0 16px', display: 'grid', gap: 14 }}>
      {q.expired ? <><h1>Link expired</h1><p>That link was already used or has expired. <a href="/login">Request a new one.</a></p></>
        : q.taken ? <><h1>Email already in use</h1><p>That email belongs to a different account.</p></>
        : q.token ? <><h1>Finish signing in</h1>
            <form action={confirm}><input type="hidden" name="token" value={q.token} /><input type="hidden" name="next" value={q.next || '/'} />
              <button className="btn btn-brand">Continue</button></form></>
        : <p>Missing link. <a href="/login">Sign in</a></p>}
    </div>
  );
}
