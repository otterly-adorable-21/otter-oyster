import { ActionForm } from '@/components/ActionForm';
import { unmatchedPrices } from '@/lib/creators';
import { get, type CreatorRow, type PaymentLinkRow, type TierRow } from '@/lib/db';
import { linkReady, linksOf } from '@/lib/payments/process';
import { PROVIDERS, PROVIDER_ORDER, type ProviderInfo } from '@/lib/payments/providers';
import {
  assignTierAction, removePayLinkAction, requestReviewAction, rotateHookAction, rotatePayLinkAction, saveGankAction,
  savePayPageAction, savePaySecretAction, saveSigningKeyAction, startPayAction,
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
  const waiting = unmatchedPrices(c.id);
  const anyWaiting = links.some((l) => !linkReady(l));
  const nameOf = (p: string) => (p === 'gank' ? 'Gank' : PROVIDERS[p as keyof typeof PROVIDERS]?.name ?? p);

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

    <details className="adv"><summary className="btn">Gank{c.gankVerified === 1 ? ' (connected)' : ''}</summary>
      <div className="advin"><GankSection c={c} /></div>
    </details>
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
        <span className="hint" style={{ display: 'block' }}>On {p.name}: {p.settingsPath}. Paste it into the webhook (URL) box and save. <a href={p.settingsUrl} target="_blank" rel="noopener noreferrer">Open {p.name} ↗</a></span>
        {p.extraNote && <p className="note" style={{ marginTop: 6 }}>{p.extraNote}</p>}
      </li>
      <li>
        {p.testHint ? (<>
          <strong>Send a test from {p.name}.</strong> {p.testHint}
          <span className="hint"> This card turns green by itself a few seconds later. You do not need to copy anything back.</span>
        </>) : (<>
          <strong>Paste {p.name}&apos;s {p.secretName.toLowerCase()} here.</strong> It is on the same page where you pasted the link. It lets us check every payment message really comes from {p.name}.
          <ActionForm action={savePaySecretAction} submit="Save" className="inline-form">
            {hidden}
            <input name="key" autoComplete="off" placeholder={`${p.secretName}`} aria-label={`${p.name} ${p.secretName}`} />
          </ActionForm>
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
        <p>{link.lastEventAt ? `${p.name} last reached us ${ago(link.lastEventAt)}.` : `Set up. The first payment from ${p.name} will confirm it.`}{last ? ` Last message: ${last.note}.` : ''}</p>
        {!link.pageUrl && <p role="status" style={{ color: 'var(--danger)', fontWeight: 700 }}>Add your {p.name} page link (step 1) so fans see a button for it on your page.</p>}
        <details className="adv"><summary className="btn">Show the setup steps again</summary><div className="advin">{steps}</div></details>
      </>) : steps}

      <details className="adv"><summary className="btn">More options</summary>
        <div className="advin">
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

function GankSection({ c }: { c: CreatorRow }) {
  return (<>
    <p className="note">Gank takes more setup than the others: a page review by our team and a webhook registered through Gank&apos;s developer tools.</p>
    <ol className="guide">
      <li className="gstep"><h4>Step 1: Create your tiers on Gank</h4><p>Use the same names and prices you set on the Page tab.</p></li>
      <li className={`gstep${c.gankUrl ? ' is-done' : ''}`}><h4>Step 2: Paste your public Gank page link below</h4></li>
      <li className="gstep"><h4>Step 3: Put your verification code in your Gank bio</h4><p>This is how we know the page is yours.</p></li>
      <li className={`gstep${c.gankVerified ? ' is-done' : ''}`}><h4>Step 4: Send us a review request</h4><p>A person on our team opens your Gank page, finds your code, and approves it. You get an email either way.</p></li>
      <li className="gstep"><h4>Step 5: Match your tiers (only if asked)</h4><p>After the first payment arrives, a box at the top of this tab asks which of your tiers it belongs to.</p></li>
    </ol>
    <h3>1. Your Gank page</h3>
    <ActionForm action={saveGankAction} submit="Save links">
      <div style={field}><label htmlFor="gu">Gank page link</label><input id="gu" name="gankUrl" defaultValue={c.gankUrl} placeholder="https://" inputMode="url" autoCapitalize="off" />
        {c.gankNick && <span className="hint">We read your Gank name as: {c.gankNick}</span>}</div>
      <div style={field}><label htmlFor="gt">Tip link (optional)</label><input id="gt" name="tipUrl" defaultValue={c.tipUrl} placeholder="https://" inputMode="url" autoCapitalize="off" />
        <span className="hint">The Leave a tip button goes here. If empty, it goes to your first connected payment page.</span></div>
    </ActionForm>
    <h3>2. Prove it is yours</h3>
    <p>Add this code to your Gank bio or page description:</p>
    <p><code style={{ fontSize: '1.25rem', fontWeight: 800 }}>{c.verifyCode}</code></p>
    <p className="hint">Status: {c.gankVerified === 1 ? 'Verified' : c.gankVerified === 2 ? 'Waiting for review' : 'Not verified yet'}</p>
    {c.gankVerified === 0 && c.reviewResult && <p role="status" style={{ color: 'var(--danger)', fontWeight: 700 }}>Not approved: {c.reviewResult} Fix it, then send a new request.</p>}
    {c.gankVerified === 2 && <p>Request sent{c.reviewRequestedAt ? ` on ${new Date(c.reviewRequestedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}. Keep your code in your Gank bio until you are approved.</p>}
    {c.gankVerified === 1 && <p>Verified. Fans can pay from your page. If you change your Gank link you will need a new review.</p>}
    {c.gankVerified === 0 && (
      <ActionForm action={requestReviewAction} submit="Send review request">
        <p className="hint">Before you send: the Gank link above is saved and the code above is in your Gank bio. {c.gankUrl ? '' : 'Save your Gank link first.'}</p>
        <div style={field}><label htmlFor="rn">Note for our team (optional)</label><input id="rn" name="note" maxLength={500} placeholder="Anything we should know?" /></div>
      </ActionForm>
    )}
    <h3>3. Connect your payments (webhook)</h3>
    <p>This is how Gank tells the site that someone paid. <strong>Each creator connects their own Gank account.</strong> Gank has no setting that works for everyone at once.</p>
    <p>Your private webhook address:</p>
    <CopyField value={`${appUrl()}/api/webhooks/gank/${c.hookSecret}`} label="Gank webhook URL" />
    <p className="hint">Keep it private. Only you and Gank should know it.</p>
    <ol className="guide">
      <li className="gstep"><h4>A. Register the address with Gank</h4><p>Gank only lets you do this through its Creator API, using a login token from your Gank account (see docs.ganknow.com, Creator API, Register webhook). Register that address for both events: USER_MEMBERSHIP.TX_SUCCEED and DIGITAL_GOODS.TX_SUCCEED. Gank also says digital-goods messages must be switched on by emailing support@ganknow.com.</p></li>
      <li className="gstep"><h4>B. Copy the secret key Gank gives you back</h4><p>Gank replies with a key. Paste it below so we can check every message really came from Gank.</p></li>
      <li className="gstep"><h4>C. Send a test</h4><p>Gank can send a test payment message to your address. A real payment is the final check.</p></li>
    </ol>
    <p className="hint">Careful: Gank allows only one webhook address per account. Registering this one replaces any other you had.</p>
    <ActionForm action={saveSigningKeyAction} submit="Save key">
      <div style={field}><label htmlFor="sk">Gank secret key {c.gankSigningKey ? '(saved, paste a new one to replace it)' : ''}</label><input id="sk" name="key" autoComplete="off" placeholder="Paste the key here" /></div>
    </ActionForm>
    <details className="adv"><summary className="btn">Make a new webhook address</summary>
      <div className="advin" style={{ display: 'grid', gap: 8, marginTop: 8 }}>
        <p className="hint">Only do this if your address leaked. You will need to register the new one with Gank again.</p>
        <form action={rotateHookAction}><button className="btn">Make a new address</button></form>
      </div></details>
  </>);
}
