import { NextRequest } from "next/server";
import { getFlag } from "../../../../lib/flags";
import { supportEngineV2 } from "../../../../services/ai-support-v2";
import { answerCustomerTeam, customerTeamAvailable } from "../../../../lib/ai/customer";
import { answerSupport } from "../../../../services/ai-support";
import { chunkText } from "../../../../lib/support-tools";
import { httpErrorResponse, readJsonBody, getClientIp } from "../../../../lib/http";
import { rateLimiters, tooManyRequests } from "../../../../lib/ratelimit";

export const runtime = "nodejs";

/**
 * Streaming support endpoint (Phase 6, feature 25). Flag-gated by
 * `ai_support_v2`. Server-Sent Events: zero or more
 * `data: {"delta": "…"}` frames followed by one terminal
 * `data: {"done": true, "sources": […], "handoff": bool, "model": "…"}`.
 * The grounded engine composes the full answer first (tools run
 * server-side), then streams it progressively via chunkText.
 */
export async function POST(req: NextRequest) {
  // Phase 5 upgrade: the stream serves when EITHER the v2 engine flag
  // or the AI-staff flag is on. Inside, the AI team answers when it is
  // enabled + configured; else the v2 engine (its flag on); else the
  // unflagged grounded baseline — each layer honest about what it is.
  const v2On = await getFlag("ai_support_v2");
  const staffOn = await getFlag("ai_staff");
  if (!v2On && !staffOn) {
    return new Response(JSON.stringify({ error: "FEATURE_DISABLED" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
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
  const aiCheck = rateLimiters.aiChatIp.check(`ip:${getClientIp(req)}`);
  if (!aiCheck.allowed) return tooManyRequests(aiCheck);
  const message = (body?.message ?? "").trim().slice(0, 1000);
  if (!message) {
    return new Response(JSON.stringify({ error: "EMPTY_MESSAGE" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        // Phase 5 upgrade: the AI customer team answers when its flag
        // is on AND a real provider is configured. Otherwise the
        // pre-existing grounded v2 engine answers, unchanged.
        if (staffOn && (await customerTeamAvailable())) {
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
            for (const chunk of chunkText(team.text)) send({ delta: chunk });
            send({
              done: true, sources: team.sources, handoff: team.handoff, model: team.model,
              employee: { id: team.employee.id, name: team.employee.name, avatar: team.employee.avatar },
            });
            return;
          }
        }
        if (!v2On) {
          // Only ai_staff was on but the team is unavailable
          // (unconfigured / stopped): stream the grounded baseline.
          const grounded = await answerSupport(message);
          for (const chunk of chunkText(grounded.answer)) send({ delta: chunk });
          send({ done: true, sources: grounded.sources, handoff: grounded.handoff, model: grounded.model });
          return;
        }
        const gen = supportEngineV2.stream(message, {
          orderId: body?.orderId?.trim() || null,
          email: body?.email?.trim() || null,
        });
        let step = await gen.next();
        while (!step.done) {
          send({ delta: step.value });
          step = await gen.next();
        }
        const final = step.value;
        send({ done: true, sources: final.sources, handoff: final.handoff, model: final.model });
      } catch {
        send({ done: true, error: "STREAM_FAILED", sources: [], handoff: true, model: "error" });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
