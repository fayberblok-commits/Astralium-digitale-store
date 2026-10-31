/**
 * AI conversation log (Phase 5 upgrade) — quality review + evidence.
 *
 * Every customer-team and owner-staff conversation is appended here
 * (config store `ai_conversations_v1` / `.data/ai-conversations.json`,
 * capped at 100 conversations × 60 messages so the log can never grow
 * unbounded). The owner reviews customer conversations in the office;
 * owner-staff conversations pair with the audit log (actions.ts) to
 * show exactly what was ordered, previewed and applied.
 *
 * Customer messages are stored verbatim for review — including
 * injection attempts, which are flagged (`injectionSuspected`) so the
 * owner can see them. No payment data ever reaches this log: the chat
 * surface has no payment fields.
 */
import { getJsonConfig, setJsonConfig } from "../config-store.ts";
import { randomUUID } from "node:crypto";

export interface ConversationMessage {
  role: "user" | "assistant" | "system";
  text: string;
  at: string;
}

export interface ConversationRecord {
  id: string;
  scope: "customer" | "owner";
  locale: string;
  employeeId: string;
  actor?: string; // owner conversations: the admin actor label
  startedAt: string;
  updatedAt: string;
  model: string;
  injectionSuspected?: boolean;
  escalatedTicketId?: string | null;
  messages: ConversationMessage[];
}

interface ConvDoc {
  conversations: ConversationRecord[];
}

const MAX_CONVERSATIONS = 100;
const MAX_MESSAGES = 60;

export function sanitizeConversations(raw: unknown): ConvDoc {
  if (!raw || typeof raw !== "object") return { conversations: [] };
  const list = (raw as { conversations?: unknown }).conversations;
  if (!Array.isArray(list)) return { conversations: [] };
  const out: ConversationRecord[] = [];
  for (const item of list.slice(-MAX_CONVERSATIONS)) {
    if (!item || typeof item !== "object") continue;
    const r = item as Partial<ConversationRecord>;
    if (typeof r.id !== "string" || (r.scope !== "customer" && r.scope !== "owner")) continue;
    out.push({
      id: r.id,
      scope: r.scope,
      locale: typeof r.locale === "string" ? r.locale.slice(0, 10) : "en",
      employeeId: typeof r.employeeId === "string" ? r.employeeId.slice(0, 40) : "",
      ...(typeof r.actor === "string" ? { actor: r.actor.slice(0, 120) } : {}),
      startedAt: typeof r.startedAt === "string" ? r.startedAt : new Date().toISOString(),
      updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : new Date().toISOString(),
      model: typeof r.model === "string" ? r.model.slice(0, 80) : "",
      ...(r.injectionSuspected === true ? { injectionSuspected: true } : {}),
      escalatedTicketId: typeof r.escalatedTicketId === "string" ? r.escalatedTicketId : null,
      messages: Array.isArray(r.messages)
        ? r.messages.slice(-MAX_MESSAGES).filter(
            (m): m is ConversationMessage =>
              Boolean(m) && typeof m === "object" &&
              ((m as ConversationMessage).role === "user" || (m as ConversationMessage).role === "assistant" || (m as ConversationMessage).role === "system") &&
              typeof (m as ConversationMessage).text === "string",
          ).map((m) => ({ role: m.role, text: m.text.slice(0, 4000), at: typeof m.at === "string" ? m.at : new Date().toISOString() }))
        : [],
    });
  }
  return { conversations: out };
}

async function load(): Promise<ConvDoc> {
  return getJsonConfig<ConvDoc>("ai_conversations_v1", "ai-conversations.json", sanitizeConversations, { conversations: [] });
}

async function save(doc: ConvDoc): Promise<void> {
  await setJsonConfig("ai_conversations_v1", "ai-conversations.json", doc, sanitizeConversations);
}

export async function startConversation(input: {
  scope: "customer" | "owner";
  locale: string;
  employeeId: string;
  actor?: string;
  model: string;
}): Promise<ConversationRecord> {
  const doc = await load();
  const now = new Date().toISOString();
  const rec: ConversationRecord = {
    id: randomUUID(),
    scope: input.scope,
    locale: input.locale,
    employeeId: input.employeeId,
    ...(input.actor ? { actor: input.actor } : {}),
    startedAt: now,
    updatedAt: now,
    model: input.model,
    escalatedTicketId: null,
    messages: [],
  };
  doc.conversations.push(rec);
  doc.conversations = doc.conversations.slice(-MAX_CONVERSATIONS);
  await save(doc);
  return rec;
}

export async function appendMessages(
  id: string,
  messages: { role: "user" | "assistant"; text: string }[],
  patch?: { injectionSuspected?: boolean; escalatedTicketId?: string | null; employeeId?: string; model?: string },
): Promise<void> {
  const doc = await load();
  const rec = doc.conversations.find((c) => c.id === id);
  if (!rec) return;
  const now = new Date().toISOString();
  for (const m of messages) rec.messages.push({ role: m.role, text: m.text.slice(0, 4000), at: now });
  rec.messages = rec.messages.slice(-MAX_MESSAGES);
  rec.updatedAt = now;
  if (patch?.injectionSuspected) rec.injectionSuspected = true;
  if (patch && "escalatedTicketId" in patch) rec.escalatedTicketId = patch.escalatedTicketId ?? null;
  if (patch?.employeeId) rec.employeeId = patch.employeeId;
  if (patch?.model) rec.model = patch.model;
  await save(doc);
}

export async function listConversations(opts: { scope?: "customer" | "owner"; limit?: number } = {}): Promise<ConversationRecord[]> {
  const doc = await load();
  const list = opts.scope ? doc.conversations.filter((c) => c.scope === opts.scope) : doc.conversations;
  return [...list].reverse().slice(0, opts.limit ?? 50);
}
