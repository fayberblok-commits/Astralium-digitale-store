# Astralium Digitale Store — Phase 1 Upgrade Report: Security Hardening + Foundations F1/F2

**Scope executed:** foundations F1 (order ledger) and F2 (database as source of truth), security sections §1–§14, and the lint/typecheck pipeline. **Nothing was pushed to GitHub and nothing was deployed** — all work is in the local tree `~/workspace/astralium-v2`, per instructions (and the owner's standing rule that upgrade work is not published until he approves).

**Verification stack used live:** PostgreSQL 18.4 on :55432 (isolated database `astralium_p7`, created and migrated by the verify script), MinIO on :9002 (script-owned instance + bucket), production build (`next start`) on :3101. Verify script: `npm run verify:security` (`scripts/verify-phase1-security.mjs`) — **25/25 live legs PASS** (listed under "Live evidence" below).

---

## Final gate (verbatim outputs, run 2026-10-31 after the last code change)

```
$ npm run lint        → LINT_EXIT=0        (eslint . — 0 errors, 0 warnings)
$ npm run typecheck   → TYPECHECK_EXIT=0   (tsc --noEmit)
$ npm test            → ℹ tests 275 · ℹ pass 275 · ℹ fail 0
$ npm run build       → BUILD_EXIT=0       (✓ Compiled successfully)
$ npm run test:e2e    → E2E SMOKE: 15/15 checks passed
```

Test count grew from the 254 baseline to **275**: +15 penetration tests (`tests/security-pentest.test.mjs`), +6 Phase-1 unit tests (`tests/phase7-security.test.mjs`); the pre-existing 254 all still pass, including updated Phase-6 team tests covering the new session format. Baseline before the phase: tests 254/254, typecheck clean, build OK, e2e 15/15 — nothing regressed.

Migration: `prisma/migrations/20261031010000_phase7_security_catalog_orders/` (Product editorial fields, Order indexes, SecurityLog table) — applied to local databases with `migrate deploy` (the pre-existing local DB needed a one-time baseline because earlier phases had used `db push`; production instructions in `docs/SECURITY.md` mandate `migrate deploy` from the start).

---

## F1 — Order ledger (DONE, live-proven)

**What:** `src/lib/orders.ts` — real order persistence, dual-mode (Prisma when `DATABASE_URL` is set, `.data/orders.json` file ledger otherwise), following the repo's adapter pattern.

- Checkout (Stripe + PayPal) creates a **PENDING** order (items, totals, currency, buyer email, provider + session/order id) after provider session creation; a ledger failure never breaks checkout.
- Webhook fulfilment transitions the order and creates **DownloadGrants** (token plaintext returned once; only the SHA-256 hash is stored; grants are counted and revocable).
- State machine in one place: `pending → paid → fulfilled`; `pending → failed`; `paid|fulfilled → refunded|disputed`; `disputed → refunded` (+ `disputed → paid` exists only as the owner-confirmed restore edge). **PAID is reachable only from PENDING**, via `markPaidAndGrant` — the only function that issues grants. REFUNDED/FAILED are terminal.
- Idempotency anchor: `Order.providerRef` is `@unique` (the provider session/order id); webhook replays create no duplicate orders or grants.

**Proof:** pentest "state resurrection" test (replay → duplicate/no new grants; refund → grant revoked; late PAID attempt → `TERMINAL_STATE` refusal); live legs L5 (signed `checkout.session.completed` → order `paid` + 1 grant row), L10 (replay → still 1 grant), L7/L7b (refund → revoked; resurrection refused).

## F2 — Database as source of truth (DONE, live-proven)

**What:** `src/lib/catalog.ts` — the storefront resolver used by home, shop, product, search and sitemap.

- When `DATABASE_URL` is set **and reachable** (1.5 s probe, cached), products are read from the DB; `src/data/products.ts` is now bootstrap seed + fallback only. If the DB is set but unreachable, a loud `console.error` warning is logged and the seed serves — the zero-env run and the live site (whose `DATABASE_URL` is still a placeholder) can never break.
- Merge rule: commercial fields (title, price, slug, active, fileKey) are always authoritative from the DB; editorial fields fall back **per field** to the seed for unpopulated legacy rows; bootstrap heals legacy rows by writing seed editorial fields into the DB (never touching title/price/fileKey). New Prisma columns carry the editorial fields (migration above).
- Admin edits: `GET/PATCH /api/admin/products` (zod-validated, audit-logged) writes the DB (or the `.data` overlay in file mode) and invalidates the resolver cache — edits reflect on the storefront with no file change and no redeploy.

**Proof:** unit test "catalog merge" (DB commercial wins, per-field editorial fallback, round-trip); live legs L2 (bootstrap wrote 12 products into the DB), **L3 (title changed only via SQL → product page renders it)**, **L4 (admin PATCH → storefront shows it immediately)**.

---

## §1 — Rate limiting & trusted client IP (DONE)

- `src/lib/http.ts::getClientIp()` is the single IP source for every route. It reads only a configured trusted header (`TRUSTED_PROXY_HEADER`) or the platform default chain (`x-vercel-forwarded-for`, `x-real-ip`); **raw `x-forwarded-for` is never trusted** (spoofable) — all raw reads in routes were eliminated (grep-verified: none remain outside `http.ts`).
- `src/lib/ratelimit.ts`: named sliding-window limiters (admin login per-IP 20/10 min **and per-account 8/15 min**, email flows 5/h, newsletter 10/h per IP, coupons 30/10 min, receipts 30/10 min, delivery-email 10/h, reviews 10/h, support 30/10 min, public posts 60/10 min) wired into the login, newsletter, privacy-request, coupon, receipt, delivery, reviews and support routes.
- The login **lockout is durable** (persisted security state, §13): 5 failures/15 min per account → 15 min lock, independent of IP and of restarts.

**Proof:** pentest "rate-limit bypass" (rotating spoofed XFF collapses to one budget; account lockout is IP-independent); live L16 (5 bad logins → correct password refused with 429).

*Remaining risk:* limiters are in-memory per process — on multi-instance hosting the effective budget multiplies by instance count. The durable account lockout does not have this flaw. A shared store (Redis/Upstash) is the documented next step (`docs/SECURITY.md`).

## §2 — Security headers (DONE)

- Middleware issues a **per-request nonce CSP**: `script-src 'self' 'nonce-…'` (+ `'unsafe-eval'` in dev only), `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, connect/frame sources limited to Stripe, PayPal, OpenAI, Resend, Turnstile and hCaptcha origins. The nonce is threaded to every inline script (theme script, JSON-LD blocks on layout/product/blog pages, reviews JSON-LD).
- `next.config.mjs` static headers: HSTS `max-age=63072000; includeSubDomains; preload`, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, COOP/CORP `same-origin`, `X-DNS-Prefetch-Control: off`.

**Proof:** live L1 (nonce CSP + `frame-ancestors 'none'` + HSTS + nosniff + referrer-policy on the production response).

*Remaining risk:* `style-src` still allows `'unsafe-inline'` — the storefront uses inline style attributes extensively; tightening it needs a styling refactor (documented, future work).

## §3 — Request protection (DONE)

- Middleware CSRF gate on every state-changing `/api` call: `Sec-Fetch-Site: cross-site` or an Origin ≠ Host → **403 `CSRF_REJECTED`** (webhooks and cron jobs exempt — they authenticate by signature/secret).
- **One unified body reader**: all 43 route handlers that previously used ad-hoc `req.json().catch(() => null)` now use `readJsonBody()` — invalid JSON is a **400** (never a 500), oversize bodies a **413**, with per-route byte caps. Zod validation added where inputs are security-relevant (admin products PATCH, newsletter; checkout/admin routes keep + extend their validators).
- Safe output encoding: `escapeHtml()` in `lib/http.ts`, used for HTML sinks; React's default escaping covers the UI.

**Proof:** pentest "CSRF", "malformed body" (400/413), "XSS" tests; live L11 (cross-site POST → 403).

## §4 — Auth & sessions (DONE)

- Sessions are `v3` tokens (httpOnly + Secure-in-production + SameSite=Lax cookies): payload `{sub, role, iat, exp, epoch, scope}`, **8 h absolute cap, idle timeout** (`ADMIN_SESSION_IDLE_MINUTES`, default 60), **rotation on login** (fresh token per sign-in), **terminate-all** via a persisted session epoch (`POST /api/admin/session/terminate-all`, settings permission + step-up).
- **Breaking change (documented):** the pre-upgrade fixed session token is rejected — everyone signs in once after deploy.
- **Mandatory TOTP:** team `owner`/`admin` roles must enrol (until then they hold a *setup-scope* session that can reach only self-service enrollment endpoints); the bootstrap owner must enrol when `ADMIN_TOTP_REQUIRED=1`. Codes are replay-guarded (last-step tracking); backup codes are single-use and stored hash-only. Disable/re-enrol require step-up.
- **Step-up re-auth** (`POST /api/admin/step-up`, password + TOTP → 5-minute actor-bound token) gates: team create/role-change/delete, TOTP disable, terminate-all — the pattern for financial actions (refunds/bank data) in later phases.
- Lockout as §1; login timing equalized (dummy scrypt on unknown team email) so account existence can't be probed by timing; password comparison is constant-time; **new-device sign-ins** (UA + IP-prefix fingerprint) raise a security event + owner alert (+ email to `ADMIN_ALERT_EMAIL` when an email provider exists).
- Admin UI: new **Security Center** panel (TOTP enrolment with one-time backup codes, step-up, terminate-all, locked accounts, event list) — strings via the i18n system (see "i18n" below).

**Proof:** pentest "session forgery" (legacy token + hand-made tokens rejected), "privilege escalation" (role-swapped payload rejected; setup scope stays setup), "step-up theft" (actor binding); updated Phase-6 team tests (legacy token rejected, idle-expired token rejected); live L4/L13/L16.

## §5 — Secrets & key management (DONE)

- `src/lib/keys.ts`: **HKDF-SHA-256 key separation** — purposes `download-token`, `claim-code`, `order-access` (root: `AUTH_SECRET` → `DOWNLOAD_SIGNING_SECRET`) and `admin-session`, `team-session`, `step-up` (root: `AUTH_SECRET` → `ADMIN_PASSWORD`). Artifacts carry `v2.`/`v3.` version prefixes; pre-upgrade tokens still verify (legacy fallbacks, dev-default only outside production) so in-flight customer links survive the deploy.
- **Weak-secret refusal** that never breaks boot: in production, `ADMIN_PASSWORD` < 12 chars disables admin login; a weak/missing download secret falls back to an ephemeral per-boot HKDF key (tokens work within the boot, unforgeable, die on restart) with a startup ERROR log. `src/lib/env.ts` validation is now **zod-based** for the security variables and escalates weak secrets to errors in production.
- Rotation procedure (incl. `KEY_VERSION` bump for a full break-glass) documented in `docs/SECURITY.md`.

**Proof:** unit tests "HKDF separation" (cross-purpose signatures never verify), "weak-secret detection" (incl. zero-entropy strings), "env validation escalation"; pentest download/claim tamper tests exercise the derived keys end-to-end.

## §6 — Admin path (DONE)

- `ADMIN_PATH` env var renames the admin segment (slug-validated; middleware rewrites it to the real route and 404s the default segment when customized). The path was **removed from `robots.ts`** (it was there before), is absent from the sitemap, and all admin pages carry `noindex, nofollow` metadata + `X-Robots-Tag`. Protection is auth, not obscurity — stated in `docs/SECURITY.md`.

**Proof:** e2e smoke still passes with the default path (admin → login redirect, no dashboard content); code-level verification of robots/sitemap contents.

## §7 — Data leaks (DONE)

- Success page shows the buyer email **masked** (`maskEmail`).
- Receipts bound to the buyer: full PDF requires either a server-verified Stripe session or the **short-lived order-access cookie** (HMAC bound to one order, 1 h) minted by `POST /api/orders/access` only after server-side session verification; the receipt route is rate-limited.
- **Found and fixed during live verification:** the receipt POST path trusted a client-supplied `localOrder` claiming `status:"paid"` — a receipt-forgery vector. It now resolves the order from the F1 ledger and builds the PDF from ledger data only; client claims are ignored.
- No state changes via GET in any new/changed path.

**Proof:** pentest "IDOR" (order-A cookie doesn't open order B); live L12a (forged "paid" claim for a refunded order → 403) and L12b (receipt GET without cookie/session → 403). *Note:* the PDF names the buyer — it is their invoice; what changed is that it is no longer fetchable by anyone holding only a session id.

## §8 — Payment integrity (DONE; disputes not live-testable — see below)

- PAID only from PENDING (§F1 state machine) — a refunded order can never return to PAID (proven live, L7b).
- **Stripe disputes**: `charge.dispute.created` → order `disputed` + grants revoked + owner alert; `charge.dispute.closed` won → grants stay revoked for an owner decision; lost → refund transition. `charge.refunded` reconciles via the payment-intent→order link recorded at completion. `checkout.session.expired`/`async_payment_failed` close PENDING orders as failed.
- **Missed-refund recovery**: `POST /api/jobs/reconcile-orders` (cron-secret gated) sweeps orders against Stripe with a pure, unit-tested decision function and applies refunds the webhook missed.
- **PayPal webhook rewritten**: the previous accept-anything skeleton is gone — events are verified through PayPal's `verify-webhook-signature` API (unverifiable → 400 + security event); `CHECKOUT.ORDER.APPROVED` captures server-side then fulfils; capture/refund/dispute events handled idempotently through the same ledger.
- **Stripe apiVersion pinned** to `2024-06-20` (`src/lib/stripe.ts`) and sent on every server-side Stripe call.
- Webhook signature verification extracted to `verifyStripeWebhookSignature` (constant-time compare, 5-minute timestamp window) — bad signatures are logged as security events.

**Proof:** pentest "webhook forgery + replay" and "state resurrection"; live L5/L7/L7b/L9/L10. **Not live-tested:** real Stripe disputes/chargebacks and all PayPal flows — no production (or sandbox) payment accounts exist; handlers are covered by unit tests with fixture-shaped events and follow the providers' documented payloads. This is the single largest untested-live area and is stated plainly.

## §9 — Files (DONE, live-proven)

- `src/lib/file-sniff.ts`: magic-byte verification for PDF, ZIP/EPUB/DOCX, MP3, MP4/M4A, PNG, JPEG, WAV, FLAC, MOBI and text. At admin upload-confirm, the object's first bytes (Range GET, new `getObjectHeadBytes`) must match the claimed extension and the real size (HEAD) must be within the 5 GB cap; a mismatch **deletes the object**, refuses the binding, and logs a security event. Existing protections kept: extension allowlist, filename sanitization, product-namespaced keys, private bucket, short-lived presigned URLs.

**Proof:** pentest "file forgery" (EXE/ZIP-as-PDF rejected, real PDF/ZIP accepted); live L15 (EXE bytes PUT as `evil.pdf` → confirm 422 `FILE_CONTENT_MISMATCH`, and the rejection appears in the audit log in L17).

## §10 — Bot protection (DONE, env-gated honestly)

- `src/lib/captcha.ts`: Turnstile **or** hCaptcha, server-side siteverify. Wired into newsletter and privacy-request (the magic-link flow); reviews accept a token too. With no keys configured it returns `{configured:false}` and routes proceed on rate limits alone, logging the fact once per process — **it never fake-passes**. With keys set, a missing/invalid token is a hard 403. Partial key groups warn at startup (§5 env validation).

**Proof:** pentest "captcha fake-pass" (unconfigured ≠ pass; configured rejects tokenless). **Not live-tested:** a real provider round-trip — no Turnstile/hCaptcha keys exist yet.

## §11 — Database (DONE, backup+restore proven)

- Migration adds the unique/idempotency anchors and indexes (`Order.providerRef` unique — pre-existing, now documented as the anchor; `Order(email)`, `Order(status, createdAt)` indexes; `DownloadGrant.tokenHash` unique). Least-privilege guidance (separate migration role, non-superuser runtime role, never `db push` in production) in `docs/SECURITY.md`.
- Cleanup job `POST /api/jobs/security-cleanup`: expired claim codes removed, security log pruned past 90 days, stale login guards dropped; orders/grants never deleted.
- **Encrypted backups**: `npm run backup:db` / `restore:db` — AES-256-GCM (scrypt-derived key from `BACKUP_ENCRYPTION_KEY`, ≥ 32 chars enforced), pg_dump engine when a binary exists, Prisma logical-export engine otherwise.
- **Proof (executed locally):** backup of the local DB (logical engine — this sandbox has no `pg_dump` binary) → junk product inserted (13 rows) → restore → junk gone, **row counts match the backup envelope exactly (34 tables)**; wrong-key restore is refused cleanly (GCM authentication). Live L18 proves the cleanup job's auth.

## §12 — Supply chain (DONE, one sandbox limitation)

- All 17 direct dependencies **pinned to exact versions** in `package.json` (lockfile regenerated consistently; suite green after pinning).
- Secret scanning: `npm run scan:secrets` (gitleaks-equivalent scripted scan) — **320 files scanned, 0 hits** (one precise, documented ignore: the intentionally public pre-upgrade dev constant, refused in production). CI workflow (`.github/workflows/ci.yml`) runs the full gate + `npm audit --audit-level=high` + gitleaks + the repo scan + Semgrep (TypeScript/OWASP/secrets); Dependabot config (`.github/dependabot.yml`) for weekly npm + Actions updates.
- **Limitation:** `npm audit` itself could not be executed in this sandbox — the registry endpoint is blocked by the environment's package-registry policy (`403 policy_denied`). The audit step is in CI, where the registry is reachable; no audit results are claimed here.

## §13 — Monitoring (DONE, live-proven)

- `src/lib/security-log.ts`: security audit log (DB `SecurityLog` table, or `.data/security-log.json` capped at 5000) recording failed logins, lockouts, denied admin access, CSRF rejections, bad webhook signatures, disputes, refunds, TOTP enrolment, step-up grants, session terminations and rejected uploads. **Sensitive data is never logged**: actors are masked + hashed in the file store, token values are never written.
- Alert-worthy events (lockout, new-device login, dispute, terminate-all) also land in the existing owner alert center immediately, and email `ADMIN_ALERT_EMAIL` when an email provider is configured.
- Admin UI: Security Center panel (§4).

**Proof:** live L17 — after the live run, `GET /api/admin/security` shows `webhook_bad_signature`, `order_refunded`, `admin_access_denied` and `upload_magic_rejected` events from the earlier legs.

## §14 — Automated penetration suite (DONE — every attack rejected)

`tests/security-pentest.test.mjs` — **15/15 attacks rejected**, plus 25 live legs (`scripts/verify-phase1-security.mjs`):

| Attack | Result |
|---|---|
| Download-link tamper / guessing (25 forged tokens) | rejected |
| Claim/ref-link order-swap tamper | rejected |
| IDOR: order-access cookie for order A → order B | rejected |
| Session forgery: pre-upgrade fixed token, hand-made tokens | rejected |
| Privilege escalation: role-swapped session payload; step-up token theft | rejected |
| Refunded → PAID resurrection; webhook replay double-grant | rejected |
| Webhook forgery (wrong secret, tampered body, stale timestamp) | rejected |
| Rate-limit bypass via rotating spoofed XFF; per-account lockout | rejected |
| CSRF: cross-site POST (Origin + Sec-Fetch) | rejected (module + live L11) |
| Malformed JSON → 400; oversize body → 413 | rejected |
| SQL injection strings in search | inert (0 hits, no dump) |
| XSS payloads through escaping helpers | neutralized |
| Captcha fake-pass (unconfigured) | never claims a pass |
| File forgery (EXE/ZIP as PDF) | rejected (module + live L15) |
| Receipt forgery (client-claimed "paid") | rejected (live L12a) |
| Admin API without session | 401 (live L13) |
| Account lockout bypass (correct password while locked) | 429 (live L16) |

## Pipeline (DONE)

ESLint 9 (Next core-web-vitals + TypeScript flat config) added with `lint` and `typecheck` scripts; the gate `npm run lint && npm run typecheck && npm test && npm run build && npm run test:e2e` now runs for real, all exit 0 (quoted above). `zod` added as a dependency for input/env validation.

## i18n (DONE, with one honest deviation)

20 new admin Security Center keys were added through the dictionary system with **native English and Arabic** translations, registered in `scripts/check-i18n.mjs`; the check passes: **412 keys × 40 locales, en/ar 412/412 native, 0 unresolved**. The other locales resolve the new keys via the project's documented per-key English fallback — the same model every previous phase used (fr/es/de carry core dictionaries; admin translation completion is an existing owner workflow in `docs/LIMITATIONS.md`). I did **not** fabricate machine translations for 35 locales: inventing unverified translations would violate the store's honesty standard, and the fallback keeps the admin fully usable in every locale meanwhile.

## Configuration added (all EMPTY in `.env.example`, zod-validated at startup)

`AUTH_SECRET`, `TRUSTED_PROXY_HEADER`, `ADMIN_PATH`, `ADMIN_TOTP_REQUIRED`, `ADMIN_SESSION_IDLE_MINUTES`, `ADMIN_ALERT_EMAIL`, `TURNSTILE_SECRET_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `HCAPTCHA_SECRET_KEY`, `NEXT_PUBLIC_HCAPTCHA_SITE_KEY`, `BACKUP_ENCRYPTION_KEY`. Zero-env boot remains a hard contract and is covered by the e2e smoke (default env) — env validation logs, never throws.

## Not live-tested (and why)

- **Real Stripe disputes/chargebacks, all PayPal flows** — no payment accounts exist; handlers unit-tested with fixture events, code follows documented payloads.
- **Turnstile/hCaptcha provider round-trip** — no keys exist; tokenless rejection and unconfigured honesty proven.
- **Resend email delivery** (incl. new-device alert emails) — no API key; alert-center delivery proven live, email path is the pre-existing service.
- **`pg_dump` backup engine** — no pg_dump binary exists in this sandbox; the logical engine was fully proven (backup → tamper → restore → counts match). The pg_dump branch is a thin spawn wrapper and is the production-preferred path when the binary exists.
- **Semgrep/gitleaks in CI** — workflow files are in place; they run on the first CI execution after a push (no push was made, per instructions).

## Remaining risks (no "unhackable" claims)

1. In-memory rate limiting multiplies across instances (§1) — durable lockout is unaffected; add a shared store when scaling out.
2. `style-src 'unsafe-inline'` remains in the CSP (§2).
3. Payment dispute/refund handlers await their first live exercise (§8) — enable them in a Stripe/PayPal sandbox before real money moves.
4. Legacy-token verification fallbacks (pre-upgrade download/claim links) should be retired in a later phase once old links age out; they are already refused for admin sessions and for the dev default in production.
5. File-mode (no-DB) operation keeps state in `.data/` JSON — fine for the current deployment shape; the DB mode is the recommended production posture and is now the storefront's source of truth whenever configured.

## Key files

- New: `src/lib/{keys,http,ratelimit,security-state,security-log,orders,catalog,order-access,reconcile,cleanup,captcha,file-sniff,stripe}.ts`, `src/components/{SecurityPanel,OrderAccess}.tsx`, `src/app/api/{orders/access,admin/step-up,admin/session,admin/security,admin/products,jobs/reconcile-orders,jobs/security-cleanup}/…`, `scripts/{backup-db,restore-db,scan-secrets,verify-phase1-security}.mjs`, `tests/{security-pentest,phase7-security}.test.mjs`, `docs/SECURITY.md`, `.github/workflows/ci.yml`, `.github/dependabot.yml`, `eslint.config.mjs`, Prisma migration `20261031010000_phase7_security_catalog_orders`.
- Changed (behavior): middleware (nonce CSP + CSRF + admin path), `next.config.mjs` headers, both webhook routes, checkout, download, receipt (incl. the forgery fix), success page (masked email), admin login/team/session handling, 43 route handlers unified on `readJsonBody`, storefront pages + search + sitemap on the catalog resolver, `robots.ts`, `.env.example`, `README.md`.
