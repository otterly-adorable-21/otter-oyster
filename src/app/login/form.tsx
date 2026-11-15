'use client';
import { useActionState } from 'react';
import { requestLogin } from '../actions';

export function LoginForm({ next }: { next: string }) {
  const [state, act, pending] = useActionState(requestLogin, null);
  return (
    <form action={act} style={{ display: 'grid', gap: 10 }}>
      <input type="hidden" name="next" value={next} />
      <label htmlFor="email">Email</label>
      <input id="email" name="email" type="email" required autoComplete="email" />
      <button className="btn btn-brand" disabled={pending}>Email me a sign-in link</button>
      {state && <p role="status">{state.msg}</p>}
    </form>
  );
}
