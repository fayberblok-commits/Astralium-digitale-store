# Final Delivery — Astralium Digitale Store Five-Phase Upgrade

**What this document is.** The complete, per-item delivery status of the
five-phase upgrade (Phase 1 Security · Phase 2 Brand & Themes · Phase 3
Storefront · Phase 4 Manager's Office · Phase 5 AI Staff), built from the
five phase reports in [`docs/upgrade-reports/`](upgrade-reports/). For
every item: whether it is implemented, **how it was tested** (test names,
counts, live-verification legs), and **what was NOT live-tested and why**.
Nothing here is softened: every "not live-tested" note and every
remaining risk from the phase reports is carried forward verbatim in
substance.

**Publication status.** The upgrade was built and verified locally.
Publishing (GitHub push / Vercel deploy) happens only on the owner's
explicit approval.

## Final gate (clean room, fresh copy of the tree)

Run in a fresh copy (`~/workspace/astralium-final-check`, excluding
`node_modules`, `.next`, `.data`, `.git`), in this exact order:

| Step | Result |
|---|---|
| `npm ci` | **Pass with the documented sandbox workaround** — the plain attempt failed with `ECONNRESET` downloading Prisma engines from `binaries.prisma.sh` (this sandbox resets that CDN; a sandbox artifact, not a project defect). With `PRISMA_QUERY_ENGINE_LIBRARY` + `PRISMA_SCHEMA_ENGINE_BINARY` pointing at the Prisma 6.19.3 engines vendored in the main tree: exit 0 |
| `npm run lint` | **Pass** — exit 0 (0 errors, 0 warnings) |
| `npm run typecheck` | **Pass** — exit 0 |
| `npm test` | **Pass** — 338 tests, 338 pass, 0 fail |
| `npm run build` | **Pass** — exit 0 |
| `npm run test:e2e` | **Pass** — E2E SMOKE: 15/15 checks passed |

Per-phase gates on the final tree of each phase: Phase 1 — tests
275/275, live security verification 25/25 legs; Phase 2 — tests 284/284,
contrast 156/156 pairs; Phase 3 — tests 291/291; Phase 4 — tests
310/310, live office verification 41/41 legs (file mode) and 43/43 legs
(DB mode); Phase 5 — tests 338/338, live AI verification 30/30 legs.
i18n at delivery: **669 keys × 40 locales, en/ar 669/669 native,
0 unresolved**.

---

## Phase 1 — Security hardening + foundations

### F1 — Order ledger
- **Implemented?** Yes. `src/lib/orders.ts`, dual-mode (Prisma /
  `.data/orders.json`). Checkout creates a PENDING order; only
  `markPaidAndGrant` can reach PAID and issue DownloadGrants
  (hash-stored, revocable); `Order.providerRef` unique = webhook-replay
  idempotency anchor.
- **Tested how:** pentest "state resurrection" test; live legs in
  `scripts/verify-phase1-security.mjs` — L5 (signed webhook → paid +
  1 grant), L10 (replay → still 1 grant), L7/L7b (refund → revoked;
  resurrection refused).
- **Not live-tested:** — (ledger itself fully live-proven locally).

### F2 — Database as source of truth
- **Implemented?** Yes. `src/lib/catalog.ts` resolves home/shop/
  product/search/sitemap from the DB when `DATABASE_URL` is set and
  reachable; the file catalog is bootstrap seed + fallback only (loud
  warning if the DB is set but unreachable, so the zero-config run can
  never break). Admin product edits write the DB and invalidate the
  resolver cache.
- **Tested how:** unit test "catalog merge"; live legs L2 (bootstrap
  wrote 12 products), L3 (SQL-only title change renders), L4 (admin
  PATCH reflects immediately).

### §1 — Rate limiting & trusted client IP
- **Implemented?** Yes. Single `getClientIp()` (trusted platform header
  only; raw `x-forwarded-for` never trusted), named sliding-window
  limiters on all sensitive routes, durable per-account login lockout
  (5 failures/15 min → 15 min lock, persisted).
- **Tested how:** pentest "rate-limit bypass" (rotating spoofed XFF
  collapses to one budget); live L16 (correct password refused with
  429 while locked).
- **Remaining risk:** limiters are in-memory per process — on
  multi-instance hosting the effective budget multiplies by instance
  count. The durable account lockout does not have this flaw. A shared
  store (Redis/Upstash) is the documented next step.

### §2 — Security headers
- **Implemented?** Yes. Per-request nonce CSP, `frame-ancestors 'none'`,
  HSTS (preload), DENY framing, nosniff, Referrer-Policy,
  Permissions-Policy, COOP/CORP.
- **Tested how:** live L1 (headers on the production response).
- **Remaining risk:** `style-src` still allows `'unsafe-inline'` (the
  storefront uses inline style attributes extensively); tightening
  needs a styling refactor — documented future work.

### §3 — Request protection
- **Implemented?** Yes. Middleware CSRF gate (Origin/Sec-Fetch-Site) on
  state-changing `/api` calls; one unified `readJsonBody()` across all
  43 handlers (invalid JSON → 400, oversize → 413); zod validation on
  security-relevant inputs; `escapeHtml()` for HTML sinks.
- **Tested how:** pentest "CSRF", "malformed body", "XSS"; live L11
  (cross-site POST → 403).

### §4 — Auth & sessions
- **Implemented?** Yes. v3 session tokens (httpOnly/Secure/SameSite,
  8 h cap, idle timeout, rotation on login, terminate-all via epoch),
  mandatory TOTP for privileged roles with setup-scope sessions and
  hash-only single-use backup codes, step-up re-auth for sensitive
  actions, timing-equalized login, new-device alerts, Security Center
  panel. Breaking change: pre-upgrade fixed session tokens are
  rejected — everyone signs in once after deploy.
- **Tested how:** pentest "session forgery", "privilege escalation",
  "step-up theft"; Phase-6 team tests updated; live L4/L13/L16.

### §5 — Secrets & key management
- **Implemented?** Yes. HKDF-SHA-256 per-purpose key separation
  (`src/lib/keys.ts`), versioned artifacts, documented rotation
  procedure incl. `KEY_VERSION` break-glass, weak-secret refusal that
  never breaks boot, zod env validation.
- **Tested how:** unit tests "HKDF separation", "weak-secret
  detection", "env validation escalation".

### §6 — Admin path
- **Implemented?** Yes. `ADMIN_PATH` env renames the segment; removed
  from robots, absent from sitemap, `noindex` + `X-Robots-Tag` on all
  admin pages. Protection is auth, not obscurity.
- **Tested how:** e2e smoke (default path: redirect to login, no
  dashboard content); code-level robots/sitemap verification.

### §7 — Data leaks
- **Implemented?** Yes. Buyer email masked on the success page; receipt
  PDF bound to a server-verified session or a short-lived order-access
  cookie (1 h, one order); receipt route rate-limited. A forgery vector
  found during live verification (receipt POST trusting a
  client-claimed `status:"paid"`) was fixed — receipts now resolve from
  the ledger only.
- **Tested how:** pentest "IDOR"; live L12a (forged claim → 403), L12b
  (no cookie/session → 403).

### §8 — Payment integrity
- **Implemented?** Yes. PAID only from PENDING; Stripe dispute handlers
  (created → disputed + grants revoked + owner alert; closed won/lost
  handled); `charge.refunded` reconciliation; missed-refund sweep job
  (`/api/jobs/reconcile-orders`); PayPal webhook rewritten with real
  `verify-webhook-signature` verification; Stripe `apiVersion` pinned
  to `2024-06-20`; constant-time webhook signature verification with a
  5-minute window.
- **Tested how:** pentest "webhook forgery + replay", "state
  resurrection"; live L5/L7/L7b/L9/L10.
- **⚠ NOT LIVE-TESTED — the single largest untested-live area:** real
  Stripe disputes/chargebacks and **all PayPal flows**. No production
  or sandbox payment accounts exist. Handlers are unit-tested with
  fixture-shaped events and follow the providers' documented payloads.
  They must be exercised in a Stripe/PayPal sandbox before real money
  moves.

### §9 — File upload/download safety
- **Implemented?** Yes. Magic-byte verification at upload-confirm
  (mismatch deletes the object, refuses the binding, logs a security
  event), extension allowlist, filename sanitization,
  product-namespaced keys, private bucket, short-lived presigned URLs.
- **Tested how:** pentest "file forgery"; live L15 (EXE as `.pdf` →
  422 `FILE_CONTENT_MISMATCH`, audited in L17).

### §10 — Bot protection
- **Implemented?** Yes, env-gated. Turnstile or hCaptcha server-side
  verification on newsletter/privacy-request (magic-link) and reviews.
  With no keys it never fake-passes; routes proceed on rate limits
  alone and log the fact.
- **Tested how:** pentest "captcha fake-pass".
- **⚠ NOT LIVE-TESTED:** a real provider round-trip — no
  Turnstile/hCaptcha keys exist yet.

### §11 — Database hygiene & backups
- **Implemented?** Yes. Unique/idempotency anchors and indexes,
  least-privilege guidance in `docs/SECURITY.md`, cleanup job
  (`/api/jobs/security-cleanup`), encrypted backups
  (`npm run backup:db` / `restore:db`, AES-256-GCM).
- **Tested how:** executed locally — backup → junk row inserted →
  restore → junk gone, **row counts match the backup envelope exactly
  (34 tables)**; wrong-key restore refused (GCM). Live L18 (cleanup
  job auth).
- **⚠ NOT LIVE-TESTED:** the `pg_dump` backup engine — no `pg_dump`
  binary exists in the build sandbox; the Prisma logical-export engine
  was fully proven instead. The pg_dump branch is a thin spawn wrapper
  and is the production-preferred path when the binary exists.

### §12 — Supply chain
- **Implemented?** Yes. All direct dependencies pinned to exact
  versions; scripted secret scan (`npm run scan:secrets`); CI workflow
  (full gate + `npm audit --audit-level=high` + gitleaks + Semgrep);
  Dependabot config.
- **Tested how:** secret scan executed (320 files, 0 hits at Phase 1;
  re-run at delivery).
- **⚠ NOT EXECUTED:** `npm audit` could not run in the build sandbox
  (registry endpoint blocked by the sandbox's package-registry policy,
  `403 policy_denied`) — the audit step is in CI, where the registry is
  reachable; no audit results are claimed. Semgrep/gitleaks run on the
  first CI execution after a push.

### §13 — Security monitoring
- **Implemented?** Yes. Security audit log (DB `SecurityLog` or
  `.data/security-log.json`), alert-worthy events fan out to the owner
  alert center and to `ADMIN_ALERT_EMAIL` when an email provider is
  configured. Sensitive data is never logged (actors masked + hashed,
  token values never written).
- **Tested how:** live L17 (the run's `webhook_bad_signature`,
  `order_refunded`, `admin_access_denied`, `upload_magic_rejected`
  events visible in the admin security feed).

### §14 — Automated penetration suite
- **Implemented?** Yes. `tests/security-pentest.test.mjs` — **15/15
  attacks rejected**, plus 25/25 live legs
  (`scripts/verify-phase1-security.mjs`): download-token tampering (25
  forged tokens), claim/ref order-swap, IDOR, session forgery,
  privilege escalation, step-up theft, refunded→PAID resurrection,
  webhook replay, webhook forgery (wrong secret / tampered body /
  stale timestamp), XFF-spoof rate-limit bypass, CSRF, malformed JSON
  (400) / oversize body (413), SQL-injection strings (inert), XSS
  payloads (neutralized), captcha fake-pass, file forgery, receipt
  forgery, unauthenticated admin API (401), lockout bypass (429).

### Pipeline & i18n (Phase 1)
- ESLint 9 + `lint`/`typecheck` scripts added; the gate
  `lint → typecheck → test → build → e2e` runs for real.
- i18n: new keys ship **native en + ar**; other locales resolve via the
  project's documented per-key English fallback. **No translations were
  fabricated** for the other 38 locales — admin translation completion
  remains an owner workflow (see `docs/LIMITATIONS.md`).

---

## Phase 2 — Brand identity, theme system & motion

### Theme system
- **Implemented?** Yes. Six palettes × light+dark in
  `src/lib/themes.ts` (single source of truth), incl. `maison-classic`
  preserving the owner's original ivory/ink/antique-gold identity
  token-for-token (pinned by a regression test). Persisted server-side
  (DB `Setting` / `.data/theme.json`), server-rendered as CSS tokens —
  a switch applies storefront-wide with no rebuild. Admin ThemePanel
  with true live preview (injects the same `paletteCss()` the layout
  uses), mode default and motion master switch; audit-logged.
- **Tested how:** +9 tests (`tests/phase8-themes.test.mjs`); live proof
  across two server processes (POST palette → another process serves
  `data-palette="electric-blue"`; unauthenticated POST → 401).
- **WCAG AA:** verified programmatically (`scripts/check-contrast.mjs`)
  — **156/156 pairs pass**; weakest text pair 4.90:1.

### Buttons & navigation
- **Implemented?** Yes. `.btn-grad` animated 4-stop gradient (glow,
  sheen, press, spinner loading state) on Buy Now / cart→checkout /
  Pay / Subscribe only; palette-gradient nav active indicator;
  `prefers-reduced-motion` and the owner motion toggle freeze
  animations to a static gradient.
- **Tested how:** live computed-style verification (Buy button computes
  to Aurora Dawn's exact gradient stops); screenshots.

### Animated homepage scene
- **Implemented?** Yes. Aurora blobs, canvas starfield in live palette
  colours (pauses on hidden tab/off-screen, DPR-capped), floating
  orbs, swaying 3D covers of real products, animated counters with
  **real** numbers, testimonials marquee, IntersectionObserver
  scroll-reveal (no-JS safe). Degradation contract: owner toggle /
  reduced-motion / Save-Data / single-core → reduced or static scene.
- **Tested how:** measured with Puppeteer/CDP (390px, 4× CPU, Fast-3G,
  median of 3): **LCP 1564 ms** (< 2500 ms budget), scene ON vs OFF
  identical — the scene costs nothing measurable.
- **Honest deviation from target:** **CLS 0.058, not ~0.** Attribution
  proved the scene contributes zero; the residual is two font-swap
  reflows under aggressive throttling (within the "good" < 0.1 band).
  A preload fix was attempted and **reverted with evidence** (Next RSC
  has no `.woff2` loader; mismatched preload URLs would
  double-download). The durable fix is a `next/font` migration —
  documented future work, not silently claimed.

### Brand identity kit
- **Implemented?** Yes. Original parametric star+ring+orbit mark
  (`src/lib/brand.ts`); `brand/` holds 7 logo SVGs, 4 social PNGs,
  generated `COLORS.md`, `BRAND.md`, email shell + 3 cover templates +
  OG notes; PWA icons regenerated with the new mark; self-hosted fonts
  (Playfair + Amiri display, Inter + IBM Plex Sans Arabic — no CDN);
  receipt email re-skinned into the branded shell; admin
  BrandGuidePanel (variants, taglines in 5 languages, voice,
  typography, swatches).
- **⚠ TRADEMARK SEARCH — REQUIRED, NOT PERFORMED:** the mark and name
  are an original design, but **no trademark clearance search was
  performed** (flagged, not executed, per the brief). Before trading
  under "Astralium" or registering the logo, the owner must run a
  clearance search for "Astralium" and similar marks in his markets
  and Nice classes (notably 9, 35, 41) and take local IP advice. The
  warning also lives in `brand/BRAND.md` and the admin brand guide.

### Phase 2 — not live-tested / remaining risks
- **Theme DB-mode persistence proven in file mode only** — the sandbox
  app servers ran without `DATABASE_URL`; the DB path is the same
  config-store upsert other owner settings already use (its DB mode
  was verified live in Phase 4 for other keys).
- **No physical-device testing** (CDP emulation only), **no live Resend
  send** for the re-skinned email, **no screen-reader/AT audit**.
- **SVG wordmarks use live text** — print workflows without the brand
  fonts must convert text to outlines first (stated in `BRAND.md`).
- Secret scan at Phase 2: 0 hits in Phase-2 files; 5 pre-existing hits
  in the Phase-1 verify harness's own local test fixtures (see the
  consolidated note at the end of this document).

---

## Phase 3 — Homepage & product presentation

### Homepage sections + owner control
- **Implemented?** Yes. Sections in the brief's order (hero → trust →
  featured → visual categories → bundles & offers → how-it-works →
  testimonials → FAQ → newsletter; New releases and the guarantee band
  retained as controllable sections — nothing removed). Layout persists
  via the config store (`src/lib/home-settings.ts`, sanitizer
  heals/dedupes); `GET/POST /api/admin/home-sections` (401
  unauthenticated; `settings` permission; audit-logged);
  `HomeSectionsPanel` in the dashboard.
- **Tested how:** live — hiding FAQ removed it from the rendered
  homepage; reordering put newsletter first; same process, no rebuild.

### Luxury product card
- **Implemented?** Yes. 3D tilt (desktop pointer only), real
  discount-% badge (unit-tested; no badge when there is no real
  saving), wishlist heart on the cover, Quick View sheet (bottom sheet
  on mobile) with real buy actions, animated-gradient buy buttons.
- **Tested how:** tilt proven with a real CDP mouse (CSS vars
  4.20°/4.20° → computed `matrix3d` rotation); touch pointers rejected
  per-event so the transform stays identity on phones. A defect found
  during verification (a CSS media-query gate that would have disabled
  tilt for real mouse users on touchscreen laptops) was fixed by moving
  the gate into the handler's per-event `pointerType` check.

### Catalog
- **Implemented?** Yes. Sidebar filters on desktop, the identical
  filter block as a mobile bottom sheet, grid/list toggle, six sorts
  (incl. popularity), five curated collections (pure helpers in
  `lib/catalog-view.ts`, unit-tested), instant search — all fed by the
  Phase-1 DB-backed catalog resolver.
- **Tested how:** live — Top-rated collection → 8 products, matching
  the data.

### Product page
- **Implemented?** Yes. Thumbnail gallery (the cover's three duotone
  treatments), sticky buy panel (price, gradient Buy-Now, commerce
  blocks), express-pay note rendered **only** when the flag is on AND
  Stripe/PayPal keys exist (mirrors checkout's rule — never a fake
  affordance), "what you will get", free preview, guarantee band,
  verified reviews, related products, product FAQ.

### Mobile
- **Implemented?** Yes. Bottom navigation (docked, cart badge,
  gradient active indicator), cart summary as a mobile bottom sheet,
  buy-bar lifted clear of the nav.
- **Tested how:** the mobile-bug rect-scan re-run — **18/18 cells
  clean** (6 routes × 320/360/390, `scrollWidth == innerWidth`,
  0 offenders), plus 6/6 re-scan after the final CSS change. Hero LCP
  re-measured: median **1976 ms** (< 2500 ms budget); CLS **0.058**,
  identical to Phase 2 — no Phase-3 addition shifts layout.

### Phase 3 — not live-tested / remaining risks
- **Sections-layout DB persistence mode not live-proven** (file mode
  proven; the DB path is the same config-store upsert other owner
  settings use).
- **No physical touch devices; no full screen-reader pass.**
- Quick View does not yet trap focus (focus lands on Close;
  Escape/backdrop close) — noted as an accessibility follow-up.
- Cosmetic: the cover's corner motif glyph sits partially behind the
  new discount badge on cards.

---

## Phase 4 — The Manager's Office

### 0. Invisibility + access doc
- **Implemented?** Yes. Office stays on the env-configured admin path
  (no storefront links, noindex/robots handling from Phase 1); README
  gained "The Manager's Office (owner admin)" — sign-in,
  `ADMIN_PATH`, first-time TOTP setup, roles, bank-vault payout copy.

### 1. Live overview
- **Implemented?** Yes. First-party analytics only (salted rotating
  visitor hashes, consent-gated; device/browser parsed server-side;
  UTM allow-list-sanitised; country from the platform header — never
  the raw IP). Visitors now/today/7d/30d, uniques, pure-SVG world map,
  devices, browsers, sources, top pages, 5-step funnel + conversion
  rate. Honest empty states — nothing estimated or invented.
- **Tested how:** live DB-mode legs — 5 real events (MA country,
  iPhone UA) aggregated into countries/sources/device/funnel.
- **Disclosed limitation:** feature flags persist only through the DB
  adapter (pre-existing Phase-6 semantics). In zero-DB file mode the
  analytics flag cannot be switched on and the event route honestly
  answers `FEATURE_DISABLED`; the file-mode leg asserts exactly that.

### 2. Sales & profit
- **Implemented?** Yes. All figures from the Phase-1 order ledger
  (`src/lib/office-finance.ts`): counts by state, gross, refunds,
  provider-fee estimate, tax estimate, product costs, ad spend → net
  profit; breakdowns by product/country/language/currency; period +
  previous-period comparison; CSV export using the same computation.
- **Tested how:** unit fixtures reconcile **to the cent** (net profit
  111.25, `balanced=true`); live legs reconcile with the seeded ledger
  in both modes (`gross=60, balanced=true`).
- **⚠ Disclosure (also shown in the UI):** Stripe/PayPal do not report
  real per-order fees to this store, so **fees and taxes are estimates
  from owner-configured rates**, not actuals. Product cost is the
  product's *current* catalog cost at report time (not snapshotted per
  order) — historical profit shifts if a cost is edited later.

### 3. Orders & customers
- **Implemented?** Yes. Search/filter/pagination, per-order detail,
  private notes, resend downloads (delivery orchestrator; without a
  Resend key the attempt is recorded **queued**, never "sent"), full
  and partial refunds, customer list with per-customer totals,
  ban/unban enforced at checkout via the existing fraud blacklist.
- Refunds require the `finance` permission **and** a fresh step-up;
  the provider refund executes first and the ledger is written only
  after provider success; a ledger mismatch raises a security event +
  owner alert.
- **Tested how:** live — refund without provider keys → 503
  `PAYMENTS_NOT_CONFIGURED`, **ledger provably untouched**; resend
  mints fresh grants; ban enforced.
- **⚠ NOT LIVE-TESTED:** a real provider refund — no Stripe/PayPal
  keys exist yet; the provider call, state machine, clamping and
  idempotency are unit-tested and the refusal path is live-proven.

### 4. Products
- **Implemented?** Yes. Create/edit/archive/duplicate (copies are
  created inactive — live-proven they cannot leak live), product-file +
  cover + preview uploads through the Phase-1 magic-byte pipeline,
  categories, per-currency prices, translations, bundles, scheduling
  (`publishAt` hides future products from every storefront read path —
  live-proven).
- **⚠ Disclosure:** per-currency prices are **display prices**;
  checkout settlement stays USD, as the office copy states.

### 5. Design control
- **Implemented?** Yes. Theme/palette panel (Phase 2), banner + hero
  text editor, homepage sections (Phase 3), brand logo — with live
  preview, **saved versions and one-click rollback** (rollback first
  saves a "Pre-rollback backup" snapshot).
- **Tested how:** live end-to-end — snapshot → banner set → banner
  visible on the storefront → rollback → banner gone.
- DB-mode persistence of the sections layout specifically was not
  re-proven in this phase (file mode was); the design-state round-trip
  itself **was** proven in DB mode via the banner legs.

### 6. Console sections
- **Implemented?** Yes. One shell: Overview · Sales & profit · Orders ·
  Customers · Products · Design · Content & support (ratings + product
  reviews moderation, **support tickets** — new end-to-end with a
  public `/support` intake page, rate-limited and captcha-gated —
  newsletter, blog, translations) · Commerce (**office-managed
  coupons** replace the static seed for checkout and validation —
  live-proven) · Bank details · Security center · Team & system. Every
  pre-existing admin panel is preserved — nothing was removed.
- **Disclosure:** office replies to tickets go out by email only when
  Resend is configured; without it, status changes still work and
  nothing pretends an email was sent.

### 7. Owner payment data (bank vault)
- **Implemented?** Yes. `src/lib/bank-vault.ts` — AES-256-GCM under an
  HKDF-separated key (purpose `bank-vault`), masked by default (last 4
  only), reveal **and** save require step-up, values never written to
  the audit log (action names only) and never in list responses. The
  panel states plainly: this is a private reference archive —
  **actual payouts are configured inside Stripe/PayPal, not here**.
- **Tested how:** unit — encrypt→decrypt round-trip, tampered
  ciphertext refused, on-disk scan finds **no plaintext**; live — save
  without step-up → 403, after step-up saved and masked
  (`•••• •••• 6666`), reveal returns the stored details, support role
  save → 403.

### 8. Security center
- **Implemented?** Yes. Sessions **honestly represented** (stateless
  signed tokens: epoch, idle/length policy, account locks, known
  devices — no fabricated per-device session list), terminate-all via
  epoch bump, searchable audit log, security alerts (24 h counts +
  recent events), backup status, system health from measurable signals
  only (DB reachability, storage mode, provider configuration, event
  volume).
- **Tested how:** live legs find the office actions
  (`office.bank_save/reveal`, `office.design_*`, `office.coupon_upsert`,
  `office.ticket_status`, `office.refund_*`) in the audit log.

### 9. Team roles
- **Implemented?** Yes. Seven roles (owner, admin, manager, support,
  marketer, accountant, viewer) with a granular permission matrix;
  `finance` = owner + accountant; `bank` and `security` = **owner
  only**. Enforcement is per-route on the server; navigation is
  filtered server-side too.
- **Tested how:** unit tests assert the matrix; **live in both modes**
  — a real support account gets **403 on sales, bank and security
  APIs** and 200 on the read-only overview.

### 10. Mobile-first office UI
- **Implemented?** Yes. Horizontal tab strip on phones, sidebar from
  921 px, single-column panels, wide tables in horizontal scroll
  wrappers.
- **Tested how:** 10 screenshots visually inspected; overflow scan —
  document `scrollWidth == innerWidth` on every section at 320/390/
  1280 (only intentional `overflow-x:auto` table wrappers extend).
- **Not verified on a physical touch device** (headless Chrome
  emulation only) — same caveat as Phases 2–3.

### Phase 4 — configuration note
No new environment variables were needed for Phase 4; `.env.example`
and the zod schema are unchanged by this phase (the vault reuses
`AUTH_SECRET` via HKDF, consistent with Phase-1 key separation).

---

## Phase 5 — AI employees

### 0. Meta Model API verification (done BEFORE building)
- **What the official docs say could NOT be rendered:** Meta's docs
  host, `dev.meta.ai`, is **blocked by the build sandbox's fetch
  policy** — the official pages were never rendered there. The
  contract used is **corroborated, not first-party-rendered**, and is
  stated as such.
- **Corroborated contract** (from promptfoo and LiteLLM provider docs,
  shipwithmuse developer guides citing Meta's docs, and search-indexed
  summaries of dev.meta.ai): base URL `https://api.meta.ai/v1`; Bearer
  token from `MODEL_API_KEY`; model id `muse-spark-1.3`; three
  surfaces — `/v1/responses` (recommended default), `/v1/chat/
  completions` (OpenAI-compatible), `/v1/messages`
  (Anthropic-compatible); `tool_choice` accepts **only `"auto"`**
  (anything else → HTTP 400); `max_completion_tokens` is the canonical
  cap; published Standard pricing $1.25/M input, $0.15/M cached,
  $4.25/M output (used for the cost estimates/caps).
- **Design consequence:** the gateway implements the Chat Completions
  contract behind a provider interface with a **configurable base URL**
  (`AI_META_BASE_URL`), sends only `tool_choice: "auto"` and
  `max_completion_tokens`, and uses a tolerant SSE parser (Muse Spark
  emits a non-standard SSE event that trips strict OpenAI clients). If
  Meta's live contract differs in detail, one adapter file
  (`src/lib/ai/openai-compatible.ts`) is the only place that changes.
- **⚠ NOT LIVE-TESTED: the Meta Model API itself. No `MODEL_API_KEY`
  exists in this project** (the owner adds keys later, per his
  standing sequence). Every live proof for this phase uses the
  deterministic MOCK provider or a fake fetch implementing the
  corroborated contract.

### 1. Architecture
- **Implemented?** Yes. One provider-independent gateway in
  `src/lib/ai/` (types, OpenAI-compatible adapter, mock provider,
  config, usage ledger, employees, RAG, tools, actions,
  conversations, gateway, customer engine), extending — not
  duplicating — the pre-existing grounded support engine. Provider +
  model configured from env keys only and the office panel; primary =
  Meta (Muse Spark), fallback = any OpenAI-compatible endpoint,
  switchable in one click; `getAiStatus()` never returns key material.
  With **no provider configured**, the deterministic grounded engine
  keeps answering byte-for-byte as before and all AI-staff UI stays
  hidden — the store never fakes AI. Flags `ai_staff` +
  `ai_owner_staff`, both default OFF.

### 2. Customer staff (storefront)
| Employee | Status |
|---|---|
| Noura ✦ Greeter | ✅ Routing + grounded answers proven (live leg) |
| Sami 💎 Sales | ✅ RAG-grounded recommendations from the real catalog only |
| Layla 🛠️ Support | ✅ Policy-grounded; HANDOFF → human ticket with full transcript proven in tests |
| Omar 📦 Orders | ✅ Deterministic id+email / claim-code verification — zero model involvement in order facts |
- Answers come ONLY from real sources (DB-resolver catalog, policy
  FAQs, published blog posts); uncertainty escalates to a human ticket
  with the full transcript. Customer staff hold **no tools**. Replies
  in the visitor's locale across the 40 store languages; streaming;
  browser-TTS listen button (STT was already present). Rate limits +
  daily cost cap; conversations logged for office quality review.

### 3. Owner staff (Manager's Office)
| Employee | Tools | Status |
|---|---|---|
| Mira 🎨 Designer | set_theme, set_banner, set_hero_text, set_home_sections, product_info | ✅ Preview→Apply→Undo proven live (palette round-trip on the real storefront) |
| Karim 📣 Marketer | create_coupon*, draft_blog_post, publish_blog_post*, product_info | ✅ Coupon approval gate proven live (Apply door refuses, 409; Approve publishes) |
| Dana 📊 Analyst | sales_summary, product_info | ✅ Read-only; live leg returns ledger figures inline |
| Yara 🌐 Translator | translate_product, product_info | ✅ Merge + undo proven in tests |
| Rami 🗂️ Product Manager | create_product_draft, update_product_price*, publish_product*, product_info | ✅ Drafts always inactive; price/publish approval-gated, proven in tests |
| Adam 🛡️ Security Monitor | security_summary | ✅ Read-only summary; cannot touch security settings (no such tool exists) |
\* = sensitive class: explicit owner Approve required.

### 4. Safety model (all test-proven)
- **Preview-first, always.** A model tool call can only create a
  preview (safe) or an approval request (sensitive); the store changes
  only at the owner's click in the office.
- **The forbidden wall lives in the tool layer** (`tools.ts`):
  unregistered names matching refund / bank / IBAN / secret / API key /
  password / credential / delete / remove / drop / purge / team /
  account / role / permission / flag / security / TOTP / session /
  payout / payment-key / Stripe / PayPal patterns are refused with
  `FORBIDDEN_TOOL` before any other check; a module-load self-check
  guarantees no registered tool trips the patterns.
- Allow-lists per employee + zod inputs (`EMPLOYEE_NOT_ALLOWED`,
  `INVALID_INPUT`, `UNKNOWN_TOOL` codes); snapshot tools restore
  exactly on Undo; irreversible-by-design tools (draft creation) say
  so in their preview.
- **Customer content is data, architecturally:** customer staff hold no
  tools; customer text is only ever a user message or inside DATA
  blocks; owner-turn context never contains customer content — text
  planted in a review/ticket/message has no channel to become a
  command. Injection attempts are logged (`ai_forbidden_attempt`
  security events) and conversations flagged for review.
- Audit entry for every proposal/apply/approve/reject/undo naming the
  employee and stating it acted on the owner's order; apply/approve
  re-checks the clicking actor's per-tool permission server-side.
  Daily cost + action caps; **emergency stop** halts owner turns
  instantly and degrades the storefront to the grounded engine
  (proven live).
- **Injection suite:** `tests/phase11-ai-injection.test.mjs` (7 tests)
  — EN+AR customer corpus → zero actions/changes; a forced
  customer-path tool call is dropped + logged; injection quoted into
  an owner turn is refused; direct forbidden asks refused;
  disabled/stop/cap behaviour; unconfigured honesty.
- **Test evidence:** `tests/phase11-ai-gateway.test.mjs` (10 — wire
  contract vs fake fetch incl. tolerant SSE, cost math, caps,
  routing), `tests/phase11-ai-tools.test.mjs` (11 — preview/apply/undo
  flows, coupon gate, forbidden wall ×13 names, stop+cap, audit);
  live verification `scripts/verify-phase5-ai.mjs` — **30/30 legs**
  (production server, mock provider, file mode), including the theme
  preview→apply→undo round-trip on the real storefront and the coupon
  409→Approve flow.

### 5. Bugs found & fixed in Phase 5
1. `src/lib/catalog.ts` (pre-existing, Phase 1/4): in file mode,
   `listAdminProducts()` returned un-edited seed products — overlay
   edits showed on the storefront but not in admin read models (DB
   mode unaffected). Fixed; the Phase 4 Products manager is now
   truthful in file mode.
2. `tests/flags.test.mjs`: registry count updated 35 → **37** for the
   two new flags (default-off assertions unchanged and passing).

### Phase 5 — NOT live-tested, and why
- **Meta Model API itself** — no `MODEL_API_KEY` exists (see §0).
- **Real provider failover** (Meta error → fallback) — the logic is
  unit-covered; a true two-provider failover needs two real keys.
- **Real refunds/disputes/Resend sends through AI flows** — AI staff
  can never refund (architectural); office manual flows are Phase 4's.
- **DB-mode AI stores** — this phase's live run was file mode; the AI
  stores use the same dual-mode config store whose DB mode Phase 4
  verified live (43/43 legs).
- **Physical touch devices / full screen-reader pass** for the new
  panel — not performed (the panel reuses the office's established
  accessible patterns).

### Phase 5 — remaining risks & notes
- If Meta's live contract differs from the corroborated one, the
  single adapter file is the fix point; base URL and model are
  owner-editable without code.
- Sensitive approvals use the office session's existing
  (TOTP-hardened) auth; adding a step-up re-auth specifically on
  Approve clicks is a reasonable future hardening, deliberately not
  invented in this phase.
- The order-answer composer in the customer engine reuses the
  pre-existing English templates from the verified lookup
  (figures/status are locale-independent data); full localization of
  that one deterministic composer is future work.
- AI cost figures are estimates from the published rate table;
  providers remain the source of truth for billing.
- The catalogue is still the starter/demo set (per the owner's earlier
  clarification) — AI staff recommend and edit exactly what the
  catalog contains, nothing more.

---

## Consolidated: everything NOT live-tested (no softening)

1. **Real Stripe disputes/chargebacks and all PayPal flows** (Phase 1
   §8) — no payment accounts exist; fixture-tested handlers following
   documented payloads. The single largest untested-live area.
2. **Real Stripe/PayPal refunds** (Phase 4 §3) — refusal path
   live-proven (503, ledger untouched); success path unit/fixture
   tested. Needs provider keys.
3. **Turnstile/hCaptcha provider round-trip** (Phase 1 §10) — no keys
   exist; tokenless rejection and unconfigured honesty proven.
4. **Resend email delivery** (Phases 1/3/4/5) — no API key; alert-center
   and queued (not "sent") semantics proven instead.
5. **Meta Model API** (Phase 5) — no `MODEL_API_KEY` exists; the docs
   host was not renderable from the build sandbox, so the contract is
   corroborated from implementer docs, and the adapter is proven
   against a fake fetch + the mock provider (30/30 legs).
6. **Real two-provider AI failover** (Phase 5) — needs two real keys;
   logic unit-covered.
7. **`pg_dump` backup engine** (Phase 1 §11) — no binary in the build
   sandbox; the logical engine was fully proven (backup → tamper →
   restore → 34-table counts match; wrong key refused).
8. **`npm audit`, Semgrep, gitleaks** (Phase 1 §12) — the sandbox
   blocks the audit registry endpoint (`403 policy_denied`); all three
   are wired into CI and run on the first CI execution after a push.
   No audit results are claimed.
9. **DB-mode persistence for the theme key and the homepage-sections
   layout specifically** (Phases 2/3) — proven live in file mode; both
   use the same config-store upsert whose DB mode Phase 4 verified
   live for other keys (43/43 legs, incl. the design-state banner
   round-trip).
10. **Analytics in zero-DB file mode** (Phase 4 §1) — impossible by
    pre-existing flag-persistence design; the route honestly answers
    `FEATURE_DISABLED`. Fully proven in DB mode.
11. **Physical devices and full assistive-technology audits**
    (Phases 2–5) — all layout/performance evidence is headless-Chrome
    CDP emulation; contrast is machine-verified; no physical-device or
    screen-reader pass was possible.
12. **Trademark clearance for the "Astralium" name and logo**
    (Phase 2) — flagged as required, deliberately not performed.

## Consolidated: remaining risks

1. **In-memory rate limiting multiplies across instances** (Phase 1
   §1) — durable account lockout unaffected; a shared store
   (Redis/Upstash) is the documented next step when scaling out.
2. **CSP `style-src 'unsafe-inline'`** remains (Phase 1 §2) — needs a
   styling refactor to tighten.
3. **Font-swap CLS 0.058** under aggressive throttling (Phases 2/3) —
   inside the "good" band; the durable fix is a `next/font` migration.
   Homepage LCP headroom narrowed to 1976 ms median (budget 2500 ms)
   under the same throttling — re-measure after future additions.
4. **Payment handlers await their first live exercise** (Phase 1 §8) —
   exercise disputes/refunds in a Stripe/PayPal sandbox before real
   money moves.
5. **Legacy-token verification fallbacks** (pre-upgrade download/claim
   links) should be retired once old links age out; already refused
   for admin sessions and for the dev default in production.
6. **File-mode (no-DB) operation** keeps state in `.data/` JSON — fine
   for the current deployment shape; DB mode is the recommended
   production posture and is the storefront's source of truth whenever
   configured.
7. **Fee/tax figures in profit reports are owner-rate estimates**
   (Phase 4 §2) until provider-reported fees are integrated; product
   cost is current-cost, so cost edits rewrite historical profit.
8. **Per-currency prices are display-only**; settlement is USD
   (Phase 4 §4).
9. **AI approvals ride on the office session's auth** (Phase 5) — a
   step-up re-auth on Approve clicks is a reasonable future hardening.
10. **Secret-scan fixtures:** the scripted scan reports 5 hits, all
    pre-existing fixture passwords inside
    `scripts/verify-phase1-security.mjs` — a Phase-1 pentest harness
    whose local test credentials are fixtures by design; 0 hits in any
    application or Phase 2–5 file.

## Environment audit (at delivery)

All 56 `process.env.*` variables read in `src/` are documented in
`.env.example`: 54 as settable entries (empty + commented) and
`NODE_ENV` / `NEXT_RUNTIME` as an explicit note — they are set
automatically by Node/Next.js and the platform and must never be set
manually. Zod startup validation covers the security and AI variable
groups and logs (never throws) on problems, preserving the zero-config
boot contract.
