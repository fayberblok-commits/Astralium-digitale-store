import { NextRequest, NextResponse } from "next/server";
import { HOME_SECTION_IDS, getHomeSections, setHomeSections } from "../../../../lib/home-settings";
import { recordAudit, requireAdmin } from "../../../../lib/team";
import { httpErrorResponse, readJsonBody } from "../../../../lib/http";

export const runtime = "nodejs";

/**
 * Homepage section layout (Phase 3 upgrade): the owner's section
 * order + visibility, persisted via lib/home-settings (DB Setting row
 * or .data file). The full design office arrives in Phase 4; this is
 * the data mechanism + API it will build on.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req, "read");
  if ("error" in auth) return auth.error;
  const settings = await getHomeSections();
  return NextResponse.json({ settings, sections: HOME_SECTION_IDS });
}

/** Save the layout. Requires the "settings" permission; audited. */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, "settings");
  if ("error" in auth) return auth.error;
  let body: { order?: unknown; hidden?: unknown } | null;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return httpErrorResponse(err);
  }
  const isStringArray = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === "string");
  if (
    !body ||
    (body.order !== undefined && !isStringArray(body.order)) ||
    (body.hidden !== undefined && !isStringArray(body.hidden))
  ) {
    return NextResponse.json({ error: "INVALID_LAYOUT" }, { status: 400 });
  }
  const result = await setHomeSections({
    ...(body.order !== undefined ? { order: body.order as string[] } : {}),
    ...(body.hidden !== undefined ? { hidden: body.hidden as string[] } : {}),
  } as Parameters<typeof setHomeSections>[0]);
  await recordAudit({
    actor: auth.actor, action: "home.update", target: "homepage",
    detail: { order: result.value.order, hidden: result.value.hidden, persisted: result.persisted },
  });
  return NextResponse.json({ ok: true, settings: result.value, persisted: result.persisted });
}
