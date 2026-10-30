# Phase 3 Report — Customer Library & Products (Features 1–8)

Date: 2026-10-30 · Codebase: `~/workspace/astralium-v2` · **Not pushed, not deployed** (per task instruction).

## Gate results (all green)

| Gate | Result |
|---|---|
| `npm test` | **100 tests, 100 pass, 0 fail** (baseline 69 → +31 new/updated) |
| `npx tsc --noEmit` | clean (0 errors) |
| `npm run build` | passes; all Phase-3 routes present in the route table |
| `node scripts/check-i18n.mjs` | 141 checked keys; **en 141 native / ar 141 native / 0 unresolved in all 40 locales** |
| `npm run verify:phase1` | not runnable here: requires `PHASE1_DATABASE_URL` (a live Postgres) which is not configured in this environment — same limitation as before Phase 3, unrelated to these changes |
| lint / test:e2e scripts | do not exist in `package.json` (unchanged from baseline) — nothing invented |

Runtime smoke test (local `next start`, production build): preview fallback 200 HTML;
`GET /api/search?q=blueprnt` → p01 first; recommendations API returns affinity rail;
offers API 403 with flag off; wishlist-alerts POST 403 with flag off; job endpoint 503
without cron secret; admin bundles API 401 unauthenticated; library POST returns a fresh
signed download URL; review POST → `status:"pending", verification:"unavailable"`, and the
review does **not** appear in the public GET afterwards. Smoke data was cleaned up.

## Per-feature table

| # | Feature | Implemented where | Flag (default) | Test evidence |
|---|---|---|---|---|
| 1 | **My Library** | Storefront: `LibrarySection` on the account page. API: `POST /api/library`. Lib: `src/lib/library.ts`, `src/lib/versions.ts`. DB: `ProductVersion` model + migration `20261030170000_phase3_library_products`. Admin: VersionsPublisher panel + `/api/admin/versions` | `library` **ON** | `tests/phase3-library.test.mjs` (8 tests): publish repoints binding + pre-minted token still verifies; `versionAt`/`isNewerVersion`; entries built only from the caller's orders (two-customer fixture); updated marker; unpaid orders excluded; bundle contents flattened |
| 2 | **Free previews** | API: `GET /api/preview/[productId]` (302 presigned GET when storage configured + preview bound; HEAD size check → 413 over cap; else formatted fallback document). Storefront: product page player/reader block (`<audio>` for audio formats, `<iframe>` for docs, format-structure table). Lib: `src/lib/preview.ts` | `previews` **ON** | Same suite: size cap (over-cap + unknown length rejected, default 25 MB from `PREVIEW_MAX_MB`), fallback doc (escaping, honesty note), audio detection. Smoke: fallback served 200 |
| 3 | **Bundles + build-your-own** | DB: `Bundle` model + migration. Admin: BundlesManager + `/api/admin/bundles` (prices derived server-side, never client-typed). Storefront: homepage uses `storefrontBundles()` (stored bundles replace catalog ones when present); cart BYO widget; checkout route validates BYO server-side (15% on 3+ distinct products, itemized separately from coupons in Stripe metadata + API `pricing` breakdown). Lib: `src/lib/bundles.ts`, `src/lib/byo.ts` | `bundles` **ON** | `tests/phase3-bundles-offers.test.mjs`: 2 items → $0, 3 items → exactly 15%, duplicates counted once, bundle lines don't count; admin derived-price math; stored-bundle persistence + storefront resolution via `.data` fallback |
| 4 | **Order bump + upsell** | Config: Setting JSON key `product_offers` (DB) / `.data/offers.json`. Admin: OffersManager + `/api/admin/offers`. Storefront: checkout bump checkboxes (prices display-only; server re-derives via `resolveBumps`), success page `UpsellOffer` (max one) → `POST /api/upsell` creates a **new** Stripe session (never re-charges). Lib: `src/lib/offers.ts` | `order_bump` **OFF** (money) | Same suite: bump price math, unconfigured/already-in-cart rejection, upsell params (discounted unit amount, `metadata[upsell_of]`, `…-UPSELL` reference), flag default off. Smoke: `/api/offers` 403 while off |
| 5 | **Recommendations** | Lib: `src/lib/recommendations.ts` (co-purchase scoring from order-item id lists only; category-affinity + top-rated fallback; viewed slugs resolved client-side). API: `GET /api/recommendations`. Storefront: rails on product page + cart; view history in `localStorage` (`RecordView`) | `recommendations` **ON** | `tests/phase3-reco-search.test.mjs`: fixture-basket ordering + `also_bought` reason/count, fallback reasons, viewed-slug affinity, `basketsFromOrders` carries ids only (no `@` in serialized baskets) |
| 6 | **Smart search** | Lib: `src/lib/search.ts` (normalization, tokenization, bounded edit-distance typo tolerance over title/subtitle/description), `src/lib/search-db.ts` (pg_trgm `similarity()` + ILIKE when DB configured; migration adds `pg_trgm` + GIN index). API: `GET /api/search`. Storefront: CatalogClient ranked search, debounced suggestions dropdown, **language filter** + existing rating/format/price filters wired to data; `Product.language` added (default `en`; `french-for-travelers` = `fr`) | `smart_search` **ON** | Same suite: `blueprnt` → Blueprint first; title-hit ranking (python → p12); language filter returns only p08; category/rating/price filters; suggestions |
| 7 | **Reviews** | DB: `Review` model + migration (email stored as SHA-256 hash only). API: `GET/POST /api/reviews`; admin moderation `/api/admin/reviews` + ReviewsModeration panel. Storefront: product-page ReviewsSection (aggregate stars, approved list, submit form) + approved-only Review/AggregateRating JSON-LD rendered from the same API payload. Lib: `src/lib/reviews.ts` | `reviews` **ON** | `tests/phase3-reviews.test.mjs` (4 tests): nothing auto-approves (even when verified); validation; submit→pending→approve flow; aggregate counts approved only; JSON-LD null with none approved, generic author, no email leakage. Smoke: POST pending + invisible until approved |
| 8 | **Wishlist extended** | Share links: `src/lib/share.ts` (pure, client-safe) + read-only `/[locale]/wishlist/shared` page. Alerts: `WishlistAlert` model (email AES-256-GCM via `pii.ts`, `priceAtSave` snapshot) + migration; registration `POST /api/wishlist/alerts` (explicit opt-in required); job `POST /api/jobs/wishlist-alerts` guarded by `x-cron-secret` = `PRICE_ALERT_CRON_SECRET`. Storefront: WishlistExtras on account page (share/copy + opt-in form). Lib: `src/lib/wishlist-alerts.ts` | `wishlist_alerts` **OFF** (email) | `tests/phase3-wishlist.test.mjs` (5 tests): share round-trip + junk-slug dropping + dedupe; drop fires only on strict decrease; opt-in required; stored row contains no plaintext email and decrypts correctly; job at current prices sends nothing; flag default off. Smoke: 403 while off, job 503 without secret, 401 wrong-secret path in route code |

## Flags registered (17 total; `src/lib/flags.ts`)

New in Phase 3: `library` ON, `previews` ON, `bundles` ON, `recommendations` ON,
`smart_search` ON, `reviews` ON, `order_bump` OFF, `wishlist_alerts` OFF — each with a
description and an admin label (en + ar native). `tests/flags.test.mjs` updated for the
17-flag registry and the new default-on set.

## Schema & env changes

- Migration `prisma/migrations/20261030170000_phase3_library_products/migration.sql`
  (additive only): `pg_trgm` extension + trigram GIN index on `Product.title`;
  new tables `ProductVersion`, `Bundle`, `Review`, `WishlistAlert` with indexes/FKs.
  Existing migrations untouched.
- `.env.example`: added `PREVIEW_MAX_MB` (default 25) and `PRICE_ALERT_CRON_SECRET`,
  both documented, no real values.
- Prisma client regenerated. Note: in this sandbox `prisma generate` needed the
  local-engine env workaround (`PRISMA_QUERY_ENGINE_LIBRARY` pointing at the already
  installed engine binary) because the binary CDN connection kept resetting — the
  schema/migration themselves are standard and need nothing special elsewhere.

## Honest limitations / not live-tested

- **No live Postgres in this environment**: every DB branch (DB orders for the library,
  trigram search, DB review verification, DB bundle/version/alert stores, buyer-email
  collection on version publish) is implemented against Prisma and typechecks, but was
  exercised end-to-end only through the `.data` fallbacks + unit tests. With no DB,
  version-publish honestly reports `no-db-no-buyer-list` and review verification
  reports `unavailable` (admin approval still required — nothing auto-approves).
- **No live S3**: the preview 302 presigned path and HEAD size check run only when
  storage is configured; locally the formatted fallback document was verified instead.
- **No live Stripe keys**: the upsell session is unit-tested at the params level and
  returns an honest `503 PAYMENTS_NOT_CONFIGURED` without keys; bump pricing is
  validated in the checkout route server-side but a full paid bump purchase was not
  run live. PayPal checkout totals include BYO/bump amounts via the shared `total`.
- **Price-drop emails** are sent through the Phase-2 email service (honest log when
  Resend is unset); a real drop email was not sent live. Scheduling the job is the
  owner's cron of choice calling the endpoint with the secret header.
- The product page's static JSON-LD keeps the catalog aggregate (as before); the
  **DB-review** JSON-LD (approved only) is rendered by the ReviewsSection from live
  API data, so the two never double-count the same reviews in one block.
- View-history recommendations use on-device slugs only; nothing is uploaded.
