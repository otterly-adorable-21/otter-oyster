'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/** A read-only box with a big Copy button, for the webhook link creators paste into a platform. */
export function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2500); }
    catch { /* Older browsers: the text is selected below so the creator can copy it by hand. */ }
  };
  return (
    <div className="copyfield">
      <input readOnly value={value} aria-label={label} onFocus={(e) => e.currentTarget.select()} />
      <button type="button" className="btn btn-brand" onClick={copy}>{copied ? 'Copied ✓' : 'Copy link'}</button>
    </div>
  );
}

/** While a platform is waiting for its first test, quietly re-check every few seconds so the card turns green by itself. */
export function AutoRefresh({ seconds = 5, minutes = 10 }: { seconds?: number; minutes?: number }) {
  const router = useRouter();
  useEffect(() => {
    const stopAt = Date.now() + minutes * 60_000;
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() > stopAt) { clearInterval(id); return; }
      router.refresh();
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds, minutes]);
  return null;
}
