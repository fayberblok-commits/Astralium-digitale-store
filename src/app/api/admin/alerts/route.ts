import { NextRequest, NextResponse } from "next/server";
import {
  countUnreadOwnerEvents, listOwnerEvents, markAllOwnerEventsRead, markOwnerEventRead,
} from "../../../../lib/owner-alerts";
import { requireAdmin } from "../../../../lib/team";
import { httpErrorResponse, readJsonBody } from "../../../../lib/http";

export const runtime = "nodejs";

/**
 * Owner notification center inbox (Phase 6, feature 26): list with
 * kind/unread filters. Any admin role may read; marking read is the
 * "moderate" permission (support included, viewer excluded).
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req, "read");
  if ("error" in auth) return auth.error;
  const kind = req.nextUrl.searchParams.get("kind") ?? undefined;
  const unreadOnly = req.nextUrl.searchParams.get("unread") === "1";
  const [events, unread] = await Promise.all([
    listOwnerEvents({ kind, unreadOnly, limit: 100 }),
    countUnreadOwnerEvents(),
  ]);
  return NextResponse.json({ events, unread });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, "moderate");
  if ("error" in auth) return auth.error;
  let body: { action?: string; id?: string } | null;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return httpErrorResponse(err);
  }
  if (body?.action === "read" && body.id) {
    const r = await markOwnerEventRead(body.id);
    return NextResponse.json({ ok: r.ok }, { status: r.ok ? 200 : 404 });
  }
  if (body?.action === "readAll") {
    const r = await markAllOwnerEventsRead();
    return NextResponse.json({ ok: true, marked: r.marked });
  }
  return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
}
