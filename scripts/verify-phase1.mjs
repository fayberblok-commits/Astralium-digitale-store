#!/usr/bin/env node
/**
 * Phase-1 end-to-end verification of the core delivery path:
 *
 *   prisma db push → catalog sync → admin login → presign upload →
 *   PUT file to S3 → confirm binding → mint download token →
 *   GET /api/download/[token] → 302 to presigned S3 URL → bytes match.
 *
 * It starts nothing itself. Point it at already-running local services:
 *
 *   PHASE1_DATABASE_URL=postgres://postgres:phase1pass@localhost:55432/astralium
 *   PHASE1_BASE_URL=http://localhost:3101          (the `next start` server)
 *   S3_ENDPOINT=http://localhost:9000  S3_FORCE_PATH_STYLE=1
 *   S3_BUCKET=astralium-test  S3_REGION=us-east-1
 *   S3_ACCESS_KEY_ID=…  S3_SECRET_ACCESS_KEY=…
 *   ADMIN_PASSWORD=…  DOWNLOAD_SIGNING_SECRET=…     (same values as the server)
 *   node scripts/verify-phase1.mjs
 *
 * Exits 0 only if every leg passes. Output is the evidence for
 * docs/PHASE1_REPORT.md.
 */
import { execFileSync } from "node:child_process";
import { PRODUCTS } from "../src/data/products.ts";
import { createDownloadToken } from "../src/lib/tokens.ts";
import { getStorageConfig, buildSignedHeaders } from "../src/services/storage.ts";

const BASE = process.env.PHASE1_BASE_URL || "http://localhost:3101";
const DB_URL = process.env.PHASE1_DATABASE_URL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

let failures = 0;
function step(name, ok, detail = "") {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}
function requireEnv(name) {
  if (!process.env[name]) {
    console.error(`✗ missing env ${name}`);
    process.exit(2);
  }
}
requireEnv("PHASE1_DATABASE_URL");
requireEnv("ADMIN_PASSWORD");
requireEnv("DOWNLOAD_SIGNING_SECRET");

const childEnv = { ...process.env, DATABASE_URL: DB_URL };

// ── 1) prisma db push ────────────────────────────────────────────────────────
try {
  execFileSync("npx", ["prisma", "db", "push", "--skip-generate"], { env: childEnv, stdio: "pipe" });
  step("prisma db push", true);
} catch (e) {
  step("prisma db push", false, String(e.stdout ?? e.message).slice(0, 300));
  process.exit(1);
}

// ── 2) catalog sync ──────────────────────────────────────────────────────────
try {
  const out = execFileSync("node", ["scripts/sync-catalog-to-db.mjs"], { env: childEnv, encoding: "utf8" });
  step("catalog sync (12 products)", true, out.trim());
} catch (e) {
  step("catalog sync", false, String(e.stdout ?? e.message).slice(0, 300));
  process.exit(1);
}

// ── 3) ensure bucket exists (signed CreateBucket via the app adapter) ───────
{
  const cfg = getStorageConfig();
  if (!cfg) {
    step("storage configured", false, "S3 env incomplete");
    process.exit(1);
  }
  const { url, headers } = buildSignedHeaders(cfg, "PUT", "");
  const res = await fetch(url, { method: "PUT", headers });
  step("CreateBucket (or already exists)", res.status === 200 || res.status === 409, `HTTP ${res.status}`);
}

// ── 4) admin login ───────────────────────────────────────────────────────────
let cookie = "";
{
  const res = await fetch(`${BASE}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  });
  cookie = res.headers.get("set-cookie")?.split(";")[0] ?? "";
  step("admin login", res.status === 200 && cookie.includes("astralium-admin"), `HTTP ${res.status}`);
  if (!cookie) process.exit(1);
}
const auth = { Cookie: cookie, "Content-Type": "application/json" };

// ── 5) presign upload ────────────────────────────────────────────────────────
const product = PRODUCTS[0];
const fileBytes = Buffer.from(`ASTRALIUM PHASE-1 VERIFICATION FILE\nproduct=${product.id}\nissued=${new Date().toISOString()}\n`);
let fileKey = "";
{
  const res = await fetch(`${BASE}/api/admin/files/presign`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ productId: product.id, filename: "phase1-test.pdf", contentType: "application/pdf", kind: "product", sizeBytes: fileBytes.length }),
  });
  const data = await res.json().catch(() => ({}));
  fileKey = data.fileKey ?? "";
  step("presign upload URL", res.status === 200 && fileKey === `products/${product.id}/phase1-test.pdf`, `HTTP ${res.status}, key=${fileKey}`);
  var uploadUrl = data.uploadUrl;
  if (!uploadUrl) process.exit(1);
}

// ── 6) PUT bytes straight to storage ─────────────────────────────────────────
{
  const res = await fetch(uploadUrl, { method: "PUT", body: fileBytes });
  step("PUT file to S3/MinIO", res.status === 200, `HTTP ${res.status}`);
  if (res.status !== 200) process.exit(1);
}

// ── 7) confirm binding ───────────────────────────────────────────────────────
{
  const res = await fetch(`${BASE}/api/admin/files/confirm`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ productId: product.id, fileKey, kind: "product", version: "1.0.0" }),
  });
  const data = await res.json().catch(() => ({}));
  step("confirm binding (persisted in DB)", res.status === 200 && data.persisted === "db", `HTTP ${res.status}, persisted=${data.persisted}`);
  if (res.status !== 200) process.exit(1);
}

// ── 8) flags persisted via DB ────────────────────────────────────────────────
{
  const res = await fetch(`${BASE}/api/admin/flags`, { headers: { Cookie: cookie } });
  const data = await res.json().catch(() => ({}));
  const email = data.flags?.find((f) => f.key === "delivery_email");
  const whatsapp = data.flags?.find((f) => f.key === "delivery_whatsapp");
  step(
    "feature flags from DB (email on, whatsapp off)",
    res.status === 200 && data.dbConfigured === true && email?.enabled === true && whatsapp?.enabled === false,
    `dbConfigured=${data.dbConfigured}`,
  );
}

// ── 9) download: token → 302 → presigned GET → identical bytes ──────────────
{
  const token = createDownloadToken(product.id, "AST-PHASE1-TEST", { ttlSeconds: 900, maxDownloads: 5 });
  const res = await fetch(`${BASE}/api/download/${encodeURIComponent(token)}`, { redirect: "manual" });
  const location = res.headers.get("location") ?? "";
  step("download route 302 → presigned S3 URL", res.status === 302 && location.includes("X-Amz-Signature") && location.includes(fileKey), `HTTP ${res.status}`);
  if (res.status === 302) {
    const fileRes = await fetch(location);
    const got = Buffer.from(await fileRes.arrayBuffer());
    step("downloaded bytes identical to uploaded file", fileRes.status === 200 && got.equals(fileBytes), `HTTP ${fileRes.status}, ${got.length} bytes`);
  }
}

console.log(failures === 0 ? "\nPHASE-1 VERIFICATION: ALL LEGS PASSED" : `\nPHASE-1 VERIFICATION: ${failures} LEG(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
