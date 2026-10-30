/**
 * DeliveryAttempt recording (Phase 2).
 *
 * Every send attempt on every channel lands here: persisted to the
 * DeliveryAttempt table when a DB is configured, mirrored in memory
 * otherwise (and always mirrored, so the admin log + tests work in the
 * zero-DB mode too). Rows carry ONLY: order id, channel, status, a
 * provider error CODE, the idempotency key, the grant id and the
 * provider message id. Never message bodies, never recipient PII.
 *
 * Idempotency: a grant is considered delivered on a channel when an
 * attempt exists with key prefix `${orderId}:${channel}:${grantId}:`
 * and status sent/delivered/read — re-delivery then short-circuits.
 */
import { randomUUID } from "node:crypto";
import { getDb } from "../../lib/db.ts";
import type { DeliveryChannelKey } from "./types.ts";

export interface AttemptRecord {
  id: string;
  orderId: string;
  channel: DeliveryChannelKey;
  status: string;
  errorCode: string | null;
  idempotencyKey: string;
  grantId: string | null;
  providerRef: string | null;
  createdAt: Date;
}

const memoryAttempts: AttemptRecord[] = [];
const MEMORY_CAP = 500;

export function __resetMemoryAttempts(): void {
  memoryAttempts.length = 0;
}

export function memoryAttemptList(): AttemptRecord[] {
  return [...memoryAttempts];
}

export async function recordAttempt(input: {
  orderId: string;
  channel: DeliveryChannelKey;
  status: string;
  errorCode?: string | null;
  idempotencyKey: string;
  grantId?: string | null;
  providerRef?: string | null;
}): Promise<AttemptRecord> {
  const record: AttemptRecord = {
    id: randomUUID(),
    orderId: input.orderId,
    channel: input.channel,
    status: input.status,
    errorCode: input.errorCode ?? null,
    idempotencyKey: input.idempotencyKey,
    grantId: input.grantId ?? null,
    providerRef: input.providerRef ?? null,
    createdAt: new Date(),
  };
  memoryAttempts.push(record);
  if (memoryAttempts.length > MEMORY_CAP) memoryAttempts.splice(0, memoryAttempts.length - MEMORY_CAP);
  try {
    const db = await getDb();
    if (db) {
      await db.deliveryAttempt.create({
        data: {
          orderId: input.orderId,
          channel: input.channel,
          status: input.status,
          errorCode: input.errorCode ?? null,
          idempotencyKey: input.idempotencyKey,
          grantId: input.grantId ?? null,
          providerRef: input.providerRef ?? null,
        },
      });
    }
  } catch {
    // Order rows are not guaranteed to exist in DB (fulfilment is
    // webhook/log-driven) — a failed insert must never fail a delivery.
  }
  return record;
}

const SUCCESS_STATUSES = ["sent", "delivered", "read"];

export async function hasSuccessfulAttempt(orderId: string, channel: string, grantId: string): Promise<boolean> {
  const prefix = `${orderId}:${channel}:${grantId}:`;
  if (memoryAttempts.some((a) => a.idempotencyKey.startsWith(prefix) && SUCCESS_STATUSES.includes(a.status))) {
    return true;
  }
  try {
    const db = await getDb();
    if (db) {
      const row = await db.deliveryAttempt.findFirst({
        where: { idempotencyKey: { startsWith: prefix }, status: { in: SUCCESS_STATUSES } },
      });
      if (row) return true;
    }
  } catch {
    // memory result stands
  }
  return false;
}

/** Correlate a provider status webhook (sent/delivered/read/failed) to its attempt. */
export async function updateAttemptStatusByProviderRef(
  providerRef: string,
  status: string,
  errorCode?: string | null,
): Promise<boolean> {
  let hit = false;
  for (const a of memoryAttempts) {
    if (a.providerRef === providerRef) {
      a.status = status;
      if (errorCode !== undefined) a.errorCode = errorCode;
      hit = true;
    }
  }
  try {
    const db = await getDb();
    if (db) {
      const res = await db.deliveryAttempt.updateMany({
        where: { providerRef },
        data: { status, ...(errorCode !== undefined ? { errorCode } : {}) },
      });
      if (res.count > 0) hit = true;
    }
  } catch {
    // memory result stands
  }
  return hit;
}

export async function listAttempts(limit = 50): Promise<AttemptRecord[]> {
  try {
    const db = await getDb();
    if (db) {
      const rows = await db.deliveryAttempt.findMany({ orderBy: { createdAt: "desc" }, take: limit });
      if (rows.length > 0) {
        return rows.map((r) => ({
          id: r.id,
          orderId: r.orderId,
          channel: r.channel as DeliveryChannelKey,
          status: r.status,
          errorCode: r.errorCode,
          idempotencyKey: r.idempotencyKey,
          grantId: r.grantId,
          providerRef: r.providerRef,
          createdAt: r.createdAt,
        }));
      }
    }
  } catch {
    // fall through to memory
  }
  return [...memoryAttempts].slice(-limit).reverse();
}

export interface ChannelStat {
  channel: string;
  total: number;
  sent: number;
  failed: number;
}

/** Selection/outcome stats per channel (admin "Delivery channels" panel). */
export async function channelStats(): Promise<ChannelStat[]> {
  const all = await listAttempts(500);
  const by = new Map<string, ChannelStat>();
  for (const a of all) {
    const s = by.get(a.channel) ?? { channel: a.channel, total: 0, sent: 0, failed: 0 };
    s.total += 1;
    if (SUCCESS_STATUSES.includes(a.status) || a.status === "queued") s.sent += 1;
    if (a.status === "failed") s.failed += 1;
    by.set(a.channel, s);
  }
  return [...by.values()].sort((x, y) => x.channel.localeCompare(y.channel));
}
