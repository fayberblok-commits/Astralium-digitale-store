# Phase 1 Report — Delivery Foundation (Postgres + S3 + Feature Flags)

Date: 2026-10-30 · Scope: Phase 1 of the six-phase expansion (foundation +
core delivery path only). Nothing was pushed to GitHub or deployed.

## What was built

### 1. Prisma + PostgreSQL layer
- `prisma/schema.prisma` — models: **Product** (id, slug @unique, title,
  priceUSD, fileKey?, previewKey?, version default "1.0.0", active),
  **Order** (providerRef @unique), **OrderItem**, **DeliveryAttempt**
  (idempotencyKey @unique, errorCode only — no message bodies),
  **Setting** (key @id, Json value), **FeatureFlag** (key @id, enabled,
  config Json?), **DownloadGrant** (tokenHash @unique — raw tokens never
  stored), **ConsentRecord** (subjectHash — raw PII never stored).
- Initial migration committed: `prisma/migrations/20261030130000_init/`
  (generated with `prisma migrate diff --from-empty`, 148 lines of SQL) +
  `migration_lock.toml`. Client generated (`postinstall: prisma generate`
  added to package.json).
- `src/lib/db.ts` — lazy singleton client; `isDbConfigured()` from
  DATABASE_URL; **every DB call no-ops/falls back when unset**, so the
  store builds and runs with zero env exactly as before.
- `scripts/sync-catalog-to-db.mjs` (`npm run sync-catalog`) — upserts the
  12 file-catalog products into Product; never overwrites fileKey/version.
- `src/lib/env.ts` + `src/instrumentation.ts` — startup validation of
  present keys (DATABASE_URL scheme, S3 group completeness, URL formats,
  Stripe/admin/signing format warnings) with a one-screen feature summary
  in the server log. It logs; it never throws.

### 2. S3 storage adapter (zero new dependencies)
- `src/services/storage.ts` — hand-rolled AWS SigV4 with node:crypto:
  `presignPut`, `presignGet`, signed `headObject`, plus exported pure
  helpers (`deriveSigningKey`, `buildPresignedUrl`, `buildSignedHeaders`,
  `resolveTarget`) for testing. AWS virtual-host style, endpoint
  virtual-host (R2), and path-style (`S3_FORCE_PATH_STYLE=1`, MinIO).
  Keys namespaced `products/<id>/<file>` and `previews/<id>/<file>`.

### 3. Admin product-file management
- `POST /api/admin/files/presign` — session-gated; validates the product
  exists in the catalog, sanitises the filename (`src/lib/uploads.ts`),
  enforces the extension allowlist (pdf, zip, mp3, mp4, epub, mobi, png,
  jpg, wav, flac) and the 5 GB declared-size cap; returns a 1-hour
  presigned PUT — or `503 STORAGE_NOT_CONFIGURED`.
- `POST /api/admin/files/confirm` — verifies the object exists
  (signed HEAD), rejects keys outside the product namespace, then
  persists the binding: DB `Product.fileKey`/`previewKey` when a DB is
  configured (409 with a sync hint if the row is missing), else the
  documented local-dev JSON store `.data/file-bindings.json`.
- `GET /api/admin/files?productId=` — binding + configuration status.
- Admin UI: "Product files" section on the existing dashboard (existing
  design classes only) listing all 12 products with binding status, kind
  selector, version field, and a browser-side presign → PUT → confirm
  flow. Clear storage-off / DB-off notices.
- i18n: 32 new keys added **natively to English and Arabic**;
  `scripts/check-i18n.mjs` verifies resolution across all 40 locales and
  reports fallback counts (see results below).

### 4. Download path upgrade
- `/api/download/[token]`: after HMAC verification, resolves the binding
  (DB → .data store → catalog). Bound file + storage configured →
  **302 to a 15-minute presigned GET**; otherwise the previous generated
  licensed deliverable. Token expiry/cap semantics unchanged.

### 5. Feature flags foundation
- `src/lib/flags.ts` — typed registry: `delivery_email` **on** by
  default; `delivery_whatsapp`, `delivery_messenger`,
  `delivery_instagram`, `social_proof`, `ai_support_v2`, `subscriptions`,
  `loyalty`, `referrals` **off**. `getFlag()` reads the FeatureFlag table
  when a DB exists, else defaults (and survives DB errors).
  `GET/POST /api/admin/flags` (session-gated) + dashboard "Feature flags"
  section. Without a DB, toggles return `persisted:false` and the UI
  states they are session previews — nothing pretends to be saved.

## Verification — what was actually run

Local stack (all outside the shipped app): MinIO
RELEASE.2025-09-07T16-13-09Z on :9000, PostgreSQL 18.4 (binaries from the
`embedded-postgres` package, installed at `~/workspace/tools/pgtest`) on
:55432, and `next start` on :3101 with DATABASE_URL + S3_* +
ADMIN_PASSWORD + DOWNLOAD_SIGNING_SECRET set.

`node scripts/verify-phase1.mjs` — **all 10 legs passed**:

```
✓ prisma db push
✓ catalog sync (12 products) — [sync-catalog] upserted 12 products
✓ CreateBucket (or already exists) — HTTP 200
✓ admin login — HTTP 200
✓ presign upload URL — HTTP 200, key=products/p01/phase1-test.pdf
✓ PUT file to S3/MinIO — HTTP 200
✓ confirm binding (persisted in DB) — HTTP 200, persisted=db
✓ feature flags from DB (email on, whatsapp off) — dbConfigured=true
✓ download route 302 → presigned S3 URL — HTTP 302
✓ downloaded bytes identical to uploaded file — HTTP 200, 80 bytes
PHASE-1 VERIFICATION: ALL LEGS PASSED
```

Zero-env regression smoke (second server, empty environment):
home 200; `GET /api/admin/flags` unauthenticated → 401; download with a
valid token → 200 with the generated licensed deliverable; startup env
summary correctly shows every integration off.

Gates (final code):
- `npm run build` — **pass** (new routes in the table:
  /api/admin/files, /api/admin/files/presign, /api/admin/flags)
- `npm test` — **37/37 pass** (17 pre-existing + 20 new: SigV4 structure
  with independently recomputed signatures, path/virtual-host targets,
  mocked-fetch HEAD 200/404/throw, flag defaults + honest no-DB
  persistence, env validation, filename policy)
- `npx tsc --noEmit` — **pass** (one tsconfig addition:
  `allowImportingTsExtensions`, needed so Node's test loader can import
  the TS libs directly)
- `node scripts/check-i18n.mjs` — **exit 0**: en 32/32 native, ar 32/32
  native, all 40 locales resolve all 32 new keys; the other 37 locales
  currently serve the new *admin* keys via the English fallback
  (admin-only surface; owner-reviewed translations still to come —
  counted in the script output, not hidden).

## Sandbox quirks encountered (environment, not product)

- `dl.min.io` now returns **410 Gone** (MinIO archived its community
  binaries); the identical release binary was fetched from the project's
  official GitHub releases into `~/workspace/tools/minio/`.
- This sandbox's network resets Node-fetch downloads from
  binaries.prisma.sh (ECONNRESET); the two engine binaries were fetched
  with curl and supplied via `PRISMA_QUERY_ENGINE_LIBRARY` /
  `PRISMA_SCHEMA_ENGINE_BINARY`. On a normal network, `npm ci` +
  the new `postinstall: prisma generate` handles this automatically.
- The `embedded-postgres` orchestration wrapper cannot run in this
  sandbox (root-only home dir blocks its daemon user; sandbox wipes
  /tmp). Its **bundled PostgreSQL 18.4 binaries** were therefore driven
  directly (`initdb`/`pg_ctl` as a dedicated OS user, data under
  /dev/shm) — the database itself is the real thing, fully exercised by
  Prisma; only the wrapper's process management was bypassed.
- No leg of the verification was mock-only: Postgres, S3 (MinIO), HTTP
  APIs and byte-level download comparison all ran live locally. Mocks
  were used only inside unit tests (mocked fetch for headObject error
  paths), as designed.

## What the owner must supply for production

1. **Hosted PostgreSQL** — create a database (Neon / Supabase / Railway /
   self-hosted), set `DATABASE_URL` in Vercel, run `npx prisma migrate
   deploy` (or `db push`) and `npm run sync-catalog` once.
2. **S3/R2 bucket + keys** — a **private** bucket (AWS S3 or Cloudflare
   R2), then set `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`,
   `S3_SECRET_ACCESS_KEY`, and for non-AWS `S3_ENDPOINT` (+
   `S3_FORCE_PATH_STYLE=1` for MinIO). All keys are documented with
   sources in `.env.example` and left empty.
3. Then upload each product's real file in Admin → Product files; buyers'
   download links will serve those files via 15-minute presigned URLs.

Not in Phase 1 (later phases, per plan): WhatsApp/Messenger/Instagram
delivery channels, webhooks recording DeliveryAttempts/DownloadGrants at
checkout time, and features 1–30. The schema and flag registry already
anticipate them.
