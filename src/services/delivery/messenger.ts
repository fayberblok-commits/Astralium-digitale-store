/**
 * Facebook Messenger adapter (Meta Messenger Platform, Send API).
 *
 * Meta forbids initiating conversations: we only ever send to a PSID the
 * customer revealed by messaging the Page first (m.me link with a signed
 * ref, handled by the meta webhook) and inside the 24h window — which is
 * exactly the claim flow this adapter serves.
 */
import { getFlag } from "../../lib/flags.ts";
import { composeDeliveryText, envPresent, graphPost } from "./meta.ts";
import type { DeliveryChannel, DeliveryContext, DeliveryResult } from "./types.ts";

export async function sendMessengerText(psid: string, text: string): Promise<DeliveryResult> {
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  if (!token) return { ok: false, status: "failed", errorCode: "MESSENGER_NOT_CONFIGURED", retryable: false };
  const r = await graphPost("/me/messages", token, {
    recipient: { id: psid },
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
    errorCode: r.errorCode ?? "MESSENGER_UNKNOWN",
    retryable: r.status >= 500 || r.status === 429 || r.errorCode === "NETWORK",
  };
}

export const messengerChannel: DeliveryChannel = {
  key: "messenger",

  async isEnabled() {
    return getFlag("delivery_messenger");
  },

  isConfigured() {
    return envPresent("META_PAGE_ACCESS_TOKEN", "META_PAGE_ID").ok;
  },

  missingEnv() {
    return envPresent("META_PAGE_ACCESS_TOKEN", "META_PAGE_ID", "META_APP_SECRET").missing;
  },

  async send(ctx: DeliveryContext): Promise<DeliveryResult> {
    if (!ctx.recipientId) return { ok: false, status: "failed", errorCode: "NO_PSID", retryable: false };
    return sendMessengerText(ctx.recipientId, composeDeliveryText(ctx.orderId, ctx.items));
  },
};
