import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "../../../services/email";

export const runtime = "nodejs";

/**
 * Newsletter signup: validates the email, sends the welcome email via the
 * email service (Resend when configured, honest log-only otherwise) and
 * records the subscription in structured logs. A list-provider adapter
 * (Resend Audiences / ConvertKit…) plugs in here later.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { email?: string } | null;
  const email = (body?.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) {
    return NextResponse.json({ ok: false, error: "INVALID_EMAIL" }, { status: 400 });
  }
  const result = await sendEmail({
    to: email,
    subject: "Welcome to Astralium — one beautiful email a month",
    kind: "newsletter",
    html: `<div style="font-family:Georgia,serif;color:#10131f"><h1>✦ Astralium Digitale Store</h1><p>Welcome aboard. New releases and member prices, once a month, no spam — ever.</p></div>`,
  });
  console.log(JSON.stringify({ event: "newsletter.subscribed", email, emailProvider: result.provider }));
  return NextResponse.json({
    ok: true,
    emailDelivery: result.delivered ? "sent" : "queued",
    note: result.delivered ? undefined : "Email provider not configured (RESEND_API_KEY) — subscription recorded in server logs.",
  });
}
