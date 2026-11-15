import { redirect } from 'next/navigation';
import { run, newId, nowIso } from '@/lib/db';
import { clamp } from '@/lib/validate';

async function submit(form: FormData) {
  'use server';
  const reason = clamp(form.get('reason'), 60);
  if (!reason) redirect('/report?error=1');
  run('INSERT INTO reports (id, postId, creatorHandle, reason, details, reporterEmail, createdAt) VALUES (?,?,?,?,?,?,?)',
    newId(), clamp(form.get('postId'), 60) || null, clamp(form.get('creator'), 60), reason, clamp(form.get('details'), 2000), clamp(form.get('email'), 200), nowIso());
  redirect('/report?sent=1');
}

export default async function Report({ searchParams }: { searchParams: Promise<{ creator?: string; sent?: string; error?: string }> }) {
  const q = await searchParams;
  if (q.sent) return <div style={{ maxWidth: 560, margin: '32px auto', padding: '0 16px' }}><h1>Thank you</h1><p>Your report was received.</p></div>;
  return (
    <div style={{ maxWidth: 560, margin: '32px auto', padding: '0 16px', display: 'grid', gap: 12 }}>
      <h1>Report content</h1>
      {q.error && <p role="alert" style={{ color: 'var(--danger)' }}>Please choose a reason.</p>}
      <form action={submit} style={{ display: 'grid', gap: 10 }}>
        <label htmlFor="c">Creator page</label><input id="c" name="creator" defaultValue={q.creator ?? ''} maxLength={60} />
        <label htmlFor="r">Reason</label>
        <select id="r" name="reason" required><option value="">Choose…</option><option>Involves a minor</option><option>Posted without consent</option><option>Copyright</option><option>Harassment</option><option>Other</option></select>
        <label htmlFor="d">Details</label><textarea id="d" name="details" rows={4} maxLength={2000} />
        <label htmlFor="e">Your email (optional)</label><input id="e" name="email" type="email" />
        <div><button className="btn btn-brand">Send report</button></div>
      </form>
    </div>
  );
}
