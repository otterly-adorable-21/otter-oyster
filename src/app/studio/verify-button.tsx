'use client';
import { useState, useTransition } from 'react';
import type { Msg } from './actions';

export function VerifyButton({ action, disabled }: { action: () => Promise<Msg>; disabled: boolean }) {
  const [m, setM] = useState<Msg | null>(null);
  const [pending, start] = useTransition();
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div><button className="btn btn-brand" disabled={disabled || pending} onClick={() => start(async () => setM(await action()))}>{pending ? 'Checking…' : 'Check my Gank page'}</button></div>
      {m && <p role="status" style={{ color: m.ok ? 'inherit' : 'var(--danger)', fontWeight: 700 }}>{m.msg}</p>}
    </div>
  );
}
