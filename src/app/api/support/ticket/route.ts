import { NextRequest, NextResponse } from "next/server";
import { createTicket, sanitizeTicketInput } from "../../../../lib/tickets";
import { captchaGate } from "../../../../lib/captcha";
import { getClientIp, httpErrorResponse, readJsonBody } from "../../../../lib/http";
import { rateLimiters, tooManyRequests } from "../../../../lib/ratelimit";
import { recordOwnerEvent } from "../../../../lib/owner-alerts";

export const runtime = "nodejs";

/**
 * Support ticket intake (Phase 4 upgrade): the human-handoff endpoint
 * behind the office support center. The AI assistant has always told
 * customers who need a human to "leave your email" — this is where
 * those messages land. Public by necessity, so it follows the Phase-1
 * public-form pattern exactly: per-IP rate limit + captcha gate when
 * a provider is configured (never a fake pass), strict sanitization.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const check = rateLimiters.supportIp.check(`ip:${ip}`);
  if (!check.allowed) return tooManyRequests(check);
  let body: Record<string, unknown> | null;
  try {
    body = await readJsonBody(req, { maxBytes: 16 * 1024 });
  } catch (err) {
    return httpErrorResponse(err);
  }
  const captchaBlock = await captchaGate(typeof body?.captchaToken === "string" ? body.captchaToken : undefined, ip ?? undefined);
  if (captchaBlock) return captchaBlock;
  const input = sanitizeTicketInput(body);
  if (!input) return NextResponse.json({ error: "INVALID_TICKET" }, { status: 400 });
  const ticket = await createTicket(input);
  // The owner hears about human handoffs in the alert center.
  await recordOwnerEvent({
    kind: "support_ticket",
    title: `Support ticket: ${ticket.subject}`,
    detail: { email: ticket.email, orderRef: ticket.orderRef ?? null, ticketId: ticket.id },
  }).catch(() => undefined);
  return NextResponse.json({ ok: true, ticketId: ticket.id });
}
