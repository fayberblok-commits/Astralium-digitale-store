import { NextRequest, NextResponse } from "next/server";
import { handleWhatsAppPayload, verifyMetaSignature, webhookVerification } from "../../../../services/delivery/meta-webhook";

export const runtime = "nodejs";

/**
 * WhatsApp Cloud API webhook.
 * GET  — Meta verification handshake (hub.verify_token).
 * POST — signature (X-Hub-Signature-256, META_APP_SECRET) is verified over
 *        the RAW body before any parsing; invalid → 403, nothing processed.
 * Handles: claim-code messages (replies with signed download links inside
 * the 24h window), STOP opt-outs, and message status updates.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const expected = process.env.WHATSAPP_VERIFY_TOKEN || process.env.META_WEBHOOK_VERIFY_TOKEN;
  const challenge = webhookVerification(sp.get("hub.mode"), sp.get("hub.verify_token"), sp.get("hub.challenge"), expected);
  if (challenge === null) return new NextResponse("Forbidden", { status: 403 });
  return new NextResponse(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
}

export async function POST(req: NextRequest) {
  const secret = process.env.META_APP_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "WEBHOOK_NOT_CONFIGURED" }, { status: 503 });
  }
  const rawBody = await req.text();
  if (!verifyMetaSignature(rawBody, req.headers.get("x-hub-signature-256"), secret)) {
    return NextResponse.json({ error: "BAD_SIGNATURE" }, { status: 403 });
  }
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "BAD_JSON" }, { status: 400 });
  }
  const summary = await handleWhatsAppPayload(payload);
  console.log(JSON.stringify({ event: "webhook.whatsapp", ...summary }));
  return NextResponse.json({ received: true });
}
