import { NextRequest, NextResponse } from "next/server";
import { getFlag } from "../../../../lib/flags";
import { getConsentPreferences, setConsentPreferences } from "../../../../lib/privacy";
import { httpErrorResponse, readJsonBody } from "../../../../lib/http";

export const runtime = "nodejs";

/**
 * Consent preferences (Phase 6, feature 30): the analytics/marketing
 * choices are (a) written to a first-party cookie that the analytics
 * endpoint and beacon honour immediately, and (b) when an email is
 * provided, recorded in the ConsentRecord store (a marketing opt-out
 * also stops feature-20 email automation for that address).
 */
export async function POST(req: NextRequest) {
  if (!(await getFlag("privacy_center"))) {
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 403 });
  }
  let body: { email?: string; analytics?: boolean; marketing?: boolean } | null;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return httpErrorResponse(err);
  }
  if (!body || typeof body.analytics !== "boolean" || typeof body.marketing !== "boolean") {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }
  let persisted = false;
  const email = (body.email ?? "").trim().toLowerCase();
  if (email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "INVALID_EMAIL" }, { status: 400 });
    }
    const r = await setConsentPreferences(email, { analytics: body.analytics, marketing: body.marketing });
    persisted = r.persisted;
  }
  const res = NextResponse.json({ ok: true, persisted });
  res.cookies.set(
    "astralium-consent",
    JSON.stringify({ analytics: body.analytics, marketing: body.marketing }),
    { httpOnly: false, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 },
  );
  return res;
}

/** Read back the recorded preferences for an email (preferences form). */
export async function GET(req: NextRequest) {
  const email = (req.nextUrl.searchParams.get("email") ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "INVALID_EMAIL" }, { status: 400 });
  }
  return NextResponse.json({ preferences: await getConsentPreferences(email) });
}
