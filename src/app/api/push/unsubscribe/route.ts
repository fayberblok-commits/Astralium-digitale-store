import { NextRequest, NextResponse } from "next/server";
import { recordConsent } from "../../../../lib/pii";
import { removePushSubscription } from "../../../../lib/push";

export const runtime = "nodejs";

/** Remove a Web Push subscription by endpoint (idempotent). */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { endpoint?: string } | null;
  if (!body?.endpoint) {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }
  const result = await removePushSubscription(body.endpoint);
  await recordConsent({ subject: body.endpoint, channel: "push", granted: false, storeCipher: false });
  return NextResponse.json({ ok: true, removed: result.removed });
}
