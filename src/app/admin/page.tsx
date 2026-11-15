import { notFound } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getViewer, isAdminEmail } from '@/lib/auth';
import { all, run } from '@/lib/db';
import { creatorEmails, markVerified, pendingReviews, rejectReview } from '@/lib/creators';
import { sendMail } from '@/lib/email';
import { get } from '@/lib/db';
import type { CreatorRow } from '@/lib/db';

export const dynamic = 'force-dynamic';

async function guard() {
  const v = await getViewer();
  if (!v || !isAdminEmail(v.emails)) notFound();
}
async function takedown(form: FormData) {
  'use server';
  await guard();
  run('UPDATE posts SET hidden = 1 WHERE id = ?', String(form.get('postId') || ''));
  run("UPDATE reports SET status = 'actioned' WHERE id = ?", String(form.get('id') || ''));
  revalidatePath('/admin');
}
async function dismiss(form: FormData) {
  'use server';
  await guard();
  run("UPDATE reports SET status = 'dismissed' WHERE id = ?", String(form.get('id') || ''));
  revalidatePath('/admin');
}
async function suspend(form: FormData) {
  'use server';
  await guard();
  run('UPDATE creators SET suspended = 1 WHERE handle = ? AND isExample = 0', String(form.get('handle') || ''));
  run("UPDATE reports SET status = 'actioned' WHERE id = ?", String(form.get('id') || ''));
  revalidatePath('/admin');
}

async function tell(userId: string, subject: string, text: string) {
  for (const to of creatorEmails(userId).slice(0, 1)) await sendMail(to, subject, text).catch((e) => console.error('creator notice failed', e));
}
async function approve(form: FormData) {
  'use server';
  await guard();
  const c = get<CreatorRow>('SELECT * FROM creators WHERE id = ? AND gankVerified = 2', String(form.get('id') || ''));
  if (c && markVerified(c).ok) await tell(c.userId, 'Your Gank page is verified', 'Your Gank page is approved. Fans can now pay from your page.');
  revalidatePath('/admin');
}
async function reject(form: FormData) {
  'use server';
  await guard();
  const id = String(form.get('id') || ''), reason = String(form.get('reason') || '');
  const c = get<CreatorRow>('SELECT * FROM creators WHERE id = ? AND gankVerified = 2', id);
  rejectReview(id, reason);
  if (c) await tell(c.userId, 'Your Gank page was not approved', `We could not approve your Gank page yet.\n\n${reason.trim() || 'We could not see your code on that Gank page.'}\n\nFix it in your studio, then send a new review request.`);
  revalidatePath('/admin');
}

export default async function Admin() {
  await guard();
  const rows = all<{ id: string; postId: string | null; creatorHandle: string; reason: string; details: string; createdAt: string }>(
    "SELECT * FROM reports WHERE status = 'open' ORDER BY createdAt");
  return (
    <div style={{ maxWidth: 860, margin: '24px auto', padding: '0 16px', display: 'grid', gap: 12 }}>
      <h1>Gank page reviews</h1>
      <p className="hint">Open each Gank link in your browser. Approve only if the creator&apos;s code appears in the bio on that page. If you reject, write what to fix; the creator is emailed your reason.</p>
      {pendingReviews().length === 0 && <p>No pages waiting.</p>}
      {pendingReviews().map((c) => (
        <div key={c.id} className="tier-ed">
          <p><strong>{c.name}</strong> (@{c.handle})</p>
          <p>Gank page: <a href={c.gankUrl} target="_blank" rel="noopener noreferrer">{c.gankUrl}</a></p>
          <p>Code to find in their bio: <code style={{ fontSize: '1.25rem', fontWeight: 800 }}>{c.verifyCode}</code></p>
          <p className="hint">Sent {c.reviewRequestedAt ? new Date(c.reviewRequestedAt).toLocaleString() : 'earlier'}{c.reviewNote ? ` · Note: ${c.reviewNote}` : ''}</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <form action={approve}><input type="hidden" name="id" value={c.id} /><button className="btn btn-brand">Approve</button></form>
            <form action={reject} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><input type="hidden" name="id" value={c.id} />
              <input name="reason" aria-label="Reason for rejecting" placeholder="Reason (the creator sees this)" maxLength={500} style={{ minWidth: 260 }} />
              <button className="btn">Reject</button></form>
          </div>
        </div>
      ))}
      <h1>Reports</h1>
      {rows.length === 0 && <p>No open reports.</p>}
      {rows.map((r) => (
        <div key={r.id} className="tier-ed">
          <p><strong>{r.reason}</strong> · {r.creatorHandle} · {new Date(r.createdAt).toLocaleString()}</p>
          <p>{r.details}</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {r.postId && <form action={takedown}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="postId" value={r.postId} /><button className="btn">Remove post</button></form>}
            <form action={suspend}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="handle" value={r.creatorHandle} /><button className="btn">Suspend page</button></form>
            <form action={dismiss}><input type="hidden" name="id" value={r.id} /><button className="btn btn-ghost">Dismiss</button></form>
          </div>
        </div>
      ))}
    </div>
  );
}
