/**
 * Missed-event reconciliation (Phase 1 upgrade, security §8).
 *
 * Webhooks can be lost (endpoint downtime, provider retry exhaustion).
 * This job re-checks PAID/FULFILLED Stripe orders against the Stripe
 * API and applies any refund that never arrived as an event:
 *
 *   session → payment_intent → charge → amount_refunded > 0 ⇒ refunded
 *
 * The decision is a pure function over the fetched charge facts so it
 * is unit-testable without a Stripe account. The runner is bounded
 * (max orders per run) and honest: orders whose facts cannot be
 * fetched are reported as "unchecked", never guessed at.
 */
import { getDb } from "./db.ts";
import { applyRefund, type OrderRecord } from "./orders.ts";
import { stripeHeaders } from "./stripe.ts";

export interface ChargeFacts {
  amountRefunded: number;
  amount: number;
  status: string | null;
}

export type ReconcileDecision = "refund" | "none";

/** Pure: a succeeded charge with any refunded amount means the order's money went back. */
export function decideReconcile(facts: ChargeFacts | null): ReconcileDecision {
  if (!facts) return "none";
  if (facts.status !== "succeeded") return "none";
  return facts.amountRefunded > 0 ? "refund" : "none";
}

async function fetchChargeFacts(sessionId: string, key: string): Promise<ChargeFacts | null> {
  try {
    const sRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
      headers: stripeHeaders(key),
    });
    if (!sRes.ok) return null;
    const session = (await sRes.json()) as { payment_intent?: string | { id?: string } };
    const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
    if (!pi) return null;
    const pRes = await fetch(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(pi)}`, {
      headers: stripeHeaders(key),
    });
    if (!pRes.ok) return null;
    const intent = (await pRes.json()) as { latest_charge?: string | { id?: string } };
    const chargeId = typeof intent.latest_charge === "string" ? intent.latest_charge : intent.latest_charge?.id;
    if (!chargeId) return null;
    const cRes = await fetch(`https://api.stripe.com/v1/charges/${encodeURIComponent(chargeId)}`, {
      headers: stripeHeaders(key),
    });
    if (!cRes.ok) return null;
    const charge = (await cRes.json()) as { amount_refunded?: number; amount?: number; status?: string };
    return {
      amountRefunded: charge.amount_refunded ?? 0,
      amount: charge.amount ?? 0,
      status: charge.status ?? null,
    };
  } catch {
    return null;
  }
}

export interface ReconcileSummary {
  checked: number;
  refunded: string[];
  unchecked: string[];
  skipped: string | null;
}

export async function runOrderReconcile(opts: { limit?: number } = {}): Promise<ReconcileSummary> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return { checked: 0, refunded: [], unchecked: [], skipped: "STRIPE_NOT_CONFIGURED" };
  const limit = opts.limit ?? 50;

  let orders: OrderRecord[] = [];
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const rows = await db.order.findMany({
        where: { provider: "stripe", status: { in: ["paid", "fulfilled"] } },
        include: { items: true },
        orderBy: { createdAt: "asc" },
        take: limit,
      });
      orders = rows.map((r) => ({
        id: r.id, email: r.email, status: r.status as OrderRecord["status"], totalUSD: r.totalUSD,
        currency: r.currency, provider: r.provider, providerRef: r.providerRef,
        deliveryChannel: r.deliveryChannel, deliverySubjectHash: r.deliverySubjectHash,
        refundUSD: r.refundUSD, note: r.note, country: r.country, locale: r.locale,
        items: r.items.map((i) => ({ productId: i.productId, priceUSD: i.priceUSD })),
        createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
      }));
    } catch { /* fall through: no candidates */ }
  }

  const summary: ReconcileSummary = { checked: 0, refunded: [], unchecked: [], skipped: null };
  for (const order of orders) {
    const facts = await fetchChargeFacts(order.providerRef, key);
    if (!facts) {
      summary.unchecked.push(order.id);
      continue;
    }
    summary.checked += 1;
    if (decideReconcile(facts) === "refund") {
      const r = await applyRefund(order.id);
      if (r.ok) summary.refunded.push(order.id);
    }
  }
  return summary;
}
