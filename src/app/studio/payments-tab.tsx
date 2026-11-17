import { ActionForm } from '@/components/ActionForm';
import { unmatchedPrices } from '@/lib/creators';
import { get, type CreatorRow, type PaymentLinkRow, type TierRow } from '@/lib/db';
import { linkReady, linksOf } from '@/lib/payments/process';
import { PROVIDERS, PROVIDER_ORDER, isProvider, type ProviderInfo } from '@/lib/payments/providers';
import {
  assignTierAction, confirmPayLinkAction, removePayLinkAction, rotatePayLinkAction,
  savePayPageAction, savePaySecretAction, saveTipAction, startPayAction,
} from './actions';
import { AutoRefresh, CopyField } from './copy-field';

const appUrl = () => (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const field = { display: 'grid', gap: 4 } as const;
const ago = (iso: string): string => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)} minutes ago`;
  if (s < 129600) return `${Math.round(s / 3600)} hours ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

export function PaymentsTab({ c, tiers }: { c: CreatorRow; tiers: TierRow[] }) {
  const links = linksOf(c.id);
  // Only platforms that still exist here (older databases may hold payments from removed ones).
  const waiting = unmatchedPrices(c.id).filter((w) => isProvider(w.provider));
  const anyWaiting = links.some((l) => !linkReady(l));
  const nameOf = (p: string) => (isProvider(p) ? PROVIDERS[p].name : p);

  return (<>
    {anyWaiting && <AutoRefresh />}
    <p className="note">Fans pay you on a site you already use. Then they sign in here with the same email, and your posts unlock by themselves. Connect one or more below. Each takes about two minutes and you do not need to know any code.</p>
    {tiers.length === 0 && <p className="hint">Tip: add your tiers on the Page tab first. Give them the same names (or prices) as on your other site so payments match by themselves.</p>}

    {waiting.length > 0 && (<>
      <h2>Payments waiting for you</h2>
      {waiting.map((w) => (
        <form key={w.provider + w.priceRef} action={assignTierAction} className="tier-ed" style={{ display: 'grid', gap: 8 }}>
          <p><strong>{w.n} payment{w.n === 1 ? '' : 's'}</strong> came in for {w.label || `a ${nameOf(w.provider)} tier`}, and we could not tell which of your tiers it is. Pick it once and we will remember.</p>
          <input type="hidden" name="priceRef" value={w.priceRef} />
          <input type="hidden" name="provider" value={w.provider} />
          {tiers.length === 0 ? <p className="hint">Add a tier on the Page tab first.</p> : (<>
            <select name="tierId" aria-label="Your tier">{tiers.map((t) => <option key={t.id} value={t.id}>{t.name} (${t.price}/mo)</option>)}</select>
            <div><button className="btn btn-brand">This is the one</button></div>
          </>)}
        </form>
      ))}
    </>)}

    <div className="pcards">
      {PROVIDER_ORDER.map((id) => <PayCard key={id} c={c} p={PROVIDERS[id]} link={links.find((l) => l.provider === id)} />)}
    </div>

    <h2>Tip link (optional)</h2>
    <ActionForm action={saveTipAction} submit="Save tip link">
      <div style={field}>
        <label htmlFor="tip">A separate link for one-time tips</label>
        <input id="tip" name="tipUrl" defaultValue={c.tipUrl} placeholder="https://" inputMode="url" autoCapitalize="off" />
        <span className="hint">Shown as “Send a one-time tip” in your Support popup. Most people can leave this empty, because fans can already tip on the sites above.</span>
      </div>
    </ActionForm>
  </>);
}

function PayCard({ c, p, link }: { c: CreatorRow; p: ProviderInfo; link?: PaymentLinkRow }) {
  const hidden = <input type="hidden" name="provider" value={p.id} />;
  if (!link) {
    return (
      <section className="pcard">
        <div className="pcard-h"><h3>{p.name}</h3><span className="pill">Not connected</span></div>
        <form action={startPayAction}>{hidden}<button className="btn btn-brand">Connect {p.name}</button></form>
      </section>
    );
  }
  const ready = linkReady(link);
  const hookUrl = `${appUrl()}/api/webhooks/${p.id}/${link.hookSecret}`;
  const last = get<{ note: string; receivedAt: string; status: string }>(
    'SELECT note, receivedAt, status FROM webhook_events WHERE creatorId = ? AND provider = ? ORDER BY receivedAt DESC LIMIT 1', c.id, p.id);

  const steps = (
    <ol className="steps">
      <li>
        <strong>Paste your {p.name} page link</strong> (the one fans visit).
        <ActionForm action={savePayPageAction} submit="Save" className="inline-form">
          {hidden}
          <input name="pageUrl" defaultValue={link.pageUrl} placeholder={p.pageExample} inputMode="url" autoCapitalize="off" aria-label={`${p.name} page link`} />
        </ActionForm>
      </li>
      <li>
        <strong>Copy your private link</strong> and paste it into {p.name}.
        <CopyField value={hookUrl} label={`Your private ${p.name} link`} />
        <span className="hint" style={{ display: 'block' }}>On {p.name}, go to {p.settingsPath}. {p.pasteHint}{p.settingsUrl && <> <a href={p.settingsUrl} target="_blank" rel="noopener noreferrer">Open {p.name} ↗</a></>}</span>
        {p.extraNote && <p className="note" style={{ marginTop: 6 }}>{p.extraNote}</p>}
      </li>
      <li>
        {p.testHint ? (<>
          <strong>Send a test from {p.name}.</strong> {p.testHint}
          <span className="hint"> This card turns green by itself a few seconds later. You do not need to copy anything back.</span>
        </>) : (<>
          <strong>Press the button once it is saved on {p.name}.</strong> {p.name} has no test button, so your first real payment is the final check. Pressing it adds a {p.name} button to your page.
          <form action={confirmPayLinkAction} style={{ marginTop: 6 }}>{hidden}<button className="btn btn-brand">I added it on {p.name}</button></form>
        </>)}
      </li>
    </ol>
  );

  return (
    <section className={`pcard${ready ? ' is-on' : ''}`}>
      <div className="pcard-h">
        <h3>{p.name}</h3>
        <span className={`pill${ready ? ' on' : ' wait'}`}>{ready ? 'Connected ✓' : 'Waiting for step 3'}</span>
      </div>
      {ready ? (<>
        <p>{link.lastEventAt ? `${p.name} last reached us ${ago(link.lastEventAt)}.` : `Set up. We have not heard from ${p.name} yet; the first payment will confirm it works. If a supporter pays and nothing unlocks, check step 2 again.`}{last ? ` Last message: ${last.note}.` : ''}</p>
        {!link.pageUrl && <p role="status" style={{ color: 'var(--danger)', fontWeight: 700 }}>Add your {p.name} page link (step 1) so fans see a button for it on your page.</p>}
        <details className="adv"><summary className="btn">Show the setup steps again</summary><div className="advin">{steps}</div></details>
      </>) : steps}

      <details className="adv"><summary className="btn">More options</summary>
        <div className="advin">
          {p.secretName && (
            <ActionForm action={savePaySecretAction} submit="Save">
              {hidden}
              <div style={field}>
                <label htmlFor={`sk-${p.id}`}>{p.name} {p.secretName.toLowerCase()} {link.signingKey ? '(saved)' : '(optional)'}</label>
                <input id={`sk-${p.id}`} name="key" autoComplete="off" placeholder={link.signingKey ? 'Paste a new one to replace it, or leave empty to remove' : 'Paste it here'} />
                <span className="hint">{p.secretLearned
                  ? `We pick this up by ourselves from ${p.name}'s first message. Only paste it if ${p.name} gave you a new one.`
                  : `Extra safety: when saved, any message without ${p.name}'s matching signature is refused.`}</span>
              </div>
            </ActionForm>
          )}
          <p className="hint">Make a new private link only if yours leaked. You will need to paste the new one into {p.name} again.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <form action={rotatePayLinkAction}>{hidden}<button className="btn">Make a new private link</button></form>
            <form action={removePayLinkAction}>{hidden}<button className="btn">Disconnect {p.name}</button></form>
          </div>
        </div>
      </details>
    </section>
  );
}
