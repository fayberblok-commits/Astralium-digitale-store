import { NextRequest, NextResponse } from "next/server";
import {
  getAlertsConfig, sanitizeAlertsConfig, setAlertsConfig, telegramConfigured,
} from "../../../../../lib/owner-alerts";
import { getFlag } from "../../../../../lib/flags";
import { recordAudit, requireAdmin } from "../../../../../lib/team";
import { httpErrorResponse, readJsonBody } from "../../../../../lib/http";

export const runtime = "nodejs";

/** Owner-alert channel settings: digest email, owner WhatsApp number, Telegram toggle. */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req, "read");
  if ("error" in auth) return auth.error;
  const config = await getAlertsConfig();
  return NextResponse.json({
    config,
    channels: {
      telegram: telegramConfigured(),
      whatsappFlag: await getFlag("delivery_whatsapp"),
    },
  });
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
  const { persisted, value } = await setAlertsConfig(sanitizeAlertsConfig(body.config));
  await recordAudit({ actor: auth.actor, action: "alerts.config", target: "owner_alerts_config", detail: { persisted } });
  return NextResponse.json({ ok: true, persisted, config: value });
}
