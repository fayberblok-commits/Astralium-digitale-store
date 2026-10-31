import { NextRequest, NextResponse } from "next/server";
import { listFlags, setFlag } from "../../../../lib/flags";
import { recordAudit, requireAdmin } from "../../../../lib/team";
import { httpErrorResponse, readJsonBody } from "../../../../lib/http";

export const runtime = "nodejs";

/** All registered flags with effective state + whether toggles persist (DB). */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req, "read");
  if ("error" in auth) return auth.error;
  const { dbConfigured, flags } = await listFlags();
  return NextResponse.json({ dbConfigured, flags });
}

/** Toggle one flag. Phase 6: requires the "settings" permission; audited. */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, "settings");
  if ("error" in auth) return auth.error;
  let body: { key?: string; enabled?: boolean } | null;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return httpErrorResponse(err);
  }
  if (!body?.key || typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }
  const result = await setFlag(body.key, body.enabled);
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "FLAG_UPDATE_FAILED" }, { status: 400 });
  }
  await recordAudit({
    actor: auth.actor, action: "flag.toggle", target: body.key,
    detail: { enabled: body.enabled, persisted: result.persisted },
  });
  return NextResponse.json({ ok: true, key: body.key, enabled: body.enabled, persisted: result.persisted });
}
