"use client";

/**
 * Manager's Office — AI Staff panel (Phase 5 upgrade).
 *
 * One screen for the whole gateway: provider status + one-click
 * provider switch, models, daily caps, the EMERGENCY STOP, both
 * employee rosters (owner staff: on/off + editable instructions +
 * stats), the owner chat (commands in the owner's language), the
 * preview/approval queue — where the owner's click is the only thing
 * that applies a change — and the customer-conversation log for
 * quality review.
 *
 * When no provider is configured the panel says so plainly and the
 * chat stays disabled: the store never fakes AI.
 */
import { useCallback, useEffect, useState } from "react";

export interface AiStaffDict {
  loading: string; title: string; sub: string; notConfigured: string; provider: string;
  model: string; fallback: string; stop: string; stopOn: string; stopOff: string;
  today: string; cost: string; actionsCount: string; conversationsCount: string;
  capCost: string; capActions: string; save: string; saved: string;
  teamCustomer: string; teamOwner: string; tools: string; instructions: string; stats: string;
  chatTitle: string; chatPh: string; send: string; thinking: string;
  pendingTitle: string; nonePending: string; apply: string; approve: string; reject: string;
  undo: string; stPreview: string; stWaiting: string; stApplied: string; stRejected: string;
  stUndone: string; refusedTitle: string; convsTitle: string; flagOff: string; mockNote: string;
}

interface EmployeeView {
  id: string; scope: string; nameEn: string; nameAr: string; avatar: string;
  toneEn: string; enabled: boolean; instructions: string; tools: string[];
  stats: { proposed: number; applied: number; rejected: number; undone: number };
}
interface AiActionView {
  id: string; employeeId: string; toolName: string; cls: "safe" | "sensitive";
  summary: string; status: string; hasUndo: boolean; createdAt: string;
  diff: { field: string; before: string; after: string }[]; resultNote?: string;
}
interface ConfigView {
  status: {
    configured: boolean; active: string | null; activeModel: string | null; mockMode: boolean;
    emergencyStop: boolean; fallbackEnabled: boolean;
    providers: { id: string; configured: boolean; model: string }[];
  };
  settings: {
    activeProvider: "meta" | "openai"; fallbackEnabled: boolean; metaModel: string;
    fallbackModel: string; dailyCostCapUSD: number; dailyActionCap: number; emergencyStop: boolean;
  };
  employees: { customer: EmployeeView[]; owner: EmployeeView[] };
  usage: { costUSD: number; actions: number; conversations: number; turns: number; inputTokens: number; outputTokens: number };
  flags: { ai_staff: boolean; ai_owner_staff: boolean };
}
interface ConversationView {
  id: string; employeeId: string; locale: string; startedAt: string;
  injectionSuspected?: boolean; escalatedTicketId: string | null;
  messages: { role: string; text: string; at: string }[];
}
interface ChatLine { role: "user" | "assistant"; text: string }

export default function AiStaffPanel({ dict, locale }: { dict: AiStaffDict; locale: string }) {
  const [cfg, setCfg] = useState<ConfigView | null>(null);
  const [actions, setActions] = useState<AiActionView[]>([]);
  const [convs, setConvs] = useState<ConversationView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [draft, setDraft] = useState("");
  const [employeePick, setEmployeePick] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusals, setRefusals] = useState<{ tool: string; code: string }[]>([]);
  const [instrDrafts, setInstrDrafts] = useState<Record<string, string>>({});
  const [metaModel, setMetaModel] = useState("");
  const [fallbackModel, setFallbackModel] = useState("");
  const [capCost, setCapCost] = useState("");
  const [capActions, setCapActions] = useState("");
  const ar = locale === "ar";

  const loadAll = useCallback(async () => {
    const [c, a, v] = await Promise.all([
      fetch("/api/admin/ai/config").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/admin/ai/actions").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/admin/ai/conversations?scope=customer&limit=10").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    if (c) {
      setCfg(c as ConfigView);
      const cc = c as ConfigView;
      setMetaModel(cc.settings.metaModel);
      setFallbackModel(cc.settings.fallbackModel);
      setCapCost(String(cc.settings.dailyCostCapUSD));
      setCapActions(String(cc.settings.dailyActionCap));
    }
    if (a) setActions((a as { actions: AiActionView[] }).actions);
    if (v) setConvs((v as { conversations: ConversationView[] }).conversations);
  }, []);
  useEffect(() => { void loadAll(); }, [loadAll]);

  async function postConfig(body: unknown) {
    const res = await fetch("/api/admin/ai/config", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!res.ok) { setError(`HTTP ${res.status}`); return; }
    setNotice(dict.saved);
    await loadAll();
  }

  async function decide(actionId: string, decision: string) {
    const res = await fetch("/api/admin/ai/actions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId, decision }),
    });
    const d = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) { setError(d.error ?? `HTTP ${res.status}`); return; }
    setNotice(dict.saved);
    await loadAll();
  }

  async function sendChat() {
    const message = draft.trim();
    if (!message || busy) return;
    setBusy(true);
    setDraft("");
    const history = chat.slice(-10);
    setChat((c) => [...c, { role: "user", text: message }]);
    try {
      const res = await fetch("/api/admin/ai/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, ...(employeePick ? { employeeId: employeePick } : {}), history }),
      });
      const d = (await res.json()) as {
        reply: string; refusals?: { tool: string; code: string }[];
        employeeName?: string;
      };
      const who = d.employeeName ? `${d.employeeName}: ` : "";
      setChat((c) => [...c, { role: "assistant", text: `${who}${d.reply}` }]);
      if (d.refusals && d.refusals.length > 0) setRefusals(d.refusals);
      await loadAll();
    } catch {
      setChat((c) => [...c, { role: "assistant", text: "⚠ network error" }]);
    } finally {
      setBusy(false);
    }
  }

  if (!cfg) return <p className="muted">{error ?? dict.loading}</p>;
  const s = cfg.settings;
  const statusLabel = (a: AiActionView): string =>
    a.status === "preview" ? dict.stPreview
      : a.status === "awaiting_approval" ? dict.stWaiting
        : a.status === "applied" ? dict.stApplied
          : a.status === "rejected" ? dict.stRejected : dict.stUndone;
  const statsLine = (e: EmployeeView) => dict.stats
    .replace("{p}", String(e.stats.proposed)).replace("{a}", String(e.stats.applied))
    .replace("{r}", String(e.stats.rejected)).replace("{u}", String(e.stats.undone));
  const empName = (e: EmployeeView) => (ar ? e.nameAr : e.nameEn);
  const pending = actions.filter((a) => a.status === "preview" || a.status === "awaiting_approval");
  const historyActions = actions.filter((a) => a.status !== "preview" && a.status !== "awaiting_approval");

  return (
    <div>
      <p className="muted">{dict.sub}</p>
      {error && <p className="form-error">{error}</p>}
      {notice && <p className="ok-text">{notice}</p>}
      {!cfg.status.configured && <p className="form-error">{dict.notConfigured}</p>}
      {cfg.status.mockMode && <p className="ok-text">{dict.mockNote}</p>}
      {s.emergencyStop && <p className="form-error">⛔ {dict.stopOn}</p>}

      <div className="admin-grid">
        <div className="stat-card"><span className="muted">{dict.provider}</span><strong>{cfg.status.active ?? "—"}</strong><span className="muted">{cfg.status.activeModel ?? ""}</span></div>
        <div className="stat-card"><span className="muted">{dict.today} · {dict.cost}</span><strong>${cfg.usage.costUSD}</strong><span className="muted">{cfg.usage.inputTokens}+{cfg.usage.outputTokens} tok</span></div>
        <div className="stat-card"><span className="muted">{dict.actionsCount}</span><strong>{cfg.usage.actions}</strong></div>
        <div className="stat-card"><span className="muted">{dict.conversationsCount}</span><strong>{cfg.usage.conversations}</strong></div>
      </div>

      <h3>{dict.provider}</h3>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {cfg.status.providers.map((p) => (
          <button
            key={p.id} type="button"
            className={s.activeProvider === p.id ? "btn" : "btn btn-ghost"}
            disabled={!p.configured}
            onClick={() => void postConfig({ settings: { activeProvider: p.id } })}
          >
            {p.id === "meta" ? "Meta · Muse Spark" : "OpenAI-compatible"} — {p.model} {p.configured ? "" : "(no key)"}
          </button>
        ))}
        <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <input
            type="checkbox" checked={s.fallbackEnabled}
            onChange={(e) => void postConfig({ settings: { fallbackEnabled: e.target.checked } })}
          />
          {dict.fallback}
        </label>
      </div>
      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", marginTop: 10 }}>
        <label>{dict.model} (Meta)<input value={metaModel} onChange={(e) => setMetaModel(e.target.value)} /></label>
        <label>{dict.model} (fallback)<input value={fallbackModel} onChange={(e) => setFallbackModel(e.target.value)} /></label>
        <label>{dict.capCost}<input inputMode="decimal" value={capCost} onChange={(e) => setCapCost(e.target.value)} /></label>
        <label>{dict.capActions}<input inputMode="numeric" value={capActions} onChange={(e) => setCapActions(e.target.value)} /></label>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <button
          type="button" className="btn"
          onClick={() => void postConfig({
            settings: {
              metaModel: metaModel || "muse-spark-1.3", fallbackModel,
              dailyCostCapUSD: Math.max(0, Number(capCost) || 0),
              dailyActionCap: Math.max(0, Math.floor(Number(capActions) || 0)),
            },
          })}
        >{dict.save}</button>
        <button
          type="button"
          className={s.emergencyStop ? "btn" : "btn btn-ghost"}
          style={s.emergencyStop ? undefined : { borderColor: "#b3261e", color: "#b3261e" }}
          onClick={() => void postConfig({ settings: { emergencyStop: !s.emergencyStop } })}
        >
          ⛔ {dict.stop}: {s.emergencyStop ? dict.stopOn : dict.stopOff}
        </button>
      </div>

      <h3>{dict.teamCustomer}</h3>
      {!cfg.flags.ai_staff && <p className="muted">{dict.flagOff}</p>}
      <div className="admin-grid">
        {cfg.employees.customer.map((e) => (
          <div key={e.id} className="stat-card">
            <strong>{e.avatar} {empName(e)}</strong>
            <span className="muted">{e.toneEn}</span>
          </div>
        ))}
      </div>

      <h3>{dict.teamOwner}</h3>
      {!cfg.flags.ai_owner_staff && <p className="muted">{dict.flagOff}</p>}
      <div style={{ display: "grid", gap: 10 }}>
        {cfg.employees.owner.map((e) => (
          <div key={e.id} className="panel" style={{ margin: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <strong>{e.avatar} {empName(e)}</strong>
              <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                <input
                  type="checkbox" checked={e.enabled}
                  onChange={(ev) => void postConfig({ employees: [{ id: e.id, enabled: ev.target.checked }] })}
                />
                {e.enabled ? "ON" : "OFF"}
              </label>
            </div>
            <p className="muted" style={{ margin: "4px 0" }}>{dict.tools}: {e.tools.join(", ") || "—"} · {statsLine(e)}</p>
            <label style={{ display: "block" }}>
              {dict.instructions}
              <textarea
                rows={2} style={{ width: "100%" }}
                value={instrDrafts[e.id] ?? e.instructions}
                onChange={(ev) => setInstrDrafts((d) => ({ ...d, [e.id]: ev.target.value }))}
              />
            </label>
            <button
              type="button" className="btn btn-ghost"
              onClick={() => void postConfig({ employees: [{ id: e.id, instructions: instrDrafts[e.id] ?? e.instructions }] })}
            >{dict.save}</button>
          </div>
        ))}
      </div>

      <h3>{dict.chatTitle}</h3>
      <div className="panel" style={{ margin: 0 }}>
        <div style={{ maxHeight: 320, overflowY: "auto", display: "grid", gap: 8 }}>
          {chat.map((line, i) => (
            <div key={i} style={{ textAlign: line.role === "user" ? "end" : "start" }}>
              <span className={line.role === "user" ? "pill pill-ok" : "pill"} style={{ whiteSpace: "pre-wrap", textAlign: "start", display: "inline-block", maxWidth: "92%" }}>
                {line.text}
              </span>
            </div>
          ))}
          {busy && <p className="muted">{dict.thinking}</p>}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <select value={employeePick} onChange={(e) => setEmployeePick(e.target.value)}>
            <option value="">Auto</option>
            {cfg.employees.owner.map((e) => (
              <option key={e.id} value={e.id} disabled={!e.enabled}>{e.avatar} {empName(e)}</option>
            ))}
          </select>
          <input
            style={{ flex: 1, minWidth: 200 }} value={draft} placeholder={dict.chatPh}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void sendChat(); }}
          />
          <button type="button" className="btn" disabled={busy || !cfg.status.configured || !cfg.flags.ai_owner_staff} onClick={() => void sendChat()}>
            {dict.send}
          </button>
        </div>
        {refusals.length > 0 && (
          <p className="form-error" style={{ marginTop: 8 }}>
            {dict.refusedTitle}: {refusals.map((r) => `${r.tool} (${r.code})`).join(", ")}
          </p>
        )}
      </div>

      <h3>{dict.pendingTitle}</h3>
      {pending.length === 0 && historyActions.length === 0 && <p className="muted">{dict.nonePending}</p>}
      <div style={{ display: "grid", gap: 10 }}>
        {[...pending, ...historyActions].map((a) => (
          <div key={a.id} className="panel" style={{ margin: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <strong>{a.toolName}</strong>
              <span className={a.status === "applied" ? "pill pill-ok" : a.status === "rejected" ? "pill pill-bad" : "pill"}>
                {statusLabel(a)} · {a.cls}
              </span>
            </div>
            <p style={{ margin: "6px 0" }}>{a.summary}</p>
            {a.diff.length > 0 && (
              <table className="admin-table">
                <tbody>
                  {a.diff.map((d, i) => (
                    <tr key={i}><td>{d.field}</td><td style={{ opacity: 0.75 }}>{d.before}</td><td>→</td><td>{d.after}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
            {a.resultNote && <p className="muted">{a.resultNote}</p>}
            <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
              {a.status === "preview" && a.cls === "safe" && (
                <button type="button" className="btn" onClick={() => void decide(a.id, "apply")}>{dict.apply}</button>
              )}
              {a.status === "awaiting_approval" && (
                <>
                  <button type="button" className="btn" onClick={() => void decide(a.id, "approve")}>{dict.approve}</button>
                  <button type="button" className="btn btn-ghost" onClick={() => void decide(a.id, "reject")}>{dict.reject}</button>
                </>
              )}
              {a.status === "applied" && a.hasUndo && (
                <button type="button" className="btn btn-ghost" onClick={() => void decide(a.id, "undo")}>{dict.undo}</button>
              )}
            </div>
          </div>
        ))}
      </div>

      <h3>{dict.convsTitle}</h3>
      {convs.length === 0 && <p className="muted">—</p>}
      <div style={{ display: "grid", gap: 8 }}>
        {convs.map((c) => (
          <details key={c.id} className="panel" style={{ margin: 0 }}>
            <summary>
              {c.employeeId} · {c.locale} · {new Date(c.startedAt).toLocaleString()}
              {c.injectionSuspected ? " · ⚠ injection suspected" : ""}
              {c.escalatedTicketId ? ` · 🎫 ${c.escalatedTicketId.slice(0, 8)}` : ""}
            </summary>
            {c.messages.map((m, i) => (
              <p key={i} style={{ margin: "6px 0" }}>
                <strong>{m.role}:</strong> {m.text}
              </p>
            ))}
          </details>
        ))}
      </div>
    </div>
  );
}
