#!/usr/bin/env node
/**
 * Restore an encrypted backup made by scripts/backup-db.mjs (§11).
 *
 *   node scripts/restore-db.mjs <backup-file> --yes
 *
 * Destructive by nature (pg_restore --clean, or wipe + recreate for the
 * logical engine), so it refuses to run without an explicit --yes.
 * Prints per-table row counts AFTER the restore so the operator can
 * compare them with the counts the backup printed when it was taken.
 */
import { spawnSync } from "node:child_process";
import { createDecipheriv, scryptSync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const envFile = path.join(root, ".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
process.env.PRISMA_QUERY_ENGINE_LIBRARY ??= path.join(root, "node_modules/@prisma/engines/libquery_engine-debian-openssl-3.0.x.so.node");
process.env.PRISMA_SCHEMA_ENGINE_BINARY ??= path.join(root, "node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x");
process.env.CHECKPOINT_DISABLE ??= "1";

const file = process.argv[2];
if (!file || !process.argv.includes("--yes")) {
  console.error("usage: node scripts/restore-db.mjs <backup-file> --yes");
  process.exit(2);
}
const passphrase = process.env.BACKUP_ENCRYPTION_KEY ?? "";
if (passphrase.length < 32) {
  console.error("REFUSED: BACKUP_ENCRYPTION_KEY must be set and at least 32 characters long.");
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  console.error("REFUSED: DATABASE_URL is not set.");
  process.exit(2);
}

function decrypt(blob) {
  if (blob.subarray(0, 6).toString() !== "ASTBK1") throw new Error("not an Astralium backup file");
  const salt = blob.subarray(6, 22);
  const iv = blob.subarray(22, 34);
  const tag = blob.subarray(34, 50);
  const data = blob.subarray(50);
  const key = scryptSync(passphrase, salt, 32);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

let plain;
try {
  plain = decrypt(readFileSync(file));
} catch {
  console.error("REFUSED: decryption failed — wrong BACKUP_ENCRYPTION_KEY or a corrupted/tampered backup file (AES-GCM authentication).");
  process.exit(2);
}
const nl = plain.indexOf(0x0a);
const envelope = JSON.parse(plain.subarray(0, nl).toString("utf8"));
const payload = plain.subarray(nl + 1);
console.log(`backup engine: ${envelope.engine}, created: ${envelope.createdAt}`);
if (envelope.counts) console.log(`backup row counts: ${JSON.stringify(envelope.counts)}`);

if (envelope.engine === "pgdump") {
  const tmpFile = path.join(root, "backups", `.tmp-restore-${process.pid}`);
  writeFileSync(tmpFile, payload);
  try {
    const res = spawnSync("pg_restore", ["--clean", "--if-exists", "--no-owner", "--dbname", process.env.DATABASE_URL, tmpFile], { encoding: "utf8" });
    if (res.error) throw new Error(`pg_restore unavailable: ${res.error.message}`);
    if (res.status !== 0) throw new Error(`pg_restore failed: ${res.stderr?.slice(0, 500)}`);
  } finally {
    rmSync(tmpFile, { force: true });
  }
  console.log("restore complete (pg_restore).");
} else {
  const { tables } = JSON.parse(payload.toString("utf8"));
  // FK-safe model order — keep in sync with scripts/backup-db.mjs MODELS.
  const order = [
    "product", "bundle", "setting", "featureFlag", "adminUser", "blogPost",
    "order", "orderItem", "downloadGrant", "deliveryAttempt", "claimCode",
    "review", "productVersion", "wishlistAlert", "flashSale", "gift",
    "loyaltyAccount", "loyaltyEntry", "referralCode", "referralAttribution",
    "subscription", "licenseKey", "fraudEvent", "fraudHold", "fraudBlacklist",
    "abEvent", "cartSnapshot", "ownerEvent", "analyticsEvent",
    "pushSubscription", "auditLog", "privacyRequest", "securityLog", "consentRecord",
  ];
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  try {
    const pkOf = (model) => (model === "setting" || model === "featureFlag" ? "key" : "id");
    await db.$transaction(async (tx) => {
      for (const model of [...order].reverse()) {
        if (tx[model]) await tx[model].deleteMany();
      }
      for (const model of order) {
        const rows = tables[model] ?? [];
        for (const row of rows) {
          await tx[model].upsert({ where: { [pkOf(model)]: row[pkOf(model)] }, update: {}, create: row });
        }
      }
    }, { timeout: 120_000 });
    const after = {};
    for (const model of order) after[model] = await db[model].count();
    console.log(`restore complete (logical). rows now: ${JSON.stringify(after)}`);
    const expected = envelope.counts ?? {};
    const mismatches = order.filter((m) => expected[m] !== undefined && expected[m] !== after[m]);
    if (mismatches.length > 0) {
      console.error(`ROW COUNT MISMATCH on: ${mismatches.join(", ")}`);
      process.exit(1);
    }
    console.log("row counts match the backup envelope — restore verified.");
  } finally {
    await db.$disconnect();
  }
}
