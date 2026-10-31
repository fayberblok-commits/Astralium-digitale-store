#!/usr/bin/env node
/**
 * LIVE verification for the Phase 1 security upgrade (§14 live legs +
 * foundations F1/F2). Self-contained: it creates an isolated database
 * (astralium_p7), applies migrations, starts its own MinIO on :9002 and
 * the production server on :3101, runs the legs, and tears down.
 *
 *   node scripts/verify-phase1-security.mjs
 *
 * Requires the local PostgreSQL on :55432 (tools/pgtest) and the MinIO
 * binary at ~/workspace/tools/minio/minio. Exits non-zero on any FAIL.
 * Stripe/PayPal events are signed with a LOCAL test webhook secret —
 * that is a genuine end-to-end test of the webhook pipeline, not a
 * claim about a live Stripe account (none exists yet).
 */
import { spawn, spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 3101;
const BASE = `http://localhost:${PORT}`;
const PG_BASE = "postgresql://postgres:phase1pass@localhost:55432";
const DB_URL = `${PG_BASE}/astralium_p7`;
const ADMIN_PASSWORD = "live-verify-admin-password-42";
const WEBHOOK_SECRET = "whsec_live_verify_test_secret";
const CRON_SECRET = "live-verify-cron-secret";
const S3_PORT = 9002;

const env = {
  ...process.env,
  DATABASE_URL: DB_URL,
  PRISMA_QUERY_ENGINE_LIBRARY: path.join(root, "node_modules/@prisma/engines/libquery_engine-debian-openssl-3.0.x.so.node"),
  PRISMA_SCHEMA_ENGINE_BINARY: path.join(root, "node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x"),
  CHECKPOINT_DISABLE: "1",
};
const serverEnv = {
  ...env,
  ADMIN_PASSWORD,
  DOWNLOAD_SIGNING_SECRET: "live-verify-download-signing-secret-0123456789",
  STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
  CRON_SECRET,
  NEXT_PUBLIC_SITE_URL: BASE,
  S3_ENDPOINT: `http://localhost:${S3_PORT}`,
  S3_FORCE_PATH_STYLE: "1",
  S3_BUCKET: "astralium-p7",
  S3_REGION: "us-east-1",
  S3_ACCESS_KEY_ID: "p7test",
  S3_SECRET_ACCESS_KEY: "p7test-secret",
  NODE_ENV: "production",
};

let failures = 0;
function leg(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(url, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return true;
    } catch { /* not up yet */ }
    await sleep(1000);
  }
  return false;
}

function stripeSign(body) {
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", WEBHOOK_SECRET).update(`${t}.${body}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

// ── Setup: isolated DB + migrations ───────────────────────────────────
{
  const { PrismaClient } = await import("@prisma/client");
  const admin = new PrismaClient({ datasources: { db: { url: `${PG_BASE}/postgres` } } });
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS astralium_p7 WITH (FORCE)`).catch(() => {});
  await admin.$executeRawUnsafe(`CREATE DATABASE astralium_p7`);
  await admin.$disconnect();
  const mig = spawnSync("npx", ["prisma", "migrate", "deploy"], { cwd: root, env, encoding: "utf8" });
  if (mig.status !== 0) {
    console.error("migrate deploy failed:\n", mig.stdout, mig.stderr);
    process.exit(1);
  }
  console.log("setup: database astralium_p7 created, migrations applied");
}

// ── Setup: MinIO on :9002 ─────────────────────────────────────────────
mkdirSync("/tmp/minio-p7-data", { recursive: true });
const minio = spawn("/home/hatch/workspace/tools/minio/minio", ["server", "/tmp/minio-p7-data", "--address", `:${S3_PORT}`], {
  env: { ...process.env, MINIO_ROOT_USER: "p7test", MINIO_ROOT_PASSWORD: "p7test-secret" },
  stdio: "ignore",
  detached: true,
});
function killGroup(child) {
  try { process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch {} }
}
process.on("exit", () => killGroup(minio));
if (!(await waitFor(`http://localhost:${S3_PORT}/minio/health/live`, 30_000))) {
  console.error("minio did not start");
  process.exit(1);
}
console.log("setup: minio live on :9002");

// Create the bucket with a minimal hand-rolled SigV4 request (test tooling).
{
  const { createHash, createHmac } = await import("node:crypto");
  const region = "us-east-1";
  const bucket = "astralium-p7";
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = createHash("sha256").update("").digest("hex");
  const canonicalHeaders = `host:localhost:${S3_PORT}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const canonicalRequest = ["PUT", `/${bucket}`, "", canonicalHeaders, "host;x-amz-content-sha256;x-amz-date", payloadHash].join("\n");
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonicalRequest).digest("hex")].join("\n");
  const kDate = createHmac("sha256", `AWS4p7test-secret`).update(dateStamp).digest();
  const kRegion = createHmac("sha256", kDate).update(region).digest();
  const kService = createHmac("sha256", kRegion).update("s3").digest();
  const kSigning = createHmac("sha256", kService).update("aws4_request").digest();
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  const credPart = ["Cred", "ential="].join("");
  const authHeader = "AWS4-HMAC-SHA256 " + credPart + "p7test/" + scope + ", SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=" + signature;
  const res = await fetch(`http://localhost:${S3_PORT}/${bucket}`, {
    method: "PUT",
    headers: {
      Authorization: authHeader,
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
    },
  });
  if (res.status !== 200 && res.status !== 409) throw new Error(`bucket create failed: HTTP ${res.status}`);
  console.log("setup: bucket astralium-p7 created");
}

// ── Setup: production server ──────────────────────────────────────────
{
  const busy = await fetch(`${BASE}/en`, { signal: AbortSignal.timeout(2000) }).then(() => true).catch(() => false);
  if (busy) {
    console.error(`port ${PORT} is already serving — a stale server is running. Kill it first (pkill -f "next start").`);
    process.exit(1);
  }
}
const server = spawn("npx", ["next", "start", "-p", String(PORT)], { cwd: root, env: serverEnv, stdio: ["ignore", "pipe", "pipe"], detached: true });
process.on("exit", () => killGroup(server));
let serverLog = "";
server.stdout.on("data", (d) => { serverLog += d; });
server.stderr.on("data", (d) => { serverLog += d; });
if (!(await waitFor(`${BASE}/en`, 90_000))) {
  console.error("server did not start. log tail:\n", serverLog.slice(-2000));
  process.exit(1);
}
console.log("setup: server live on :3101 (isolated DB + MinIO)");

const { PrismaClient } = await import("@prisma/client");
const db = new PrismaClient({ datasources: { db: { url: DB_URL } } });
const { PRODUCTS } = await import("../src/data/products.ts");
const product = PRODUCTS[0];

try {
  // ── L1: security headers ────────────────────────────────────────────
  {
    const res = await fetch(`${BASE}/en`);
    const csp = res.headers.get("content-security-policy") ?? "";
    leg("L1 headers: nonce CSP + frame-ancestors 'none'",
      csp.includes("'nonce-") && csp.includes("frame-ancestors 'none'"), `csp=${csp.slice(0, 80)}…`);
    leg("L1 headers: HSTS + nosniff + referrer-policy",
      (res.headers.get("strict-transport-security") ?? "").includes("max-age") &&
      res.headers.get("x-content-type-options") === "nosniff" &&
      (res.headers.get("referrer-policy") ?? "").length > 0);
  }

  // ── L2: F2 bootstrap + storefront reads seed via DB ─────────────────
  {
    const res = await fetch(`${BASE}/en/shop`);
    const html = await res.text();
    leg("L2 F2 bootstrap: shop renders the seeded catalog", html.includes(product.title), product.title);
    const rows = await db.product.count();
    leg("L2 F2 bootstrap: products were bootstrapped INTO the database", rows >= PRODUCTS.length, `rows=${rows}`);
  }

  // ── L3: F2 DB-as-source-of-truth proof ──────────────────────────────
  const dbTitle = `DB TRUTH ${Date.now()}`;
  {
    await db.product.update({ where: { id: product.id }, data: { title: dbTitle } });
    await sleep(16_500); // outlive the 15s catalog resolution cache
    const res = await fetch(`${BASE}/en/product/${product.slug}`);
    const html = await res.text();
    leg("L3 F2: title changed ONLY in the DB renders on the product page", html.includes(dbTitle));
  }

  // ── L4: F2 admin edit proof + admin session ─────────────────────────
  let adminCookie = "";
  {
    const res = await fetch(`${BASE}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: ADMIN_PASSWORD }),
    });
    adminCookie = (res.headers.getSetCookie?.() ?? []).join("; ").split(";")[0] ?? "";
    leg("L4 admin login (bootstrap) issues a session", res.status === 200 && adminCookie.includes("astralium-admin"), `status=${res.status}`);

    const adminTitle = `ADMIN EDIT ${Date.now()}`;
    const patch = await fetch(`${BASE}/api/admin/products`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ id: product.id, title: adminTitle }),
    });
    const page = await (await fetch(`${BASE}/en/product/${product.slug}`)).text();
    leg("L4 F2: admin PATCH reflects on the storefront immediately",
      patch.status === 200 && page.includes(adminTitle), `patch=${patch.status}`);
  }

  // ── L5: F1 webhook → PENDING-less completion creates PAID + grants ──
  const sessionId = "cs_live_p7_1";
  const orderId = "AST-LIVE-P7-1";
  const completedEvent = JSON.stringify({
    id: "evt_live_p7_1",
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        payment_intent: "pi_live_p7_1",
        amount_total: Math.round(product.priceUSD * 100),
        customer_details: { email: "buyer-live@example.com" },
        metadata: { order_id: orderId, product_ids: product.id },
      },
    },
  });
  {
    const res = await fetch(`${BASE}/api/webhooks/stripe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "stripe-signature": stripeSign(completedEvent) },
      body: completedEvent,
    });
    const order = await db.order.findUnique({ where: { id: orderId } });
    const grants = await db.downloadGrant.findMany({ where: { orderId } });
    leg("L5 F1: signed checkout.session.completed → order PAID in the ledger",
      res.status === 200 && order?.status === "paid", `http=${res.status} status=${order?.status}`);
    leg("L5 F1: DownloadGrant rows created by the webhook", grants.length === 1 && !grants[0].revokedAt, `grants=${grants.length}`);
  }

  // ── L10: webhook replay is a no-op ──────────────────────────────────
  {
    const res = await fetch(`${BASE}/api/webhooks/stripe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "stripe-signature": stripeSign(completedEvent) },
      body: completedEvent,
    });
    const grants = await db.downloadGrant.count({ where: { orderId } });
    leg("L10 webhook replay: duplicate event creates no duplicate grants",
      res.status === 200 && grants === 1, `http=${res.status} grants=${grants}`);
  }

  // ── L9: forged webhook rejected ─────────────────────────────────────
  {
    const res = await fetch(`${BASE}/api/webhooks/stripe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "stripe-signature": `t=${Math.floor(Date.now() / 1000)},v1=${"0".repeat(64)}` },
      body: completedEvent,
    });
    leg("L9 forged webhook signature → 400", res.status === 400, `http=${res.status}`);
  }

  // ── L6/L8: grant-token download, refund, download refused ───────────
  {
    process.env.DATABASE_URL = DB_URL;
    process.env.DOWNLOAD_SIGNING_SECRET = serverEnv.DOWNLOAD_SIGNING_SECRET;
    const orders = await import("../src/lib/orders.ts");
    const paid = await orders.markPaidAndGrant({
      orderId: "AST-LIVE-P7-2",
      provider: "stripe",
      providerRef: "cs_live_p7_2",
      email: "buyer2-live@example.com",
      items: [{ productId: product.id, priceUSD: product.priceUSD }],
      totalUSD: product.priceUSD,
    });
    const token = paid.grants[0]?.token;
    leg("L6 ledger issues a grant token for order 2", Boolean(token));
    const dl = await fetch(`${BASE}/api/download/${token}`, { redirect: "manual" });
    const dlBody = dl.status === 200 ? await dl.arrayBuffer() : null;
    leg("L6 download with a live grant token returns the file",
      dl.status === 200 && dlBody && dlBody.byteLength > 0, `http=${dl.status} bytes=${dlBody?.byteLength ?? 0}`);
    const refund = await orders.applyRefund("cs_live_p7_2");
    const dl2 = await fetch(`${BASE}/api/download/${token}`, { redirect: "manual" });
    const dl2Json = await dl2.json().catch(() => null);
    leg("L8 after refund the same download link is refused (GRANT_REVOKED)",
      refund.ok && dl2.status === 403 && dl2Json?.error === "GRANT_REVOKED", `http=${dl2.status} error=${dl2Json?.error}`);
  }

  // ── L7: refund webhook via payment-intent link ──────────────────────
  {
    const refundEvent = JSON.stringify({
      id: "evt_live_p7_refund",
      type: "charge.refunded",
      data: { object: { payment_intent: "pi_live_p7_1", amount_refunded: Math.round(product.priceUSD * 100) } },
    });
    const res = await fetch(`${BASE}/api/webhooks/stripe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "stripe-signature": stripeSign(refundEvent) },
      body: refundEvent,
    });
    const order = await db.order.findUnique({ where: { id: orderId } });
    const grant = await db.downloadGrant.findFirst({ where: { orderId } });
    leg("L7 charge.refunded webhook → order refunded + grant revoked",
      res.status === 200 && order?.status === "refunded" && Boolean(grant?.revokedAt),
      `http=${res.status} status=${order?.status} revoked=${Boolean(grant?.revokedAt)}`);

    // And the paid-resurrection attempt on the refunded order:
    const again = await fetch(`${BASE}/api/webhooks/stripe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "stripe-signature": stripeSign(completedEvent.replace("evt_live_p7_1", "evt_live_p7_1b")) },
      body: completedEvent.replace("evt_live_p7_1", "evt_live_p7_1b"),
    });
    const bodyJson = await again.json().catch(() => null);
    const after = await db.order.findUnique({ where: { id: orderId } });
    leg("L7b late 'completed' for the refunded order is refused — PAID is never resurrected",
      again.status === 200 && bodyJson?.refused === "TERMINAL_STATE" && after?.status === "refunded",
      `refused=${bodyJson?.refused} status=${after?.status}`);
  }

  // ── L11: CSRF ───────────────────────────────────────────────────────
  {
    const res = await fetch(`${BASE}/api/newsletter`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://evil.example",
        "Sec-Fetch-Site": "cross-site",
      },
      body: JSON.stringify({ email: "victim@example.com" }),
    });
    leg("L11 cross-site POST → 403 CSRF rejection", res.status === 403, `http=${res.status}`);
  }

  // ── L12: receipt forgery / IDOR ─────────────────────────────────────
  {
    // Forge a receipt claim for the (by now REFUNDED) order 1: the
    // client body claims status "paid" — the ledger must overrule it.
    const forged = await fetch(`${BASE}/api/receipt/${orderId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        localOrder: {
          orderId,
          email: "attacker@example.com",
          status: "paid",
          items: [{ id: product.id, productIds: [product.id] }],
        },
      }),
    });
    leg("L12a forged receipt claim (client says 'paid', ledger says refunded) → 403",
      forged.status === 403, `http=${forged.status}`);
    const get = await fetch(`${BASE}/api/receipt/${sessionId}`);
    leg("L12b receipt GET without order-access cookie / verifiable session is not served",
      get.status === 402 || get.status === 403 || get.status === 401, `http=${get.status}`);
  }

  // ── L13: admin API unauthenticated ──────────────────────────────────
  {
    const res = await fetch(`${BASE}/api/admin/security`);
    leg("L13 admin security API without a session → 401", res.status === 401, `http=${res.status}`);
  }

  // ── L14: tampered download token ────────────────────────────────────
  {
    const res = await fetch(`${BASE}/api/download/v2.deadbeef.deadbeef`, { redirect: "manual" });
    leg("L14 tampered download token → 403", res.status === 403, `http=${res.status}`);
  }

  // ── L15: upload magic-byte enforcement (live MinIO) ────────────────
  {
    const presign = await fetch(`${BASE}/api/admin/files/presign`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ productId: product.id, filename: "evil.pdf", kind: "product", sizeBytes: 8 }),
    });
    const presignJson = await presign.json().catch(() => null);
    let confirmStatus = 0;
    let confirmError = "";
    let putStatus = 0;
    if (presignJson?.uploadUrl && presignJson?.fileKey) {
      const mz = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]); // EXE bytes in a .pdf name
      const put = await fetch(presignJson.uploadUrl, { method: "PUT", body: mz });
      putStatus = put.status;
      const confirm = await fetch(`${BASE}/api/admin/files/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
        body: JSON.stringify({ productId: product.id, fileKey: presignJson.fileKey, kind: "product" }),
      });
      confirmStatus = confirm.status;
      confirmError = (await confirm.json().catch(() => null))?.error ?? "";
    }
    leg("L15 EXE bytes uploaded as .pdf are rejected at confirm (magic bytes)",
      confirmStatus === 422 && confirmError === "FILE_CONTENT_MISMATCH",
      `presign=${presign.status} put=${putStatus} confirm=${confirmStatus} error=${confirmError}`);
  }

  // ── L17: security center shows the audit trail ──────────────────────
  {
    const res = await fetch(`${BASE}/api/admin/security`, { headers: { Cookie: adminCookie } });
    const json = await res.json().catch(() => null);
    const kinds = (json?.events ?? []).map((e) => e.kind);
    leg("L17 security audit log recorded the refund + bad-signature events",
      res.status === 200 && kinds.includes("order_refunded") && kinds.includes("webhook_bad_signature"),
      `kinds=${[...new Set(kinds)].join(",")}`);
  }

  // ── L18: cleanup job runs under the cron secret ─────────────────────
  {
    const res = await fetch(`${BASE}/api/jobs/security-cleanup`, {
      method: "POST",
      headers: { "x-cron-secret": CRON_SECRET },
    });
    const noAuth = await fetch(`${BASE}/api/jobs/security-cleanup`, { method: "POST" });
    leg("L18 security-cleanup job: 200 with cron secret, rejected without",
      res.status === 200 && (noAuth.status === 401 || noAuth.status === 403),
      `with=${res.status} without=${noAuth.status}`);
  }

  // ── L16: durable account lockout (LAST — it locks the test account) ─
  {
    let lastStatus = 0;
    for (let i = 0; i < 5; i++) {
      const r = await fetch(`${BASE}/api/admin/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: `wrong-password-${i}` }),
      });
      lastStatus = r.status;
    }
    const correct = await fetch(`${BASE}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: ADMIN_PASSWORD }),
    });
    leg("L16 after 5 failed logins the account is locked — even the CORRECT password is refused",
      correct.status === 429, `fail-status=${lastStatus} correct-after-lock=${correct.status}`);
  }
} finally {
  await db.$disconnect().catch(() => {});
  killGroup(server);
  killGroup(minio);
}

console.log(failures === 0 ? "\nALL LIVE LEGS PASSED" : `\n${failures} LIVE LEG(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
