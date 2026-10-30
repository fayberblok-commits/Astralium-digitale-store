import { NextRequest, NextResponse } from "next/server";
import { getFlag } from "../../../../lib/flags";
import { recordConsent } from "../../../../lib/pii";
import { pushReady, savePushSubscription } from "../../../../lib/push";

export const runtime = "nodejs";

/**
 * Store a Web Push subscription (Phase 6, feature 28). The endpoint is
 * persisted only as hash + AES-GCM ciphertext (see lib/push.ts); when
 * PII encryption is not configured the route refuses honestly instead
 * of storing endpoints in plaintext.
 */
export async function POST(req: NextRequest) {
  if (!(await getFlag("pwa_push"))) {
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 403 });
  }
  const ready = pushReady();
  if (!ready.ok) return NextResponse.json({ error: ready.reason }, { status: 503 });
  const body = (await req.json().catch(() => null)) as
    | { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
    | null;
  if (!body?.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    return NextResponse.json({ error: "INVALID_SUBSCRIPTION" }, { status: 400 });
  }
  const result = await savePushSubscription({
    endpoint: body.endpoint,
    keys: { p256dh: body.keys.p256dh, auth: body.keys.auth },
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  // Consent trail for the push channel (hash-only record, like Phase 2).
  await recordConsent({ subject: body.endpoint, channel: "push", granted: true, storeCipher: false });
  return NextResponse.json({ ok: true });
}
