/**
 * AI action engine (Phase 5 upgrade) — where previews become changes,
 * and only at the owner's hand.
 *
 * Lifecycle of a write the AI proposed:
 *   safe tool      → status "preview"          → owner Apply  → "applied" (undoable)
 *   sensitive tool → status "awaiting_approval" → owner Approve → "applied" (undoable)
 *                                                → owner Reject  → "rejected"
 *   applied        → owner Undo (when the tool carries a snapshot) → "undone"
 *
 * Enforcement, here and in tools.ts (never in prompts):
 *  - the EMERGENCY STOP blocks new proposals outright;
 *  - the daily ACTION CAP blocks proposals past the owner's budget;
 *  - apply/approve re-checks the clicking actor's permission for the
 *    tool (the same permission the equivalent manual route requires);
 *  - EVERY transition writes an audit entry whose detail states it
 *    was "executed by employee X on the owner's order", with the
 *    tool inputs and the outcome.
 *
 * Records persist via the config store (`ai_actions_v1`), capped at
 * 200. Undo snapshots live server-side only — never sent to the model.
 */
import { randomUUID } from "node:crypto";
import { getJsonConfig, setJsonConfig } from "../config-store.ts";
import { can, recordAudit, type AdminActor } from "../team.ts";
import { getAiSettings } from "./config.ts";
import { checkCaps, recordAiUsage } from "./usage.ts";
import { applyTool, undoTool, TOOL_REGISTRY, type DiffEntry, type ToolClass, type ToolDef, type ToolPreview } from "./tools.ts";

export type AiActionStatus = "preview" | "awaiting_approval" | "applied" | "rejected" | "undone";

export interface AiAction {
  id: string;
  createdAt: string;
  employeeId: string;
  toolName: string;
  cls: ToolClass;
  requiredPermission: string;
  input: Record<string, unknown>;
  summary: string;
  diff: DiffEntry[];
  status: AiActionStatus;
  undo: unknown;
  hasUndo: boolean;
  conversationId?: string;
  requestedBy: string;
  decidedBy?: string;
  decidedAt?: string;
  resultNote?: string;
}

interface ActionsDoc {
  actions: AiAction[];
}

const MAX_ACTIONS = 200;

export function sanitizeActions(raw: unknown): ActionsDoc {
  if (!raw || typeof raw !== "object") return { actions: [] };
  const list = (raw as { actions?: unknown }).actions;
  if (!Array.isArray(list)) return { actions: [] };
  const out: AiAction[] = [];
  for (const item of list.slice(-MAX_ACTIONS)) {
    if (!item || typeof item !== "object") continue;
    const r = item as Partial<AiAction>;
    if (typeof r.id !== "string" || typeof r.toolName !== "string" || typeof r.employeeId !== "string") continue;
    if (!["preview", "awaiting_approval", "applied", "rejected", "undone"].includes(String(r.status))) continue;
    out.push({
      id: r.id,
      createdAt: typeof r.createdAt === "string" ? r.createdAt : new Date().toISOString(),
      employeeId: r.employeeId,
      toolName: r.toolName,
      cls: r.cls === "sensitive" ? "sensitive" : "safe",
      requiredPermission: typeof r.requiredPermission === "string" ? r.requiredPermission : "settings",
      input: r.input && typeof r.input === "object" ? (r.input as Record<string, unknown>) : {},
      summary: typeof r.summary === "string" ? r.summary : "",
      diff: Array.isArray(r.diff) ? r.diff : [],
      status: r.status as AiActionStatus,
      undo: r.undo ?? null,
      hasUndo: r.hasUndo === true,
      ...(typeof r.conversationId === "string" ? { conversationId: r.conversationId } : {}),
      requestedBy: typeof r.requestedBy === "string" ? r.requestedBy : "",
      ...(typeof r.decidedBy === "string" ? { decidedBy: r.decidedBy } : {}),
      ...(typeof r.decidedAt === "string" ? { decidedAt: r.decidedAt } : {}),
      ...(typeof r.resultNote === "string" ? { resultNote: r.resultNote } : {}),
    });
  }
  return { actions: out };
}

async function load(): Promise<ActionsDoc> {
  return getJsonConfig<ActionsDoc>("ai_actions_v1", "ai-actions.json", sanitizeActions, { actions: [] });
}

async function save(doc: ActionsDoc): Promise<void> {
  await setJsonConfig("ai_actions_v1", "ai-actions.json", doc, sanitizeActions);
}

export async function listActions(limit = 50): Promise<AiAction[]> {
  const doc = await load();
  return [...doc.actions].reverse().slice(0, limit);
}

export async function getAction(id: string): Promise<AiAction | null> {
  const doc = await load();
  return doc.actions.find((a) => a.id === id) ?? null;
}

export type ProposeResult =
  | { ok: true; action: AiAction }
  | { ok: false; code: "EMERGENCY_STOP" | "ACTION_CAP_REACHED"; message: string };

/** Create an action record from a tool preview (gateway calls this). */
export async function proposeAction(input: {
  actor: AdminActor;
  employeeId: string;
  def: ToolDef;
  toolInput: Record<string, unknown>;
  preview: ToolPreview;
  conversationId?: string;
}): Promise<ProposeResult> {
  const settings = await getAiSettings();
  if (settings.emergencyStop) {
    return { ok: false, code: "EMERGENCY_STOP", message: "The AI emergency stop is engaged — no new actions can be proposed." };
  }
  const caps = await checkCaps(settings);
  if (!caps.actionsOk) {
    return { ok: false, code: "ACTION_CAP_REACHED", message: `Daily AI action cap reached (${caps.today.actions}/${settings.dailyActionCap}).` };
  }
  const action: AiAction = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    employeeId: input.employeeId,
    toolName: input.def.name,
    cls: input.def.cls,
    requiredPermission: input.def.requiredPermission,
    input: input.toolInput,
    summary: input.preview.summary,
    diff: input.preview.diff,
    status: input.def.cls === "sensitive" ? "awaiting_approval" : "preview",
    undo: input.preview.undo ?? null,
    hasUndo: Boolean(input.def.undo) && input.preview.undo !== null && input.preview.undo !== undefined,
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    requestedBy: input.actor.actor,
  };
  const doc = await load();
  doc.actions.push(action);
  doc.actions = doc.actions.slice(-MAX_ACTIONS);
  await save(doc);
  await recordAiUsage({ actions: 1 });
  await recordAudit({
    actor: input.actor,
    action: "ai.action_proposed",
    target: input.def.name,
    detail: {
      employee: input.employeeId, tool: input.def.name, cls: input.def.cls,
      note: `Proposed by employee ${input.employeeId} on the owner's order; awaiting the owner's ${input.def.cls === "sensitive" ? "approval" : "apply click"}.`,
      input: input.toolInput,
    },
  });
  return { ok: true, action };
}

type TransitionResult = { ok: true; action: AiAction } | { ok: false; error: string };

async function transition(
  id: string,
  actor: AdminActor,
  fn: (action: AiAction, def: ToolDef) => Promise<{ status: AiActionStatus; resultNote?: string }>,
  auditAction: string,
): Promise<TransitionResult> {
  const doc = await load();
  const action = doc.actions.find((a) => a.id === id);
  if (!action) return { ok: false, error: "ACTION_NOT_FOUND" };
  const def = TOOL_REGISTRY.get(action.toolName);
  if (!def) return { ok: false, error: "TOOL_GONE" };
  if (!can(actor.role, def.requiredPermission)) {
    return { ok: false, error: `FORBIDDEN: role ${actor.role} lacks "${def.requiredPermission}" for ${def.name}` };
  }
  try {
    const outcome = await fn(action, def);
    action.status = outcome.status;
    if (outcome.resultNote) action.resultNote = outcome.resultNote;
    action.decidedBy = actor.actor;
    action.decidedAt = new Date().toISOString();
    await save(doc);
    await recordAudit({
      actor,
      action: auditAction,
      target: def.name,
      detail: {
        employee: action.employeeId, tool: def.name,
        note: `Executed by employee ${action.employeeId} on the owner's order (action ${action.id}).`,
        result: outcome.resultNote ?? action.status,
      },
    });
    return { ok: true, action };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "TRANSITION_FAILED" };
  }
}

/** Owner clicks "Apply" on a SAFE action preview. */
export async function applyAction(id: string, actor: AdminActor): Promise<TransitionResult> {
  return transition(id, actor, async (action, def) => {
    if (def.cls !== "safe") throw new Error("NOT_A_SAFE_ACTION — sensitive actions need Approve");
    if (action.status !== "preview") throw new Error(`ACTION_NOT_PENDING (status: ${action.status})`);
    const note = await applyTool(def, action.input);
    return { status: "applied", resultNote: note };
  }, "ai.action_applied");
}

/** Owner explicitly approves (or rejects) a SENSITIVE action. */
export async function decideAction(id: string, actor: AdminActor, decision: "approve" | "reject"): Promise<TransitionResult> {
  return transition(id, actor, async (action, def) => {
    if (def.cls !== "sensitive") throw new Error("NOT_A_SENSITIVE_ACTION — safe actions use Apply");
    if (action.status !== "awaiting_approval") throw new Error(`ACTION_NOT_PENDING (status: ${action.status})`);
    if (decision === "reject") return { status: "rejected", resultNote: "Rejected by the owner." };
    const note = await applyTool(def, action.input);
    return { status: "applied", resultNote: note };
  }, decision === "approve" ? "ai.action_approved" : "ai.action_rejected");
}

/** Owner undoes an applied action (when the tool carries a snapshot). */
export async function undoAction(id: string, actor: AdminActor): Promise<TransitionResult> {
  return transition(id, actor, async (action, def) => {
    if (action.status !== "applied") throw new Error(`ACTION_NOT_APPLIED (status: ${action.status})`);
    if (!action.hasUndo) throw new Error("ACTION_HAS_NO_UNDO");
    const note = await undoTool(def, action.undo, action.input);
    return { status: "undone", resultNote: note };
  }, "ai.action_undone");
}

/** Per-employee counters for the office stats. */
export async function employeeStats(): Promise<Record<string, { proposed: number; applied: number; rejected: number; undone: number }>> {
  const doc = await load();
  const out: Record<string, { proposed: number; applied: number; rejected: number; undone: number }> = {};
  for (const a of doc.actions) {
    const s = out[a.employeeId] ?? { proposed: 0, applied: 0, rejected: 0, undone: 0 };
    s.proposed += 1;
    if (a.status === "applied") s.applied += 1;
    if (a.status === "rejected") s.rejected += 1;
    if (a.status === "undone") s.undone += 1;
    out[a.employeeId] = s;
  }
  return out;
}
