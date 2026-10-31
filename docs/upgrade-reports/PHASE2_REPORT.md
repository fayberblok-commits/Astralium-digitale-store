# Astralium Digitale Store — Phase 2 Upgrade Report: Brand Identity, Theme System & Motion

**Scope executed:** the full Phase 2 brief — (1) admin-selectable theme system with live preview, light+dark per palette, CSS-token architecture, programmatic WCAG AA verification; (2) animated-gradient buy/checkout buttons and gradient nav indicators; (3) the animated homepage scene (aurora canvas scene, counters, marquee, scroll-reveal) inside a measured performance budget; (4) the complete brand identity kit in `brand/` plus an in-admin brand guide. **Nothing was pushed to GitHub and nothing was deployed** — all work is in the local tree `~/workspace/astralium-v2`, per the owner's standing rule (no publishing until he approves). Phase 1's security posture is untouched: no CSP change was needed (see §5).

---

## Final gate (verbatim outputs, run 2026-10-31 on the final tree, in sequence)

```
$ npm run lint        → exit 0        (eslint . — 0 errors, 0 warnings)
$ npm run typecheck   → exit 0        (tsc --noEmit)
$ npm test            → ℹ tests 284 · ℹ pass 284 · ℹ fail 0
$ npm run build       → exit 0        (✓ Compiled successfully)
$ npm run test:e2e    → exit 0        (E2E SMOKE: 15/15 checks passed)
```

Test count grew from the Phase-1 baseline of 275 to **284** (+9 in `tests/phase8-themes.test.mjs`); all pre-existing tests still pass. Supporting checks: `npm run check-i18n` → **448 keys × 40 locales, en/ar 448/448 native, 0 unresolved**; `node scripts/check-contrast.mjs` → **156/156 pairs pass**.

---

## 1 — Theme system (DONE, live-proven)

**Architecture.** `src/lib/themes.ts` is the single source of truth: six palettes, each with a complete light **and** dark token set plus a 4-stop animated gradient and glow colour. The `[locale]` layout reads the owner's choice server-side (`src/lib/theme-settings.ts`, persisted through the repo's JSON config store — DB `Setting` row `storefront_theme` when a database is configured, `.data/theme.json` otherwise) and server-renders the palette's tokens as one `<style>` block with `html[data-palette="…"][data-theme="…"]` selectors that out-specify the `globals.css` baselines. A palette switch therefore applies **storefront-wide with no rebuild and no redeploy**, in both modes, for every visitor.

**The palettes** (the five suggested bright identities, plus the preserved original):

| Palette | Character |
|---|---|
| `maison-classic` | **The owner's earlier identity, preserved token-for-token** (warm ivory `#f6f1e7` / ink `#171512` / antique gold `#a8842c` / champagne `#d6be8c`) — a regression test pins these exact values |
| `aurora-dawn` | Dawn rose, brick, ochre, deep teal on warm ivory / twilight violet |
| `tropical-glow` | Jungle teal, palm, sunset, hibiscus; mango-gold accents on dark |
| `cosmic-candy` | Fuchsia, violet, blueberry, candy pink on a cosmic night |
| `emerald-gold` | Emerald depths with antique gold — the closest cousin of the classic |
| `electric-blue` | Electric blue/cyan on pale ice / deep marine |

**Admin panel with live preview** (`src/components/ThemePanel.tsx`, API `GET/POST /api/admin/theme`, `settings` permission, audit-logged as `theme.update`). Each palette card renders a miniature storefront mock in that palette's own tokens; clicking a card injects that palette's token stylesheet (the very same `paletteCss()` generator the layout uses) and flips `data-palette` on the live admin page — the preview the owner sees is pixel-identical to what visitors get. Mode default (system/light/dark for first-time visitors; the visitor's own toggle still wins) and the motion master switch are in the same panel. Leaving without saving restores the saved look; saving persists.

**Live proof (HTTP, two separate server processes):**
```
POST /api/admin/theme {"palette":"electric-blue",…}  → {"ok":true,…,"persisted":"file"}
GET  :3100/en (different process)                    → <html data-palette="electric-blue">
POST /api/admin/theme {"palette":"maison-classic",…} → {"ok":true,…}
GET  :3100/en                                        → <html data-palette="maison-classic">
POST /api/admin/theme (no session)                   → 401
```

**WCAG AA, verified programmatically** (`scripts/check-contrast.mjs`, shared math in `lib/themes.ts`, enforced by unit tests): 13 pairs per palette × mode — text/muted/accent-ink on bg, surface and surface-strong; button text on button bg; on-gradient text on **every** gradient stop (4.5:1 class); accent on bg (3:1 large/focus class). **156/156 pass.** Weakest 4.5-class pair per palette×mode ranges **4.90:1 (emerald-gold) to 6.70:1 (cosmic-candy dark)**; the single tightest value overall is maison-classic light's decorative accent at 3.11:1 against its 3:1 requirement.

## 2 — Buttons & navigation (DONE)

- **`.btn-grad`** (new, palette-driven): a 4-stop gradient that slides slowly (8 s alternate), brightens and speeds on hover with a light-sheen sweep, soft palette glow shadow, a real press state (`scale .98`), and a spinner loading state via `[data-loading="true"]`. Applied exactly to the money actions: **Buy Now** (product page, cards, and the sticky bottom buy-bar), **cart → checkout**, **checkout Pay** (with the spinner while processing), and **Subscribe**. Confirmed live: the product page's Buy button computes to `linear-gradient(115deg, rgb(142,42,92), rgb(178,58,72), rgb(168,91,30), …)` under Aurora Dawn — the palette's exact stops. Add-to-cart and admin buttons keep the classic primary style.
- **Nav indicator**: top-bar links get a gradient underline bar that grows from the section side (RTL-aware origin); the active section (pathname-derived, product pages count as Shop) is fully extended and lit, partial on hover. The sticky buy-bar inherits the gradient Buy button. Verified in screenshots (SHOP indicator lit on the product page; HOME on the homepage).
- **Reduced motion**: the global `prefers-reduced-motion` rule already freezes CSS animation; the gradient then rests as a static 4-colour gradient. The owner's motion toggle (`html[data-motion="off"]`) also freezes `.btn-grad` and every scene animation.

## 3 — Animated homepage scene (DONE, budget measured)

Inside the existing gilt hero frame (all layers absolutely positioned behind the copy — **zero layout impact by construction**):

- **Aurora**: three blurred radial-gradient blobs in the palette's gradient colours, drifting on 17–26 s loops.
- **Canvas starfield** (`HeroScene.tsx`): ≤ 90 twinkling, slowly drifting stars coloured from the live CSS variables (`--gold`, `--champagne`, `--grad-2` — recolours itself when the mode/palette changes via MutationObserver), DPR capped at 1.5, particle count scaled to area.
- **Floating shapes**: two glass orbs (radial highlight + gilt rim) and three ✦/✧ glyphs on gentle float loops.
- **3D covers**: the top-3 products' real covers in a perspective row, swaying `rotateY ±13°` with staggered delays (server-rendered — no async shift).
- **Animated counters**: real numbers only — product count (12), languages (40), average rating (4.8 ★), guarantee days (14) — counted up on first view with ease-out cubic.
- **Marquee**: trust badges + real testimonial names/ratings/star counts in a seamless −50% loop, edge-masked, pause-on-hover.
- **Scroll-reveal**: homepage sections fade-rise via IntersectionObserver. Reveal-hidden styles apply **only** when `html.js` is present (set by the existing inline theme script), so no-JS visitors always see everything; a 2.5 s safety timer reveals anything unobserved.

**Degradation contract** (checked in order, all client-side): owner motion toggle off → no canvas, CSS frozen; `prefers-reduced-motion` → static aurora only, counters render final values; Save-Data or single-core CPU → no canvas; tab hidden or scene off-screen → rAF loop paused (visibilitychange + IntersectionObserver).

**Performance, measured** (Puppeteer/CDP, 390×780 @ DSF 2, **4× CPU throttle + Fast-3G** (150 ms RTT, 1.6 Mb/s), production build on this 2-core sandbox, median of 3 runs):

| Configuration | LCP | CLS |
|---|---|---|
| Scene ON (Aurora Dawn) | **1564 ms** ✓ (< 2500 ms budget) | 0.058 |
| Scene OFF (owner toggle) | 1628 ms | 0.058 |

The scene costs nothing measurable. **Honest CLS note:** the brief targeted CLS ≈ 0; the scene itself contributes **zero** (transform/opacity only — verified by attribution). The residual 0.058 — comfortably inside the "good" < 0.1 band — is two font-swap reflows (Inter at ~2.9 s, Playfair at ~3.7 s under this aggressive throttling) identified via `layout-shift` source attribution. A font-preload fix was attempted and **reverted**: Next's RSC layer has no loader for direct `.woff2` imports (`Module parse failed`), and preloading URLs that differ from the Fontsource `@font-face` URLs would double-download. On unthrottled real networks the subsets (15–30 KB, same origin) land far earlier; the durable fix (next/font migration) is noted as future work, not silently claimed.

**Screenshots** (`~/workspace/astralium-preview/phase2/`, 18 files, all visually inspected): homepage in maison-classic / aurora-dawn / cosmic-candy × light+dark × 390+1280, aurora at 320, tropical-glow shop (dark, 390), emerald-gold scrolled mid-page (reveal + sections), product page (aurora dark 390 — gradient Buy + nav indicator), admin theme panel and brand guide at 1280. Two defects were found and fixed during this pass: the canvas rendered at its intrinsic 300×150 (replaced-element sizing — now `width/height:100%`), and the brand panel's SVG lockups collapsed (wrapper is now a block with `width:100%`).

## 4 — Brand identity kit (DONE)

**The mark** (`src/lib/brand.ts`, single source): an original parametric astroid **star** inside a fine **ring**, crossed by a tilted **orbit** with one **planet** and an ivory core jewel — geometry generated from a curve equation; it copies no other brand's marks. The header now wears it as an inline SVG that recolours with the palette.

**Kit in `brand/`** (generated by `node scripts/generate-brand.mjs` from `lib/brand.ts` + `lib/themes.ts`; served copies in `public/brand/`):

- `logo/` — symbol, colour horizontal, dark-ground horizontal, mono ink, mono ivory, stacked ×2 (7 SVGs)
- `social/` — profile 1024², WhatsApp profile 640², Instagram square 1080², Facebook cover 1640×924 (rasterised per-pixel: mark + star scatter on deep ink)
- `COLORS.md` — every palette × mode token table, generated from the source of truth
- `BRAND.md` — usage rules, clear-space/min-size, voice, taglines
- `templates/` — branded `email.html` shell, three product-cover SVGs (classic/aurora/emerald duotones), `og-template.md`
- **PWA icons regenerated in the new identity** (orbit added to the mark) by the updated `scripts/generate-icons.mjs` — runs automatically as `prebuild`; favicon is now the SVG symbol (`/brand/logo/logo-symbol.svg`, served 200 `image/svg+xml`)

**Typography**: Playfair Display (Latin display) + **Amiri** (Arabic display) + Inter (Latin text) + **IBM Plex Sans Arabic** (Arabic text), self-hosted via Fontsource (4 new pinned deps, no font CDN; `font-src 'self'` already permits them). `:root[lang="ar"]` promotes Amiri/Plex to first position so Arabic gets true display typography.

**Email identity**: `receiptEmailHtml` now renders inside `brandedEmailShell()` (ink header, ✦ mark, wordmark, gilt double-rule footer) — same content and download links, verified by the unchanged receipt/webhook test suites.

**OG images**: the store card gained the aurora accent bar and the ringed mark (`/en/opengraph-image` → 200 `image/png` verified); the product OG route is unchanged.

**Admin brand guide** (`BrandGuidePanel`): logo variants on light/dark/mono chips, the tagline in en/ar/fr/es/de, brand voice, typography specimens (Playfair + Amiri rendered live), the active palette's swatch table, asset links, and the trademark warning (below).

> ### ⚠ TRADEMARK SEARCH — REQUIRED BEFORE ADOPTING THIS LOGO
> The mark and name are an original design produced for this store, but **no trademark clearance search was performed** (per the brief, it is flagged, not executed). Before trading under “Astralium” or registering the logo, the owner must run a clearance search for “Astralium” and similar marks in his markets and Nice classes (notably 9, 35, 41) and take local IP advice. This warning also lives in `brand/BRAND.md` and in the admin brand guide.

## 5 — Rules compliance

- **No feature removed or broken**: baseline 275 tests all pass; two deliberate visual upgrades only — buy/checkout CTAs moved from `btn-primary` to `btn-grad`, and the header's ✦ glyph became the SVG mark (same slot, 26 px). The ThemeToggle/localStorage mode behaviour is unchanged; the owner's server-side mode is only the *default* for first-time visitors.
- **Phase-1 security posture intact**: the palette `<style>` block carries the middleware nonce; no inline scripts were added or changed except the theme script (still nonced); canvas is same-origin code (no new `connect-src`/origins); `style-src 'unsafe-inline'` is the pre-existing documented posture Phase 1 already reported. Theme POST is behind `requireAdmin("settings")` + audit log, and its GET requires `read`.
- **i18n**: 36 new keys (theme panel, brand guide, palette names, hero stat labels) with **native en + ar**; all other locales resolve via the project's documented per-key English fallback — counted openly by `check-i18n` (448 keys, 0 unresolved), exactly the Phase-1 model. **No translations were fabricated.** The brand *tagline* additionally ships in fr/es/de in the brand kit (brand copy, not UI strings).
- **Env**: **no new environment variables** were needed (theme persists via the existing config store), so `.env.example` and the zod startup validation are unchanged.
- **Secrets scan**: `npm run scan:secrets` — 344 files, 0 hits in any Phase-2 file. (5 hits flagged in `scripts/verify-phase1-security.mjs` are that Phase-1 harness's own local test fixtures — pre-existing, untouched by this phase, noted here for the owner's awareness.)

## Not live-tested (and why)

- **Real devices / real networks**: all measurements are CDP emulation on this sandbox (2-core VM) — LCP/CLS on physical mid-range phones will differ (likely better CPU, variable radio). No physical-device run was possible.
- **DB persistence mode**: theme persistence was proven live in **file mode** (`.data/theme.json`) — this sandbox's app servers ran without `DATABASE_URL`. The DB path is the same `config-store` upsert every other owner setting (offers, bundles) already uses in production, but the `Setting`-row round-trip for the theme key specifically was not exercised against PostgreSQL in this phase.
- **Screen readers / full a11y audit**: contrast is machine-verified and the new controls are native inputs with labels/fieldsets, but no AT pass was run.
- **Email rendering**: the branded shell uses the same table/inline-style pattern as before and its content is covered by unit tests; no live Resend send was made (no key — the Phase-1 position stands).

## Remaining risks / future work

1. **Font-swap CLS (0.058 under heavy throttling)** — a `next/font` migration would eliminate it via metric-matched fallbacks; deferred as a deliberate, separately-testable change.
2. **Style-tag palette injection** depends on the documented `style-src 'unsafe-inline'` posture; the eventual CSP tightening Phase 1 described (nonce-only styles) would need the palette block nonced per-response — it already carries the nonce attribute, so the change would be small.
3. **SVG wordmarks use live text** — print workflows without the brand fonts must convert text to outlines first (stated in `BRAND.md`).
4. Palette count is six; adding more is a data-only change in `lib/themes.ts` (tests + contrast script will hold the AA line).

## Key files

- New: `src/lib/{themes,theme-settings,brand}.ts`, `src/components/{ThemePanel,BrandGuidePanel,Logo,NavLinks,HeroScene,Marquee,ScrollReveal}.tsx`, `src/app/api/admin/theme/route.ts`, `scripts/{check-contrast,generate-brand}.mjs`, `scripts/lib/png.mjs`, `tests/phase8-themes.test.mjs`, `brand/` (18 files), `public/brand/` (13 served copies).
- Changed: `src/app/[locale]/layout.tsx` (palette attrs + token style + fonts + favicon), `src/app/[locale]/page.tsx` (scene, stats, covers, marquee, reveal), `src/app/globals.css` (font stacks, `.btn-grad`, nav indicator, scene/marquee/reveal/panel CSS, mobile hero polish), `src/components/{Header,Buttons,CheckoutClient,CartClient,ProductCommerce}.tsx`, `src/app/[locale]/control-astralium/page.tsx` (two panels + corrected settings note), `src/app/[locale]/opengraph-image.tsx`, `src/services/email.ts` (branded shell), `src/i18n/dictionaries.ts` (+36 keys en/ar), `scripts/{check-i18n,generate-icons}.mjs`, `package.json` (4 pinned Fontsource deps).
