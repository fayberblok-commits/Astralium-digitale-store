import { NextRequest, NextResponse } from "next/server";
import { handleMetaPayload, verifyMetaSignature, webhookVerification } from "../../../../services/delivery/meta-webhook";

export const runtime = "nodejs";

/**
 * Meta webhook for Messenger (object: "page") and Instagram
 * (object: "instagram"). Same signature discipline as WhatsApp: the
 * X-Hub-Signature-256 header is verified over the raw body first.
 * Handles signed m.me/ig.me referral refs and the claim-code fallback
 * (the customer types their short order code as the first message).
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const challenge = webhookVerification(
    sp.get("hub.mode"),
    sp.get("hub.verify_token"),
    sp.get("hub.challenge"),
    process.env.META_WEBHOOK_VERIFY_TOKEN,
  );
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
  const summary = await handleMetaPayload(payload);
  console.log(JSON.stringify({ event: "webhook.meta", object: payload.object ?? null, ...summary }));
  return NextResponse.json({ received: true });
}
