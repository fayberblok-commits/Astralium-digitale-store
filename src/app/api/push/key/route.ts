import { NextResponse } from "next/server";
import { getFlag } from "../../../../lib/flags";
import { pushReady } from "../../../../lib/push";

export const runtime = "nodejs";

/** The public VAPID key (public by design) for pushManager.subscribe. */
export async function GET() {
  if (!(await getFlag("pwa_push"))) {
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 403 });
  }
  const ready = pushReady();
  if (!ready.ok) {
    return NextResponse.json({ error: ready.reason }, { status: 503 });
  }
  return NextResponse.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
}
