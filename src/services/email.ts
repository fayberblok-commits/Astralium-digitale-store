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
    | "owner-alert" | "privacy"
    // Phase 1 upgrade kinds
    | "security";
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

/**
 * Branded email shell (Phase 2 upgrade): ink header with the astral
 * mark + wordmark, ivory body, gilt double-rule footer — the same
 * identity as brand/templates/email.html. Inline styles only (email
 * clients strip stylesheets).
 */
export function brandedEmailShell(params: { heading: string; bodyHtml: string }): string {
  return `<div style="background:#f6f1e7;padding:28px 12px">
  <div style="max-width:600px;margin:0 auto;background:#fffdf7;border:1px solid #d8c391;font-family:Georgia,'Times New Roman',serif;color:#221d15">
    <div style="background:#14100c;padding:26px 36px;text-align:center">
      <div style="color:#d6be8c;font-size:24px;letter-spacing:2px">✦</div>
      <div style="color:#f6f1e7;font-size:24px;letter-spacing:3px;margin-top:6px">ASTRALIUM</div>
      <div style="font-family:Arial,sans-serif;color:#d6be8c;font-size:10px;letter-spacing:5px;margin-top:4px">DIGITALE STORE</div>
    </div>
    <div style="padding:30px 36px;font-size:16px;line-height:1.65">
      <h1 style="font-size:22px;margin:0 0 14px">${params.heading}</h1>
      ${params.bodyHtml}
    </div>
    <div style="border-top:3px double #d8c391;padding:16px 36px;text-align:center;font-family:Arial,sans-serif;color:#6b6252;font-size:12px">
      Digital products, delivered among the stars.<br>14-day money-back guarantee on everything.
    </div>
  </div>
</div>`;
}

export function receiptEmailHtml(params: {
  brand: string;
  orderId: string;
  items: { title: string; downloadUrl: string }[];
  totalFormatted: string;
}): string {
  const rows = params.items
    .map(
      (i) =>
        `<tr><td style="padding:10px 0;border-bottom:1px solid #e7dcc2">${i.title}</td><td style="padding:10px 0;border-bottom:1px solid #e7dcc2;text-align:right"><a href="${i.downloadUrl}" style="color:#7d5f1a;font-weight:bold">Download</a></td></tr>`,
    )
    .join("");
  return brandedEmailShell({
    heading: params.brand,
    bodyHtml: `
    <p>Thank you — your order <strong>${params.orderId}</strong> is confirmed (${params.totalFormatted}).</p>
    <table style="width:100%;border-collapse:collapse">${rows}</table>
    <p style="color:#6b6252;font-size:13px">Links are personal and valid for 7 days; re-issue them any time from your account page. 14-day money-back guarantee on everything.</p>`,
  });
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
