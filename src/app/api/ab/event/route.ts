import { NextRequest, NextResponse } from "next/server";
import { getFlag } from "../../../../lib/flags";
import {
  AB_SLOT_HERO, AB_VISITOR_COOKIE, assignVariant, getAbConfig, recordAbEvent, runningExperimentForSlot,
} from "../../../../lib/ab";
import { httpErrorResponse, readJsonBody } from "../../../../lib/http";

export const runtime = "nodejs";

/**
 * Anonymous A/B event intake (Phase 5, feature 23). The client sends
 * only { type } — the variant is computed SERVER-side from the visitor
 * cookie + the running hero experiment, so a client can never stuff a
 * variant ballot. Events store a hash of the visitor id only. No
 * cookie / no running experiment / flag off → quiet 204 no-op.
 */
export async function POST(req: NextRequest) {
  if (!(await getFlag("ab_tests"))) return new NextResponse(null, { status: 204 });
  let body: { type?: string } | null;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return httpErrorResponse(err);
  }
  if (body?.type !== "exposure" && body?.type !== "conversion") {
    return NextResponse.json({ error: "INVALID_TYPE" }, { status: 400 });
  }
  const visitorId = req.cookies.get(AB_VISITOR_COOKIE)?.value;
  if (!visitorId) return new NextResponse(null, { status: 204 });
  const config = await getAbConfig();
  const exp = runningExperimentForSlot(config, AB_SLOT_HERO);
  if (!exp) return new NextResponse(null, { status: 204 });
  const variant = assignVariant(exp, visitorId);
  const { recorded } = await recordAbEvent({
    experimentId: exp.id,
    variantKey: variant.key,
    type: body.type,
    visitorId,
  });
  return NextResponse.json({ ok: true, recorded });
}
