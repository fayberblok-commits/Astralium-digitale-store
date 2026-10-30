import { NextRequest, NextResponse } from "next/server";
import { broadcastPush, countPushSubscriptions, pushReady } from "../../../../lib/push";
import { recordAudit, requireAdmin } from "../../../../lib/team";

export const runtime = "nodejs";

/** Push status for the admin composer: readiness + subscriber count. */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req, "read");
  if ("error" in auth) return auth.error;
  const ready = pushReady();
  return NextResponse.json({
    ready: ready.ok,
    reason: ready.ok ? null : ready.reason,
    subscribers: await countPushSubscriptions(),
  });
}

/**
 * Broadcast a notification to every subscriber. Requires the
 * "settings" permission AND an explicit per-send confirmation
 * (`confirm: true`) — there is no silent send path. Audited.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, "settings");
  if ("error" in auth) return auth.error;
  const body = (await req.json().catch(() => null)) as
    | { title?: string; body?: string; url?: string; confirm?: boolean }
    | null;
  if (!body?.title || !body?.body) {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }
  if (body.confirm !== true) {
    return NextResponse.json({ error: "CONFIRMATION_REQUIRED" }, { status: 400 });
  }
  const result = await broadcastPush({ title: body.title, body: body.body, url: body.url });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 503 });
  }
  await recordAudit({
    actor: auth.actor, action: "push.broadcast", target: body.title.slice(0, 80),
    detail: { ...(result.result ?? {}) },
  });
  return NextResponse.json({ ok: true, ...result.result });
}
