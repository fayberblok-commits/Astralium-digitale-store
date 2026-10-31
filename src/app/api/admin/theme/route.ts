import { NextRequest, NextResponse } from "next/server";
import { PALETTES, contrastReport, isPaletteId } from "../../../../lib/themes";
import { getThemeSettings, setThemeSettings } from "../../../../lib/theme-settings";
import { recordAudit, requireAdmin } from "../../../../lib/team";
import { httpErrorResponse, readJsonBody } from "../../../../lib/http";

export const runtime = "nodejs";

/**
 * Storefront theme (Phase 2 upgrade): the palette registry with its
 * WCAG AA contrast table, plus the owner's persisted choice.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req, "read");
  if ("error" in auth) return auth.error;
  const settings = await getThemeSettings();
  return NextResponse.json({
    settings,
    palettes: PALETTES.map((p) => ({
      id: p.id,
      grad: p.grad,
      onGrad: p.onGrad,
      light: p.light,
      dark: p.dark,
      contrast: {
        light: contrastReport(p, "light"),
        dark: contrastReport(p, "dark"),
      },
    })),
  });
}

/** Save the theme choice. Requires the "settings" permission; audited. */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, "settings");
  if ("error" in auth) return auth.error;
  let body: { palette?: unknown; mode?: unknown; motion?: unknown } | null;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return httpErrorResponse(err);
  }
  if (!body || (body.palette !== undefined && !isPaletteId(body.palette))) {
    return NextResponse.json({ error: "INVALID_PALETTE" }, { status: 400 });
  }
  if (body.mode !== undefined && !["light", "dark", "system"].includes(String(body.mode))) {
    return NextResponse.json({ error: "INVALID_MODE" }, { status: 400 });
  }
  if (body.motion !== undefined && typeof body.motion !== "boolean") {
    return NextResponse.json({ error: "INVALID_MOTION" }, { status: 400 });
  }
  const result = await setThemeSettings({
    ...(body.palette !== undefined ? { palette: body.palette as string } : {}),
    ...(body.mode !== undefined ? { mode: body.mode as "light" | "dark" | "system" } : {}),
    ...(body.motion !== undefined ? { motion: body.motion } : {}),
  });
  await recordAudit({
    actor: auth.actor, action: "theme.update", target: result.value.palette,
    detail: { mode: result.value.mode, motion: result.value.motion, persisted: result.persisted },
  });
  return NextResponse.json({ ok: true, settings: result.value, persisted: result.persisted });
}
