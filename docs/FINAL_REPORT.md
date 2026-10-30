# Final Report — Clean-Room Verification & Delivery Packaging

Date: 2026-10-30 · Scope: the FINAL stage of the six-phase expansion —
clean-room verification of `astralium-v2`, a new e2e smoke gate,
`docs/FEATURES_TABLE.md`, a README/.env.example refresh, and the delivery
ZIP. Nothing was pushed to GitHub and nothing was deployed.

## 1. Clean-room run

The project was copied to a fresh folder excluding `node_modules`,
`.next`, `.data` and `.git`; the copy's file list was diffed against the
source tree and was **identical (298 files at copy time)**.

**Environment deviation, stated plainly:** the requested `/tmp` location
is a 512 MB tmpfs in this sandbox and physically cannot hold this
project's `node_modules` (~1 GB). The first `npm ci` attempt there failed
with `ENOSPC: no space left on device` during extraction, and its
`postinstall` (`prisma generate`) additionally failed with `ECONNRESET`
downloading Prisma engines from `binaries.prisma.sh` — the same sandbox
CDN reset documented in the Phase 1/3/5/6 reports. The clean room was
therefore run at `~/workspace/astralium-cleanroom` (same disk as the main
tree, otherwise identical conditions).

In the relocated clean room, `npm ci` was run with the documented
local-engine workaround from the phase reports
(`PRISMA_QUERY_ENGINE_LIBRARY` + `PRISMA_SCHEMA_ENGINE_BINARY` pointing
at the Prisma 6.19.3 engines already vendored in the main tree):

```
npm ci → added 92 packages in 52s
postinstall: ✔ Generated Prisma Client (v6.19.3) to ./node_modules/@prisma/client
```

### Gates in the clean room (real outputs)

| Gate | Result |
|---|---|
| `npm ci` | **Pass** (with the documented engine env workaround; see above for the two sandbox failure modes of the plain attempt) |
| lint | **Does not exist** — `package.json` has never had a lint script (unchanged from every phase baseline); nothing was invented to fill the slot |
| `npx tsc --noEmit` (typecheck) | **Pass** (exit 0, no output) |
| `npm test` | **254 tests, 254 pass, 0 fail** |
| `node scripts/check-i18n.mjs` | **Exit 0** — 392 keys × 40 locales; en 392/392 native, ar 392/392 native, 0 unresolved anywhere (other locales resolve via the English fallback, counted openly by the script) |
| `npm run build` | **Pass** — full route table built (all Phase 1–6 routes present) |
| `npm run test:e2e` (new, see §2) | **15/15 checks passed** |

## 2. New e2e smoke gate

`scripts/e2e-smoke.mjs` + the `test:e2e` npm script were created (the
repo previously had no e2e gate — the phase reports said so honestly).
It boots the production build (`next start`) on a test port with a
scrubbed environment (defaults exercised; one throwaway `ADMIN_PASSWORD`
is set for the local boot only, since the admin is fully disabled
without one) and asserts over HTTP:

home EN 200 + brand marker · home AR 200 + `lang="ar"`/`dir="rtl"` ·
shop 200 with catalog product · product page 200 with title ·
`/api/search?q=blueprnt` typo-tolerant with the Blueprint first ·
`sitemap.xml` 200 with product URLs · `robots.txt` 200 ·
`manifest.webmanifest` 200 with the store name · flag-OFF endpoint
`/api/offers` → 403 `FEATURE_DISABLED` · admin API unauthenticated → 401 ·
admin dashboard unauthenticated → redirect-to-login with **no dashboard
content served** · admin login page 200 with the password form ·
privacy center 200. **Result: 15/15 in the clean room.**

Two findings from authoring it, recorded honestly:

- Next.js App Router delivers a server-component `redirect()` inside
  the streamed RSC payload (`NEXT_REDIRECT;replace;/en/control-astralium/login;307;`)
  with an HTTP 200 shell, not as an HTTP 3xx. The check therefore asserts
  the redirect instruction is present **and** that zero dashboard HTML
  leaks — the guard itself works; only its wire shape differs.
- The first version spawned the server through `npx`, whose wrapper
  orphaned the real server on kill and let a stale server answer the
  next run. The script now spawns the Next binary directly and refuses
  to run if the test port is already serving.

The script and the `package.json` change were also applied to the real
tree, where the quick gates were re-run: `npm test` **254/254**,
`check-i18n` **exit 0**.

## 3. Features table

`docs/FEATURES_TABLE.md` — Part A (email + WhatsApp/Messenger/Instagram
delivery) and features 1–30, one row each: implemented?, where it lives
(storefront route / admin section / API), flag + default, proving test
file(s), and live-tested status with the reason wherever the answer is
no (in every such case: an owner-only production account or key does not
exist yet). Built strictly from the six phase reports.

## 4. Documentation refresh

- **README.md** rewritten: architecture (hybrid file-catalog + optional
  Prisma layer, S3 SigV4 adapter, delivery orchestrator, flags),
  setup steps (incl. `prisma migrate deploy` + `sync-catalog`), the
  quality gates, a **full env-var table** (every variable, what it
  activates, what happens when unset), the **flag registry with
  defaults** (16 ON / 19 OFF of 35), deployment notes for **Vercel**
  (incl. the Hobby 100-deployments/day caveat) and **Netlify**
  (ephemeral `.data/` caveat + external scheduler for `/api/jobs/*`),
  and links to the phase reports, FEATURES_TABLE, ADMIN_GUIDE and
  META_WHATSAPP_SETUP.
- **`.env.example` audited against the code**: all `process.env.*` reads
  in `src/`, `scripts/`, `tests/` and `prisma/` were grepped (51
  distinct names). Every one is now covered: 48 assignable variables
  documented with a source note (5 added by this audit —
  `DELIVERY_RETRY_BACKOFF_MS`, `PHASE1_DATABASE_URL`, `PHASE1_BASE_URL`,
  `E2E_PORT`, `E2E_TIMEOUT_MS`), the dynamic `FLAG_<KEY>` bootstrap
  pattern documented as a note, and `NODE_ENV`/`NEXT_RUNTIME` documented
  as platform-set (never to be set manually). No real values anywhere —
  the only env file in the tree is `.env.example`.

## 5. Delivery ZIP

`~/workspace/astralium-digitale-store-final.zip`, built from the real
tree excluding `node_modules`, `.next`, `.data`, `.git` and the
generated `tsconfig.tsbuildinfo`. A pre-packaging scan found no real
`.env` files and no secret patterns (live/test Stripe keys, private
keys, AWS key IDs) anywhere in the shipped tree.

Verification: the ZIP was unzipped into a fresh folder — top level
correct, `package.json`, `prisma/schema.prisma` + all 7 migrations and
the full `docs/` set (including this report and FEATURES_TABLE.md)
present, and the ZIP's file count matches the source tree exactly
(300 files). The SHA-256 checksum and exact byte size are delivered
alongside the ZIP in the delivery message (a file cannot contain the
hash of an archive that contains itself).

## 6. Remaining owner-only production inputs

Nothing below can be supplied by anyone but the store owner; every
feature degrades honestly until its input exists:

1. **Hosted PostgreSQL** — `DATABASE_URL` (Neon/Supabase/Railway/…),
   then `npx prisma migrate deploy` + `npm run sync-catalog` once.
2. **S3/R2 storage** — a private bucket + `S3_BUCKET`, `S3_REGION`,
   `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (and `S3_ENDPOINT` for
   non-AWS), then upload each product's real file in Admin → Product
   files. Also still outstanding: the **real product files** themselves
   (the catalog is starter/demo data — see the Phase-1–6 honesty notes).
3. **Stripe** — `STRIPE_SECRET_KEY`,
   `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`
   (enables real checkout, express pay, subscriptions).
4. **PayPal** — `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`,
   `PAYPAL_WEBHOOK_ID`.
5. **Resend** — `RESEND_API_KEY` + a verified `EMAIL_FROM` (receipts,
   delivery emails, automation, privacy-request links).
6. **Admin + signing** — a self-chosen `ADMIN_PASSWORD` and a long
   random `DOWNLOAD_SIGNING_SECRET`; `PII_ENCRYPTION_KEY` for encrypted
   phone/email storage.
7. **Meta / WhatsApp Business** — a Meta app + WhatsApp Business
   number, Page and Instagram professional account with the tokens in
   `.env.example`, and the `astralium_delivery` template approved in
   Business Suite (steps: `docs/META_WHATSAPP_SETUP.md`).
8. **Optional Phase-6 keys** — `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`
   (owner alerts), `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`
   (Web Push, `npx web-push generate-vapid-keys`), `OPENAI_API_KEY`
   (LLM support path), `ANALYTICS_SALT`.
9. **A scheduler** for the `/api/jobs/*` endpoints (gifts, dunning,
   price alerts, digests, retention cleanup) sending the `x-cron-secret`
   header (`CRON_SECRET` / `PRICE_ALERT_CRON_SECRET`).
