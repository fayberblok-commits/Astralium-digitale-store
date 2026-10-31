import { NextRequest, NextResponse } from "next/server";
import { getPrivacyConfig, sanitizePrivacyConfig, setPrivacyConfig } from "../../../../lib/privacy";
import { recordAudit, requireAdmin } from "../../../../lib/team";
import { httpErrorResponse, readJsonBody } from "../../../../lib/http";

export const runtime = "nodejs";

/** Privacy settings (Phase 6, feature 30): data-retention days. */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req, "read");
  if ("error" in auth) return auth.error;
  return NextResponse.json({ config: await getPrivacyConfig() });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, "settings");
  if ("error" in auth) return auth.error;
  let body: { config?: unknown } | null;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return httpErrorResponse(err);
  }
  if (!body) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  const { persisted, value } = await setPrivacyConfig(sanitizePrivacyConfig(body.config));
  await recordAudit({
    actor: auth.actor, action: "privacy.retention", target: "privacy_config",
    detail: { retentionDays: value.retentionDays, persisted },
  });
  return NextResponse.json({ ok: true, persisted, config: value });
}
