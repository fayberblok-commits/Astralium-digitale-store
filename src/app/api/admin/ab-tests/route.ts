import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, type Permission } from "../../../../lib/team";
import {
  computeResults, getAbConfig, listAbEvents, sanitizeAbConfig, setAbConfig,
} from "../../../../lib/ab";
import { httpErrorResponse, readJsonBody } from "../../../../lib/http";

export const runtime = "nodejs";

// Phase 6 (feature 29): role-based guard — GET needs "read", mutations
// need this route's permission (see the matrix in lib/team.ts). The
// ADMIN_PASSWORD bootstrap session acts as owner and passes everything.
async function guard(req: NextRequest, permission: Permission): Promise<Response | null> {
  const res = await requireAdmin(req, permission);
  return "error" in res ? res.error : null;
}

/**
 * A/B test administration (Phase 5, feature 23): experiment definitions
 * plus per-variant results with two-proportion z-test significance
 * against control.
 */
export async function GET(req: NextRequest) {
  const denied = await guard(req, "read");
  if (denied) return denied;
  const config = await getAbConfig();
  const results = [];
  for (const exp of config.experiments) {
    const events = await listAbEvents(exp.id);
    results.push(computeResults(exp, events));
  }
  return NextResponse.json({ config, results });
}

export async function POST(req: NextRequest) {
  const denied = await guard(req, "content");
  if (denied) return denied;
  let body: { config?: unknown } | null;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return httpErrorResponse(err);
  }
  if (!body) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  const { persisted, value } = await setAbConfig(sanitizeAbConfig(body.config));
  return NextResponse.json({ ok: true, persisted, config: value });
}
