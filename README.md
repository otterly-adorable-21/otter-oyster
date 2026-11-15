# Otter & Oyster

Creator pages with tiers, gated posts, tips and an 18+ gate. Payments run through Gank. Fans pay there, sign in here with the same email, and their posts unlock.

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

`npm test` runs the payment logic, access rules and input checks. `npm run typecheck` checks types.
