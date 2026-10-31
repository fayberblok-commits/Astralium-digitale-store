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

Five-phase upgrade (security · brand/themes · storefront · Manager's
Office · AI staff) — per-item delivery status, test evidence and every
not-live-tested item with its reason:
**[docs/FINAL_DELIVERY.md](docs/FINAL_DELIVERY.md)**, with the full
phase reports in [docs/upgrade-reports/](docs/upgrade-reports/).

## Setup

```bash
npm ci                  # installs deps and generates the Prisma client
npm run dev             # http://localhost:3000 → redirects to /en (or browser language)
```

Production:

```bash
npm run build && npm start
```

Quality gates (the five-phase upgrade's full gate — all must pass):

```bash
npm run lint            # ESLint 9 (Next core-web-vitals + TypeScript) — 0 errors, 0 warnings
npm run typecheck       # tsc --noEmit
npm test                # 338 unit/integration/security tests (Node's built-in runner)
npm run build           # production build
npm run test:e2e        # boots the production build, 15 HTTP smoke checks
npm run check-i18n      # 669 keys × 40 locales must all resolve (en/ar fully native)
npm run scan:secrets    # scripted secret scan over the tree — must be 0 hits
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

## The Manager's Office (owner admin)

The office is the store's private control room. It is **invisible to
customers**: there are no storefront links to it, it is excluded from
robots/sitemap, every page is `noindex`, and its URL path is not
published anywhere in the storefront.

### Signing in

1. Open the office in your browser at
   **`/<locale>/control-astralium`** — or, if you set `ADMIN_PATH` in
   the environment, at `/<locale>/<your ADMIN_PATH>` (the default path
   then stops working). Example: `/en/control-astralium`.
2. Sign in with the owner password — the `ADMIN_PASSWORD` environment
   variable (the "bootstrap owner"). Team accounts you create later
   sign in with their own email + password on the same page.
3. **First-time two-factor setup (required):** the owner account must
   enroll in TOTP 2FA. After your first sign-in, open
   **Team & system → Security** in the office, start the TOTP setup,
   scan the secret with any authenticator app (Google Authenticator,
   Authy, …), enter the 6-digit code to confirm, and **store the
   backup codes somewhere safe** — they are shown once. From then on,
   signing in asks for the password plus a code, and sensitive actions
   (refunds, bank reveal, role changes) ask you to re-authenticate
   ("step-up") even while signed in.

### What is inside

- **Overview** — live visitors (now / today / week / month), countries
  on a world map, devices, browsers, traffic sources, top pages and
  the conversion funnel. First-party analytics only, consent-respecting.
- **Sales & profit** — gross, refunds, estimated provider fees/taxes
  (rates you set), product costs, ad spend, and real net profit from
  the order ledger, with previous-period comparison and CSV export.
  Only the owner and the accountant role can open this section.
- **Orders / Customers** — search, order detail, resend downloads,
  notes, full/partial refunds (provider-executed, step-up required),
  customer totals, ban/unban (enforced at checkout).
- **Products** — create/edit/archive/duplicate, per-product cost,
  per-currency prices, translations, scheduled publishing; product
  files are attached in the same section (magic-byte-verified uploads).
- **Design** — palette/theme, announcement banner, hero texts,
  homepage sections, brand guide — plus **saved design versions with
  one-click rollback**.
- **Content & support** — review moderation, support tickets (from the
  storefront `/support` page), blog, A/B tests, push broadcasts.
- **Commerce** — coupons & discounts (office-managed; checkout uses
  exactly this list) and feature flags.
- **Bank details** — an encrypted-at-rest archive of your bank details
  (masked by default; reveal needs step-up). This is a reference
  archive only: **actual payouts are configured inside Stripe/PayPal**,
  never here.
- **Security center** — sessions, searchable audit log, security
  alerts, encrypted-backup status, system health. Owner only.
- **Team & system** — team accounts and roles
  (owner / manager / support / marketer / accountant), your own 2FA
  and session controls. Only the owner ever sees money, bank and
  security data — enforced on the server for every request.
- **AI Staff** (Phase 5 upgrade) — a provider-independent AI gateway
  (office section "AI Staff", `settings` permission). Primary provider:
  Meta Model API, model `muse-spark-1.3` (key: `MODEL_API_KEY`);
  fallback: any OpenAI-compatible endpoint (`AI_FALLBACK_API_KEY` or
  the legacy `OPENAI_API_KEY`); switch providers in one click. With
  **no key configured the staff stays hidden** and the deterministic
  grounded support engine keeps answering — the store never fakes AI.
  - *Customer team* (storefront chat, flag `ai_staff`): Greeter,
    Sales, Support and Order employees answer ONLY from the real
    catalog/policies/articles; order status uses the same verified
    id+email / claim-code lookup as before; uncertainty escalates to
    a human ticket with the full transcript. They hold **no tools** —
    a customer message can never trigger an action.
  - *Owner team* (flag `ai_owner_staff`): Designer, Marketer, Analyst,
    Translator, Product Manager and Security Monitor act ONLY through
    a typed tools layer. Every write is a **preview** first: safe
    changes apply on your Apply click (with one-click undo);
    sensitive changes (coupons, prices, publishing) need your
    explicit **Approve**. Refunds, bank data, secrets, deletes,
    account/permission changes and security changes are **refused in
    the tool layer itself** — no prompt can override that. Daily cost
    and action caps, a full audit trail ("executed by employee X on
    the owner's order"), conversation logs for quality review, and an
    **emergency stop** that halts all staff instantly.
  - *What is verified vs not (Meta Model API):* the gateway speaks the
    Chat Completions contract (`POST /v1/chat/completions`, Bearer
    `MODEL_API_KEY`, `tool_choice: "auto"` only, `max_completion_tokens`)
    with a configurable base URL (`AI_META_BASE_URL`, default
    `https://api.meta.ai/v1`) and a tolerant streaming parser — the
    contract corroborated from Meta's implementer ecosystem
    (promptfoo/LiteLLM provider docs and developer guides citing
    dev.meta.ai). **The official docs host could not be rendered from
    the build environment, and no `MODEL_API_KEY` exists yet, so the
    Meta endpoint itself is NOT live-tested**; the adapter is proven
    against a fake fetch implementing the corroborated contract and
    against the deterministic mock provider end-to-end (30/30 live
    legs, `scripts/verify-phase5-ai.mjs`). If Meta's live contract
    differs in detail, `src/lib/ai/openai-compatible.ts` is the only
    file that changes. Full detail: `docs/upgrade-reports/PHASE5_REPORT.md`.

### Backups & key rotation

- **Encrypted database backups:** set `BACKUP_ENCRYPTION_KEY`
  (≥ 32 chars), then `npm run backup:db` writes an AES-256-GCM
  encrypted dump (pg_dump when the binary exists, a logical export
  otherwise) and `npm run restore:db` restores it — a wrong key is
  refused by GCM authentication. The round-trip (backup → tamper →
  restore → row counts match) is proven; schedule it with your host's
  cron and keep the key outside the database host.
- **Key rotation:** all token/session families derive from their root
  secrets by HKDF with per-purpose separation (`src/lib/keys.ts`), so
  rotating `DOWNLOAD_SIGNING_SECRET` / `AUTH_SECRET` / `ADMIN_PASSWORD`
  invalidates only that family. The step-by-step procedure (including
  the `KEY_VERSION` break-glass bump that invalidates every derived
  artifact at once) is in `docs/SECURITY.md` → "Key separation &
  rotation". Weak secrets are refused or degraded loudly at startup —
  the app never boots silently on a guessable secret.

## Architecture

- **Hybrid data layer.** The typed file catalog (`src/data/products.ts`)
  renders the storefront with zero infrastructure. An optional Prisma +
  PostgreSQL layer (`prisma/schema.prisma`, accessed only through
  `src/lib/db.ts`) adds durable orders, feature flags, file bindings,
  reviews, loyalty, subscriptions, team accounts and more; every DB call
  no-ops gracefully when `DATABASE_URL` is unset, and feature stores fall
  back to documented JSON files under `.data/`. Since the Phase 1
  upgrade, **when `DATABASE_URL` is set and reachable the database is
  the storefront's source of truth** (`src/lib/catalog.ts`); the file
  catalog is the bootstrap seed and the fallback only. A real order
  ledger (`src/lib/orders.ts`) records every order in both modes.
  8 additive migrations are committed under `prisma/migrations/`.
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
- **Feature flags for everything.** `src/lib/flags.ts` registers 37
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
| `AUTH_SECRET` | Root secret for HKDF-separated admin/team/step-up keys (Phase 1) | Derived from `ADMIN_PASSWORD` (documented fallback) |
| `ADMIN_PATH` | Renames the admin URL segment | Default `control-astralium` segment |
| `ADMIN_TOTP_REQUIRED` | Makes TOTP enrolment mandatory for the bootstrap owner (`=1`) | Mandatory for team owner/admin roles only |
| `ADMIN_SESSION_IDLE_MINUTES`, `ADMIN_ALERT_EMAIL` | Admin session idle timeout (60); security-alert email recipient | Defaults apply; alerts stay in-app |
| `TRUSTED_PROXY_HEADER` | Which platform header `getClientIp()` trusts for rate limiting | Platform default chain (raw `x-forwarded-for` never trusted) |
| `TURNSTILE_SECRET_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY` / `HCAPTCHA_SECRET_KEY`, `NEXT_PUBLIC_HCAPTCHA_SITE_KEY` | Bot protection on public forms (either provider) | Forms rely on rate limits; captcha never fake-passes |
| `BACKUP_ENCRYPTION_KEY` | AES-256-GCM key for `npm run backup:db` / `restore:db` (≥ 32 chars) | Backup commands refuse to run |
| `DOWNLOAD_SIGNING_SECRET` | HMAC download/claim/ref tokens | Tokens cannot be minted/verified |
| `DATABASE_URL` | Durable orders, flags, bindings, reviews, loyalty, subscriptions, team, analytics… | File catalog + `.data/` JSON fallbacks |
| `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE` | Real product-file storage + presigned downloads | Generated license deliverable is served instead |
| `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_BUSINESS_NUMBER`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_TEMPLATE_NAME` | WhatsApp delivery channel | Channel hidden (flag also required) |
| `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `META_PAGE_ID`, `META_PAGE_ACCESS_TOKEN`, `INSTAGRAM_USERNAME`, `INSTAGRAM_ACCESS_TOKEN` | Messenger + Instagram delivery, webhook signature verification | Channels hidden |
| `PII_ENCRYPTION_KEY` | Encrypted phone/email storage (WhatsApp proactive delivery, alerts, cart recovery) | Hash-only storage; proactive sends fall back to email |
| `PREVIEW_MAX_MB`, `WATERMARK_MAX_MB` | Size caps for previews (25) and watermarking (50) | Documented defaults apply |
| `PRICE_ALERT_CRON_SECRET`, `CRON_SECRET` | Cron job endpoints (`/api/jobs/*`, sent as `x-cron-secret`) | Job endpoints refuse (503) |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | LLM path of the support assistant | Assistant answers from local catalog/policy data |
| `MODEL_API_KEY`, `AI_META_MODEL`, `AI_META_BASE_URL` | AI staff gateway — Meta Model API (Muse Spark) primary provider | AI staff hidden; grounded engine answers |
| `AI_FALLBACK_API_KEY`, `AI_FALLBACK_BASE_URL`, `AI_FALLBACK_MODEL`, `AI_PROVIDER`, `AI_DAILY_COST_CAP_USD`, `AI_DAILY_ACTION_CAP` | AI staff fallback provider (OpenAI-compatible), active-provider default, daily budgets | Fallback = `OPENAI_API_KEY` when set; caps default $5 / 50 actions |
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
`social_proof`, `ai_support_v2`, `ai_staff`, `ai_owner_staff`
(both AI-staff flags also stay inert until a real provider key exists).

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
| Admin (path renameable via `ADMIN_PATH`) | `/[locale]/control-astralium`, `/api/admin/*` |
| Order ledger + grants (F1) | `src/lib/orders.ts` |
| Catalog source of truth (F2) | `src/lib/catalog.ts` |
| Security (keys, sessions, audit log) | `src/lib/keys.ts`, `src/lib/security-log.ts`, `docs/SECURITY.md` |
| Privacy center | `/[locale]/privacy-center`, `/api/privacy/*` |

## Documentation

- [docs/FINAL_DELIVERY.md](docs/FINAL_DELIVERY.md) — **five-phase
  upgrade delivery status**: every Phase 1–5 item, how it was tested,
  and what was not live-tested (and why) — read this first
- Upgrade phase reports: [1 · Security](docs/upgrade-reports/PHASE1_REPORT.md) ·
  [2 · Brand & themes](docs/upgrade-reports/PHASE2_REPORT.md) ·
  [3 · Storefront](docs/upgrade-reports/PHASE3_REPORT.md) ·
  [4 · Manager's Office](docs/upgrade-reports/PHASE4_REPORT.md) ·
  [5 · AI staff](docs/upgrade-reports/PHASE5_REPORT.md)
- [docs/SECURITY.md](docs/SECURITY.md) — Phase 1 security model: key
  separation + rotation, admin/TOTP/step-up, payment integrity,
  backups, monitoring, known limits
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
