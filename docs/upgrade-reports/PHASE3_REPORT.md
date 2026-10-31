# Astralium Digitale Store — Phase 3 Upgrade Report: Homepage & Product Presentation

**Scope executed:** the full Phase 3 brief — (1) homepage sections in the brief's order with owner-controlled order/visibility (persisted settings + admin API + minimal functional admin UI); (2) luxury product card with desktop 3D tilt, discount badge, Quick View, animated-gradient buy actions and one-tap wishlist; (3) catalog rebuild (grid/list toggle, sidebar filters on desktop, bottom-sheet filters on mobile, instant search, six sort orders, curated collections) fed by the Phase-1 DB catalog resolver; (4) product page rebuild (gallery, sticky buy panel, express-pay-when-configured, what-you-get, preview, guarantee, verified reviews, related, product FAQ); (5) mobile-first from 320px with a new bottom navigation, the cart summary as a mobile bottom sheet, and a full zero-overflow re-verification. **Nothing was pushed to GitHub and nothing was deployed** — all work is in the local tree `~/workspace/astralium-v2`, per the owner's standing rule.

---

## Final gate (verbatim outputs, run 2026-10-31 on the final tree, after the last code change)

```
$ npm run lint        → exit 0        (eslint . — 0 errors, 0 warnings)
$ npm run typecheck   → exit 0        (tsc --noEmit)
$ npm test            → ℹ tests 291 · ℹ pass 291 · ℹ fail 0
$ npm run build       → exit 0        (✓ Compiled successfully)
$ npm run test:e2e    → exit 0        (E2E SMOKE: 15/15 checks passed)
$ npm run check-i18n  → 470 keys × 40 locales, en/ar 470/470 native, 0 unresolved
```

Test count grew from the Phase-2 baseline of 284 to **291** (+7 in `tests/phase9-storefront.test.mjs`); all pre-existing tests still pass — checkout, bundles, coupons, wishlist, reviews, previews, subscriptions and every earlier feature suite is green, so nothing was removed or broken.

---

## 1 — Homepage sections + owner control (DONE, live-proven)

**Order implemented** (the brief's): cinematic hero (the Phase-2 scene, untouched) → trust bar → featured products (bestsellers) → visual categories → bundles & offers → how-it-works → testimonials → FAQ → newsletter. Two pre-existing sections the brief's list omits — **New releases** and the **guarantee band** — were kept as first-class sections (nothing removed), placed after bundles / after how-it-works; the owner can move or hide them like any other.

**Mechanism** (`src/lib/home-settings.ts`): the layout — `order` (every known id exactly once) + `hidden` — persists through the same JSON config store as the theme (DB `Setting` row `homepage_sections`, else `.data/home-sections.json`). The sanitizer drops unknown ids, dedupes, and *heals* a stored layout by appending any missing known id in default order, so a future phase's new section can never silently vanish. The homepage renders `visibleHomeSections()` in the owner's order (each section wrapped in a `data-home-section="<id>"` marker).

**Admin API** (`GET/POST /api/admin/home-sections`, mirroring the Phase-2 theme route): GET behind the `read` permission; POST behind `settings`, zod-style shape validation (400 `INVALID_LAYOUT`), audit-logged as `home.update`. **Admin UI** (`HomeSectionsPanel`, mounted in the dashboard after the theme panel): per-section ↑/↓ reorder buttons + visibility checkbox + save, with a saved confirmation — minimal but fully functional; the Phase-4 design office builds on this same API.

**Live proof** (production server, file persistence mode):
```
GET  /api/admin/home-sections (no session)     → 401 ADMIN_UNAUTHORIZED
POST /api/admin/login (bootstrap owner)        → 200
GET  /api/admin/home-sections                  → default order, hidden []
POST {"hidden":["faq"]}                        → { ok:true, persisted:"file" }
GET  /en                                       → data-home-section sequence has NO "faq"
POST {"order":["newsletter","hero",…]}         → 200
GET  /en                                       → first section rendered is "newsletter"
POST restore defaults                          → 200 (test file then removed)
```
Categories are now *visual* tiles with a live product count per category (`{n} products`, resolved from the same catalog).

## 2 — Luxury product card (DONE, interaction-proven)

- **3D tilt** (`src/components/Tilt.tsx`): pointermove writes `--tilt-x/--tilt-y` (max ±7°) consumed by `.card-tilt-inner` inside a 900px perspective. **Desktop-only by construction**: the handler ignores every non-mouse/pen pointer event, so on touch the variables never leave their 0deg defaults and the transform is the identity — verified live with a real CDP mouse: vars `4.20deg / 4.20deg` → computed `matrix3d(0.997314, …, 0.994636, …)` (a true 3D rotation). A defect was caught and fixed during verification (see "Defect found" below).
- **Badges**: bestseller/new (existing) at the cover's top-start; a new **discount badge** at top-end showing the real whole-percent saving (`discountPercent()` in `lib/catalog-view.ts`, unit-tested: 19 vs 49 → 61%; equal/higher price → no badge, no fake discounts).
- **Wishlist heart**: one tap, moved onto the cover's bottom-end corner (circular, surface-backed) — same store action as before.
- **Quick View** (`src/components/QuickView.tsx`): opens a sheet (bottom sheet on mobile, centred dialog on desktop) with cover, category, rating, price + compare-at, the first four "what you get" items, format list, the real Add-to-Cart / Buy-Now (Phase-2 `.btn-grad`) actions and a full-page link. Backdrop click, ✕ and Escape close it; body scroll locks while open; the close button receives focus. The card's own Add-to-Cart keeps the classic style; Buy actions use the animated gradient (product page, sticky bar, Quick View).
- **Micro-animation**: transform/opacity only (tilt, sheet rise/fade keyframes) — the global `prefers-reduced-motion` rule freezes them; no layout properties are animated anywhere.

## 3 — Catalog (DONE, live-proven)

`CatalogClient` rebuilt around a **sidebar + bottom-sheet** model sharing one filter block (single state, two presentations):
- **Sidebar filters** (desktop, sticky): curated **collections** (All / Bestsellers / New releases / Under $25 / Top rated — predicates in `lib/catalog-view.ts`, unit-tested incl. the 120-day "new" window), category chips, format, max-price range, language, minimum rating.
- **Mobile**: a Filters button opens the identical block as a **bottom sheet** with a live result count on the apply button.
- **Grid/list toggle**: list view renders horizontal cards (stacking again under 560px).
- **Sorting**: featured, **popularity** (new — reviews count, rating tiebreak), price ↑/↓, rating, newest. All sorts are the pure, unit-tested `sortProducts()` (input never mutated).
- **Instant search**: unchanged Phase-3 smart-search ranker + suggestions, now scoped to the active collection.
- **Data source**: the shop page still resolves products through the Phase-1 `getStorefrontProducts()` (database-first) and passes them in — the client never imports the static seed. (CartClient's build-your-own estimate still reads the seed for its *display* math, as before; checkout re-prices server-side. Noted, not changed — outside this phase's surface.)

Live checks (desktop, real browser): list-view toggle applies `.catalog-list`; sidebar visible; **Top rated collection → "8 products"** (8 of 12 seed products are ≥ 4.8★ — matches the data).

## 4 — Product page (DONE)

- **Gallery** (`ProductGallery.tsx`): the generated cover in its three duotone treatments as switchable views with a thumbnail rail of real buttons (`aria-pressed`, keyboard/touch friendly). Every view is the same fixed-aspect `.cover` box, so switching cannot shift layout.
- **Sticky buy panel** (`.buy-panel`, sticky on desktop, static on mobile where the existing sticky bottom buy-bar takes over): category + badge, title, rating, price + compare-at, the big Add-to-Cart / gradient Buy-Now, delivery note, **express-pay note only when the `express_pay` flag is on AND Stripe or PayPal keys exist** (the exact rule the checkout page applies — an unconfigured store never advertises express pay), the guarantee line, and the Phase-4 commerce blocks (flash sale / PWYW / pre-order / subscription) moved inside the panel unchanged.
- **Guarantee section** (new on this page, the maison's framed band) after the preview; **product FAQ** section (the store FAQ set) after the verified reviews. What-you-get, formats, free preview (audio player / iframe), bundle upsell, related products, recommendations rail and the verified-reviews system are all unchanged and still rendered.

## 5 — Mobile-first (DONE, measured)

- **Bottom navigation** (`MobileNav.tsx`, in the locale layout): Home / Shop / Cart (live count badge) / Account, ≤640px only, safe-area padded, gradient active indicator mirroring the top nav; the active section derives from the pathname (product pages count as Shop). Measured live at 390px: `display:flex`, docked at viewport bottom (779–844 of 844), 4 items, active = Shop on a product page; the product page's sticky buy-bar now rests **62px** above the viewport bottom (clear of the nav), and the chat/cookie/install banners were lifted to 78px on small screens; `main` bottom padding grew accordingly.
- **Cart as a bottom sheet**: on ≤820px the cart summary panel (totals + gradient checkout) becomes sticky-docked above the bottom nav (bottom: 66px ≤640px, 12px at 641–820px), rounded sheet top, own scroll if tall — totals and checkout stay in thumb reach while items scroll. Verified visually with an item in the cart.
- **Zero-overflow verification** (the `mobile-bug-report.md` rect-scan method, extended to skip elements verifiably clipped by an `overflow:hidden/clip` ancestor — the marquee/aurora case): **18/18 cells clean** — routes `/en`, `/ar`, `/en/shop`, `/ar/shop`, product, cart × widths 320/360/390: `scrollWidth == innerWidth`, **0 offenders**. Re-run after the final CSS change on the three rebuilt pages × 320/390: **6/6 clean**. The masthead fix did not regress.

## Performance (re-measured after all changes)

Puppeteer/CDP, 390×780 @ DSF 2, **4× CPU throttle + Fast-3G** (150 ms RTT, 1.6 Mb/s), production build, median of 3 runs, homepage:

| Metric | Phase 2 | Phase 3 |
|---|---|---|
| LCP | 1564 ms | **1976 ms** ✓ (< 2500 ms budget) |
| CLS | 0.058 | **0.058** (unchanged) |

LCP rose within budget on this 2-core sandbox (the homepage now also resolves the sections layout + renders the trust section separately); CLS is identical to Phase 2 — the residual is the same font-swap reflow documented there; **none** of the Phase-3 additions (tilt, sheets, gallery, bottom nav) contribute layout shift (transform/opacity/fixed-position by construction).

## Screenshots (`~/workspace/astralium-preview/phase3/`, 20 files, all visually inspected)

Homepage, catalog and product at **320 / 390 / 1280** (EN); homepage AR at 390; homepage dark mode at 390; Quick View sheet, filter bottom sheet and cart-with-item at 390; admin Homepage-sections panel at 1280; tilt mid-hover at 1280; and palette variation: **cosmic-candy** home + catalog at 390, **aurora-dawn** home at 1280 + product at 390 (maison-classic is the default in the main set) — three palettes × both modes covered across the set.

## Defect found & fixed during this phase

The card tilt's first CSS used a `@media (hover: none), (pointer: coarse)` *override* to disable the transform on touch. Live verification showed the override also fires on touchscreen **laptops** (which report a coarse secondary pointer) and in any environment reporting `hover: none` — silently killing the tilt for real mouse users. The design was corrected twice: first to a positive `(hover: hover) and (pointer: fine)` gate, then — when this sandbox's headless shell proved unable to emulate those features at all (it reports `hover: none`, pointer neither fine nor coarse, and ignores `Emulation.setEmulatedMedia` for them) — to the robust architecture: **the transform is unconditional CSS, and the gate lives in the event handler's per-event `pointerType` check**, which is exact on every real device class. Final proof: real mouse → rotation matrix (above); touch taps produce `pointerType: touch` events the handler discards, so the variables never move.

## Rules compliance

- **No feature removed or broken**: the full 284-test baseline passes alongside the 7 new tests; the two homepage sections absent from the brief's list (New releases, guarantee) were retained as controllable sections rather than deleted.
- **i18n**: 22 new keys (quick view, catalog controls, collections, admin homepage panel, gallery, section names) with **native en + ar**; all other locales resolve via the project's documented per-key English fallback — counted openly by `check-i18n` (470 keys, 0 unresolved). No translations were fabricated.
- **Theme tokens only**: every new colour in the Phase-3 CSS block references palette variables (`--grad-*`, `--on-grad`, `--gold`, `--line*`, `--surface*`, …); no new hardcoded colours (the two `rgba(0,0,0,0.55)` sheet backdrops are neutral scrim, palette-independent by nature). Visually verified in maison-classic (light + dark), cosmic-candy and aurora-dawn.
- **Security posture**: no new API surface beyond the admin home-sections route, which follows the Phase-1 pattern exactly (`requireAdmin` + `readJsonBody` + audit log); no inline scripts added; CSP unchanged.
- **Env**: no new environment variables; `.env.example` unchanged.

## Not live-tested (and why)

- **DB persistence mode for the sections layout**: proven live in **file mode** (`.data/home-sections.json`) — this sandbox's app server ran without `DATABASE_URL`. The DB path is the same `config-store` upsert the theme and every other owner setting already exercise (the theme's DB mode carries the same note from Phase 2); the key-specific `Setting`-row round-trip was not exercised against PostgreSQL in this phase.
- **Real touch devices**: tilt exclusion on touch is proven by the handler's pointer-type contract + identity transform at defaults, and all tap targets were exercised via CDP taps/clicks; no physical device was available (the Phase-2 position stands).
- **Screen readers**: new dialogs carry `role="dialog"`/`aria-modal`, labelled buttons and focus-on-open, but no full AT pass was run.

## Remaining risks / future work

1. **Homepage LCP headroom narrowed** (1976 ms median under aggressive throttling on a 2-core sandbox): fine today, but the Phase-4/5 additions should re-measure; the `next/font` migration noted in Phase 2 remains the durable CLS/LCP lever.
2. **Cover motif vs discount badge**: on cards, the cover's corner motif glyph sits partially behind the new top-end discount badge. Cosmetic only; a motif reposition belongs to a cover-art pass, not this phase.
3. **CartClient BYO estimate** still reads the seed catalog for display math (server re-prices at checkout) — folding it into the resolver is a small follow-up outside this phase's surface.
4. The Quick View dialog does not yet trap focus (focus lands on Close; Escape/backdrop close) — a full focus trap is a Phase-4 admin/storefront a11y follow-up candidate.

## Key files

- New: `src/lib/home-settings.ts`, `src/lib/catalog-view.ts`, `src/app/api/admin/home-sections/route.ts`, `src/components/{HomeSectionsPanel,Tilt,QuickView,ProductGallery,MobileNav}.tsx`, `tests/phase9-storefront.test.mjs`.
- Changed: `src/app/[locale]/page.tsx` (ordered owner-controlled sections, visual categories with counts), `src/app/[locale]/product/[slug]/page.tsx` (gallery, sticky buy panel, express note, guarantee + FAQ sections), `src/app/[locale]/layout.tsx` (MobileNav), `src/app/[locale]/control-astralium/page.tsx` (sections panel), `src/components/{ProductCard,CatalogClient,CartClient}.tsx`, `src/app/globals.css` (Phase-3 block: tilt, quick view, catalog layout/sheets, gallery, buy panel, mobile nav, cart sheet), `src/i18n/dictionaries.ts` (+22 keys en/ar), `scripts/check-i18n.mjs` (key registry).
