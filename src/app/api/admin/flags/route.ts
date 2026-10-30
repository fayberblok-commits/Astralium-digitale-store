import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, isAdminSession } from "../../../../lib/admin";
import { listFlags, setFlag } from "../../../../lib/flags";

export const runtime = "nodejs";

function unauthorized(): NextResponse {
  return NextResponse.json({ error: "ADMIN_UNAUTHORIZED" }, { status: 401 });
}

/** All registered flags with effective state + whether toggles persist (DB). */
export async function GET(req: NextRequest) {
  if (!isAdminSession(req.cookies.get(ADMIN_COOKIE)?.value)) return unauthorized();
  const { dbConfigured, flags } = await listFlags();
  return NextResponse.json({ dbConfigured, flags });
}

export async function POST(req: NextRequest) {
  if (!isAdminSession(req.cookies.get(ADMIN_COOKIE)?.value)) return unauthorized();
  const body = (await req.json().catch(() => null)) as { key?: string; enabled?: boolean } | null;
  if (!body?.key || typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }
  const result = await setFlag(body.key, body.enabled);
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "FLAG_UPDATE_FAILED" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, key: body.key, enabled: body.enabled, persisted: result.persisted });
}
