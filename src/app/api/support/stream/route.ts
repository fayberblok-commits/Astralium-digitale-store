import { NextRequest } from "next/server";
import { getFlag } from "../../../../lib/flags";
import { supportEngineV2 } from "../../../../services/ai-support-v2";

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
  if (!(await getFlag("ai_support_v2"))) {
    return new Response(JSON.stringify({ error: "FEATURE_DISABLED" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  const body = (await req.json().catch(() => null)) as
    | { message?: string; locale?: string; orderId?: string; email?: string }
    | null;
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
