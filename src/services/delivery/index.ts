/**
 * Delivery orchestrator (Phase 2).
 *
 * deliverOrder(order, channel):
 *   1. If the grant was already delivered on that channel → short-circuit
 *      (idempotency on (orderId, channel, grantId)).
 *   2. If a non-email channel is flag-off or unconfigured → record the
 *      failed attempt, then fall back to email.
 *   3. Send with a timeout and up to 2 retries (backoff) for retryable
 *      failures, recording EVERY attempt.
 *   4. Any failure on the chosen channel → automatic email fallback.
 *      Email itself is the last resort and is recorded honestly
 *      (queued when Resend is not configured).
 */
import { createHash } from "node:crypto";
import { getProductById } from "../../data/products.ts";
import { createDownloadToken } from "../../lib/tokens.ts";
import { hasSuccessfulAttempt, recordAttempt, type AttemptRecord } from "./attempts.ts";
import { emailChannel } from "./email.ts";
import { instagramChannel } from "./instagram.ts";
import { messengerChannel } from "./messenger.ts";
import { whatsappChannel } from "./whatsapp.ts";
import type { DeliverableOrder, DeliveryChannel, DeliveryChannelKey, DeliveryContext, DeliveryResult } from "./types.ts";

export const CHANNELS: Record<DeliveryChannelKey, DeliveryChannel> = {
  email: emailChannel,
  whatsapp: whatsappChannel,
  messenger: messengerChannel,
  instagram: instagramChannel,
};

export const CHANNEL_KEYS = Object.keys(CHANNELS) as DeliveryChannelKey[];

function siteBase(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
}

/** Stable grant id for an order's item set — part of every idempotency key. */
export function grantIdFor(order: DeliverableOrder): string {
  return createHash("sha256").update(`${order.orderId}|${[...order.productIds].sort().join(",")}`).digest("hex").slice(0, 24);
}

export function buildContext(order: DeliverableOrder): DeliveryContext {
  const base = siteBase();
  return {
    orderId: order.orderId,
    grantId: grantIdFor(order),
    email: order.email ?? null,
    phoneE164: order.phoneE164 ?? null,
    recipientId: order.recipientId ?? null,
    locale: order.locale,
    freeForm: order.freeForm,
    items: order.productIds.map((pid) => ({
      productId: pid,
      title: getProductById(pid)?.title ?? pid,
      downloadUrl: `${base}/api/download/${createDownloadToken(pid, order.orderId)}`,
    })),
  };
}

export interface ChannelAvailability {
  key: DeliveryChannelKey;
  enabled: boolean;
  configured: boolean;
  missing: string[];
  /** Offerable to customers right now (email is offerable unless flag-off). */
  available: boolean;
}

export async function channelAvailability(): Promise<ChannelAvailability[]> {
  const out: ChannelAvailability[] = [];
  for (const key of CHANNEL_KEYS) {
    const ch = CHANNELS[key];
    const enabled = await ch.isEnabled();
    const configured = ch.isConfigured();
    out.push({ key, enabled, configured, missing: ch.missingEnv(), available: enabled && configured });
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("DELIVERY_TIMEOUT")), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface DeliverOutcome {
  deliveredVia: DeliveryChannelKey | null;
  fellBack: boolean;
  alreadyDelivered: boolean;
  attempts: AttemptRecord[];
  reason?: string;
}

export async function deliverOrder(
  order: DeliverableOrder,
  requested: DeliveryChannelKey = "email",
  opts: { timeoutMs?: number; maxRetries?: number } = {},
): Promise<DeliverOutcome> {
  const timeoutMs = opts.timeoutMs ?? 8000;
  const maxRetries = opts.maxRetries ?? 2;
  const backoffBase = Number(process.env.DELIVERY_RETRY_BACKOFF_MS ?? 250);
  const ctx = buildContext(order);
  const attempts: AttemptRecord[] = [];

  async function tryChannel(key: DeliveryChannelKey): Promise<{ ok: boolean; already?: boolean; reason?: string }> {
    const adapter = CHANNELS[key];

    if (await hasSuccessfulAttempt(order.orderId, key, ctx.grantId)) {
      return { ok: true, already: true };
    }

    if (key !== "email") {
      const enabled = await adapter.isEnabled();
      const configured = adapter.isConfigured();
      if (!enabled || !configured) {
        const errorCode = !enabled ? "CHANNEL_DISABLED" : "CHANNEL_NOT_CONFIGURED";
        attempts.push(
          await recordAttempt({
            orderId: order.orderId, channel: key, status: "failed", errorCode,
            idempotencyKey: `${order.orderId}:${key}:${ctx.grantId}:gate`, grantId: ctx.grantId,
          }),
        );
        return { ok: false, reason: errorCode };
      }
    }

    let lastReason = "SEND_FAILED";
    for (let n = 1; n <= 1 + maxRetries; n++) {
      let result: DeliveryResult;
      try {
        result = await withTimeout(adapter.send(ctx), timeoutMs);
      } catch {
        result = { ok: false, status: "failed", errorCode: "TIMEOUT", retryable: true };
      }
      attempts.push(
        await recordAttempt({
          orderId: order.orderId, channel: key, status: result.status,
          errorCode: result.errorCode ?? null,
          idempotencyKey: `${order.orderId}:${key}:${ctx.grantId}:try${n}`,
          grantId: ctx.grantId, providerRef: result.providerMessageId ?? null,
        }),
      );
      if (result.ok) return { ok: true };
      lastReason = result.errorCode ?? "SEND_FAILED";
      if (!result.retryable || n === 1 + maxRetries) break;
      await sleep(backoffBase * n);
    }
    return { ok: false, reason: lastReason };
  }

  const primary = await tryChannel(requested);
  if (primary.ok) {
    return { deliveredVia: requested, fellBack: false, alreadyDelivered: Boolean(primary.already), attempts };
  }
  if (requested === "email") {
    return { deliveredVia: null, fellBack: false, alreadyDelivered: false, attempts, reason: primary.reason };
  }
  // Automatic email fallback — the base channel always runs.
  const fallback = await tryChannel("email");
  return {
    deliveredVia: fallback.ok ? "email" : null,
    fellBack: true,
    alreadyDelivered: Boolean(fallback.already),
    attempts,
    reason: fallback.ok ? undefined : fallback.reason,
  };
}
