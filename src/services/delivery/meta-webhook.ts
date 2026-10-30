/**
 * Meta webhook core (WhatsApp + Messenger + Instagram).
 *
 * Pure-ish handlers separated from the Next routes so every path is
 * exercisable in tests with a stubbed global fetch — no live Meta calls.
 *
 * Security order matters: the route verifies X-Hub-Signature-256 BEFORE
 * parsing (see verifyMetaSignature), dedupe runs on provider message ids,
 * claim codes are single-use (lib/claim-codes), and referral refs are
 * HMAC-signed. Status webhooks only ever update DeliveryAttempt rows by
 * provider message id — no PII is read from or written to payloads.
 */
import { createHmac } from "node:crypto";
import { extractClaimCode, redeemClaimCode, verifyRefToken } from "../../lib/claim-codes.ts";
import { recordConsent } from "../../lib/pii.ts";
import { safeEqual } from "../../lib/pii.ts";
import { buildContext } from "./index.ts";
import { composeDeliveryText } from "./meta.ts";
import { updateAttemptStatusByProviderRef } from "./attempts.ts";
import { sendInstagramText } from "./instagram.ts";
import { sendMessengerText } from "./messenger.ts";
import { sendWhatsAppText } from "./whatsapp.ts";
import type { DeliveryChannelKey } from "./types.ts";

/** Verify an X-Hub-Signature-256 header ("sha256=<hex>") in constant time. */
export function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header || !appSecret) return false;
  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  return safeEqual(header.trim(), expected);
}

/** GET verification handshake (hub.mode / hub.verify_token / hub.challenge). */
export function webhookVerification(
  mode: string | null,
  token: string | null,
  challenge: string | null,
  expectedToken: string | undefined,
): string | null {
  if (mode === "subscribe" && token && expectedToken && safeEqual(token, expectedToken)) {
    return challenge ?? "";
  }
  return null;
}

// ─── Dedupe (provider retries the same webhook on any non-200/timeout) ──────

const seenMessageIds = new Set<string>();
const SEEN_CAP = 2000;

export function __resetWebhookDedupe(): void {
  seenMessageIds.clear();
}

function isDuplicate(id: string | undefined): boolean {
  if (!id) return false;
  if (seenMessageIds.has(id)) return true;
  seenMessageIds.add(id);
  if (seenMessageIds.size > SEEN_CAP) {
    // Bounded memory: drop the oldest half when the cap is hit.
    const it = seenMessageIds.values();
    for (let i = 0; i < SEEN_CAP / 2; i++) {
      const v = it.next().value;
      if (v) seenMessageIds.delete(v);
    }
  }
  return false;
}

// ─── Shared claim flow ────────────────────────────────────────────────────────

const STOP_WORDS = new Set(["STOP", "إيقاف", "ايقاف", "UNSUBSCRIBE", "CANCEL", "إلغاء", "الغاء"]);

export function isStopMessage(text: string): boolean {
  const t = text.trim().toUpperCase();
  return STOP_WORDS.has(t) || t.startsWith("STOP ");
}

async function replyWithLinks(
  channel: DeliveryChannelKey,
  recipientId: string,
  orderId: string,
  productIds: string[],
): Promise<boolean> {
  const ctx = buildContext({ orderId, productIds });
  const text = composeDeliveryText(orderId, ctx.items);
  const res =
    channel === "whatsapp"
      ? await sendWhatsAppText(recipientId, text)
      : channel === "messenger"
        ? await sendMessengerText(recipientId, text)
        : await sendInstagramText(recipientId, text);
  return res.ok;
}

export interface WebhookSummary {
  replies: number;
  claimsRedeemed: number;
  optOuts: number;
  statusesUpdated: number;
  duplicates: number;
  ignored: number;
}

function emptySummary(): WebhookSummary {
  return { replies: 0, claimsRedeemed: 0, optOuts: 0, statusesUpdated: 0, duplicates: 0, ignored: 0 };
}

// ─── WhatsApp ────────────────────────────────────────────────────────────────

interface WaMessage {
  from?: string;
  id?: string;
  type?: string;
  text?: { body?: string };
}
interface WaStatus {
  id?: string;
  status?: string;
  errors?: { code?: number }[];
}

export async function handleWhatsAppPayload(payload: Record<string, unknown>): Promise<WebhookSummary> {
  const s = emptySummary();
  const entries = (payload.entry ?? []) as { changes?: { value?: { messages?: WaMessage[]; statuses?: WaStatus[] } }[] }[];
  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      for (const st of value.statuses ?? []) {
        if (st.id && st.status) {
          const err = st.errors?.[0]?.code ? `WA_${st.errors[0].code}` : null;
          if (await updateAttemptStatusByProviderRef(st.id, st.status, err)) s.statusesUpdated += 1;
          else s.ignored += 1;
        }
      }
      for (const msg of value.messages ?? []) {
        if (isDuplicate(msg.id)) {
          s.duplicates += 1;
          continue;
        }
        const from = msg.from;
        const body = msg.text?.body ?? "";
        if (!from || msg.type !== "text" || !body) {
          s.ignored += 1;
          continue;
        }
        if (isStopMessage(body)) {
          await recordConsent({ subject: `+${from}`, channel: "whatsapp", granted: false, storeCipher: false });
          s.optOuts += 1;
          const res = await sendWhatsAppText(from, "You are unsubscribed. You will not receive further WhatsApp messages from Astralium Digitale Store. Your email delivery is unaffected.");
          if (res.ok) s.replies += 1;
          continue;
        }
        const code = extractClaimCode(body);
        if (!code) {
          s.ignored += 1;
          continue;
        }
        const redeemed = await redeemClaimCode(code);
        if (!redeemed.ok) {
          const res = await sendWhatsAppText(from, "That delivery code is invalid, expired or already used. Your download links are also in your receipt email.");
          if (res.ok) s.replies += 1;
          continue;
        }
        s.claimsRedeemed += 1;
        if (await replyWithLinks("whatsapp", from, redeemed.orderId, redeemed.productIds)) s.replies += 1;
      }
    }
  }
  return s;
}

// ─── Messenger + Instagram ────────────────────────────────────────────────────

interface MetaEvent {
  sender?: { id?: string };
  message?: { mid?: string; text?: string };
  referral?: { ref?: string };
  postback?: { payload?: string; mid?: string; referral?: { ref?: string } };
}

export async function handleMetaPayload(payload: Record<string, unknown>): Promise<WebhookSummary> {
  const s = emptySummary();
  const channel: DeliveryChannelKey = payload.object === "instagram" ? "instagram" : "messenger";
  const entries = (payload.entry ?? []) as { messaging?: MetaEvent[] }[];
  for (const entry of entries) {
    for (const ev of entry.messaging ?? []) {
      const senderId = ev.sender?.id;
      const mid = ev.message?.mid ?? ev.postback?.mid;
      if (isDuplicate(mid)) {
        s.duplicates += 1;
        continue;
      }
      if (!senderId) {
        s.ignored += 1;
        continue;
      }
      // 1) Signed referral ref (m.me / ig.me deep link, or postback payload).
      const ref = ev.referral?.ref ?? ev.postback?.referral?.ref ?? (ev.postback?.payload?.includes(".") ? ev.postback.payload : undefined);
      if (ref) {
        const v = verifyRefToken(ref);
        if (v.ok && v.payload.ch === channel) {
          if (await replyWithLinks(channel, senderId, v.payload.oid, v.payload.pids)) s.replies += 1;
        } else {
          s.ignored += 1;
        }
        continue;
      }
      // 2) Fallback (required on Instagram): first message carries the code.
      const text = ev.message?.text ?? "";
      const code = text ? extractClaimCode(text) : null;
      if (!code) {
        s.ignored += 1;
        continue;
      }
      const redeemed = await redeemClaimCode(code);
      if (!redeemed.ok) {
        const res = channel === "messenger"
          ? await sendMessengerText(senderId, "That delivery code is invalid, expired or already used. Your download links are also in your receipt email.")
          : await sendInstagramText(senderId, "That delivery code is invalid, expired or already used. Your download links are also in your receipt email.");
        if (res.ok) s.replies += 1;
        continue;
      }
      s.claimsRedeemed += 1;
      if (await replyWithLinks(channel, senderId, redeemed.orderId, redeemed.productIds)) s.replies += 1;
    }
  }
  return s;
}
