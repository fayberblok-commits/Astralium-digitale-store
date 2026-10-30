/**
 * PII protection for delivery subjects (phone numbers, PSIDs).
 *
 * - Encryption: AES-256-GCM. The key is derived from PII_ENCRYPTION_KEY with
 *   scrypt (per-record random salt), so the raw env value is never used as a
 *   key directly. Ciphertext format: v1:<salt>:<iv>:<tag>:<data> (base64url).
 * - Lookup: subjects are always indexed by SHA-256 hash (subjectHash) — the
 *   same value ConsentRecord.subjectHash stores. Raw values are NEVER
 *   logged and never written to DeliveryAttempt rows.
 * - Consent: recordConsent() persists a ConsentRecord (DB when configured,
 *   in-memory fallback otherwise) — mirroring the flags layer's honesty:
 *   callers can see whether the record persisted.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { getDb } from "./db.ts";

export function hashSubject(subject: string): string {
  return createHash("sha256").update(subject.trim()).digest("hex");
}

export function piiConfigured(): boolean {
  return Boolean(process.env.PII_ENCRYPTION_KEY && process.env.PII_ENCRYPTION_KEY.length >= 16);
}

function deriveKey(salt: Buffer): Buffer {
  const secret = process.env.PII_ENCRYPTION_KEY;
  if (!secret) throw new Error("PII_ENCRYPTION_KEY_NOT_SET");
  return scryptSync(secret, salt, 32);
}

export function encryptPii(plaintext: string): string {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", salt.toString("base64url"), iv.toString("base64url"), tag.toString("base64url"), data.toString("base64url")].join(":");
}

export function decryptPii(ciphertext: string): string | null {
  try {
    const parts = ciphertext.split(":");
    if (parts.length !== 5 || parts[0] !== "v1") return null;
    const [, saltB, ivB, tagB, dataB] = parts;
    const key = deriveKey(Buffer.from(saltB, "base64url"));
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB, "base64url"));
    const out = Buffer.concat([decipher.update(Buffer.from(dataB, "base64url")), decipher.final()]);
    return out.toString("utf8");
  } catch {
    return null; // wrong key / tampered ciphertext — never throw raw PII paths
  }
}

/** Constant-time string compare for secrets that are not hashes. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

// ─── Consent records ─────────────────────────────────────────────────────────

export interface ConsentEntry {
  subjectHash: string;
  channel: string;
  granted: boolean;
  createdAt: Date;
}

/** In-memory fallback mirror (also used by tests + admin stats). */
const memoryConsent: ConsentEntry[] = [];

export function memoryConsentEntries(): ConsentEntry[] {
  return [...memoryConsent];
}

export async function recordConsent(params: {
  subject: string; // raw phone/email/PSID — hashed + encrypted here, never stored raw
  channel: string;
  granted: boolean;
  storeCipher?: boolean; // keep an encrypted copy for delivery (default true for phones)
}): Promise<{ persisted: boolean; subjectHash: string }> {
  const subjectHash = hashSubject(params.subject);
  const entry: ConsentEntry = { subjectHash, channel: params.channel, granted: params.granted, createdAt: new Date() };
  memoryConsent.push(entry);
  let persisted = false;
  try {
    const db = await getDb();
    if (db) {
      const subjectCipher =
        params.granted && params.storeCipher !== false && piiConfigured() && !params.subject.includes("@")
          ? encryptPii(params.subject)
          : null;
      await db.consentRecord.create({
        data: { subjectHash, channel: params.channel, granted: params.granted, subjectCipher },
      });
      persisted = true;
    }
  } catch {
    persisted = false; // in-memory record above remains the honest fallback
  }
  return { persisted, subjectHash };
}

/** Latest consent state for a subject+channel. Default: not opted out. */
export async function isOptedOut(subject: string, channel: string): Promise<boolean> {
  const subjectHash = hashSubject(subject);
  try {
    const db = await getDb();
    if (db) {
      const row = await db.consentRecord.findFirst({
        where: { subjectHash, channel },
        orderBy: { createdAt: "desc" },
      });
      if (row) return row.granted === false;
    }
  } catch {
    // fall through to memory
  }
  const mine = memoryConsent.filter((c) => c.subjectHash === subjectHash && c.channel === channel);
  if (mine.length === 0) return false;
  return mine[mine.length - 1].granted === false;
}

/**
 * Recover a delivery subject (e.g. phone) from its consent record by hash.
 * Used by the Stripe webhook: metadata carries only the subject HASH, and
 * the raw value exists solely as AES-256-GCM ciphertext on the consent
 * record written at checkout opt-in. Returns null when no DB, no cipher,
 * or no PII key — the caller then falls back to email, by design.
 */
export async function findSubjectByHash(subjectHash: string, channel: string): Promise<string | null> {
  try {
    const db = await getDb();
    if (!db || !piiConfigured()) return null;
    const row = await db.consentRecord.findFirst({
      where: { subjectHash, channel, granted: true, subjectCipher: { not: null } },
      orderBy: { createdAt: "desc" },
    });
    if (!row?.subjectCipher) return null;
    return decryptPii(row.subjectCipher);
  } catch {
    return null;
  }
}

/** Test helper: wipe the in-memory consent mirror. */
export function __resetMemoryConsent(): void {
  memoryConsent.length = 0;
}

/**
 * Privacy deletion (Phase 6): drop every in-memory consent entry for a
 * subject hash. The DB rows are deleted by lib/privacy.ts directly;
 * this covers the zero-DB mirror.
 */
export function deleteMemoryConsentFor(subjectHash: string): number {
  let removed = 0;
  for (let i = memoryConsent.length - 1; i >= 0; i--) {
    if (memoryConsent[i].subjectHash === subjectHash) {
      memoryConsent.splice(i, 1);
      removed++;
    }
  }
  return removed;
}
