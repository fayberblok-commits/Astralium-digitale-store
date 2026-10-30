/**
 * Email delivery adapter — wraps the Phase-1 Resend service. Email is the
 * base channel: always offered, and the orchestrator's automatic fallback
 * for every other channel. When RESEND_API_KEY is absent the underlying
 * service honestly logs instead of sending; the attempt is recorded as
 * "queued" (not "sent") in that case.
 */
import { getFlag } from "../../lib/flags.ts";
import { sendEmail, receiptEmailHtml } from "../email.ts";
import type { DeliveryChannel, DeliveryContext, DeliveryResult } from "./types.ts";

export const emailChannel: DeliveryChannel = {
  key: "email",

  async isEnabled() {
    return getFlag("delivery_email");
  },

  isConfigured() {
    // Sending degrades to an honest server log without Resend — the
    // channel itself never disappears.
    return true;
  },

  missingEnv() {
    return process.env.RESEND_API_KEY ? [] : ["RESEND_API_KEY"];
  },

  async send(ctx: DeliveryContext): Promise<DeliveryResult> {
    if (!ctx.email) {
      return { ok: false, status: "failed", errorCode: "NO_EMAIL", retryable: false };
    }
    const res = await sendEmail({
      to: ctx.email,
      subject: `Your Astralium order ${ctx.orderId} — download links inside`,
      kind: "receipt",
      orderId: ctx.orderId,
      html: receiptEmailHtml({
        brand: "Astralium Digitale Store",
        orderId: ctx.orderId,
        items: ctx.items.map((i) => ({ title: i.title, downloadUrl: i.downloadUrl })),
        totalFormatted: "",
      }),
    });
    if (res.delivered) return { ok: true, status: "sent" };
    // Log-only mode (no Resend key): recorded as queued, never faked sent.
    return { ok: true, status: "queued" };
  },
};
