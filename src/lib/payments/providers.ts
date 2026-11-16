// The payment platforms a creator can connect with a single webhook link.
// Text here is shown to creators, so it is written for people, not developers.

export type ProviderId = 'kofi' | 'bmc' | 'subscribestar';

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  /** Hosts a creator's public page link may live on (subdomains included). */
  hosts: string[];
  pageExample: string;
  /** Where on the platform the creator pastes our link. */
  settingsUrl: string;
  settingsPath: string;
  /** What the creator presses on the platform to send us a test, or null if the platform has none. */
  testHint: string | null;
  /** Name of the secret the platform shows, if the creator may paste it for extra safety. */
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
    settingsPath: 'Settings → Webhooks → Create new webhook',
    testHint: 'Open the webhook you made, choose an event (for example “Membership started”) and press Send test.',
    secretName: 'Secret',
    secretLearned: false,
  },
  subscribestar: {
    id: 'subscribestar',
    name: 'SubscribeStar',
    hosts: ['subscribestar.com', 'subscribestar.adult'],
    pageExample: 'https://subscribestar.adult/yourname',
    settingsUrl: 'https://www.subscribestar.com/webhooks',
    settingsPath: 'Profile Settings → Webhooks',
    testHint: null,
    secretName: 'Webhook secret',
    secretLearned: false,
    extraNote: 'SubscribeStar only switches webhooks on after your page is approved, and you may need to ask their support to turn them on. Your supporters must also share their email with you on SubscribeStar (it is a setting on their side), or we cannot tell who paid.',
  },
};

export const PROVIDER_ORDER: ProviderId[] = ['kofi', 'bmc', 'subscribestar'];

export const isProvider = (s: string): s is ProviderId => Object.prototype.hasOwnProperty.call(PROVIDERS, s);

export function pageHostOk(provider: ProviderId, hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^www\./, '');
  return PROVIDERS[provider].hosts.some((a) => h === a || h.endsWith('.' + a));
}
