'use client';
import { useActionState } from 'react';
import { claimEmail } from './actions';

export function ClaimForm({ handle }: { handle: string }) {
  const [state, act, pending] = useActionState(claimEmail, null);
  return (
    <form action={act} style={{ display: 'grid', gap: 10 }}>
      <input type="hidden" name="handle" value={handle} />
      <label htmlFor="e">Email you paid with</label>
      <input id="e" name="email" type="email" required autoComplete="email" />
      <button className="btn btn-brand" disabled={pending}>Send confirmation link</button>
      {state && <p role="status">{state.msg}</p>}
    </form>
  );
}
