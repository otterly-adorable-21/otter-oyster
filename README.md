# Otter & Oyster

Creator pages with tiers, gated posts, tips and an 18+ gate. Fans pay on Ko-fi, Buy Me a Coffee, SubscribeStar or Gank, sign in here with the same email, and their posts unlock.

## Run it on your computer

Needs Node 22.5 or newer.

```
npm install
cp .env.example .env
npm run dev
```

Open http://localhost:3000. With no mail server set up, sign-in links are printed in the terminal instead of emailed.

## Settings (`.env`)

| Name | What it is |
|---|---|
| `APP_URL` | Your public address, e.g. `https://yoursite.com`. Used in sign-in links. |
| `DATA_DIR` | Folder for the database and uploaded images. Back this up. |
| `SMTP_*`, `MAIL_FROM` | Your email sender, so sign-in links can be mailed. |
| `GANK_WEBHOOK_SECRET` | A long random string. Part of the address you give Gank. |
| `GANK_SIGNATURE_HEADER`, `GANK_SIGNING_SECRET` | Only if Gank signs its webhooks. Confirm with Gank. |
| `GANK_ALLOWED_HOSTS` | Which Gank domains creators may link. Default `ganknow.com`. Confirm Gank's real domain. |
| `ADMIN_EMAILS` | Comma-separated emails allowed into `/admin`. |

## Put it online

Build with `npm run build`, then `npm start`. It is one Node process with a SQLite file, so any small server works. **Choose a host whose written policy allows adult content** and read it before you pay. Many do not. Keep `DATA_DIR` on storage that survives restarts.

## Connect Ko-fi, Buy Me a Coffee or SubscribeStar

Creators do this themselves in Studio, Payments. There is nothing for the site owner to set up.

1. Press Connect, then paste their page link (for example `ko-fi.com/name`).
2. Copy the private link shown and paste it into the platform's webhook setting:
   - Ko-fi: More, API, Webhooks.
   - Buy Me a Coffee: Settings, Webhooks, Create new webhook.
   - SubscribeStar: Profile Settings, Webhooks. SubscribeStar only switches webhooks on for approved pages, sometimes on request.
3. Send a test from the platform (Ko-fi, Buy Me a Coffee) and the card turns green by itself. SubscribeStar has no test button, so there the creator pastes the webhook secret instead.

How it stays simple and still safe:

- **No page review.** Each creator gets their own private link per platform (`/api/webhooks/kofi/<secret>` and so on). A message can only reach that link if the creator pasted it into their own account, so we know whose payment it is.
- **No secret to copy for Ko-fi.** Ko-fi puts its verification token in every message. We save it from the first one (normally the test), and refuse any later message without it.
- **Buy Me a Coffee and SubscribeStar** sign their messages. Pasting that secret is optional for Buy Me a Coffee and is step 3 for SubscribeStar. Once it is saved, unsigned messages are refused.
- **Tiers match by themselves**, first by name, then by price (when exactly one tier has that price). If neither works, the creator sees "Payments waiting for you" and picks the tier once. Earlier payments for that tier are then applied.
- **Payment buttons appear on the page only after the link works**, so fans never pay into a setup that cannot unlock anything.

What each platform can and cannot tell us:

| | New payment / renewal | Cancel | Refund / dispute | Tips |
|---|---|---|---|---|
| Ko-fi | yes (monthly, each payment) | no message: access runs out after the paid month | no message | yes |
| Buy Me a Coffee | yes, with the paid-up date when sent | yes | yes | yes |
| SubscribeStar | yes (priced in cents, matched to tiers by price) | yes | yes (dispute) | yes |

SubscribeStar supporters must share their email with the creator on SubscribeStar, or the message arrives without an email and nothing unlocks.

### Things to check with a real message (look for `VERIFY` in `src/lib/payments/parse.ts`)

The parsers follow each platform's public docs and community examples. These docs could not be opened from where this was built:

- Buy Me a Coffee: the field names inside `data` (email, membership level, period end) and the signature header name (`x-signature-sha256` or `x-bmc-signature`; both are accepted).
- Ko-fi: how test messages are marked (we treat `@example.com` emails and Ko-fi's all-zero test transaction id as tests).
- SubscribeStar: whether the signature is still HMAC-MD5 (we accept MD5 or SHA-256), and the event names.

Every message is stored in the `webhook_events` table (Ko-fi tokens are blanked out), so one real test from each platform is enough to confirm.

## Connect Gank

1. Give Gank this address and ask whether they send one webhook for the whole platform:
   `https://YOUR-SITE/api/webhooks/gank?key=YOUR_GANK_WEBHOOK_SECRET`
2. Each creator can also use their own private address, shown under Studio, Payments, Advanced.
3. Creators paste their Gank page link, put the code shown in the studio into their Gank bio, and press Check. This proves the page is theirs.
4. The first payment for a tier may ask the creator to match it to one of their tiers. After that it is automatic.

## Things I could not confirm (look for `VERIFY` in `src/lib/gank.ts` and `src/lib/validate.ts`)

- Gank's webhook names for refunds, chargebacks and cancellations are guesses.
- How Gank builds page links, so how we read the creator name from one.
- Whether a server can read the Gank bio. If the page is drawn by JavaScript, the check cannot see the code, and you will need another proof method (for example Gank confirming ownership).
- Whether Gank allows this use. Get their answer in writing.

## Not built yet

- The Discord role bot (separate always-running service).
- Real terms, privacy policy and content rules. The pages here are placeholders. Have an adult-industry lawyer write them.
- Backups, rate limits beyond sign-in links, and automated image moderation.

## Tests

`npm test` runs the payment logic (Gank, Ko-fi, Buy Me a Coffee, SubscribeStar), access rules and input checks. `npm run typecheck` checks types.
