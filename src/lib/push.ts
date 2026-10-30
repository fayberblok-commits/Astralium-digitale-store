/**
 * Web Push (Phase 6, feature 28). Flag `pwa_push` — default OFF.
 *
 * The `web-push` library is used deliberately: RFC 8291 (aes128gcm
 * payload encryption) and RFC 8292 (VAPID ES256 JWT) are both easy to
 * get subtly wrong by hand, and a broken implementation fails silently
 * at the push service. web-push is the maintained reference
 * implementation for Node; it is used for exactly two things — setting
 * the VAPID details and sending one notification per subscription.
 *
 * Privacy: a subscription endpoint is stored ONLY as a SHA-256 hash
 * (the lookup key) plus AES-256-GCM ciphertext (src/lib/pii.ts); the
 * subscription keys (p256dh/auth) are ciphertext too. Storage requires
 * PII_ENCRYPTION_KEY — without it subscribing is refused honestly
 * (PII_NOT_CONFIGURED) rather than persisting endpoints in plaintext.
 *
 * Lifecycle: a 404/410 from the push service means the subscription is
 * gone — the row is deleted automatically during broadcast.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import webpush from "web-push";
import { getDb } from "./db.ts";
import { decryptPii, encryptPii, piiConfigured } from "./pii.ts";

export function vapidConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

function vapidSubject(): string {
  if (process.env.VAPID_SUBJECT) return process.env.VAPID_SUBJECT;
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  if (site && /^https:\/\//.test(site)) return site;
  return "mailto:owner@example.com";
}

export function pushReady(): { ok: boolean; reason?: string } {
  if (!vapidConfigured()) return { ok: false, reason: "VAPID_NOT_CONFIGURED" };
  if (!piiConfigured()) return { ok: false, reason: "PII_NOT_CONFIGURED" };
  return { ok: true };
}

export function endpointHash(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex");
}

// ─── Payload (pure) ──────────────────────────────────────────────────────────

export interface PushPayloadInput { title: string; body: string; url?: string }

export function buildPushPayload(input: PushPayloadInput): string {
  const title = (input.title ?? "").trim().slice(0, 120);
  const body = (input.body ?? "").trim().slice(0, 300);
  const url = typeof input.url === "string" && input.url.startsWith("/") ? input.url.slice(0, 300) : "/";
  return JSON.stringify({
    title: title || "Astralium Digitale Store",
    body,
    url,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
  });
}

// ─── Subscription store ──────────────────────────────────────────────────────

export interface PushSubscriptionRecord {
  id: string;
  endpointHash: string;
  endpoint: string; // decrypted — server-side send path only
  keys: { p256dh: string; auth: string };
  createdAt: string;
}

interface StoredPushRow {
  id: string;
  endpointHash: string;
  endpointCipher: string;
  keysCipher: string;
  createdAt: string;
}

const STORE_PATH = path.join(process.cwd(), ".data", "push-subscriptions.json");

async function readFileRows(): Promise<StoredPushRow[]> {
  try {
    const raw = JSON.parse(await fs.readFile(STORE_PATH, "utf8")) as StoredPushRow[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

async function writeFileRows(list: StoredPushRow[]): Promise<void> {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(list, null, 2), "utf8");
}

export async function savePushSubscription(input: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}): Promise<{ ok: boolean; error?: string }> {
  if (!piiConfigured()) return { ok: false, error: "PII_NOT_CONFIGURED" };
  if (!/^https:\/\//.test(input.endpoint)) return { ok: false, error: "INVALID_ENDPOINT" };
  if (!input.keys?.p256dh || !input.keys?.auth) return { ok: false, error: "INVALID_KEYS" };
  const hash = endpointHash(input.endpoint);
  const row: StoredPushRow = {
    id: randomUUID(),
    endpointHash: hash,
    endpointCipher: encryptPii(input.endpoint),
    keysCipher: encryptPii(JSON.stringify(input.keys)),
    createdAt: new Date().toISOString(),
  };
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      await db.pushSubscription.upsert({
        where: { endpointHash: hash },
        create: { endpointHash: hash, endpointCipher: row.endpointCipher, keysCipher: row.keysCipher },
        update: { endpointCipher: row.endpointCipher, keysCipher: row.keysCipher },
      });
      return { ok: true };
    } catch { /* fall through to file */ }
  }
  const all = await readFileRows();
  const idx = all.findIndex((r) => r.endpointHash === hash);
  if (idx >= 0) all[idx] = { ...all[idx], endpointCipher: row.endpointCipher, keysCipher: row.keysCipher };
  else all.push(row);
  await writeFileRows(all);
  return { ok: true };
}

export async function removePushSubscription(endpoint: string): Promise<{ removed: boolean }> {
  const hash = endpointHash(endpoint);
  return removePushSubscriptionByHash(hash);
}

export async function removePushSubscriptionByHash(hash: string): Promise<{ removed: boolean }> {
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      await db.pushSubscription.delete({ where: { endpointHash: hash } });
      return { removed: true };
    } catch { /* fall through */ }
  }
  const all = await readFileRows();
  const next = all.filter((r) => r.endpointHash !== hash);
  if (next.length === all.length) return { removed: false };
  await writeFileRows(next);
  return { removed: true };
}

export async function countPushSubscriptions(): Promise<number> {
  const db = await getDb().catch(() => null);
  if (db) {
    try { return await db.pushSubscription.count(); } catch { /* fall through */ }
  }
  return (await readFileRows()).length;
}

/** Decrypted subscriptions for the send path. Undecryptable rows are skipped. */
export async function listPushSubscriptions(): Promise<PushSubscriptionRecord[]> {
  let rows: StoredPushRow[] = [];
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const dbRows = await db.pushSubscription.findMany();
      if (dbRows.length > 0) {
        rows = dbRows.map((r) => ({
          id: r.id, endpointHash: r.endpointHash, endpointCipher: r.endpointCipher,
          keysCipher: r.keysCipher, createdAt: r.createdAt.toISOString(),
        }));
      }
    } catch { /* fall through */ }
  }
  if (rows.length === 0) rows = await readFileRows();
  const out: PushSubscriptionRecord[] = [];
  for (const row of rows) {
    const endpoint = decryptPii(row.endpointCipher);
    const keysRaw = decryptPii(row.keysCipher);
    if (!endpoint || !keysRaw) continue;
    try {
      const keys = JSON.parse(keysRaw) as { p256dh: string; auth: string };
      if (keys.p256dh && keys.auth) {
        out.push({ id: row.id, endpointHash: row.endpointHash, endpoint, keys, createdAt: row.createdAt });
      }
    } catch { /* skip corrupt row */ }
  }
  return out;
}

// ─── Broadcast ───────────────────────────────────────────────────────────────

export type PushSender = (
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
) => Promise<{ statusCode: number }>;

/** Default sender: the web-push library with the env VAPID identity. */
export const webPushSender: PushSender = async (sub, payload) => {
  webpush.setVapidDetails(vapidSubject(), process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  try {
    const res = await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
      payload,
    );
    return { statusCode: res.statusCode };
  } catch (err) {
    const code = (err as { statusCode?: number }).statusCode;
    if (typeof code === "number") return { statusCode: code };
    throw err;
  }
};

export interface BroadcastResult {
  sent: number;
  removed: number; // subscriptions deleted after 404/410
  failed: number;
  total: number;
}

/**
 * Send one payload to every subscriber. Expired subscriptions
 * (404/410) are deleted as encountered; other failures keep the row.
 * `sender` is injectable so tests never touch a real push service.
 */
export async function broadcastPush(
  input: PushPayloadInput,
  deps: { sender?: PushSender; subscriptions?: PushSubscriptionRecord[] } = {},
): Promise<{ ok: boolean; error?: string; result?: BroadcastResult }> {
  if (!vapidConfigured()) return { ok: false, error: "VAPID_NOT_CONFIGURED" };
  const payload = buildPushPayload(input);
  const subs = deps.subscriptions ?? (await listPushSubscriptions());
  const sender = deps.sender ?? webPushSender;
  const result: BroadcastResult = { sent: 0, removed: 0, failed: 0, total: subs.length };
  for (const sub of subs) {
    try {
      const res = await sender({ endpoint: sub.endpoint, keys: sub.keys }, payload);
      if (res.statusCode === 404 || res.statusCode === 410) {
        await removePushSubscriptionByHash(sub.endpointHash);
        result.removed++;
      } else if (res.statusCode >= 200 && res.statusCode < 300) {
        result.sent++;
      } else {
        result.failed++;
      }
    } catch {
      result.failed++;
    }
  }
  return { ok: true, result };
}
