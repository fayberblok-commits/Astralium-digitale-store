/**
 * WhatsApp Business Cloud API adapter.
 *
 * Two send modes, per Meta's rules:
 *  - Template message (proactive, outside the 24h window): an approved
 *    utility template (env WHATSAPP_TEMPLATE_NAME, default
 *    "astralium_delivery") with parameters {{1}} = order id,
 *    {{2}} = the store's signed download link. Template text lives in
 *    docs/whatsapp-template.md.
 *  - Free-form text (inside the 24h customer-service window, e.g. when
 *    replying to a customer who just sent us their claim code).
 *
 * Sends require an explicit opt-in: the orchestrator only routes here
 * when the customer chose WhatsApp, and send() itself refuses numbers
 * with a recorded opt-out (STOP). Numbers travel only to Meta's API —
 * never into logs or DeliveryAttempt rows.
 */
import { getFlag } from "../../lib/flags.ts";
import { isOptedOut } from "../../lib/pii.ts";
import { composeDeliveryText, envPresent, graphPost, type GraphResult } from "./meta.ts";
import type { DeliveryChannel, DeliveryContext, DeliveryResult } from "./types.ts";

export function whatsappTemplateName(): string {
  return process.env.WHATSAPP_TEMPLATE_NAME || "astralium_delivery";
}

/** WhatsApp template language codes: pass through known ones, else English. */
function templateLanguage(locale?: string): string {
  const known = new Set(["en", "en_US", "ar", "fr", "es", "de", "pt_BR", "it", "nl", "tr", "hi", "id", "ur"]);
  if (locale && known.has(locale)) return locale === "en" ? "en_US" : locale;
  return "en_US";
}

function waDigits(phoneOrId: string): string {
  return phoneOrId.replace(/\D/g, "");
}

function toResult(r: GraphResult): DeliveryResult {
  if (r.ok) {
    const messages = (r.json?.messages ?? []) as { id?: string }[];
    return { ok: true, status: "sent", providerMessageId: messages[0]?.id };
  }
  return {
    ok: false,
    status: "failed",
    errorCode: r.errorCode ?? "WA_UNKNOWN",
    retryable: r.status >= 500 || r.status === 429 || r.errorCode === "NETWORK",
  };
}

/** Free-form text inside the 24h window. Also used by the webhook reply path. */
export async function sendWhatsAppText(toWaId: string, text: string): Promise<DeliveryResult> {
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneId || !token) return { ok: false, status: "failed", errorCode: "WA_NOT_CONFIGURED", retryable: false };
  const r = await graphPost(`/${phoneId}/messages`, token, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: waDigits(toWaId),
    type: "text",
    text: { body: text, preview_url: true },
  });
  return toResult(r);
}

/** Approved-template proactive send (outside the 24h window). */
export async function sendWhatsAppTemplate(params: {
  to: string;
  orderId: string;
  downloadUrl: string;
  locale?: string;
}): Promise<DeliveryResult> {
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneId || !token) return { ok: false, status: "failed", errorCode: "WA_NOT_CONFIGURED", retryable: false };
  const r = await graphPost(`/${phoneId}/messages`, token, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: waDigits(params.to),
    type: "template",
    template: {
      name: whatsappTemplateName(),
      language: { code: templateLanguage(params.locale) },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: params.orderId },
            { type: "text", text: params.downloadUrl },
          ],
        },
      ],
    },
  });
  return toResult(r);
}

export const whatsappChannel: DeliveryChannel = {
  key: "whatsapp",

  async isEnabled() {
    return getFlag("delivery_whatsapp");
  },

  isConfigured() {
    return envPresent("WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN").ok;
  },

  missingEnv() {
    return envPresent("WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_BUSINESS_NUMBER").missing;
  },

  async send(ctx: DeliveryContext): Promise<DeliveryResult> {
    const to = ctx.phoneE164 ?? ctx.recipientId ?? null;
    if (!to) return { ok: false, status: "failed", errorCode: "NO_PHONE", retryable: false };
    if (await isOptedOut(to, "whatsapp")) {
      return { ok: false, status: "failed", errorCode: "OPTED_OUT", retryable: false };
    }
    if (ctx.freeForm) {
      return sendWhatsAppText(to, composeDeliveryText(ctx.orderId, ctx.items));
    }
    // Template carries the first item's link; remaining items follow by
    // email (the orchestrator's fallback covers failure, and the receipt
    // email always lists every item when email delivery runs).
    const first = ctx.items[0];
    if (!first) return { ok: false, status: "failed", errorCode: "NO_ITEMS", retryable: false };
    return sendWhatsAppTemplate({ to, orderId: ctx.orderId, downloadUrl: first.downloadUrl, locale: ctx.locale });
  },
};
