import { NextRequest, NextResponse } from "next/server";
import { getFlag } from "../../../../lib/flags";
import { createPrivacyRequest } from "../../../../lib/privacy";
import { createRateLimiter } from "../../../../lib/license";
import { sendEmail } from "../../../../services/email";
import { siteUrl } from "../../../../lib/server";

export const runtime = "nodejs";

const limiter = createRateLimiter(5, 60_000); // per IP, per process

/**
 * Start a privacy export/deletion (Phase 6, feature 30): creates a
 * one-time signed link (token stored hash-only, 1h TTL) and emails it.
 * The response is identical whether or not the email has data — no
 * account enumeration. Without an email provider the link is logged by
 * the email service (honest log-only mode), never shown in the response.
 */
export async function POST(req: NextRequest) {
  if (!(await getFlag("privacy_center"))) {
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 403 });
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!limiter.hit(ip).allowed) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }
  const body = (await req.json().catch(() => null)) as
    | { email?: string; kind?: string; locale?: string }
    | null;
  const email = (body?.email ?? "").trim().toLowerCase();
  const kind = body?.kind === "delete" ? "delete" : "export";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "INVALID_EMAIL" }, { status: 400 });
  }
  const locale = (body?.locale ?? "en").replace(/[^a-z-]/gi, "").slice(0, 5) || "en";
  const { token } = await createPrivacyRequest(email, kind);
  const link = `${siteUrl()}/${locale}/privacy-center?token=${encodeURIComponent(token)}`;
  const isExport = kind === "export";
  await sendEmail({
    to: email,
    kind: "privacy",
    subject: isExport ? "Your Astralium data export link" : "Confirm your Astralium data deletion",
    html: `<div style="font-family:Georgia,serif;color:#10131f"><h1>Astralium Digitale Store</h1><p>${isExport
      ? "You asked for a copy of your data. This one-time link downloads it as JSON and expires in 1 hour:"
      : "You asked to delete your personal data. This one-time link opens the confirmation page (nothing is deleted until you confirm there) and expires in 1 hour:"}</p><p><a href="${link}">${link}</a></p><p>If you did not request this, ignore this email — nothing happens without the link.</p></div>`,
  });
  return NextResponse.json({ ok: true });
}
