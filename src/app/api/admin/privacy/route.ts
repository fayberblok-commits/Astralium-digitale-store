import { NextRequest, NextResponse } from "next/server";
import { getPrivacyConfig, sanitizePrivacyConfig, setPrivacyConfig } from "../../../../lib/privacy";
import { recordAudit, requireAdmin } from "../../../../lib/team";

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
  const body = (await req.json().catch(() => null)) as { config?: unknown } | null;
  if (!body) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  const { persisted, value } = await setPrivacyConfig(sanitizePrivacyConfig(body.config));
  await recordAudit({
    actor: auth.actor, action: "privacy.retention", target: "privacy_config",
    detail: { retentionDays: value.retentionDays, persisted },
  });
  return NextResponse.json({ ok: true, persisted, config: value });
}
