import { NextRequest, NextResponse } from "next/server";
import { recordAudit, requireAdmin } from "../../../../../lib/team";
import {
  getDesignState, listDesignVersions, rollbackDesignVersion, saveDesignVersion,
  setHeroText, setSiteBanner,
} from "../../../../../lib/design";
import { httpErrorResponse, readJsonBody } from "../../../../../lib/http";

export const runtime = "nodejs";

/**
 * Manager's Office — design control (Phase 4 upgrade, item 5).
 *
 * Aggregates the design state (theme + homepage sections + banner +
 * hero text) and the saved-version history. Theme and sections keep
 * their own dedicated routes/panels from Phases 2–3; this route adds
 * banner/hero editing and snapshot/rollback on the whole state.
 * Mutations need `settings` and are audit-logged; rollback snapshots
 * the current state first, so it is itself undoable.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req, "read");
  if ("error" in auth) return auth.error;
  const [state, versions] = await Promise.all([getDesignState(), listDesignVersions()]);
  return NextResponse.json({
    state,
    versions: versions.map((v) => ({
      id: v.id, name: v.name, author: v.author, createdAt: v.createdAt,
      palette: v.state.theme.palette, mode: v.state.theme.mode,
      hiddenSections: v.state.homeSections.hidden.length,
    })),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, "settings");
  if ("error" in auth) return auth.error;
  let body: {
    action?: string; name?: string; id?: string;
    banner?: Record<string, unknown>; heroText?: Record<string, unknown>;
  } | null;
  try {
    body = await readJsonBody(req, { maxBytes: 32 * 1024 });
  } catch (err) {
    return httpErrorResponse(err);
  }
  if (!body?.action) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });

  if (body.action === "snapshot") {
    const { version, persisted } = await saveDesignVersion(body.name ?? "", auth.actor.actor);
    await recordAudit({ actor: auth.actor, action: "office.design_snapshot", target: version.id, detail: { name: version.name } });
    return NextResponse.json({ ok: true, persisted, version: { id: version.id, name: version.name, createdAt: version.createdAt } });
  }
  if (body.action === "rollback") {
    if (!body.id) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
    const res = await rollbackDesignVersion(body.id, auth.actor.actor);
    if (!res.ok) return NextResponse.json({ error: res.error ?? "ROLLBACK_FAILED" }, { status: 404 });
    await recordAudit({ actor: auth.actor, action: "office.design_rollback", target: body.id, detail: { restoredName: res.restoredName } });
    return NextResponse.json({ ok: true, restoredName: res.restoredName, state: await getDesignState() });
  }
  if (body.action === "banner") {
    const { value, persisted } = await setSiteBanner(body.banner ?? {});
    await recordAudit({ actor: auth.actor, action: "office.design_banner", target: "site-banner", detail: { enabled: value.enabled } });
    return NextResponse.json({ ok: true, persisted, banner: value });
  }
  if (body.action === "hero") {
    const { value, persisted } = await setHeroText(body.heroText ?? {});
    await recordAudit({ actor: auth.actor, action: "office.design_hero", target: "hero-text" });
    return NextResponse.json({ ok: true, persisted, heroText: value });
  }
  return NextResponse.json({ error: "UNKNOWN_ACTION" }, { status: 400 });
}
