'use client';
import { useActionState } from 'react';
import type { Msg } from '@/app/studio/actions';

/** A form that runs a server action and shows its result message underneath. */
export function ActionForm({ action, children, submit, className }: {
  action: (p: Msg | null, f: FormData) => Promise<Msg>; children: React.ReactNode; submit: string; className?: string;
}) {
  const [state, act, pending] = useActionState(action, null);
  return (
    <form action={act} className={className} style={{ display: 'grid', gap: 10 }}>
      {children}
      <div><button className="btn btn-brand" disabled={pending}>{pending ? 'Working…' : submit}</button></div>
      {state && <p role="status" style={{ color: state.ok ? 'inherit' : 'var(--danger)', fontWeight: 700 }}>{state.msg}</p>}
    </form>
  );
}
