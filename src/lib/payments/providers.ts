// The payment platforms a creator can connect with a single webhook link.
// Text here is shown to creators, so it is written for people, not developers.

export type ProviderId = 'kofi' | 'bmc' | 'subscribestar';

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  /** Hosts a creator's public page link may live on (subdomains included). */
  hosts: string[];
  pageExample: string;
  /** Where on the platform the creator pastes our link (null when there is no fixed address to link to). */
  settingsUrl: string | null;
  settingsPath: string;
  /** What to do there, after opening settingsPath. */
  pasteHint: string;
  /** What the creator presses on the platform to send us a test, or null if the platform has none. */
  testHint: string | null;
  /** Name of the secret the platform shows, if the creator may paste it for extra safety. Empty: no secret field is offered. */
  secretName: string;
  /** True when we can learn the secret from the first message, so the creator never copies it. */
  secretLearned: boolean;
  extraNote?: string;
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  kofi: {
    id: 'kofi',
    name: 'Ko-fi',
    hosts: ['ko-fi.com'],
    pageExample: 'https://ko-fi.com/yourname',
    settingsUrl: 'https://ko-fi.com/manage/webhooks',
    settingsPath: 'More → API → Webhooks',
    pasteHint: 'Paste it into the Webhook URL box and press Update.',
    testHint: 'Press “Send Single Donation Test”. To test a membership, use the membership test button on the same page.',
    secretName: 'Verification Token',
    secretLearned: true,
  },
  bmc: {
    id: 'bmc',
    name: 'Buy Me a Coffee',
    hosts: ['buymeacoffee.com'],
    pageExample: 'https://buymeacoffee.com/yourname',
    settingsUrl: 'https://studio.buymeacoffee.com/webhooks',
    settingsPath: 'Integrations → Webhooks → Create',
    pasteHint: 'Paste it as the webhook URL, choose all the events, and save.',
    testHint: 'Open the webhook you made, choose an event (for example “Membership started”) and press Send test.',
    secretName: 'Secret',
    secretLearned: false,
  },
  subscribestar: {
    id: 'subscribestar',
    name: 'SubscribeStar',
    hosts: ['subscribestar.art', 'subscribestar.com', 'subscribestar.adult'],
    pageExample: 'https://subscribestar.art/yourname',
    settingsUrl: null,
    settingsPath: 'your profile page → Settings → API → Add client',
    pasteHint: 'Paste it into the new client, tick “subscriber.payment.read”, and save.',
    testHint: null,
    // VERIFY: whether an API client signs its messages, and with which secret. Until that is known no secret is asked for:
    // a wrong one would make us refuse every real payment. The private link alone ties messages to the creator.
    secretName: '',
    secretLearned: false,
    extraNote: 'If a payment arrives without the supporter’s email, we cannot tell who paid. If that happens, ask the supporter to share their email with you on SubscribeStar, or to use “Already paid? Claim access” on your page.',
  },
};

export const PROVIDER_ORDER: ProviderId[] = ['kofi', 'bmc', 'subscribestar'];

export const isProvider = (s: string): s is ProviderId => Object.prototype.hasOwnProperty.call(PROVIDERS, s);

export function pageHostOk(provider: ProviderId, hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^www\./, '');
  return PROVIDERS[provider].hosts.some((a) => h === a || h.endsWith('.' + a));
}
