import { NextRequest, NextResponse } from "next/server";
import { getFlag } from "../../../../lib/flags";
import {
  analyticsDeniedByConsent, countryFromHeaders, hashPersistentVisitor, hashVisitor,
  isAnalyticsType, recordAnalyticsEvent,
} from "../../../../lib/analytics";

export const runtime = "nodejs";

/**
 * First-party analytics capture (Phase 6, feature 27). Flag-gated.
 * Stores NO raw IP: the visitor dimension is a daily-rotating salted
 * hash. A persistent visitor id is honoured only when the beacon marks
 * it consent-granted, and is stored hashed as well. An explicit
 * analytics denial in the consent cookie drops the event entirely.
 * Always answers 204-style JSON so beacons never surface errors.
 */
export async function POST(req: NextRequest) {
  if (!(await getFlag("analytics"))) {
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 403 });
  }
  if (analyticsDeniedByConsent(req.headers.get("cookie"))) {
    return NextResponse.json({ ok: true, stored: false, reason: "CONSENT_DENIED" });
  }
  const body = (await req.json().catch(() => null)) as
    | { type?: unknown; productId?: unknown; path?: unknown; vid?: unknown; vidConsent?: unknown }
    | null;
  if (!body || !isAnalyticsType(body.type)) {
    return NextResponse.json({ error: "INVALID_EVENT" }, { status: 400 });
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip");
  let visitorHash = hashVisitor(ip, req.headers.get("user-agent"));
  if (typeof body.vid === "string" && body.vid.length >= 8 && body.vidConsent === true) {
    visitorHash = hashPersistentVisitor(body.vid.slice(0, 80));
  }
  await recordAnalyticsEvent({
    type: body.type,
    productId: typeof body.productId === "string" ? body.productId : null,
    path: typeof body.path === "string" ? body.path : null,
    country: countryFromHeaders((n) => req.headers.get(n)),
    visitorHash,
  });
  return NextResponse.json({ ok: true, stored: true });
}
