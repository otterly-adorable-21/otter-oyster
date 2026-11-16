'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

// One "Support" popup per creator page. Any SupportButton on the page opens it, optionally pointing at a tier
// (for example from a locked post). Native <dialog> gives us Escape to close, focus handling and a backdrop.

const EVENT = 'oo:support';

export interface SupportTier { id: string; name: string; price: number; rank: number; ownUrl: string | null }
export interface SupportSite { id: string; name: string; url: string }

export function SupportButton({ tierId, className = 'btn btn-creator', children }: { tierId?: string; className?: string; children: React.ReactNode }) {
  return (
    <button type="button" className={className} aria-haspopup="dialog"
      onClick={() => window.dispatchEvent(new CustomEvent(EVENT, { detail: { tierId: tierId ?? null } }))}>
      {children}
    </button>
  );
}

export function SupportDialog({ name, handle, tiers, sites, tipUrl, rank }: {
  name: string; handle: string; tiers: SupportTier[]; sites: SupportSite[]; tipUrl: string | null; rank: number;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [focus, setFocus] = useState<string | null>(null);

  useEffect(() => {
    const open = (e: Event) => {
      setFocus((e as CustomEvent<{ tierId: string | null }>).detail?.tierId ?? null);
      if (!ref.current?.open) ref.current?.showModal();
    };
    window.addEventListener(EVENT, open);
    return () => window.removeEventListener(EVENT, open);
  }, []);

  const close = () => ref.current?.close();
  const focused = tiers.find((t) => t.id === focus);

  return (
    <dialog ref={ref} className="support" aria-labelledby="support-h"
      // A click on the dimmed area outside the box closes it.
      onClick={(e) => { if (e.target === ref.current) close(); }}>
      <div className="support-in">
        <div className="support-top">
          <h2 id="support-h">{focused ? `Join ${focused.name}` : `Support ${name}`}</h2>
          <button type="button" className="btn btn-ghost support-x" onClick={close} aria-label="Close">✕</button>
        </div>

        {tiers.length > 0 && (
          <ul className="support-tiers">
            {tiers.map((t) => {
              const state = t.rank === rank ? 'Your plan' : t.rank < rank ? 'Included' : null;
              return (
                <li key={t.id} className={t.id === focus ? 'is-focus' : undefined}>
                  <span><strong>{t.name}</strong> <span className="support-price">${t.price}/mo</span></span>
                  {state ? <span className="badge">{state}</span>
                    : t.ownUrl ? <a className="btn btn-creator chip" href={t.ownUrl} target="_blank" rel="noopener noreferrer">Join</a> : null}
                </li>
              );
            })}
          </ul>
        )}

        <div className="support-sites">
          <h3>Support on</h3>
          {sites.map((s) => (
            <a key={s.id} className={`btn support-site site-${s.id}`} href={s.url} target="_blank" rel="noopener noreferrer">
              {s.name}<span aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span>
            </a>
          ))}
          {tipUrl && <a className="btn btn-ghost support-site" href={tipUrl} target="_blank" rel="noopener noreferrer">Send a one-time tip<span aria-hidden="true">↗</span></a>}
        </div>

        <p className="support-note">
          {focused ? `Pick ${focused.name} (or the same price) on the site you choose. ` : 'Pick the same tier there as here. '}
          Pay with the email you sign in with here, and your posts unlock by themselves.{' '}
          <Link href={`/${handle}/claim`} onClick={close}>Paid with a different email?</Link>
        </p>
      </div>
    </dialog>
  );
}
