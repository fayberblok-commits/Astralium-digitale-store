import crypto from "node:crypto";

const KEY_MATERIAL =
  process.env.APP_ENCRYPTION_KEY ??
  process.env.DATABASE_URL ??
  "astralium-digitale-store-fallback-key";

const ENCRYPTION_KEY = crypto.scryptSync(KEY_MATERIAL, "astralium.vault.v1", 32);

/** AES-256-GCM encryption used for owner bank details & any vaulted secret. */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptSecret(payload: string): string {
  try {
    const [version, iv, tag, data] = payload.split(".");
    if (version !== "v1" || !iv || !tag || !data) return "";
    const decipher = crypto.createDecipheriv("aes-256-gcm", ENCRYPTION_KEY, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}

export function maskSecret(value: string, visible = 4): string {
  if (!value) return "—";
  const clean = value.replace(/\s+/g, "");
  if (clean.length <= visible * 2) return `${"•".repeat(Math.max(4, clean.length - 2))}${clean.slice(-2)}`;
  return `${"•".repeat(Math.min(16, clean.length - visible))}${clean.slice(-visible)}`;
}

export function scryptHash(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, hash] = parts;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  if (expected.length !== candidate.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/* -------------------------------- signed tokens ------------------------------ */

function sign(payload: string): string {
  return crypto.createHmac("sha256", ENCRYPTION_KEY).update(payload).digest("base64url");
}

export function createSignedToken(data: Record<string, string | number>, ttlSeconds: number): string {
  const payload = { ...data, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function readSignedToken(token: string): Record<string, string | number> | null {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  const expected = sign(encoded);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Record<string, string | number>;
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

/* ------------------------------- TOTP (2FA) --------------------------------- */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateTotpSecret(length = 20): string {
  const bytes = crypto.randomBytes(length);
  let secret = "";
  for (let i = 0; i < bytes.length; i += 1) secret += BASE32_ALPHABET[bytes[i] % 32];
  return secret;
}

function base32Decode(secret: string): Buffer {
  const clean = secret.replace(/=+$/g, "").replace(/\s+/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

export function totpCode(secret: string, timeStep = Math.floor(Date.now() / 30000)): string {
  const key = base32Decode(secret);
  const counter = Buffer.alloc(8);
  counter.writeUInt32BE(Math.floor(timeStep / 2 ** 32), 0);
  counter.writeUInt32BE(timeStep % 2 ** 32, 4);
  const digest = crypto.createHmac("sha1", key).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return (binary % 1_000_000).toString().padStart(6, "0");
}

export function verifyTotp(secret: string, token: string): boolean {
  const clean = token.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(clean)) return false;
  const step = Math.floor(Date.now() / 30000);
  for (const drift of [-1, 0, 1]) {
    if (totpCode(secret, step + drift) === clean) return true;
  }
  return false;
}

export function totpUri(email: string, secret: string, issuer = "Astralium Digitale Store"): string {
  const label = encodeURIComponent(`${issuer}:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
