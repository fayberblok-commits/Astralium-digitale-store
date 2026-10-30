# Astralium Digitale Store (v2)

A luxury digital-products store — ebooks, audiobooks, courses, templates,
music, software and design assets — in 40 locales with full RTL, real
Stripe/PayPal checkout, instant cryptographic download delivery, delivery
over email/WhatsApp/Messenger/Instagram, and a full owner admin panel.
It **runs and renders with zero configuration** (no database, no keys) and
every integration switches on only when the owner supplies its keys.
Nothing is faked: without payment keys, checkout honestly returns
`503 PAYMENTS_NOT_CONFIGURED` instead of pretending to sell.

Feature-by-feature status (implemented where, flag, proving tests, what
was live-tested and what was not): **[docs/FEATURES_TABLE.md](docs/FEATURES_TABLE.md)**.

## Setup

```bash
npm ci                  # installs deps and generates the Prisma client
npm run dev             # http://localhost:3000 → redirects to /en (or browser language)
```

Production:

```bash
npm run build && npm start
```

Quality gates:

```bash
npm test                # 254 unit/integration tests (Node's built-in runner)
npm run test:e2e        # boots the production build, 15 HTTP smoke checks
npx tsc --noEmit        # typecheck (there is intentionally no lint script)
node scripts/check-i18n.mjs   # 392 keys × 40 locales must all resolve
```

Optional production data layer (the store works without it):

```bash
# 1. Set DATABASE_URL (see env table) in your host's env settings
npx prisma migrate deploy     # applies prisma/migrations/*
npm run sync-catalog          # upserts the 12 catalog products as DB rows
# 2. Set the S3_* keys, then upload each product's real file in
#    Admin → Product files. Buyers then download via 15-minute
#    presigned URLs (Admin → docs/ADMIN_GUIDE.md).
```

Verify the core delivery path end-to-end against a local Postgres +
MinIO/S3 with `npm run verify:phase1` (see `docs/PHASE1_REPORT.md`).

## Architecture

- **Hybrid data layer.** The typed file catalog (`src/data/products.ts`)
  renders the storefront with zero infrastructure. An optional Prisma +
  PostgreSQL layer (`prisma/schema.prisma`, accessed only through
  `src/lib/db.ts`) adds durable orders, feature flags, file bindings,
  reviews, loyalty, subscriptions, team accounts and more; every DB call
  no-ops gracefully when `DATABASE_URL` is unset, and feature stores fall
  back to documented JSON files under `.data/`. 7 additive migrations are
  committed under `prisma/migrations/`.
- **Product files in S3.** A hand-rolled AWS SigV4 adapter
  (`src/services/storage.ts`, no SDK) presigns admin uploads and
  15-minute buyer downloads; works with AWS S3, Cloudflare R2, Wasabi
  and MinIO. Bound PDFs can be watermarked per buyer at download time
  (originals are never modified).
- **Downloads are cryptographic.** HMAC-signed, expiring, capped tokens
  (`src/lib/tokens.ts`) are minted only after server-side payment
  verification; DB grants store token hashes only. PII (phones, emails
  for alerts) is AES-256-GCM encrypted (`src/lib/pii.ts`) and indexed by
  SHA-256 hash.
- **Delivery orchestrator.** `src/services/delivery/` sends download
  links through email (always on, automatic fallback), WhatsApp,
  Messenger and Instagram adapters with idempotency keys, bounded
  retries, and attempt logging that never stores message bodies or PII.
- **No payment SDKs.** Stripe and PayPal are integrated over their REST
  APIs with `fetch`; Stripe webhook signatures are verified manually
  (HMAC-SHA256 + timestamp tolerance). PDF receipts and previews are
  generated in-repo (`src/lib/receipt.ts`; watermarking uses `pdf-lib`,
  the one justified extra dependency, plus `web-push` for push
  encryption and `libphonenumber-js` for E.164 validation).
- **Hand-written CSS, local font stacks.** One design system in
  `src/app/globals.css` (warm-ivory / ink / antique-gold luxury-classic
  theme), RTL-aware logical properties, no font CDN.
- **Feature flags for everything.** `src/lib/flags.ts` registers 35
  flags; the database (Admin → Feature flags) is the source of truth,
  `FLAG_<KEY>=1|0` env vars bootstrap a flag only when no DB row exists.
  Messaging, money and tracking features default OFF (list below).

## Environment variables

All variables are documented with sources in `.env.example` (copy it to
`.env.local`, or set them in the host dashboard). Every one is optional
for browsing; each integration activates when its keys appear.

| Variable(s) | Activates | When unset |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | Canonical URLs, sitemap, payment return URLs | Localhost default |
| `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` | Card checkout, express pay, subscriptions | Checkout returns 503 `PAYMENTS_NOT_CONFIGURED` |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_ENV`, `PAYPAL_WEBHOOK_ID` | PayPal checkout | PayPal hidden at checkout |
| `RESEND_API_KEY`, `EMAIL_FROM` | Receipts, download emails, automation | Email runs log-only (honest `queued`) |
| `ADMIN_PASSWORD` | Admin login (bootstrap owner) at `/[locale]/control-astralium` | Admin login disabled, page explains |
| `DOWNLOAD_SIGNING_SECRET` | HMAC download/claim/ref tokens | Tokens cannot be minted/verified |
| `DATABASE_URL` | Durable orders, flags, bindings, reviews, loyalty, subscriptions, team, analytics… | File catalog + `.data/` JSON fallbacks |
| `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE` | Real product-file storage + presigned downloads | Generated license deliverable is served instead |
| `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_BUSINESS_NUMBER`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_TEMPLATE_NAME` | WhatsApp delivery channel | Channel hidden (flag also required) |
| `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `META_PAGE_ID`, `META_PAGE_ACCESS_TOKEN`, `INSTAGRAM_USERNAME`, `INSTAGRAM_ACCESS_TOKEN` | Messenger + Instagram delivery, webhook signature verification | Channels hidden |
| `PII_ENCRYPTION_KEY` | Encrypted phone/email storage (WhatsApp proactive delivery, alerts, cart recovery) | Hash-only storage; proactive sends fall back to email |
| `PREVIEW_MAX_MB`, `WATERMARK_MAX_MB` | Size caps for previews (25) and watermarking (50) | Documented defaults apply |
| `PRICE_ALERT_CRON_SECRET`, `CRON_SECRET` | Cron job endpoints (`/api/jobs/*`, sent as `x-cron-secret`) | Job endpoints refuse (503) |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | LLM path of the support assistant | Assistant answers from local catalog/policy data |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Owner-alert fan-out to Telegram | In-app inbox only |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push sending | Push subscribe/send refuse honestly |
| `ANALYTICS_SALT` | Extra entropy for the analytics visitor hash | `DOWNLOAD_SIGNING_SECRET` reused |
| `DELIVERY_RETRY_BACKOFF_MS` | Delivery retry backoff base (250 ms) | Default applies |
| `FLAG_<KEY>=1\|0` | Boot-time flag bootstrap (any registry key) | Registry defaults / DB rows |
| `PHASE1_DATABASE_URL`, `PHASE1_BASE_URL` | `npm run verify:phase1` script only | Script targets its documented defaults |
| `E2E_PORT`, `E2E_TIMEOUT_MS` | `npm run test:e2e` script only | 3219 / 90000 defaults |

`NODE_ENV` and `NEXT_RUNTIME` are read by the code but set automatically
by Node/Next.js and the platform — never set them yourself.

## Feature flags (registry defaults)

Managed in Admin → Feature flags (persisted in the DB when configured).

**ON by default:** `delivery_email`, `library`, `previews`, `bundles`,
`recommendations`, `smart_search`, `reviews`, `receipts`, `watermarking`,
`license_keys`, `fraud_shield` (review-only holds), `blog`, `seo_engine`,
`owner_alerts` (in-app inbox), `team_access`, `privacy_center`.

**OFF by default** (messaging / money / tracking — the owner enables
them deliberately): `delivery_whatsapp`, `delivery_messenger`,
`delivery_instagram`, `order_bump`, `wishlist_alerts`, `flash_sales`,
`gifts`, `pwyw`, `preorders`, `express_pay`, `subscriptions`, `loyalty`,
`referrals`, `email_automation`, `ab_tests`, `analytics`, `pwa_push`,
`social_proof`, `ai_support_v2`.

## Deployment

**Vercel** — import the repo, framework preset **Next.js**, no build
overrides (the `postinstall` Prisma generate is automatic). Set env vars
in Project → Settings → Environment Variables and redeploy. Point the
Stripe webhook to `https://YOUR-DOMAIN/api/webhooks/stripe`, PayPal's to
`/api/webhooks/paypal`, and Meta's to `/api/webhooks/whatsapp` +
`/api/webhooks/meta` (see `docs/META_WHATSAPP_SETUP.md`). Note: the free
Hobby plan caps deployments at 100/day — bulk git operations that trigger
many auto-deployments can exhaust it until the next day.

**Netlify** — import the same repo; Netlify's Next.js runtime handles the
build (`npm run build`) and serves API routes as functions. Set the same
env vars in Site → Settings → Environment variables. Two honest caveats:
the `.data/` JSON fallbacks live on an ephemeral function filesystem, so
configure `DATABASE_URL` (and S3) for durable data on serverless hosts;
and scheduled jobs (`/api/jobs/*`) need an external scheduler (e.g.
cron-job.org or Netlify Scheduled Functions) sending the `x-cron-secret`
header, on either platform.

On both platforms, run `npx prisma migrate deploy` once against your
production database (e.g. from a local shell with the production
`DATABASE_URL`) and `npm run sync-catalog` after first deploy.

## What's where

| Area | Location |
|---|---|
| Catalog data + accessors | `src/data/products.ts`, `src/data/legal.ts` |
| 40 locales + dictionaries | `src/i18n/locales.ts`, `src/i18n/dictionaries.ts` |
| Feature flags | `src/lib/flags.ts`, Admin → Feature flags |
| DB layer (Prisma, optional) | `prisma/schema.prisma`, `src/lib/db.ts` |
| S3 storage adapter | `src/services/storage.ts` |
| Delivery channels (email/WhatsApp/Messenger/Instagram) | `src/services/delivery/` |
| Download tokens + grants | `src/lib/tokens.ts`, `/api/download/[token]` |
| Checkout + fulfilment | `/api/checkout`, `/api/webhooks/*`, `src/lib/fulfill.ts` |
| Admin (obscure path) | `/[locale]/control-astralium`, `/api/admin/*` |
| Privacy center | `/[locale]/privacy-center`, `/api/privacy/*` |

## Documentation

- [docs/FEATURES_TABLE.md](docs/FEATURES_TABLE.md) — all 30 features +
  Part A: where they live, flags, proving tests, live-test status
- [docs/ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md) — running the store day to day
- [docs/META_WHATSAPP_SETUP.md](docs/META_WHATSAPP_SETUP.md) — owner setup
  for WhatsApp/Messenger/Instagram delivery (+ `docs/whatsapp-template.md`)
- [docs/LIMITATIONS.md](docs/LIMITATIONS.md) — honest list of what is not
  included / not live-tested
- Phase reports: [1](docs/PHASE1_REPORT.md) · [2](docs/PHASE2_REPORT.md) ·
  [3](docs/PHASE3_REPORT.md) · [4](docs/PHASE4_REPORT.md) ·
  [5](docs/PHASE5_REPORT.md) · [6](docs/PHASE6_REPORT.md) ·
  [Final](docs/FINAL_REPORT.md)

Priorities honoured: (1) checkout + instant delivery, (2) luxury
design/UX, (3) 40-language reach with full RTL, (4) owner control,
(5) performance, security headers, SEO.
