/**
 * Support-assistant tools (Phase 6, feature 25, flag `ai_support_v2`).
 *
 * The assistant's tools are deliberately narrow and read-only:
 *  - orderLookup(orderId, email): the order row is fetched by id and
 *    the email must match the order's email (case-insensitive). ANY
 *    mismatch — unknown id, wrong email, malformed input — returns the
 *    same generic { found: false }: the tool never reveals whether an
 *    order exists. The result carries status/delivery state ONLY —
 *    never download links or tokens (downloads stay on the existing
 *    signed-token flow: email receipt / library / claim codes).
 *  - productSearch / productDetails: straight from the real catalog.
 *
 * The order fetcher is injectable so the tool layer is unit-testable
 * without a database.
 */
import { getDb } from "./db.ts";
import { getProductBySlug, type Product } from "../data/products.ts";
import { searchCatalog } from "../services/ai-support.ts";

export interface SupportOrderView {
  orderId: string;
  status: string;
  totalUSD: number;
  currency: string;
  createdAt: string;
  items: { productId: string; title: string }[];
  delivery: { channel: string; status: string }[];
  downloadGrants: number;
}

export type OrderLookupResult = { found: true; order: SupportOrderView } | { found: false };

export interface OrderFetcher {
  (orderId: string): Promise<{
    id: string;
    email: string;
    status: string;
    totalUSD: number;
    currency: string;
    createdAt: string;
    items: { productId: string; title: string }[];
    delivery: { channel: string; status: string }[];
    downloadGrants: number;
  } | null>;
}

/** Default fetcher: the DB order ledger (null without a database). */
export const dbOrderFetcher: OrderFetcher = async (orderId) => {
  try {
    const db = await getDb();
    if (!db) return null;
    const row = await db.order.findUnique({
      where: { id: orderId },
      include: { items: true, deliveryAttempts: { orderBy: { createdAt: "desc" } }, downloadGrants: true },
    });
    if (!row) return null;
    const { PRODUCTS } = await import("../data/products.ts");
    const titleOf = (pid: string) => PRODUCTS.find((p) => p.id === pid)?.title ?? pid;
    // Latest attempt per channel only — a compact delivery state.
    const seen = new Set<string>();
    const delivery: { channel: string; status: string }[] = [];
    for (const a of row.deliveryAttempts) {
      if (seen.has(a.channel)) continue;
      seen.add(a.channel);
      delivery.push({ channel: a.channel, status: a.status });
    }
    return {
      id: row.id, email: row.email, status: row.status, totalUSD: row.totalUSD,
      currency: row.currency, createdAt: row.createdAt.toISOString(),
      items: row.items.map((i) => ({ productId: i.productId, title: titleOf(i.productId) })),
      delivery, downloadGrants: row.downloadGrants.length,
    };
  } catch {
    return null;
  }
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function orderLookup(
  orderId: string,
  email: string,
  fetchOrder: OrderFetcher = dbOrderFetcher,
): Promise<OrderLookupResult> {
  const id = (orderId ?? "").trim();
  const mail = (email ?? "").trim().toLowerCase();
  if (!id || id.length > 80 || !EMAIL_RE.test(mail)) return { found: false };
  const row = await fetchOrder(id).catch(() => null);
  if (!row) return { found: false };
  // The email must match the order's own email. A mismatch is
  // indistinguishable from a nonexistent order — by design.
  if (row.email.trim().toLowerCase() !== mail) return { found: false };
  return {
    found: true,
    order: {
      orderId: row.id, status: row.status, totalUSD: row.totalUSD, currency: row.currency,
      createdAt: row.createdAt, items: row.items, delivery: row.delivery, downloadGrants: row.downloadGrants,
    },
  };
}

/** Compose the customer-facing answer from a lookup result. No links, ever. */
export function composeOrderAnswer(result: OrderLookupResult): string {
  if (!result.found) {
    return (
      "I could not find an order matching that order ID and email. Please double-check both " +
      "(the order ID is in your receipt email). I cannot look up orders any other way — " +
      "if you still need help, a human on our support team can assist."
    );
  }
  const o = result.order;
  const items = o.items.map((i) => `• ${i.title}`).join("\n");
  const delivery = o.delivery.length > 0
    ? o.delivery.map((d) => `${d.channel}: ${d.status}`).join(", ")
    : "no delivery attempts recorded yet";
  return [
    `Order ${o.orderId} — status: ${o.status} (placed ${o.createdAt.slice(0, 10)}, total ${o.totalUSD.toFixed(2)} ${o.currency}).`,
    items ? `Items:\n${items}` : "",
    `Delivery: ${delivery}.`,
    o.downloadGrants > 0
      ? "Your download links were issued with the order — check your receipt email, or open the account page to re-issue them."
      : "Download links are issued as soon as the order is fulfilled; if this order is still pending, they will arrive by email shortly.",
  ].filter(Boolean).join("\n");
}

// ─── Product tools ───────────────────────────────────────────────────────────

export function productSearch(query: string, limit = 3): Product[] {
  return searchCatalog(query, limit);
}

export interface ProductDetails {
  slug: string;
  title: string;
  priceUSD: number;
  category: string;
  formats: string;
  rating: number;
  description: string;
}

export function productDetails(slug: string): ProductDetails | null {
  const p = getProductBySlug((slug ?? "").trim().toLowerCase());
  if (!p) return null;
  return {
    slug: p.slug, title: p.title, priceUSD: p.priceUSD, category: p.category,
    formats: p.formats.map((f) => `${f.format} (${f.sizeMB} MB)`).join(", "),
    rating: p.rating, description: p.description,
  };
}

// ─── Order-intent detection (pure) ───────────────────────────────────────────

export interface OrderIntent { orderId: string | null; email: string | null }

const ORDER_ID_RE = /\b(?:order|ord|#)\s*[:#]?\s*([A-Za-z0-9_-]{6,40})\b/i;
const BARE_ID_RE = /\b(c[a-z0-9]{20,}|SUB-[A-Za-z0-9-]{6,})\b/;
const EMAIL_IN_TEXT_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;

/** Extract an order reference / email from a free-text question, if present. */
export function detectOrderIntent(message: string): OrderIntent | null {
  const text = message ?? "";
  const looksLikeOrder = /order|tracking|track|status|طلب|تتبع|حالة/i.test(text);
  const email = text.match(EMAIL_IN_TEXT_RE)?.[0] ?? null;
  const idMatch = text.match(ORDER_ID_RE) ?? text.match(BARE_ID_RE);
  const orderId = idMatch ? idMatch[1] : null;
  if (!looksLikeOrder && !orderId) return null;
  return { orderId, email };
}

// ─── Streaming chunks (pure) ─────────────────────────────────────────────────

/**
 * Split an answer into progressive chunks on whitespace boundaries.
 * Invariant (unit-tested): chunks.join("") === text, and no chunk
 * exceeds maxLen except a single word longer than maxLen.
 */
export function chunkText(text: string, maxLen = 24): string[] {
  if (!text) return [];
  const chunks: string[] = [];
  let current = "";
  const tokens = text.split(/(?<=\s)|(?=\s)/); // keep whitespace attached
  for (const token of tokens) {
    if (current && current.length + token.length > maxLen) {
      chunks.push(current);
      current = token;
    } else {
      current += token;
    }
    while (current.length > maxLen * 2) {
      chunks.push(current.slice(0, maxLen));
      current = current.slice(maxLen);
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
