import type { ReactNode } from 'react';
import { LEGAL_UPDATED } from '@/lib/legal';

export function Doc({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ maxWidth: 760, margin: '32px auto', padding: '0 16px 40px', display: 'grid', gap: 14, lineHeight: 1.6 }}>
      <h1>{title}</h1>
      <p className="hint">Last updated {LEGAL_UPDATED}</p>
      {children}
    </div>
  );
}
