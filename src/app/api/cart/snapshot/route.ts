import { NextRequest, NextResponse } from "next/server";
import { getFlag } from "../../../../lib/flags";
import { captureCartSnapshot } from "../../../../lib/email-automation";
import { httpErrorResponse, readJsonBody } from "../../../../lib/http";

export const runtime = "nodejs";

/**
 * Abandoned-cart snapshot capture (Phase 5, feature 20). Called by the
 * checkout page when a valid email + non-empty cart exist. Flag-gated;
 * the recovery token is NEVER returned here (it travels only in the
 * recovery email). Without PII encryption the capture honestly refuses:
 * a hash-only snapshot could never be emailed back.
 */
export async function POST(req: NextRequest) {
  if (!(await getFlag("email_automation"))) {
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 403 });
  }
  let body: {
    email?: string; productIds?: string[]; locale?: string;
  } | null;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return httpErrorResponse(err);
  }
  if (!body?.email || !Array.isArray(body.productIds)) {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }
  const result = await captureCartSnapshot({
    email: body.email,
    productIds: body.productIds.slice(0, 50),
    locale: body.locale,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error === "PII_NOT_CONFIGURED" ? 503 : 400 },
    );
  }
  return NextResponse.json({ ok: true, persisted: result.persisted });
}
