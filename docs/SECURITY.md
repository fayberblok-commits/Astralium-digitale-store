# Security — Astralium Digitale Store (Phase 1 upgrade)

This document is the operator's companion to the Phase 1 security
hardening. It describes what protects the store, how to rotate keys,
and the known limits. It never claims the store is "unhackable" —
security is layered defence plus honest monitoring.

## Key separation & rotation (§5)

One master secret is never used directly. `src/lib/keys.ts` derives a
separate HMAC key per purpose with HKDF-SHA-256:

| Purpose | Used for | Root secret |
|---|---|---|
| `download-token` | download links | AUTH_SECRET → DOWNLOAD_SIGNING_SECRET |
| `claim-code` | library claim links | AUTH_SECRET → DOWNLOAD_SIGNING_SECRET |
| `order-access` | receipt/order cookie binding | AUTH_SECRET → DOWNLOAD_SIGNING_SECRET |
| `admin-session` | bootstrap-owner sessions | AUTH_SECRET → ADMIN_PASSWORD |
| `team-session` | team sessions | AUTH_SECRET → ADMIN_PASSWORD |
| `step-up` | 5-minute elevation tokens | AUTH_SECRET → ADMIN_PASSWORD |

Derived artifacts carry `v2.` prefixes. Pre-upgrade tokens (raw-secret
HMAC, and the old development default outside production only) still
verify so in-flight customer links survive a deploy.

**Rotation procedure**

1. Generate a new secret: `openssl rand -base64 48`.
2. Set it in the hosting dashboard (Vercel → project → Environment
   Variables) for `DOWNLOAD_SIGNING_SECRET` (download family) and/or
   `AUTH_SECRET` (everything), then redeploy.
3. Effect: download/claim links signed with the old key stop verifying
   (buyers can re-claim from their library or a fresh receipt email);
   admin/team sessions signed with the old root stop verifying (the
   team signs in again). There is no dual-key window by design — rotate
   during a quiet period and announce it.
4. For a full cryptographic break-glass, bump `KEY_VERSION` in
   `src/lib/keys.ts` and ship it with the new secret: every derived key
   changes even if a root is reused.
5. Admin sessions can also be revoked WITHOUT rotating secrets:
   Security Center → "Sign out all sessions" (bumps the session epoch).

**Weak-secret policy**: in production, an `ADMIN_PASSWORD` under 12
characters disables admin login, and a `DOWNLOAD_SIGNING_SECRET` under
32 characters is refused — downloads then use an ephemeral per-boot key
(tokens work until the next restart) and an error is logged at startup
(`src/lib/env.ts` also flags both). The server never refuses to BOOT:
the public store stays up while the owner fixes the secret.

## Admin access (§4, §6)

- The admin path defaults to `/[locale]/control-astralium` and can be
  renamed with `ADMIN_PATH`. It is deliberately NOT listed in
  robots.txt or the sitemap, and every admin page carries
  `noindex, nofollow` — but the path is not the protection; auth is.
- Sessions are `v3` tokens in httpOnly + Secure (production) +
  SameSite=Lax cookies: 8-hour absolute cap, idle timeout
  (`ADMIN_SESSION_IDLE_MINUTES`, default 60), rotation on sign-in,
  epoch-based terminate-all.
- **Breaking change**: the pre-upgrade fixed session token format is
  rejected. Everyone signs in once after the upgrade deploy.
- TOTP 2FA: team `owner`/`admin` roles MUST enrol (they receive a
  setup-only session until they do). The bootstrap owner must enrol
  when `ADMIN_TOTP_REQUIRED=1`. Backup codes are single-use, stored
  hash-only, shown once. A replayed TOTP code (same time step) is
  rejected.
- Step-up: refunds, team create/role/delete, bank-data-class actions,
  TOTP disable and terminate-all require a fresh step-up token
  (password + TOTP, 5 minutes, bound to the actor) via
  `POST /api/admin/step-up`.
- Lockout: 5 failed sign-ins per account inside 15 minutes locks the
  account for 15 minutes. The lock is DURABLE (database/file state),
  so restarts do not reset it. Limits per IP apply independently.
- A sign-in from an unrecognized device (UA + IP-prefix fingerprint)
  writes a security event and alerts the owner center (+ email to
  `ADMIN_ALERT_EMAIL` when an email provider is configured).

## Payments integrity (§8)

- Orders exist in a real ledger (`src/lib/orders.ts`): checkout creates
  a PENDING order; the ONLY path to PAID is the state machine's
  `markPaidAndGrant`, reachable from PENDING, driven by verified
  webhooks. REFUNDED/FAILED are terminal — a refunded order can never
  return to PAID. Duplicate webhook deliveries create no duplicate
  grants (idempotency anchor: the provider session/order id, unique).
- Stripe webhooks verify the HMAC signature manually (raw body); a bad
  signature is logged as a security event. PayPal webhooks are verified
  through PayPal's `verify-webhook-signature` API; unverifiable events
  are rejected with 400 (the previous accept-anything skeleton is
  gone). PayPal completion captures the approved order server-side.
- Disputes (Stripe `charge.dispute.*`, PayPal `CUSTOMER.DISPUTE.CREATED`)
  move the order to `disputed`, revoke download grants and alert the
  owner. A dispute closed as "won" leaves grants revoked for an owner
  decision; "lost" applies the refund transition.
- Missed refunds are recovered two ways: the `charge.refunded` handler
  reconciles via the charge's payment intent, and
  `POST /api/jobs/reconcile-orders` (cron-secret gated) sweeps PENDING/
  PAID orders against Stripe and applies any refund it finds.
- Stripe API version is pinned: `2024-06-20` (`src/lib/stripe.ts`).

## Data exposure rules (§7)

- The success page shows the buyer email MASKED (`j***@example.com`).
- Receipts: full receipt PDFs require either a verified Stripe session
  (re-checked server-side) or the short-lived `astralium-order-access`
  cookie (HMAC-bound to one order, 1 hour) minted by
  `POST /api/orders/access` after a server-side session verification.
  The PDF itself names the buyer — it is their invoice — but it is no
  longer fetchable by anyone holding only a session id.
- No state changes via GET anywhere in the new code paths.

## Uploads & downloads (§9)

- Uploads: extension allowlist + filename sanitization + 5 GB cap at
  presign; at confirm time the object's real bytes must match the
  claimed format's magic bytes (`src/lib/file-sniff.ts`) and the real
  size is enforced from the HEAD response. Mismatches are deleted from
  storage, refused, and logged as security events.
- Storage stays private; downloads are short-lived presigned URLs
  behind HMAC tokens whose grants live in the order ledger (revocable,
  download-counted).

## Database (§11)

- Least privilege: the application role needs DML on the app schema
  only. Run migrations (`prisma migrate deploy`) with a separate,
  stronger migration role; the runtime `DATABASE_URL` role should NOT
  be a superuser and should not own the tables. Never use `db push`
  against production (it skips migration history and extensions such
  as pg_trgm that search relies on).
- Unique constraints: `Order.providerRef` (provider session/order id),
  `DownloadGrant.tokenHash`, email-keyed settings. Indexes on
  `Order(email)` and `Order(status, createdAt)`.
- Cleanup: `POST /api/jobs/security-cleanup` (cron-secret gated)
  removes expired claim codes, prunes the security log past 90 days
  and drops stale login guards. Orders and grants are never deleted by
  cleanup (financial records).
- Backups: `npm run backup:db` writes an AES-256-GCM encrypted backup
  (pg_dump engine when available, else a Prisma logical export);
  `npm run restore:db -- <file> --yes` restores and verifies row
  counts. Keep `BACKUP_ENCRYPTION_KEY` somewhere other than with the
  backups. Both directions were executed and proven locally.

## Supply chain (§12)

- All direct dependencies are pinned to exact versions in
  `package.json` (no `^` ranges); the lockfile is committed.
- CI (`.github/workflows/ci.yml`) runs the full gate plus
  `npm audit --audit-level=high`, gitleaks, the repo's own secret scan
  (`npm run scan:secrets`) and Semgrep (TypeScript/OWASP/secrets).
- Dependabot (`.github/dependabot.yml`) opens weekly update PRs.

## Monitoring (§13)

- `src/lib/security-log.ts` records failed sign-ins, lockouts, CSRF
  rejections, denied admin access, bad webhook signatures, disputes,
  refunds, TOTP enrollment, step-up grants, session termination and
  rejected uploads — to the `SecurityLog` table (or
  `.data/security-log.json`), viewable in the admin Security Center.
  Sensitive values are never logged: emails are masked+hashed, IPs are
  the trusted-proxy IP, token values are never written.
- Alert-worthy events also land in the owner alert center immediately
  and email `ADMIN_ALERT_EMAIL` when configured.

## Known limits (honest list)

- Rate limiting is in-memory per process. On multi-instance hosting
  the effective limits multiply by the instance count; the durable
  account lockout does NOT have this problem (it is persisted). A
  shared store (Redis/Upstash) is the documented next step if the
  store scales out.
- Captcha is env-gated: until Turnstile/hCaptcha keys are set, forms
  rely on rate limits alone, and the server logs that fact once.
- The PayPal dispute/refund handlers follow PayPal's documented
  payloads but have not been exercised against a live PayPal account;
  neither have real Stripe disputes (no production payment accounts
  exist yet). Handlers are covered by unit tests with fixture events.
- CSP allows `style-src 'unsafe-inline'` (the storefront uses inline
  style attributes extensively); scripts are nonce-strict. Tightening
  styles requires a styling refactor and is future work.
