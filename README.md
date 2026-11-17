# Otter & Oyster

Creator pages with tiers, gated posts, tips and an 18+ gate. Fans pay on Ko-fi, Buy Me a Coffee or SubscribeStar, sign in here with the same email, and their posts unlock.

## Run it on your computer

Needs Node 22.5 or newer.

```
npm install
cp .env.example .env
npm run dev
```

Open http://localhost:3000. With no mail server set up, sign-in links are printed in the terminal instead of emailed.

## Settings

On your computer they go in `.env`. **On Railway they go in the service's Variables tab** (no `.env` file is used there).

| Name | What it is |
|---|---|
| `APP_URL` | Your public address, e.g. `https://yoursite.com`. Used in sign-in links. |
| `DATA_DIR` | Folder for the database and uploaded images. Back this up. |
| `SMTP_*`, `MAIL_FROM` | Your email sender, so sign-in links can be mailed. |
| `ADMIN_EMAILS` | Comma-separated emails allowed into `/admin`. |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN` | Your Discord app. Optional: leave empty to hide Discord roles. See below. |
| `DISCORD_SYNC_MINUTES` | How often all roles are re-checked. Default 30. |

## Put it online (Railway)

The site runs on Railway as one always-on Node process with a SQLite file. Railway builds it with `npm run build` and starts it with `npm start`; it needs nothing else.

1. **Node version.** The database needs Node 22.5 or newer. `.nvmrc` and `engines` in `package.json` tell Railway to use Node 22. If a deploy fails with `node:sqlite` or `No such built-in module`, this is the cause.
2. **Keep your data.** Railway wipes the disk on every deploy. Add a **Volume** to the service (right-click the service, Attach volume), mount it at `/data`, and set the variable `DATA_DIR=/data`. Without this, every deploy deletes all accounts, posts and images.
3. **Variables.** In the service's Variables tab set at least `APP_URL=https://otteroyster.online`, `DATA_DIR=/data`, the `SMTP_*` and `MAIL_FROM` mail settings, and `ADMIN_EMAILS`. Add the Discord ones when you set up Discord.
4. **One copy only.** Keep the service at 1 replica. The database is a single file, and the Discord role check runs inside the web process.
5. **Adult content.** Read Railway's acceptable use policy and confirm in writing that your content is allowed before you launch.

## Connect Ko-fi, Buy Me a Coffee or SubscribeStar

Creators do this themselves in Studio, Payments. There is nothing for the site owner to set up.

1. Press Connect, then paste their page link (for example `ko-fi.com/name`).
2. Copy the private link shown and paste it into the platform's webhook setting:
   - Ko-fi: More, API, Webhooks.
   - Buy Me a Coffee: Integrations, Webhooks, Create. Paste the link and choose all the events.
   - SubscribeStar: profile page Settings, API, Add client. Paste the link and tick `subscriber.payment.read`.
3. Send a test from the platform (Ko-fi, Buy Me a Coffee) and the card turns green by itself. SubscribeStar has no test button, so the creator presses "I added it on SubscribeStar" instead, and the first real payment is the final check.

How it stays simple and still safe:

- **No page review.** Each creator gets their own private link per platform (`/api/webhooks/kofi/<secret>` and so on). A message can only reach that link if the creator pasted it into their own account, so we know whose payment it is.
- **No secret to copy for Ko-fi.** Ko-fi puts its verification token in every message. We save it from the first one (normally the test), and refuse any later message without it.
- **Buy Me a Coffee** signs its messages. Pasting its secret is optional; once saved, unsigned messages are refused.
- **SubscribeStar** is not asked for a secret yet, because it is not confirmed which secret (if any) an API client signs with. A wrong one would block every real payment. The private link alone still ties each message to the right creator.
- **Tiers match by themselves**, first by name, then by price (when exactly one tier has that price). If neither works, the creator sees "Payments waiting for you" and picks the tier once. Earlier payments for that tier are then applied.
- **Payment buttons appear on the page only after the link works**, so fans never pay into a setup that cannot unlock anything.

What each platform can and cannot tell us:

| | New payment / renewal | Cancel | Refund / dispute | Tips |
|---|---|---|---|---|
| Ko-fi | yes (monthly, each payment) | no message: access runs out after the paid month | no message | yes |
| Buy Me a Coffee | yes, with the paid-up date when sent | yes | yes | yes |
| SubscribeStar | yes (priced in cents, matched to tiers by price) | yes | yes (dispute) | yes |

If a SubscribeStar message arrives without the supporter's email, nothing unlocks. The supporter can share their email with the creator on SubscribeStar, or use "Already paid? Claim access". Creator page links on `subscribestar.art`, `subscribestar.com` and `subscribestar.adult` are all accepted.

### Things to check with a real message (look for `VERIFY` in `src/lib/payments/parse.ts`)

The parsers follow each platform's public docs and community examples. These docs could not be opened from where this was built:

- Buy Me a Coffee: the field names inside `data` (email, membership level, period end) and the signature header name (`x-signature-sha256` or `x-bmc-signature`; both are accepted).
- Ko-fi: how test messages are marked (we treat `@example.com` emails and Ko-fi's all-zero test transaction id as tests).
- SubscribeStar: that messages from an API client (scope `subscriber.payment.read`) have the same shape as the older webhook messages this parser follows, and whether they are signed. If they are, add a secret field back for SubscribeStar in `src/lib/payments/providers.ts` (the MD5 or SHA-256 check is already written).

Every message is stored in the `webhook_events` table (Ko-fi tokens are blanked out), so one real test from each platform is enough to confirm.

## Discord roles

Supporters get a role in the creator's own Discord server that matches their tier, and lose it when their plan ends. One shared bot serves every creator. It is not a separate program: the website itself talks to Discord, so there is nothing else to host.

### Set up the bot (once, for the whole site)

1. Go to https://discord.com/developers/applications and press **New Application**. Name it (for example "Otter & Oyster"). This name and icon are what creators see.
2. **OAuth2** page: copy the **Client ID** and **Client Secret**. Under **Redirects** add exactly `https://otteroyster.online/api/discord/callback` (it must match `APP_URL`), and save.
3. **Bot** page: press **Reset Token** and copy the token. Leave **Public Bot** switched **on**, or creators cannot add it to their servers. No privileged intents are needed.
4. In Railway, add `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` and `DISCORD_BOT_TOKEN`, then let it redeploy.
5. Test with your own server: Studio, Discord tab, Add the bot. If you come back to the studio with "Something went wrong adding the bot", switch on **Requires OAuth2 Code Grant** on the Bot page and try again.

Keep the bot token secret. It only has Manage Roles and Create Invite, never Administrator, but anyone holding it can change roles in every connected server. If it leaks, press Reset Token and update Railway.

### How it behaves

- Creators: Studio, Discord tab, add the bot, then pick (or have the bot make) a role for each tier.
- Supporters: open the creator's join link (`/handle/discord`), sign in, link Discord, and are added to the server with their role. They can unlink from the same page, which takes their roles back.
- Roles change **as soon as** a payment, refund or cancellation arrives, when a creator matches a tier, and when a fan claims another email. Every role is also re-checked every 30 minutes; that is when roles are removed from plans that simply ran out.
- If the bot is kicked from a server, or a tier's role is deleted, the creator sees a warning in the studio and gets one email.

## Payments are handled by the platforms

Each payment platform's own terms decide what can be sold there, including adult content. Before launch, get each platform's answer in writing that this use (and your content) is allowed.

## Not built yet

- Real terms, privacy policy and content rules. The pages here are placeholders. Have an adult-industry lawyer write them.
- Backups, rate limits beyond sign-in links, and automated image moderation.

## Tests

`npm test` runs the payment logic (Ko-fi, Buy Me a Coffee, SubscribeStar), access rules and input checks. `npm run typecheck` checks types.
