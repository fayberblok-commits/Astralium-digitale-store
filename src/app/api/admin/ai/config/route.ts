/**
 * AI gateway configuration (Phase 5 upgrade) — Manager's Office.
 *
 * GET: provider status (NEVER key material — only "configured: yes/no"
 * per provider plus model ids), the office-editable settings (active
 * provider = one-click switch, models, caps, emergency stop), both
 * employee rosters with per-employee stats, today's usage, and the
 * two staff feature flags' state.
 * POST: update settings and/or owner-employee overrides. Every change
 * is audit-logged; emergency-stop flips get their own audit action.
 * Permission: "settings" (owner/admin).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, recordAudit } from "../../../../../lib/team";
import { httpErrorResponse, readJsonBody } from "../../../../../lib/http";
import { getFlag } from "../../../../../lib/flags";
import { getAiSettings, getAiStatus, setAiSettings, type AiGatewaySettings } from "../../../../../lib/ai/config";
import { CUSTOMER_EMPLOYEES, employeeById, getOwnerEmployees, setEmployeeOverride } from "../../../../../lib/ai/employees";
import { getTodayUsage } from "../../../../../lib/ai/usage";
import { employeeStats } from "../../../../../lib/ai/actions";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req, "settings");
  if ("error" in auth) return auth.error;
  try {
    const [status, owner, usage, stats, aiStaff, aiOwnerStaff] = await Promise.all([
      getAiStatus(), getOwnerEmployees(),
      getTodayUsage(), employeeStats(), getFlag("ai_staff"), getFlag("ai_owner_staff"),
    ]);
    const empty = { proposed: 0, applied: 0, rejected: 0, undone: 0 };
    return NextResponse.json({
      status,
      settings: status.settings,
      employees: {
        customer: CUSTOMER_EMPLOYEES.map((e) => ({
          ...e, enabled: true, instructions: e.defaultInstructions,
          stats: stats[e.id] ?? empty,
        })),
        owner: owner.map((e) => ({ ...e, stats: stats[e.id] ?? empty })),
      },
      usage,
      flags: { ai_staff: aiStaff, ai_owner_staff: aiOwnerStaff },
    });
  } catch (err) {
    return httpErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, "settings");
  if ("error" in auth) return auth.error;
  const actor = auth.actor;
  let body: {
    settings?: Partial<AiGatewaySettings>;
    employees?: { id: string; enabled?: boolean; instructions?: string }[];
  };
  try {
    body = await readJsonBody(req, { maxBytes: 64 * 1024 });
  } catch (err) {
    return httpErrorResponse(err);
  }
  try {
    const before = await getAiSettings();
    let settings = before;
    if (body.settings) settings = (await setAiSettings(body.settings)).value;
    const employeeChanges: string[] = [];
    if (Array.isArray(body.employees)) {
      for (const change of body.employees.slice(0, 20)) {
        if (!change || typeof change.id !== "string") continue;
        const def = employeeById(change.id);
        if (!def || def.scope !== "owner") continue; // overrides exist for owner staff
        await setEmployeeOverride(change.id, {
          ...(typeof change.enabled === "boolean" ? { enabled: change.enabled } : {}),
          ...(typeof change.instructions === "string" ? { instructions: change.instructions } : {}),
        });
        employeeChanges.push(change.id);
      }
    }
    await recordAudit({
      actor, action: "ai.config_updated", target: "ai-gateway",
      detail: {
        providerFrom: before.activeProvider, providerTo: settings.activeProvider,
        emergencyStopFrom: before.emergencyStop, emergencyStopTo: settings.emergencyStop,
        fallbackEnabled: settings.fallbackEnabled,
        dailyCostCapUSD: settings.dailyCostCapUSD, dailyActionCap: settings.dailyActionCap,
        employeesChanged: employeeChanges,
      },
    });
    if (before.emergencyStop !== settings.emergencyStop) {
      await recordAudit({
        actor, action: settings.emergencyStop ? "ai.emergency_stop_engaged" : "ai.emergency_stop_released",
        target: "ai-gateway", detail: {},
      });
    }
    const status = await getAiStatus();
    return NextResponse.json({ ok: true, status, settings: status.settings });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
