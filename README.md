# Shiroko Translator

## Run locally

Use Node.js 20.19+ or 22.12+.

```sh
npm ci
npm run dev
```

The site follows the system light/dark preference by default. The header’s Appearance control can select Light, Dark, or System; manual choices persist locally across pages.

Open `http://localhost:3000`. The server serves the built site and the account API. `npm run build && npm start` runs the same setup for a deployment. Set `HOST` and `PORT` if the server should listen somewhere other than `127.0.0.1:3000`; use HTTPS when exposing it publicly.

Set `OPENAI_API_KEY` in `.env` (or in the server environment) before starting the server:

```sh
OPENAI_API_KEY=your_api_key
```

Translation, improvement, and sentence regeneration use `gpt-6.1-sol` with Standard (`service_tier: "default"`), Fast (`"fast"`), or Ultrafast (`"ultrafast"`). Source tokens use `o200k_base`. Monthly subscriptions are Personal $9/50,000, Plus $19/120,000, and Pro $99/650,000 Standard-equivalent source tokens. Standard consumes 1×, Fast 2×, and Ultrafast 6×. Improvement and regeneration also consume allowance. The server reserves usage atomically, releases failed calls, and grants a fresh allowance only for a verified paid billing period. Unused monthly allowance does not roll over. Existing prepaid dollar credit retains its previous source-token purchasing power and is stored separately.

## Polar billing

Configure these server-only values in `.env`:

```sh
APP_URL=https://translate.shiroko.tools
POLAR_ENVIRONMENT=production
POLAR_ACCESS_TOKEN=your_organization_token
POLAR_WEBHOOK_SECRET=your_endpoint_signing_secret
POLAR_PRODUCT_5_USD=product_uuid
POLAR_PRODUCT_10_USD=product_uuid
POLAR_PRODUCT_25_USD=product_uuid
POLAR_PRODUCT_50_USD=product_uuid
POLAR_PRODUCT_100_USD=product_uuid
```

Use `POLAR_ENVIRONMENT=sandbox` with separate sandbox credentials for test payments. `node scripts/setup-polar.mjs` creates or reuses the five credit products, writes their IDs to `.env`, and checks the webhook. The setup script uses `https://translate.shiroko.tools` as the app URL. Required token permissions are product read/write, checkout write, order read, and webhook read. Register `https://translate.shiroko.tools/api/billing/webhook` in Polar with API version `2026-10`, raw format, and events `order.paid` and `order.refunded`. Never put these secrets in frontend environment variables or source control.

Checkout ties purchases to the signed-in account using `external_customer_id`. Credit is granted only after verifying a webhook signature and retrieving the current paid order from Polar. Retries and out-of-order delivery reconcile the same order balance rather than crediting it again. Partial and full refunds remove the corresponding purchased credit; a refund of already-spent credit can make the balance negative and blocks further translations.

Billing entries are stored in the existing persistent store as integer millionths of a dollar. Every model call reserves exactly the fixed source-token charge, rounded to integer millionths of a dollar per chunk, then settles that same amount. Provider token counts are retained only for internal usage records. Failed provider requests release the reservation. A valid provider response is charged even if its translation cannot be parsed. No payment or usage is trusted from the browser. Run only one server process per data file. An interrupted process can leave a reservation pending; investigate those entries before returning any credit, since the provider may have processed the request. Back up the data file, including its billing ledger.

Accounts and saved translations live in `data/store.json` by default; this directory is ignored by Git. Back it up to keep user work. Set `SHIROKO_DATA_FILE` to use another persistent file. Each saved translation includes the original text, target language, style instructions, paragraph boundaries, and editable aligned sentence pairs.

Google, Microsoft, X/Twitter, and Kakao sign-in are supported alongside email/password accounts. See [SOCIAL_LOGIN_SETUP.md](SOCIAL_LOGIN_SETUP.md) for provider app registration, credentials, and callback URLs. Users connect providers to an existing account through **Sign-in methods** to keep the same translations and prepaid credit.

For frontend hot reload, run `npm run dev:client` alongside `npm start`. Vite proxies `/api` to the server on port 3000.

Run `npm test` for the account and saved-translation integration test.

Choose **Use Existing Translation** on the home page or editor to paste an original and draft translation, then add revision instructions. Improvement processes the document in chunks, carrying a running summary, terminology, and the previous revision forward. There is no overall document character limit in this flow. Saved results include the term dictionary and running summary alongside three aligned columns: original text, original translation, and editable new translation. Word exports also include all three columns.

The editor supports 58 target languages (the original eight plus 50 additional languages). The homepage loops through the headline in every supported language, with pause and reduced-motion controls. `headline-translations.json` is generated once with `gpt-6.1-sol`; visitors do not trigger API calls. To regenerate, run `node scripts/generate-headline-translations.mjs` with the server API key configured in `.env`.

The homepage film at `public/demo/side-by-side-launch.mp4` is a 23-second recording of an actual GPT-6.1 Sol translation session using the opening passage of Moby-Dick. It focuses on the aligned original and French translation, including live sentence editing, with an original soundtrack, a poster extracted from the film, optional English captions, and a text walkthrough. Source scripts and the 16:9, square, and portrait compositions are in `video/launch/`. Static files support byte-range requests for video seeking.

Signup promotion: entering `TRANSLATE.SHIROKO.TOOLS` during email signup or under **Add credit → Promotion code** grants $0.50 once per account, including social accounts. Codes are case-insensitive and ignore surrounding whitespace. Promotional credit uses the persistent billing ledger and can fund translations immediately.

Translations save automatically to the signed-in account as chunks arrive and after edits or sentence regeneration. Edits are saved after a short pause; failed saves retry automatically. The Save button remains available to retry immediately.

Signed-in users can select **Invite friends** to copy their stable invitation link. A new account created through that link gives both the inviter and the new user $0.50 in translation credit, without requiring a purchase. Email and social signup support referral attribution. Existing accounts cannot claim referral signup credit retroactively; each new account receives either referral signup credit or promotional signup credit once. Inviter rewards are separate and granted once per new referred account. Opening or sharing a link alone grants no credit.


Human Review is a separate manual service for English ↔ Korean. Pricing is $0.04 per English word with a $10 minimum; a standardized page is 250 English words. English source text is counted for English→Korean, and the English draft for Korean→English. Original and draft are required. Requests, notes, prices, statuses, reviewed deliveries, and notification state are persisted in `humanReviewRequests` in the existing private data file. Submitting requests does not charge Polar or translation credit; payment is arranged separately.

Open **Human Review → My requests** for customer status and delivered text. Review managers sign in at `/app.html?reviews=manage`. The existing accounts for `jbaek080@gmail.com` and `miarasung@gmail.com` are authorized at server startup; newly registered accounts cannot claim the role simply by submitting an email address. Managers can move requests between queued, in review, completed, and canceled; completing requires reviewed text. Customers can cancel their own queued requests. Queue estimates use pending English words and capacity of 5,000 words (20 standardized pages) per day; completed/canceled work is removed. Estimates update from the current queue and are not guaranteed dates.

Notifications use Private Email SMTP via Nodemailer. Configure `SMTP_PASSWORD` privately in `.env`; defaults are `SMTP_HOST=mail.privateemail.com`, `SMTP_PORT=465`, `SMTP_USER=support@shiroko.tools`, and sender `support@shiroko.tools` (`HUMAN_REVIEW_FROM_EMAIL`). Notifications go to both review managers and include metadata plus an authenticated dashboard link; full documents stay in the dashboard. Failed sends stay in the durable queue and retry every minute with backoff up to one hour. SMTP delivery can repeat after an ambiguous connection failure or process crash; a stable Message-ID is retained for the request. The app does not use Resend.

The interface supports English, Spanish, French, German, Chinese, Arabic, Korean, and Japanese. Saved manual selection takes priority over browser language preferences, then geographic fallback, then English. Geographic lookup is best-effort and server-side, requested only when there is no supported browser language; document content and account data are excluded. Arabic uses RTL for the interface while document text keeps automatic direction. The globe control appears on the public page, editor, and results. Rare errors and the demo film remain English.

Measured multilingual subscription estimates, assumptions, speed multipliers, and Polar fee calculations are in `reports/subscription-economics-2026-10-21.md`; raw measurements are in `reports/language-benchmark-2026-10-21.json`. Subscription billing and revised referral terms in that report are proposals, not implemented billing changes.


Current subscription setup: run `node scripts/setup-subscriptions.mjs` to create/reuse monthly Polar products and token top-ups and enable renewal/cancellation webhook events. Store IDs as `POLAR_SUBSCRIPTION_PERSONAL`, `POLAR_SUBSCRIPTION_PLUS`, `POLAR_SUBSCRIPTION_PRO`, and `POLAR_TOKEN_TOPUP_5`, `_10`, `_25`, `_50`, `_100`. Required scopes include subscriptions read, products read/write, orders read, checkouts write, customer sessions write, and webhooks read/write. The old `setup-polar.mjs` configures legacy dollar-credit products only and should not be used for new storefront pricing.

New one-time top-ups are $5/20,000, $10/45,000, $25/120,000, $50/250,000, and $100/520,000 Standard-equivalent tokens. They do not expire and are consumed after the monthly allowance, before legacy dollar credit. No automatic top-up occurs. Historical dollar-credit payment webhooks still reconcile purchases/refunds, but new storefront checkout uses token top-ups. Manage payment methods and cancel/change subscriptions in the authenticated Polar customer portal. Cancellations at period end preserve the current paid allowance until its expiration. A refunded allowance is reduced proportionally. Webhook processing fetches authoritative current provider state and reconciles order IDs rather than adding tokens on every event.

All paid subscriptions include the book-photo workspace. Users can import hundreds of JPEG/PNG/WebP photos, inspect previews, rotate, naturally sort or manually reorder pages, edit OCR text, pause/resume and retry failed pages. Normalized Full HD photos and small thumbnails live in browser IndexedDB, not sessionStorage. OCR uses `gpt-6.1-sol` at Standard, with up to 4,096 allowance tokens reserved per photo; final cost is 512 plus recognized source tokens. Unused reservation is returned. Translation is a separate source-token action at the chosen speed. Photos are sent only when transcription is started. Stable page request IDs cache completed OCR results so retrying a lost response does not charge twice. No photos are stored on the server. OCR job text/results and billing reservations are durable in the private data store. Pending jobs interrupted by a server restart require operator review before retrying, since the provider may already have processed the image. Oversized text drafts/results fall back to IndexedDB so browser sessionStorage limits do not truncate whole-book workflows.

Appearance uses a fixed bottom-right sun/moon button with a persisted light/dark choice. The initial appearance follows the system until the visitor selects a theme.

The translation editor preserves the visible reading position when changing text size, finding text, replacing text, or undoing replacements. Its document actions and reading tools share a sticky toolbar with Hide/Show controls. Sentence bookmarks save with the translation and are reachable from the Bookmarks menu.

Translation and improvement run as server jobs. After the start request is accepted, users can close or refresh the browser. Each chunk saves the running summary, terminology, previous output, next chunk, and improvement draft cursor. Stop finishes and saves the current chunk, then pauses; Resume continues from that checkpoint. Duplicate starts share a worker, and stale browser saves cannot truncate newer server results. Pasting/uploading the same full source with matching language, instructions, mode, and custom terms also finds unfinished work. Older saves need no migration; resume is offered only when the saved source establishes a verified chunk boundary. Older improvement jobs additionally need the original draft to verify its consumed prefix. Server restarts pause interrupted jobs at the last saved checkpoint.

The search button below each sentence bookmark opens Explain & research. It highlights special terms and uses the saved book summary plus up to two preceding and two following sentences, in both languages. Required web search provides clickable inline citations, cited sources, and expandable additional results. Research uses 1,000 allowance tokens plus the submitted context payload's token count; privately cached results reopen without another charge for seven days. Failed or uncited research releases its reservation. Existing translation/OCR rates are unchanged.
