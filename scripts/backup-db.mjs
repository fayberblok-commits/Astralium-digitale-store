#!/usr/bin/env node
/**
 * Encrypted database backup (Phase 1 upgrade, security §11).
 *
 *   node scripts/backup-db.mjs [output-file]
 *
 * Engines:
 *  - pg_dump (custom format) when a pg_dump binary is on PATH — the
 *    production-preferred engine (exact schema + data snapshot).
 *  - Prisma logical export (JSON of every table) otherwise — used in
 *    minimal containers without PostgreSQL client tools.
 *
 * The payload is ALWAYS encrypted with AES-256-GCM; the key is derived
 * (scrypt) from BACKUP_ENCRYPTION_KEY, which must be ≥ 32 characters.
 * An unencrypted backup of a store database is a liability, so there
 * is deliberately no --plain flag.
 */
import { spawnSync } from "node:child_process";
import { createCipheriv, randomBytes, scryptSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Minimal .env loader (never overrides real environment variables).
const envFile = path.join(root, ".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
// Vendored Prisma engines in minimal sandboxes.
process.env.PRISMA_QUERY_ENGINE_LIBRARY ??= path.join(root, "node_modules/@prisma/engines/libquery_engine-debian-openssl-3.0.x.so.node");
process.env.PRISMA_SCHEMA_ENGINE_BINARY ??= path.join(root, "node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x");
process.env.CHECKPOINT_DISABLE ??= "1";

const passphrase = process.env.BACKUP_ENCRYPTION_KEY ?? "";
if (passphrase.length < 32) {
  console.error("REFUSED: BACKUP_ENCRYPTION_KEY must be set and at least 32 characters long.");
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  console.error("REFUSED: DATABASE_URL is not set — nothing to back up.");
  process.exit(2);
}

export const MODELS = [
  // FK-safe order: parents before children.
  "product", "bundle", "setting", "featureFlag", "adminUser", "blogPost",
  "order", "orderItem", "downloadGrant", "deliveryAttempt", "claimCode",
  "review", "productVersion", "wishlistAlert", "flashSale", "gift",
  "loyaltyAccount", "loyaltyEntry", "referralCode", "referralAttribution",
  "subscription", "licenseKey", "fraudEvent", "fraudHold", "fraudBlacklist",
  "abEvent", "cartSnapshot", "ownerEvent", "analyticsEvent",
  "pushSubscription", "auditLog", "privacyRequest", "securityLog", "consentRecord",
];

function encrypt(plain) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from("ASTBK1"), salt, iv, tag, data]);
}

async function logicalExport() {
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  try {
    const tables = {};
    const counts = {};
    for (const model of MODELS) {
      const rows = await db[model].findMany();
      tables[model] = rows;
      counts[model] = rows.length;
    }
    return { payload: Buffer.from(JSON.stringify({ tables }), "utf8"), counts };
  } finally {
    await db.$disconnect();
  }
}

function pgDumpExport(tmpFile) {
  const res = spawnSync("pg_dump", ["--format=custom", "--file", tmpFile, process.env.DATABASE_URL], { encoding: "utf8" });
  if (res.error || res.status !== 0) return null;
  return readFileSync(tmpFile);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outFile = process.argv[2] ?? path.join(root, "backups", `astralium-backup-${stamp}.enc`);
mkdirSync(path.dirname(outFile), { recursive: true });

let engine;
let payload;
let counts = null;

const tmpFile = path.join(root, "backups", `.tmp-dump-${process.pid}`);
const dump = pgDumpExport(tmpFile);
if (dump) {
  engine = "pgdump";
  payload = dump;
  rmSync(tmpFile, { force: true });
} else {
  engine = "logical";
  const out = await logicalExport();
  payload = out.payload;
  counts = out.counts;
}

const envelope = JSON.stringify({ engine, createdAt: new Date().toISOString(), counts });
const blob = encrypt(Buffer.concat([Buffer.from(envelope), Buffer.from("\n"), payload]));
writeFileSync(outFile, blob);
console.log(`backup written: ${outFile}`);
console.log(`engine: ${engine}${counts ? `, tables: ${Object.keys(counts).length}, rows: ${Object.values(counts).reduce((a, b) => a + b, 0)}` : ""}`);
console.log(`bytes: ${blob.length} (AES-256-GCM encrypted)`);
