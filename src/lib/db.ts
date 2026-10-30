/**
 * Lazy Prisma client.
 *
 * The store must build and run with zero environment (file data layer), so
 * the database is strictly opt-in: when DATABASE_URL is absent — or the
 * client cannot be constructed — every caller gets `null` and falls back to
 * the file-based behavior. Never import @prisma/client statically elsewhere;
 * go through here so the fallback stays in exactly one place.
 */
import type { PrismaClient } from "@prisma/client";

let cached: PrismaClient | null | undefined;
let warned = false;

export function isDbConfigured(): boolean {
  const url = process.env.DATABASE_URL;
  return Boolean(url && /^postgres(ql)?:\/\//.test(url));
}

export async function getDb(): Promise<PrismaClient | null> {
  if (!isDbConfigured()) return null;
  if (cached !== undefined) return cached;
  try {
    const { PrismaClient } = await import("@prisma/client");
    const g = globalThis as unknown as { __astraliumPrisma?: PrismaClient };
    if (!g.__astraliumPrisma) {
      g.__astraliumPrisma = new PrismaClient();
    }
    cached = g.__astraliumPrisma;
  } catch (err) {
    cached = null;
    if (!warned) {
      warned = true;
      console.warn(
        "[astralium] DATABASE_URL is set but the Prisma client failed to start; continuing without DB.",
        err instanceof Error ? err.message : err,
      );
    }
  }
  return cached;
}

/** SHA-256 helper for token/PII hashing used by grants + consent records. */
export async function sha256Hex(value: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(value).digest("hex");
}
