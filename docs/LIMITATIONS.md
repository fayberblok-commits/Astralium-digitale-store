# Limitations — what is NOT in this release (honest list)

This release is production-quality for browsing, catalog, cart, coupons,
real Stripe/PayPal checkout initiation, webhook fulfilment and signed
delivery. The following are **deliberately deferred**, with the seam where
each will land:

## Deferred features

1. **Voice AI agents** (sales/support/welcome personas, STT/TTS, agent
   "HR-style" management UI) — the text support assistant exists
   (`src/services/ai-support.ts`, grounded, no-hallucination guardrails,
   human handoff). Voice and persona management are a later phase.
2. **Full human translations for all 40 locales.** Routing, native names,
   RTL and formatting exist for all 40; complete UI dictionaries ship for
   **en + ar**, solid core dictionaries for **fr/es/de**; other locales
   fall back per-key to English. Product copy is English in this release.
3. **Stripe Tax / automated VAT-GST calculation.** Prices are tax-exclusive
   display in this release; enable Stripe Tax (or a MoR like Paddle/Lemon
   Squeezy) in the payments phase. Legal pages state taxes are calculated
   and shown before payment once enabled.
4. **Database persistence.** Orders are fulfilled via webhooks + structured
   logs + provider dashboards; cart/wishlist/order history live on the
   customer's device (`localStorage`). The Postgres adapter implements the
   same data accessors when accounts, cross-device sync, per-order download
   counting and admin order search are needed. Download `max` caps are
   carried inside tokens but only *counted* with the DB adapter.
5. **Accounts with passwordless/social login.** The account page is a
   device-local order + re-download centre in this release; verified
   re-downloads re-check the Stripe session server-side.
6. **Subscriptions/memberships, license-key generation, PDF watermarking,
   gift purchases, pay-what-you-want, pre-orders** — not included.
7. **A/B testing, live-sale notifications, exit-intent offers, loyalty
   points, affiliate program, advanced funnel/cohort analytics** — not
   included; analytics are provider/log based in this release.
8. **Admin CRUD UI.** The dashboard is read-only over the data layer;
   products/coupons/theme are edited in typed source files (see
   ADMIN_GUIDE). In-admin editing ships with the DB adapter.
9. **Regional payment gateways** (Mada, Tap, Paystack, Flutterwave,
   Razorpay, Paddle, Lemon Squeezy) — the unified checkout route is where
   each plugs in; Stripe already covers cards, Apple Pay, Google Pay,
   Link, iDEAL, SEPA, Bancontact, Klarna where enabled on the account.
10. **Real product files.** Downloads stream a generated, licensed
    deliverable package proving the signed pipeline end-to-end; the S3
    adapter (env placeholders reserved) serves production files.
11. **PayPal capture/webhook fulfilment** — order creation is real;
    webhook verification/final fulfilment activates with the merchant's
    PayPal webhook (skeleton route included, honestly labelled).
12. **FX rates are a dated static snapshot** (`FX_SNAPSHOT_DATE` in
    `src/lib/currency.ts`), not a live feed.

## Known constraints

- Static FX + USD-base pricing: converted prices are indicative; Stripe
  charges in USD in this release.
- Webhook idempotency uses an in-memory event set (per instance); the DB
  adapter makes it durable.
- Lighthouse targets depend on hosting; the app ships no external images
  or fonts to keep Core Web Vitals green by construction.
