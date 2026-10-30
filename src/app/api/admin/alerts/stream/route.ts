import { NextRequest } from "next/server";
import { listOwnerEvents } from "../../../../../lib/owner-alerts";
import { requireAdmin } from "../../../../../lib/team";

export const runtime = "nodejs";

/**
 * Live owner-alert updates (Phase 6, feature 26): an SSE stream that
 * polls the event store server-side every 4s and pushes events newer
 * than the client's watermark. The inbox component falls back to plain
 * polling when EventSource fails — same data either way.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req, "read");
  if ("error" in auth) return auth.error;
  const encoder = new TextEncoder();
  let closed = false;
  let lastSeen = new Date().toISOString();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };
      send({ type: "ready" });
      const timer = setInterval(async () => {
        if (closed) return;
        try {
          const events = await listOwnerEvents({ limit: 20 });
          const fresh = events.filter((e) => e.createdAt > lastSeen);
          for (const e of fresh.reverse()) {
            send({ type: "event", event: e });
            lastSeen = e.createdAt;
          }
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          // transient store hiccup — next tick retries
        }
      }, 4000);
      req.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(timer);
        try { controller.close(); } catch { /* already closed */ }
      });
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
