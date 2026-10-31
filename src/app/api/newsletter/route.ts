import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "../../../services/email";
import { getClientIp, httpErrorResponse, readJsonBody } from "../../../lib/http";
import { rateLimiters, tooManyRequests } from "../../../lib/ratelimit";
import { captchaGate } from "../../../lib/captcha";
import { z } from "zod";

export const runtime = "nodejs";

const bodySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  captchaToken: z.string().max(4096).optional(),
}).strict();

/**
 * Newsletter signup: validates the email, sends the welcome email via the
 * email service (Resend when configured, honest log-only otherwise) and
 * records the subscription in structured logs. A list-provider adapter
 * (Resend Audiences / ConvertKit…) plugs in here later.
 */
export async function POST(req: NextRequest) {
  // §1: per-IP and per-email budgets (independent of each other).
  const ip = getClientIp(req);
  const ipCheck = rateLimiters.newsletterIp.check(`ip:${ip}`);
  if (!ipCheck.allowed) return tooManyRequests(ipCheck);
  let raw: unknown;
  try {
    raw = await readJsonBody(req);
  } catch (err) {
    return httpErrorResponse(err);
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "INVALID_EMAIL" }, { status: 400 });
  }
  const email = parsed.data.email;
  const emailCheck = rateLimiters.emailFlow.check(`email:${email}`);
  if (!emailCheck.allowed) return tooManyRequests(emailCheck);
  // §10: captcha when configured (no-op + one-time log line when not).
  const captchaBlock = await captchaGate(parsed.data.captchaToken, ip);
  if (captchaBlock) return captchaBlock;
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
