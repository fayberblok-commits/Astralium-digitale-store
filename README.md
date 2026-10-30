# Astralium Digitale Store (v2)

A luxury digital-products store — ebooks, audiobooks, courses, templates,
music, software and design assets — that **runs and renders fully on Vercel
with no external database**. Checkout is real when payment keys are present
and honestly refuses (503) when they are not. Nothing is faked.

## One-command setup

```bash
npm install && npm run dev   # http://localhost:3000 → redirects to /en (or your browser language)
```

Production:

```bash
npm run build && npm start
npm test                     # Node's built-in runner: coupons, tokens, currency
```

Deploy on Vercel: import the repo, framework preset **Next.js**, no build
overrides. Set env vars (below) in Project → Settings → Environment
Variables and redeploy. Point Stripe's webhook to
`https://YOUR-DOMAIN/api/webhooks/stripe` and PayPal's to
`/api/webhooks/paypal`.

## Architecture — and why

- **File data layer instead of a database.** `src/data/products.ts` is a
  typed catalog module (12 products, 3 bundles, testimonials, FAQs) behind
  adapter-shaped accessors (`getProductBySlug`, `bundleProducts`, …). The
  previous store died because every page required a live Postgres. This
  store renders statically and sells with zero infrastructure; a Postgres
  adapter can implement the same accessors later without touching pages.
- **Hand-written CSS instead of Tailwind.** One design system in
  `src/app/globals.css` (≈18 KB, zero build dependencies, zero risk of a
  styling toolchain breaking the deploy), with dark (midnight navy + gold)
  and light (warm ivory) themes via CSS variables, RTL-aware logical
  properties throughout.
- **Local font stacks instead of webfonts.** Serif display (Playfair/Didot/
  Georgia stack) + geometric system sans — no font CDN, so builds and first
  paint never wait on the network.
- **No payment SDKs.** Stripe and PayPal are integrated over their REST
  APIs with `fetch`; Stripe webhook signatures are verified manually
  (HMAC-SHA256 + timestamp tolerance). Fewer dependencies, same security.
- **Downloads are cryptographic, not hopeful.** `src/lib/tokens.ts` mints
  HMAC-signed, expiring, download-capped tokens. Tokens are issued only
  after server-side payment verification (success page re-checks the
  Stripe session; the webhook is the system of record).

## Environment variables

See `.env.example` for the full annotated list (Stripe, PayPal, Resend,
admin, signing secret, S3-adapter placeholders, optional OpenAI). The store
browses fine with **none** of them set; each integration switches on when
its keys appear. The admin provider panel shows which are present.

## What's where

| Area | Location |
|---|---|
| Catalog data + accessors | `src/data/products.ts`, `src/data/legal.ts` |
| 40 locales + dictionaries | `src/i18n/locales.ts`, `src/i18n/dictionaries.ts` |
| Currency (static FX table) | `src/lib/currency.ts`, `/api/fx` |
| Cart/wishlist/orders (device) | `src/lib/store.tsx` |
| Coupons (pure engine) | `src/lib/coupons.ts`, `/api/coupon/validate` |
| Download tokens | `src/lib/tokens.ts`, `/api/download/[token]` |
| Checkout + fulfilment | `/api/checkout`, `/api/webhooks/*`, `src/lib/fulfill.ts` |
| Email (Resend or log-only) | `src/services/email.ts` |
| Support assistant (grounded) | `src/services/ai-support.ts`, `/api/support/chat` |
| Admin (obscure path) | `/[locale]/control-astralium`, `src/lib/admin.ts` |

Priorities honoured: (1) checkout + instant delivery, (2) design/UX,
(3) 40-language reach with full RTL, (4) owner control, (5) performance,
security headers, SEO (hreflang sitemap, JSON-LD, per-locale metadata).

See `docs/ADMIN_GUIDE.md` for running the store and `docs/LIMITATIONS.md`
for an honest list of what this release does **not** include yet.
