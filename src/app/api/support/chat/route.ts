import { NextRequest, NextResponse } from "next/server";
import { answerSupport } from "../../../../services/ai-support";
import { getFlag } from "../../../../lib/flags";
import { answerCustomerTeam, customerTeamAvailable } from "../../../../lib/ai/customer";
import { httpErrorResponse, readJsonBody, getClientIp } from "../../../../lib/http";
import { rateLimiters, tooManyRequests } from "../../../../lib/ratelimit";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: {
    message?: string; locale?: string; orderId?: string; email?: string;
    history?: { role: "user" | "assistant"; text: string }[];
  } | null;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return httpErrorResponse(err);
  }
  const ipCheck = rateLimiters.supportIp.check(`ip:${getClientIp(req)}`);
  if (!ipCheck.allowed) return tooManyRequests(ipCheck);
  const message = (body?.message ?? "").trim().slice(0, 1000);
  if (!message) {
    return NextResponse.json({ error: "EMPTY_MESSAGE" }, { status: 400 });
  }
  // Phase 5 upgrade: AI customer team when enabled + configured;
  // otherwise the deterministic grounded engine, unchanged.
  if ((await getFlag("ai_staff")) && (await customerTeamAvailable())) {
    const team = await answerCustomerTeam({
      message,
      email: body?.email?.trim() || undefined,
      orderId: body?.orderId?.trim() || undefined,
      locale: body?.locale?.trim() || "en",
      history: Array.isArray(body?.history)
        ? body.history.filter((h) => h && (h.role === "user" || h.role === "assistant") && typeof h.text === "string").slice(-8)
        : undefined,
    });
    if (team) {
      return NextResponse.json({
        answer: team.text, sources: team.sources, handoff: team.handoff, model: team.model,
        employee: { id: team.employee.id, name: team.employee.name, avatar: team.employee.avatar },
      });
    }
  }
  const answer = await answerSupport(message);
  return NextResponse.json(answer);
}
