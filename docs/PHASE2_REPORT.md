# Phase 2 Report — Social Delivery (WhatsApp / Messenger / Instagram)

Date: 2026-10-30 · Scope: Part A of the six-phase expansion — delivery of
download links via WhatsApp, Facebook Messenger and Instagram, with email
always as the automatic fallback. Nothing was pushed to GitHub or deployed.

## What was built

### 1. Unified delivery core — `src/services/delivery/`
- `types.ts` — `DeliveryChannel` interface `{ key, isEnabled(), isConfigured(), missingEnv(), send(ctx) }`,
  `DeliveryContext`, `DeliveryResult`, `DeliverableOrder`.
- Adapters: `email.ts` (wraps the Phase-1 Resend service; honest `queued`
  status in log-only mode), `whatsapp.ts` (Cloud API template + free-form),
  `messenger.ts` / `instagram.ts` (Send API, reply-only per Meta rules).
- `attempts.ts` — every attempt recorded (DB `DeliveryAttempt` when
  configured, in-memory mirror always): order id, channel, status,
  provider error **code**, idempotency key, grant id, provider message id.
  **No message bodies, no recipient PII, ever.**
- `index.ts` — orchestrator `deliverOrder(order, channel)`:
  idempotency short-circuit per `(orderId, channel, grantId)` → flag/config
  gate (recorded as failed attempt) → send with 8s timeout + up to 2
  retries with backoff on retryable errors → **automatic email fallback**
  on any failure/timeout of the chosen channel.
- Only the store's signed download links (`/api/download/<HMAC token>`)
  are ever sent — no raw S3/storage URLs anywhere (asserted in tests).

### 2. Claim codes + referral tokens — `src/lib/claim-codes.ts`
- Short one-time codes `AST-XXXX-XXXX` (unambiguous alphabet), order-bound,
  7-day expiry, **single-use** (marked used before links are issued).
  Only the SHA-256 hash is stored — new Prisma model `ClaimCode`
  (+ migration `20261030150000_phase2_delivery`), in-memory fallback.
- Signed `ref` tokens (HMAC, domain-separated `ref:` prefix) for
  `m.me/<page>?ref=` and `ig.me/m/<user>?ref=` deep links.

### 3. Privacy layer — `src/lib/pii.ts`, `src/lib/phone.ts`
- AES-256-GCM encryption with scrypt-derived key from `PII_ENCRYPTION_KEY`;
  ciphertext format `v1:salt:iv:tag:data`. Subjects indexed by SHA-256
  hash only. Consent via `ConsentRecord` (+ new `subjectCipher` column):
  opt-in recorded at checkout; STOP writes `granted=false`; the WhatsApp
  adapter refuses opted-out numbers before any Meta call.
- Phone validation/normalisation (E.164) with `libphonenumber-js`
  (new dependency, `/min` build), country auto-detect + checkout country
  select. Invalid numbers are rejected client- AND server-side.

### 4. WhatsApp adapter — `src/services/delivery/whatsapp.ts`
- Template send: `WHATSAPP_TEMPLATE_NAME` (default `astralium_delivery`),
  parameters `{{1}}` order id, `{{2}}` signed link; locale-aware template
  language with `en_US` fallback. Free-form text send for the 24h window.
- The Stripe webhook now completes the proactive path: checkout stores
  only the phone **hash** in Stripe metadata; the webhook recovers the
  number from its encrypted consent record and calls `deliverOrder`
  (whose email fallback then acts as the receipt — no duplicates).

### 5. Webhooks — `src/services/delivery/meta-webhook.ts` + routes
- `POST /api/webhooks/whatsapp`, `POST /api/webhooks/meta`, GET
  verification for both (`WHATSAPP_VERIFY_TOKEN` /
  `META_WEBHOOK_VERIFY_TOKEN`). `X-Hub-Signature-256` verified with
  `META_APP_SECRET` (timing-safe) over the raw body **before** parsing.
- Dedupe by provider message id (bounded in-memory set; claim codes are
  inherently replay-proof). Handled: claim-code messages (all 3 channels),
  signed referral refs (Messenger/Instagram), Instagram claim-code
  fallback, WhatsApp **STOP / إيقاف** opt-out + confirmation, and message
  status events (`sent/delivered/read/failed`) correlated to attempts by
  provider message id.

### 6. Storefront UX
- Checkout: delivery-channel choice appears only for channels that are
  flag-ON **and** configured (server-computed); email default. WhatsApp
  reveals phone + country + explicit opt-in checkbox; the API re-validates
  (`INVALID_PHONE`, `WHATSAPP_OPTIN_REQUIRED`).
- Success page (verified orders only): claim code + `wa.me` / `m.me` /
  `ig.me` buttons for available channels + **"Email it to me"**
  (`POST /api/delivery/email`, re-verifies the Stripe session first).
- All new strings are i18n keys — en + ar native, other 38 locales via
  the existing English fallback (counted by check-i18n, not hidden).

### 7. Admin — "Delivery channels" section
- Per-channel flag state + provider readiness (env presence only),
  WhatsApp template status panel (name + "submit in Business Suite"
  note — approval state is not knowable from here), channel stats,
  delivery log (latest attempts), manual resend
  (`POST /api/admin/delivery/resend`, session-gated; resolves items from
  the DB Order when present, else honestly returns 422 asking for
  email+productIds). `providerStatus()` gained WhatsApp/Messenger/
  Instagram/PII groups; startup env validation warns on partial Meta
  key groups.
- Legal: "Messaging & delivery privacy" section (en + ar native) added
  to the Privacy Policy — encrypted storage, purpose limitation, STOP,
  deletion on request.

### 8. Schema changes
- New model `ClaimCode`; `DeliveryAttempt.grantId/providerRef/updatedAt`;
  `ConsentRecord.subjectCipher`; `Order.deliveryChannel/deliverySubjectHash`.
  Migration: `prisma/migrations/20261030150000_phase2_delivery/migration.sql`
  (additive only). `prisma validate` ✓. Note: in this sandbox the Prisma
  engine download endpoint resets connections, so `prisma generate` was
  run with the already-vendored local engines
  (`PRISMA_QUERY_ENGINE_LIBRARY` / `PRISMA_SCHEMA_ENGINE_BINARY` env) —
  the generated client now includes the new models. Normal CI/deploy
  environments with network access generate as usual via postinstall.

### 9. Supporting change — `src/lib/flags.ts`
- `envFlagOverride()`: `FLAG_<KEY>=1|0` env bootstrap, consulted only
  when no DB row exists (DB stays the owner's source of truth). Needed
  to exercise flag-gated paths in tests/first boot without a database.
  All pre-existing flag tests pass unchanged.

## Gates — exact results (2026-10-30)

```
npm test            → tests 69 · pass 69 · fail 0   (37 pre-existing + 32 new)
npx tsc --noEmit    → OK (no output)
npm run build       → OK — routes include /api/webhooks/whatsapp,
                      /api/webhooks/meta, /api/delivery/email,
                      /api/admin/delivery, /api/admin/delivery/resend
node scripts/check-i18n.mjs → exit 0 — 66 keys (33 new) × 40 locales,
                      en 66/66 native, ar 66/66 native, 0 unresolved
```

Runtime smoke (built server, dummy env):
```
GET  /api/webhooks/whatsapp?hub.mode=subscribe&verify_token=ok   → 200 "CH42"
GET  /api/webhooks/whatsapp (wrong token)                        → 403
POST /api/webhooks/whatsapp (bad X-Hub-Signature-256)            → 403
POST /api/webhooks/meta     (bad X-Hub-Signature-256)            → 403
GET  /api/webhooks/meta?hub.mode=subscribe&verify_token=ok       → 200 "CH99"
GET  /api/admin/delivery (no session)                            → 401
```

New tests (`tests/pii.test.mjs`, `tests/claim-codes.test.mjs`,
`tests/phone.test.mjs`, `tests/delivery.test.mjs`,
`tests/meta-webhook.test.mjs`) cover, with Meta/Stripe fully mocked:
claim sign/redeem/expire/**reuse-reject**; ref-token verify + tamper;
webhook signature valid/invalid; duplicate-message dedupe; expired code;
invalid phone rejected; STOP (EN + AR) sets opt-out; orchestrator
fallback to email on failure AND on timeout; flag-gate fallback; opt-out
refusal before any Meta call; idempotent re-delivery; PII
encrypt/decrypt round-trip + tamper/wrong-key rejection; assertion that
no raw phone appears in consent or attempt records.

## NOT live-tested (and why)

- **Real WhatsApp/Messenger/Instagram delivery** — no owner Meta app,
  WhatsApp Business number, Page/IG tokens, or approved template exist
  yet. Every Meta call is behind the global `fetch`, and all flows above
  were exercised end-to-end against stubbed Graph API responses. The
  owner's setup steps are in `docs/META_WHATSAPP_SETUP.md`; template
  text for submission is in `docs/whatsapp-template.md`.
- **Template approval status** — unknowable from the store; the admin
  panel reports only the configured template name, honestly labelled.
- **DB-backed paths against a live Postgres** — no DATABASE_URL exists
  in this environment (same constraint as Phase 1). DB writes are
  try/caught with the in-memory mirror as fallback, and the schema +
  migration validate cleanly.
- **Proactive WhatsApp send after a real Stripe payment** — the webhook
  wiring is code-complete and unit-covered at the orchestrator level,
  but no live Stripe payment + real phone number was available to run
  it against.
