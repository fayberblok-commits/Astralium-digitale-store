# Admin Guide — Astralium Digitale Store

## Getting in

1. Set `ADMIN_PASSWORD` (≥ 8 characters, long and random) in your hosting
   environment variables and redeploy.
2. Open `https://YOUR-DOMAIN/en/control-astralium/login` (replace `en` with
   any locale). There are **no public links** to this area anywhere on the
   store — bookmark it.
3. Sessions last 8 hours (httpOnly cookie, HMAC-signed; rotating the
   password invalidates all sessions instantly).

If `ADMIN_PASSWORD` is unset, the login page explains exactly that instead
of accepting anything.

## The dashboard

- **Stat cards** — live counts from the data layer (products, bundles,
  catalog value, average rating, active coupons).
- **Provider panel** — shows which integrations are configured by reading
  env-key *presence only* (values are never displayed): Stripe, PayPal,
  Resend email, OpenAI support, download signing, admin.
- **Products & coupons tables** — the current catalog and coupon rules.

## Day-to-day operations (this release)

| Task | How |
|---|---|
| Add/edit a product | Edit `src/data/products.ts`, redeploy (or push via git). Prices, badges, includes, preview text live there. |
| Add a coupon | Add an entry in `src/lib/coupons.ts` (percent/fixed, first-order, country, minimum, limit, expiry). |
| Change prices per currency | Customers see USD prices converted by the static FX table (`src/lib/currency.ts`); edit the snapshot rates or switch currencies there. |
| Refund a customer | One click in the Stripe/PayPal dashboard. Then revoke access: rotate `DOWNLOAD_SIGNING_SECRET` only if you must invalidate *all* links; per-order revocation ships with the DB adapter. |
| Read orders | Stripe webhook fulfilments + receipt emails are logged as structured JSON (`order.fulfilled`) in your hosting logs; receipts are emailed via Resend when configured. |
| Translations | Edit `src/i18n/dictionaries.ts` (en/ar complete; fr/es/de core; others fall back to English per key). |
| Theme & branding | CSS variables at the top of `src/app/globals.css` (gold/violet, dark & light themes). |

## Going live checklist

1. Stripe keys + webhook endpoint `/api/webhooks/stripe` (event:
   `checkout.session.completed`), set `STRIPE_WEBHOOK_SECRET`.
2. `DOWNLOAD_SIGNING_SECRET` — long random string (≥ 32 chars).
3. `ADMIN_PASSWORD` set.
4. `NEXT_PUBLIC_SITE_URL` = your production domain.
5. `RESEND_API_KEY` + verified `EMAIL_FROM` domain (receipts/downloads).
6. Have the legal templates reviewed by a lawyer (they say so on-page).
7. Optional: PayPal keys + webhook; `OPENAI_API_KEY` for model-assisted
   support answers (still grounded in catalog/policy context).
