/**
 * Email service. Sends through the Resend REST API when RESEND_API_KEY is
 * set; otherwise it logs a structured "queued" record and returns
 * { delivered: false } — an honest no-op, never a fake "sent".
 * Used for: order receipts + download links, abandoned-cart sequence and
 * the newsletter welcome email.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  kind:
    | "receipt" | "abandoned-cart" | "newsletter" | "refund" | "review-request" | "product-update" | "price-alert"
    // Phase 4 kinds
    | "gift" | "gift-confirmation" | "dunning" | "preorder-release"
    // Phase 5 kinds
    | "win-back"
    // Phase 6 kinds
    | "owner-alert" | "privacy";
  orderId?: string;
  /** Extra headers passed through to the provider (e.g. List-Unsubscribe). */
  headers?: Record<string, string>;
  /** Optional file attachments (Resend): content is base64. */
  attachments?: { filename: string; contentBase64: string }[];
}

export async function sendEmail(msg: EmailMessage): Promise<{ delivered: boolean; provider: string }> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || "Astralium Digitale Store <orders@example.com>";
  if (!key) {
    console.log(JSON.stringify({ event: "email.queued", kind: msg.kind, to: msg.to, subject: msg.subject, orderId: msg.orderId ?? null, reason: "RESEND_API_KEY not set" }));
    return { delivered: false, provider: "log-only" };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from, to: msg.to, subject: msg.subject, html: msg.html,
        ...(msg.headers && Object.keys(msg.headers).length > 0 ? { headers: msg.headers } : {}),
        ...(msg.attachments && msg.attachments.length > 0
          ? { attachments: msg.attachments.map((a) => ({ filename: a.filename, content: a.contentBase64 })) }
          : {}),
      }),
    });
    if (!res.ok) {
      console.log(JSON.stringify({ event: "email.failed", kind: msg.kind, status: res.status }));
      return { delivered: false, provider: "resend" };
    }
    return { delivered: true, provider: "resend" };
  } catch {
    console.log(JSON.stringify({ event: "email.failed", kind: msg.kind, status: "network" }));
    return { delivered: false, provider: "resend" };
  }
}

export function receiptEmailHtml(params: {
  brand: string;
  orderId: string;
  items: { title: string; downloadUrl: string }[];
  totalFormatted: string;
}): string {
  const rows = params.items
    .map((i) => `<tr><td style="padding:8px 0">${i.title}</td><td><a href="${i.downloadUrl}">Download</a></td></tr>`)
    .join("");
  return `<div style="font-family:Georgia,serif;color:#10131f">
    <h1>${params.brand}</h1>
    <p>Thank you — your order <strong>${params.orderId}</strong> is confirmed (${params.totalFormatted}).</p>
    <table>${rows}</table>
    <p>Links are personal and valid for 7 days; re-issue them any time from your account page. 14-day money-back guarantee on everything.</p>
  </div>`;
}

/** Abandoned-cart step planner (timings configurable by the caller/cron). */
export const ABANDONED_CART_STEPS = [
  { afterHours: 1, subject: "You left something among the stars", includeCoupon: null as string | null },
  { afterHours: 24, subject: "Still thinking it over? Here is 10% off", includeCoupon: "WELCOME10" },
  { afterHours: 72, subject: "Last call — your cart misses you", includeCoupon: "WELCOME10" },
];

export async function sendAbandonedCartStep(email: string, stepIndex: number, cartSummary: string): Promise<{ delivered: boolean; provider: string }> {
  const step = ABANDONED_CART_STEPS[stepIndex];
  if (!step) return { delivered: false, provider: "none" };
  const couponLine = step.includeCoupon ? `<p>Use code <strong>${step.includeCoupon}</strong> at checkout.</p>` : "";
  return sendEmail({
    to: email,
    subject: step.subject,
    kind: "abandoned-cart",
    html: `<div style="font-family:Georgia,serif;color:#10131f"><h1>Astralium</h1><p>Your cart: ${cartSummary}</p>${couponLine}<p>Your items are digital — checkout takes under two minutes and delivery is instant.</p></div>`,
  });
}
