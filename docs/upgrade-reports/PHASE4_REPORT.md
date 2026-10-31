# Phase 4 — The Manager's Office (مكتب المدير) — Report

**Status: COMPLETE.** Built on top of the existing admin (same env-path route,
same team/audit/analytics foundations — extended, not duplicated). Nothing was
pushed to GitHub and nothing was deployed, per the owner's standing rule.
Final gate (after the last source edit): **lint exit 0 · typecheck exit 0 ·
tests 310/310 · build exit 0 · e2e 15/15**. Live verification:
`scripts/verify-phase4-office.mjs` — **41/41 legs in file mode** and
**43/43 legs in DB mode** (real PostgreSQL, migrations applied). i18n check:
**en 623/623 native, ar 623/623 native, 0 unresolved across 40 locales**.

---

## 0. Invisibility + access doc
- The office stays on the env-configured admin path (`ADMIN_PATH` or the
  default `control-astralium` segment, mapped by middleware; Phase-1 noindex /
  robots handling unchanged). No storefront link points to it; the existing
  login page on that path is the sign-in surface.
- README gained a **"The Manager's Office (owner admin)"** section: how to
  sign in at `/<locale>/control-astralium` (or the `ADMIN_PATH` segment —
  with the warning that setting it disables the default path), that the
  bootstrap owner signs in with `ADMIN_PASSWORD` alone, that team members use
  email + password, **first-time TOTP setup** (Team & system → Security,
  mandatory for privileged roles), the seven roles and who sees money/bank/
  security, and the bank-vault payout copy.

## 1. Live overview — `OfficeOverviewPanel` + `GET /api/admin/office/overview`
- First-party analytics only (extends the Phase-6 privacy analytics: salted
  rotating visitor hashes, consent-gated `vid`, no third-party trackers).
  Events now also record device/browser (parsed from the UA server-side),
  traffic source (UTM, allow-list-sanitised, else referrer host, else
  "direct") and country (platform header — never the raw IP). Event model
  extended by migration `20261031030000_phase10_office` (+ file-mode fields).
- Panel shows: visitors now (5-minute window), today / 7d / 30d visitors and
  pageviews, conversion rate, a **pure-SVG world map** (equirectangular
  projection from `src/lib/countries-geo.ts`, no map library, no external
  tiles), devices, browsers, sources, top pages, and the 5-step funnel
  (visit → product → cart → checkout → purchase) with per-step conversion.
- Honest empty states: with no events the panel says so ("No data yet — this
  fills in as visitors arrive. Nothing here is estimated or invented.").
- **Proven live (DB mode):** after enabling the analytics flag and posting 5
  real events with `cf-ipcountry: MA` and an iPhone UA, the overview returned
  `countries=[{MA, 5 events, 1 visitor}]`, `sources=[{legtest, …}]`, a mobile
  device row and the full funnel.
- **Honest limitation found & documented:** feature flags persist only
  through the DB adapter (pre-existing Phase-6 semantics — the admin UI
  itself says so). In zero-DB file mode the analytics flag therefore cannot
  be switched on and the event route honestly answers `FEATURE_DISABLED`;
  the file-mode leg asserts exactly that behaviour plus honest zeros.

## 2. Sales & profit — `SalesPanel` + `GET /api/admin/office/sales` (+`?format=csv`)
- All figures derive from the Phase-1 order ledger via `src/lib/office-finance.ts`:
  counts by state, gross revenue, refunds, provider-fee estimate, tax
  estimate, product costs, ad spend → **net profit**, breakdowns by product /
  country / language / currency, period selection, previous-period comparison
  (shown once the period is longer than a day), and a CSV export whose totals
  are the same computation as the JSON.
- Product **cost field** (`costUSD`, migration + admin editor) and **ad-spend
  entries** (dated, labelled) feed the profit math. Fee/tax rates are
  owner-configured in the panel.
- **Reconciliation is tested, not asserted:** unit fixtures reconcile to the
  cent (gross 285, refunds 50, fees 10.25, taxes 28.5, costs 45, net 111.25,
  `balanced=true` — items sum = gross − discount gap, 0 here). Live legs:
  the seeded ledger reconciles in both modes (`gross=60 balanced=true` on
  the $60/$25 fixture whose only revenue order is $60). Screenshot fixture
  also reconciles by eye: gross $227 = 129 + 59 + 39, fees $8.02, MA 2 orders
  $168, FR $59.
- **Disclosure:** Stripe/PayPal do not report their real per-order fees to
  this store, so fees and taxes are **estimates from the rates the owner
  sets** — the panel says exactly that in the UI. Product cost is the
  product's *current* catalog cost at report time (not snapshotted per
  order); historical profit shifts if a cost is edited later.

## 3. Orders & customers — `OrdersPanel`, `CustomersPanel`, office order APIs
- Orders: search (id/email), status filter, pagination, per-order detail
  (items, grants with expiry/download counts, delivery attempts), private
  order notes, resend downloads, **full and partial refunds**.
- Refunds (`POST /api/admin/office/orders/[id]/refund`) require the
  `finance` permission **and** a fresh Phase-1 step-up. The provider refund
  executes **first** (`src/lib/refunds.ts`); the ledger is written only after
  provider success, grants are revoked on a full refund, and a ledger
  mismatch raises a new security event (`refund_ledger_mismatch`) plus an
  owner alert. With no provider keys the route answers
  `503 PAYMENTS_NOT_CONFIGURED` and **the ledger is provably untouched**
  (live leg: status still `fulfilled`, `refundUSD=0` after the refusal).
- Resend re-runs the existing delivery orchestrator; without a Resend key
  the email attempt is recorded **queued**, never "sent" (pre-existing
  Phase-2 semantics) — the live leg asserts the fresh grants are minted.
- Customers: aggregated from the ledger (orders, net spend after refunds,
  refunded total, dispute/refund flags, last order). **Ban/unban** writes to
  the existing fraud blacklist, which checkout already enforces.
- Not live-tested: a real provider refund (no Stripe/PayPal keys exist yet);
  the provider call, state machine, clamping and idempotency are unit-tested
  and the refusal path is live-proven.

## 4. Products — `ProductsManager` + widened `POST/PATCH /api/admin/products`
- Create / edit / archive (active flag) / **duplicate** (copy created
  inactive, so it can never leak live by accident — live-proven), per-product
  file + cover + preview uploads through the existing Phase-1 magic-byte
  pipeline and file-binding manager, categories, badge, product language,
  cost, **per-currency display prices** (`priceOverrides`), title/description
  **translations**, and **scheduling** (`publishAt` — a future-dated product
  is filtered from every storefront/catalog read path; live-proven: created
  → visible → scheduled → hidden).
- **Disclosure:** per-currency prices are *display* prices (cards, quick
  view, product page via `formatProductPrice`); checkout settlement remains
  USD, as it has been since Phase 1 — the office copy does not claim
  otherwise.
- Bundles remain managed in the existing bundles panel (same section), whose
  prices are always derived from the catalog.

## 5. Design control — Design section (theme panel + `BannerHeroPanel` + `DesignVersionsPanel` + `HomeSectionsPanel`)
- Phase-2 theme/palette panel (with its live preview), a top **banner** and
  **hero text** editor, and the Phase-3 homepage-sections panel are wired
  into one Design section.
- **Versioning:** every design change (theme save, banner, hero, logo,
  sections) can be snapshotted; versions are listed with labels/timestamps
  and **one-click rollback** restores the whole design state (rollback itself
  first saves a "Pre-rollback backup" snapshot). Live-proven end-to-end:
  snapshot → set banner → banner visible on the storefront → rollback →
  banner gone.
- The storefront renders the banner and hero override (a running A/B
  experiment still outranks the static override — documented behaviour).
- DB-mode persistence of the sections layout specifically was not re-proven
  in this phase (file mode was, live); the same config-store adapter serves
  both, and the design state round-trip *was* proven in DB mode via the
  banner legs.

## 6. Console sections — one coherent navigation
The office is a single shell (`OfficeShell`) with sections: Overview ·
Sales & profit (finance) · Orders · Customers · Products · Design ·
Content & support (ratings/reviews moderation, **support tickets**,
newsletter, blog, translations) · Commerce (coupons, flags, delivery,
licenses, subscriptions…) · Bank details (owner) · Security center ·
Team & system. Every pre-existing admin panel is preserved inside these
sections — nothing was removed.
- **Support tickets are new end-to-end:** public intake on the new
  `/<locale>/support` page (rate-limited, captcha-gated like other public
  forms, owner alerted), office list + status workflow
  (open → answered/closed) — live-proven intake → list → transition.
- **Coupons are now office-managed:** the office list replaces the static
  seed for checkout and for `/api/coupon/validate` — live-proven (office
  coupon LEG10 → $10 off a $100 validation).
- **Disclosure:** office replies to tickets go out by email only when Resend
  is configured; without it, status changes still work and nothing pretends
  an email was sent.

## 7. Owner payment data — `BankVaultPanel` + `src/lib/bank-vault.ts`
- Encrypted at rest with AES-256-GCM under an HKDF-separated key (purpose
  `bank-vault`, Phase-1 key separation), stored via the config store.
  Display is **masked by default** (IBAN/account number show last 4 only);
  **reveal and save both require step-up**. Values are never written to the
  audit log (only the action names `office.bank_save` / `office.bank_reveal`)
  and never appear in any list response.
- The panel carries the required copy: this is a private archive for the
  owner's reference — **actual payouts are configured inside Stripe/PayPal,
  not here**.
- Unit-proven: encrypt → decrypt round-trip, tampered ciphertext refused, and
  a scan of the on-disk file finds **no plaintext** account number. Live legs:
  save without step-up → `403 STEP_UP_REQUIRED`; after step-up → saved and
  masked (`•••• •••• 6666`); reveal returns the stored details; support role
  save → 403.

## 8. Security center — `OfficeSecurityPanel` + `GET /api/admin/office/security`
- Sessions **honestly represented**: admin sessions are stateless signed
  tokens, so the center shows the session epoch, idle/length policy, account
  locks and known devices rather than a fabricated per-device session list —
  with terminate-all available through the existing epoch bump.
- Searchable audit log (the office queries the Phase-1 audit store;
  every office action is logged — the live legs find
  `office.bank_save/reveal`, `office.design_*`, `office.coupon_upsert`,
  `office.ticket_status`, `office.refund_*` in it), security alerts (24h
  counts + recent events from the Phase-1 security log), backup status from
  the Phase-1 backup system, and system health from measurable signals only
  (DB reachability, storage mode, provider configuration, event volume).
- The Phase-1/6 Security panel (2FA enrollment, epoch terminate-all) remains
  in Team & system — deliberately reachable by privileged non-owner roles so
  they can complete their mandatory TOTP enrollment.

## 9. Team roles — server-side, proven
- Seven roles on the existing team system: owner, admin, manager, support,
  marketer, accountant, viewer, with a granular permission matrix
  (`finance` = owner + accountant only; `bank` and `security` = **owner
  only**; manager has no finance/bank/security/team).
- Enforcement is **per-route on the server**, and the navigation is filtered
  server-side too (a role never even receives the sections it cannot use).
- **Proven two ways:** unit tests assert the matrix (including support denied
  finance/bank/security/team), and the live legs sign in as a real support
  account and get **403 on the sales, bank and security APIs** while the
  read-only overview returns 200 — in both file and DB modes.
- Step-up is required for refunds, bank reveal/save, and team account
  management (Phase-1 rule, enforced by the existing team route).

## 10. Mobile-first office UI
- The shell is a horizontal tab strip on phones and a sidebar from 921px up;
  panels stack single-column; wide tables live in horizontal scroll wrappers
  (the sales breakdown tables were wrapped during screenshot review).
- Screenshots in `~/workspace/astralium-preview/phase4/` (visually inspected):
  `office-overview-390.png`, `office-overview-1280.png`,
  `office-overview-320.png`, `office-sales-390.png`, `office-sales-320.png`,
  `office-orders-390.png`, `office-products-390.png`,
  `office-design-390.png`, `office-security-390.png`, `office-bank-390.png`.
- Overflow scan at 320/390/1280: **document `scrollWidth == innerWidth` on
  every section** (no page-level horizontal overflow); the only elements
  extending beyond the viewport sit inside intentional `overflow-x:auto`
  table wrappers. Not verified on a physical touch device (headless Chrome
  emulation only) — same caveat as Phases 2–3.

---

## Global rules — compliance
- No existing feature removed or broken: gate + e2e green, all legacy panels
  reachable in the new shell.
- Money reconciles with the ledger: reconciliation unit tests + live legs +
  CSV uses the same computation as the JSON report.
- i18n: ~124 new keys, native en+ar, documented EN fallback for the other 38
  locales; `scripts/check-i18n.mjs` clean (623 keys).
- **No new environment variables were needed for Phase 4** — `.env.example`
  and the zod schema are unchanged (the vault reuses `AUTH_SECRET` via HKDF,
  consistent with Phase-1 key separation).
- Every office action is audit-logged; step-up guards refunds, bank
  reveal/save and role changes.

## Not live-tested, and why
- **Real Stripe/PayPal refunds and payouts** — no provider accounts/keys
  exist yet (owner supplies them after inspecting the store). Refusal path
  live-proven; success path unit/fixture-tested.
- **Ticket reply emails / any Resend send** — no Resend key; the queued (not
  sent) semantics are asserted in the legs.
- **Analytics in zero-DB file mode** — impossible by pre-existing design
  (flags need the DB adapter); fully proven in DB mode instead.
- **Design sections persistence in DB mode** — file mode proven live; the
  design-state round-trip itself was proven in DB mode (banner legs).
- **Physical mobile devices** — headless emulation only.

## Remaining risks
- Fee/tax figures are owner-rate estimates until provider-reported fees are
  integrated (needs provider accounts); the UI discloses this.
- Rate limiting remains per-process in-memory (Phase-1 caveat) — the ticket
  intake inherits it; a shared store is still future work.
- Per-currency prices are display-only while settlement is USD; true
  multi-currency settlement needs provider configuration and is out of
  scope for this phase.
- Product cost edits rewrite historical profit (current-cost accounting) —
  acceptable for a single-owner store, noted here and in the panel design.
