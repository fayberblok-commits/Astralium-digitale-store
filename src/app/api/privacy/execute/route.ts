import { NextRequest, NextResponse } from "next/server";
import { getFlag } from "../../../../lib/flags";
import {
  consumePrivacyRequest, executeDeletion, requestEmail, resolvePrivacyRequest,
} from "../../../../lib/privacy";
import { recordAudit } from "../../../../lib/team";
import { httpErrorResponse, readJsonBody } from "../../../../lib/http";

export const runtime = "nodejs";

/**
 * Execute a verified deletion (Phase 6, feature 30). Requires the
 * one-time token AND an explicit { confirm: true } POST body — a GET
 * (email scanner, prefetcher) can never trigger deletion. Execution
 * anonymises PII while preserving order financial records; the job is
 * written to the audit log under actor "privacy-center".
 */
export async function POST(req: NextRequest) {
  if (!(await getFlag("privacy_center"))) {
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 403 });
  }
  let body: { token?: string; confirm?: boolean } | null;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return httpErrorResponse(err);
  }
  if (!body?.token || body.confirm !== true) {
    return NextResponse.json({ error: "CONFIRMATION_REQUIRED" }, { status: 400 });
  }
  const pending = await resolvePrivacyRequest(body.token);
  if (!pending || pending.kind !== "delete") {
    return NextResponse.json({ error: "LINK_INVALID_OR_EXPIRED" }, { status: 400 });
  }
  const email = requestEmail(pending);
  const rec = await consumePrivacyRequest(body.token);
  if (!rec || !email) {
    return NextResponse.json({ error: "LINK_INVALID_OR_EXPIRED" }, { status: 400 });
  }
  const summary = await executeDeletion(email);
  await recordAudit({
    actor: { actor: "privacy-center", role: "owner", via: "password", userId: null, scope: "full", epoch: 0 },
    action: "privacy.deletion.executed",
    target: summary.dbMode ? "db+file stores" : "file stores",
    detail: { ...summary },
  });
  return NextResponse.json({ ok: true, summary });
}
