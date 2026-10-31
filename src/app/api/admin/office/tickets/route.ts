import { NextRequest, NextResponse } from "next/server";
import { recordAudit, requireAdmin } from "../../../../../lib/team";
import { listTickets, updateTicket, type TicketStatus } from "../../../../../lib/tickets";
import { httpErrorResponse, readJsonBody } from "../../../../../lib/http";

export const runtime = "nodejs";

/**
 * Manager's Office — support tickets (Phase 4 upgrade, item 6).
 * Intake is public (POST /api/support/ticket); the office lists and
 * triages. Replying happens from the owner's own mailbox — the ticket
 * carries the customer's email — so status transitions are what the
 * office records (open → answered → closed, reopenable). Bodies are
 * PII: audit entries carry id + status only, never the message text.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req, "read");
  if ("error" in auth) return auth.error;
  const status = req.nextUrl.searchParams.get("status") as TicketStatus | null;
  const tickets = await listTickets({ status: status ?? undefined, limit: 200 });
  return NextResponse.json({ tickets });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, "support_ops");
  if ("error" in auth) return auth.error;
  let body: { id?: string; status?: string } | null;
  try {
    body = await readJsonBody(req, { maxBytes: 8 * 1024 });
  } catch (err) {
    return httpErrorResponse(err);
  }
  if (!body?.id || !["open", "answered", "closed"].includes(body.status ?? "")) {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }
  const result = await updateTicket(body.id, { status: body.status as TicketStatus });
  if (!result.ok || !result.ticket) {
    return NextResponse.json({ error: result.error ?? "UPDATE_FAILED" }, { status: 409 });
  }
  await recordAudit({ actor: auth.actor, action: "office.ticket_status", target: body.id, detail: { status: body.status } });
  return NextResponse.json({ ok: true, ticket: result.ticket });
}
