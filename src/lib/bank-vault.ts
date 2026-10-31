/**
 * Owner bank-details vault (Phase 4 upgrade — Manager's Office, item 7).
 *
 * A small encrypted-at-rest archive of the owner's payout bank details,
 * kept for reference inside the office. IMPORTANT, and stated in the UI:
 * this vault moves no money — actual payout accounts are configured
 * inside Stripe and PayPal themselves.
 *
 * Crypto: AES-256-GCM with the HKDF-derived "bank-vault" purpose key
 * (src/lib/keys.ts — key separation: the vault key is independent of
 * the session/download keys, so a leak of one purpose never opens the
 * vault). The stored document is the ciphertext envelope ONLY
 * ({ v, cipher, updatedAt, updatedBy }) in the JSON config store
 * (DB Setting row / .data file) — plaintext exists in memory only at
 * save/reveal time, is NEVER written to the audit log, the security
 * log, or any response other than the step-up-gated reveal.
 *
 * Access control lives in the API route: `bank` permission (owner
 * only) + a fresh step-up token for both save and reveal.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { deriveKey } from "./keys.ts";
import { getJsonConfig, setJsonConfig } from "./config-store.ts";

export interface BankDetails {
  bankName: string;
  accountHolder: string;
  iban: string;
  swiftBic: string;
  accountNumber: string;
  currency: string;
  notes: string;
}

export const EMPTY_BANK_DETAILS: BankDetails = {
  bankName: "", accountHolder: "", iban: "", swiftBic: "", accountNumber: "", currency: "", notes: "",
};

const FIELD_LIMITS: Record<keyof BankDetails, number> = {
  bankName: 120, accountHolder: 120, iban: 64, swiftBic: 24, accountNumber: 64, currency: 8, notes: 500,
};

export function sanitizeBankDetails(raw: unknown): BankDetails {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof BankDetails, unknown>>;
  const out = { ...EMPTY_BANK_DETAILS };
  (Object.keys(FIELD_LIMITS) as (keyof BankDetails)[]).forEach((k) => {
    if (typeof r[k] === "string") out[k] = (r[k] as string).trim().slice(0, FIELD_LIMITS[k]);
  });
  out.iban = out.iban.replace(/\s+/g, "").toUpperCase();
  out.swiftBic = out.swiftBic.replace(/\s+/g, "").toUpperCase();
  out.currency = out.currency.toUpperCase();
  return out;
}

/** True when at least one identifying field is present. */
export function bankDetailsPresent(d: BankDetails): boolean {
  return Boolean(d.iban || d.accountNumber || d.bankName || d.accountHolder);
}

/** Masked view — safe to return without a reveal: last 4 only. */
export function maskBankDetails(d: BankDetails): Record<keyof BankDetails, string> {
  const tail = (v: string) => (v.length <= 4 ? "••••" : `•••• •••• ${v.slice(-4)}`);
  return {
    bankName: d.bankName,
    accountHolder: d.accountHolder,
    iban: d.iban ? tail(d.iban) : "",
    swiftBic: d.swiftBic,
    accountNumber: d.accountNumber ? tail(d.accountNumber) : "",
    currency: d.currency,
    notes: d.notes ? "••••••••" : "",
  };
}

// ─── Envelope crypto (pure given a key) ──────────────────────────────────────

export function encryptWithKey(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["bv1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(":");
}

export function decryptWithKey(key: Buffer, envelope: string): string | null {
  try {
    const parts = envelope.split(":");
    if (parts.length !== 4 || parts[0] !== "bv1") return null;
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parts[1], "base64url"));
    decipher.setAuthTag(Buffer.from(parts[2], "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null; // tampered or wrong key — GCM authentication refuses
  }
}

function vaultKey(): Buffer | null {
  return deriveKey("bank-vault");
}

// ─── Store ───────────────────────────────────────────────────────────────────

interface VaultDocument {
  v: 1;
  cipher: string;
  updatedAt: string;
  updatedBy: string;
}

function sanitizeVaultDocument(raw: unknown): VaultDocument | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<VaultDocument>;
  if (r.v !== 1 || typeof r.cipher !== "string" || !r.cipher.startsWith("bv1:")) return null;
  return {
    v: 1,
    cipher: r.cipher,
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : "",
    updatedBy: typeof r.updatedBy === "string" ? r.updatedBy : "",
  };
}

const NO_VAULT: VaultDocument | null = null;

export async function getVaultDocument(): Promise<VaultDocument | null> {
  return getJsonConfig<VaultDocument | null>("owner_bank_vault_v1", "bank-vault.json", sanitizeVaultDocument, NO_VAULT);
}

export type VaultRead =
  | { state: "empty" }
  | { state: "unavailable"; reason: "VAULT_KEY_MISSING" | "VAULT_UNREADABLE" }
  | { state: "ok"; details: BankDetails; masked: Record<keyof BankDetails, string>; updatedAt: string; updatedBy: string };

export async function readVault(): Promise<VaultRead> {
  const doc = await getVaultDocument();
  if (!doc) return { state: "empty" };
  const key = vaultKey();
  if (!key) return { state: "unavailable", reason: "VAULT_KEY_MISSING" };
  const plain = decryptWithKey(key, doc.cipher);
  if (plain == null) return { state: "unavailable", reason: "VAULT_UNREADABLE" };
  try {
    const details = sanitizeBankDetails(JSON.parse(plain));
    return { state: "ok", details, masked: maskBankDetails(details), updatedAt: doc.updatedAt, updatedBy: doc.updatedBy };
  } catch {
    return { state: "unavailable", reason: "VAULT_UNREADABLE" };
  }
}

export async function writeVault(details: BankDetails, updatedBy: string): Promise<{ ok: boolean; persisted?: "db" | "file"; error?: string }> {
  const key = vaultKey();
  if (!key) return { ok: false, error: "VAULT_KEY_MISSING" };
  const clean = sanitizeBankDetails(details);
  const doc: VaultDocument = {
    v: 1,
    cipher: encryptWithKey(key, JSON.stringify(clean)),
    updatedAt: new Date().toISOString(),
    updatedBy: updatedBy.slice(0, 120),
  };
  const res = await setJsonConfig<VaultDocument | null>("owner_bank_vault_v1", "bank-vault.json", doc, sanitizeVaultDocument);
  return { ok: true, persisted: res.persisted };
}
