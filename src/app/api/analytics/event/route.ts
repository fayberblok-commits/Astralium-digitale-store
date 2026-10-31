import { NextRequest, NextResponse } from "next/server";
import { getFlag } from "../../../../lib/flags";
import {
  analyticsDeniedByConsent, countryFromHeaders, hashPersistentVisitor, hashVisitor,
  isAnalyticsType, parseUserAgent, recordAnalyticsEvent, trafficSource,
} from "../../../../lib/analytics";
import { httpErrorResponse, readJsonBody, getClientIp } from "../../../../lib/http";

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
  let body: { type?: unknown; productId?: unknown; path?: unknown; vid?: unknown; vidConsent?: unknown; ref?: unknown; utm?: unknown } | null;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return httpErrorResponse(err);
  }
  if (!body || !isAnalyticsType(body.type)) {
    return NextResponse.json({ error: "INVALID_EVENT" }, { status: 400 });
  }
  const ip = getClientIp(req);
  let visitorHash = hashVisitor(ip, req.headers.get("user-agent"));
  if (typeof body.vid === "string" && body.vid.length >= 8 && body.vidConsent === true) {
    visitorHash = hashPersistentVisitor(body.vid.slice(0, 80));
  }
  const ua = parseUserAgent(req.headers.get("user-agent"));
  await recordAnalyticsEvent({
    type: body.type,
    productId: typeof body.productId === "string" ? body.productId : null,
    path: typeof body.path === "string" ? body.path : null,
    country: countryFromHeaders((n) => req.headers.get(n)),
    visitorHash,
    device: ua.device,
    browser: ua.browser,
    source: trafficSource({ utmSource: body.utm, referrerHost: body.ref, ownHost: req.headers.get("host") }),
  });
  return NextResponse.json({ ok: true, stored: true });
}
