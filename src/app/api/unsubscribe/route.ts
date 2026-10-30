import { NextRequest, NextResponse } from "next/server";
import { handleUnsubscribe } from "../../../lib/email-automation";

export const runtime = "nodejs";

/**
 * One-click unsubscribe (Phase 5, feature 20). The token is HMAC-signed
 * (purpose "unsubscribe") and identifies the address; hitting it records
 * a ConsentRecord (granted=false, channel "email") so NO automation
 * emails that address again. GET renders a confirmation page (email
 * clients), POST is the RFC 8058 one-click endpoint (mailbox providers).
 */
const PAGE = (ok: boolean) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>Astralium — Unsubscribe</title>
<meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body style="font-family:Georgia,serif;background:#F6F1E7;color:#141210;text-align:center;padding:48px 20px">
<h1 style="border-bottom:3px double #B08D3C;display:inline-block;padding-bottom:8px">Astralium Digitale Store</h1>
<p>${ok ? "You have been unsubscribed from automated emails. Order receipts and download links for purchases you make will still be sent — those are transactional, not marketing." : "This unsubscribe link is invalid or has expired."}</p>
<p dir="rtl" lang="ar">${ok ? "تم إلغاء اشتراكك من الرسائل الآلية. ستظل تصلك إيصالات الطلبات وروابط التحميل للمشتريات التي تقوم بها لأنها رسائل ضرورية لإتمام الشراء." : "رابط إلغاء الاشتراك غير صالح أو انتهت صلاحيته."}</p>
</body></html>`;

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const result = token ? await handleUnsubscribe(token) : { ok: false };
  return new NextResponse(PAGE(result.ok), {
    status: result.ok ? 200 : 400,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const result = token ? await handleUnsubscribe(token) : { ok: false };
  if (!result.ok) return NextResponse.json({ error: "INVALID_TOKEN" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
