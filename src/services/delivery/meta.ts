/**
 * Shared Meta Graph API helpers for the WhatsApp / Messenger / Instagram
 * adapters and webhook replies. All calls go through the global fetch so
 * tests can stub it — no live Meta call ever happens in tests.
 */
import type { DeliveryItem } from "./types.ts";

export const GRAPH_BASE = "https://graph.facebook.com/v21.0";

export function envPresent(...keys: string[]): { ok: boolean; missing: string[] } {
  const missing = keys.filter((k) => !process.env[k]);
  return { ok: missing.length === 0, missing };
}

export interface GraphResult {
  ok: boolean;
  status: number;
  json: Record<string, unknown> | null;
  errorCode?: string;
}

export async function graphPost(path: string, accessToken: string, body: unknown): Promise<GraphResult> {
  try {
    const res = await fetch(`${GRAPH_BASE}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) {
      const err = (json?.error ?? {}) as { code?: number; message?: string };
      return { ok: false, status: res.status, json, errorCode: err.code ? `META_${err.code}` : `HTTP_${res.status}` };
    }
    return { ok: true, status: res.status, json };
  } catch {
    return { ok: false, status: 0, json: null, errorCode: "NETWORK" };
  }
}

/** Plain-text delivery message used inside the 24h service window. */
export function composeDeliveryText(orderId: string, items: DeliveryItem[]): string {
  const lines = items.map((i) => `• ${i.title}\n${i.downloadUrl}`).join("\n");
  return [
    `Astralium Digitale Store — order ${orderId}`,
    `Your download link${items.length > 1 ? "s" : ""} (personal, limited use):`,
    lines,
    `Keep this message — links can be re-issued free from your account page.`,
  ].join("\n");
}
