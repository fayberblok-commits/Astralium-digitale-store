/**
 * Instagram DM adapter (Instagram Messaging API via the Send API).
 *
 * Same conversation rules as Messenger: we only reply to an IGSID the
 * customer revealed by messaging the store's professional account first
 * (ig.me link with a signed ref, or the claim-code fallback handled by
 * the meta webhook), inside the 24h window.
 */
import { getFlag } from "../../lib/flags.ts";
import { composeDeliveryText, envPresent, graphPost } from "./meta.ts";
import type { DeliveryChannel, DeliveryContext, DeliveryResult } from "./types.ts";

export async function sendInstagramText(igsid: string, text: string): Promise<DeliveryResult> {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!token) return { ok: false, status: "failed", errorCode: "INSTAGRAM_NOT_CONFIGURED", retryable: false };
  const r = await graphPost("/me/messages", token, {
    recipient: { id: igsid },
    messaging_type: "RESPONSE",
    message: { text },
  });
  if (r.ok) {
    const mid = (r.json?.message_id as string | undefined) ?? undefined;
    return { ok: true, status: "sent", providerMessageId: mid };
  }
  return {
    ok: false,
    status: "failed",
    errorCode: r.errorCode ?? "INSTAGRAM_UNKNOWN",
    retryable: r.status >= 500 || r.status === 429 || r.errorCode === "NETWORK",
  };
}

export const instagramChannel: DeliveryChannel = {
  key: "instagram",

  async isEnabled() {
    return getFlag("delivery_instagram");
  },

  isConfigured() {
    return envPresent("INSTAGRAM_ACCESS_TOKEN", "INSTAGRAM_USERNAME").ok;
  },

  missingEnv() {
    return envPresent("INSTAGRAM_ACCESS_TOKEN", "INSTAGRAM_USERNAME", "META_APP_SECRET").missing;
  },

  async send(ctx: DeliveryContext): Promise<DeliveryResult> {
    if (!ctx.recipientId) return { ok: false, status: "failed", errorCode: "NO_IGSID", retryable: false };
    return sendInstagramText(ctx.recipientId, composeDeliveryText(ctx.orderId, ctx.items));
  },
};
