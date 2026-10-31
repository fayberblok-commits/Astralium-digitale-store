import { NextRequest, NextResponse } from "next/server";
import { getProductById } from "../../../../data/products";
import { getFlag } from "../../../../lib/flags";
import { verifyStripeSession } from "../../../../lib/fulfill";
import { buildReceiptPdf, receiptDataFor, type ReceiptItem } from "../../../../lib/receipt";
// Phase 1 upgrade (§7): order-access cookie binding + rate limiting.
import { ORDER_ACCESS_COOKIE, verifyOrderAccess } from "../../../../lib/order-access";
import { findOrder } from "../../../../lib/orders";
import { getClientIp, httpErrorResponse, readJsonBody } from "../../../../lib/http";
import { rateLimiters, tooManyRequests } from "../../../../lib/ratelimit";

export const runtime = "nodejs";

function pdfResponse(orderId: string, items: ReceiptItem[], email: string | null, totalUSD?: number): NextResponse {
  const data = receiptDataFor({ orderId, email, items, totalUSD });
  const pdf = buildReceiptPdf(data);
  return new NextResponse(Buffer.from(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="astralium-receipt-${orderId}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}

function itemsFor(productIds: string[]): ReceiptItem[] {
  return productIds
    .map((pid) => getProductById(pid))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map((p) => ({ title: p.title, priceUSD: p.priceUSD }));
}

/**
 * PDF receipt download (Phase 4, feature 16).
 *
 * GET ?session_id=cs_… — the success-page path: the order is verified
 * server-side with Stripe exactly like the success page, so a receipt
 * can only be minted for a genuinely paid session.
 * POST { localOrder } — the library path: the browser presents its own
 * device order record (the same trust model as /api/library); items are
 * rebuilt from the catalog, never from client-sent prices.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  if (!(await getFlag("receipts"))) {
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 403 });
  }
  const ipCheck = rateLimiters.receiptIp.check(`ip:${getClientIp(req)}`);
  if (!ipCheck.allowed) return tooManyRequests(ipCheck);
  const { orderId } = await params;

  // Path A (§7): the order-access cookie bound at the verified success
  // page. Items/email come from the order LEDGER — nothing is taken
  // from the request, and a cookie minted for another order never
  // verifies for this one.
  if (verifyOrderAccess(req.cookies.get(ORDER_ACCESS_COOKIE)?.value, orderId)) {
    const order = await findOrder(orderId);
    if (order && (order.status === "paid" || order.status === "fulfilled")) {
      return pdfResponse(orderId, itemsFor(order.items.map((i) => i.productId)), order.email, order.totalUSD);
    }
  }

  // Path B: session re-verification with Stripe (unchanged semantics).
  const sessionId = req.nextUrl.searchParams.get("session_id") ?? "";
  const verified = sessionId ? await verifyStripeSession(sessionId) : null;
  if (!verified || verified.orderId !== orderId) {
    return NextResponse.json({ error: "ORDER_NOT_VERIFIED" }, { status: 403 });
  }
  return pdfResponse(orderId, itemsFor(verified.productIds), verified.email);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  if (!(await getFlag("receipts"))) {
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 403 });
  }
  const { orderId } = await params;
  let body: {
    localOrder?: { orderId: string; email?: string; status?: string; items?: { id: string; productIds?: string[] }[] };
  } | null;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return httpErrorResponse(err);
  }
  const order = body?.localOrder;
  if (!order || order.orderId !== orderId || !Array.isArray(order.items)) {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }
  // Phase 1 upgrade (§7): the client's claim is NEVER trusted. Since
  // F1 the order ledger is authoritative — the order must exist there
  // as paid/fulfilled, and the PDF is built from LEDGER data (buyer
  // email + items), not from anything in this request body. Before F1
  // this path minted receipts from a localStorage claim alone, which
  // let anyone forge a receipt for any order id.
  const ledger = await findOrder(orderId);
  if (!ledger || (ledger.status !== "paid" && ledger.status !== "fulfilled")) {
    return NextResponse.json({ error: "ORDER_NOT_PAID" }, { status: 403 });
  }
  const productIds = ledger.items.map((i) => i.productId);
  return pdfResponse(orderId, itemsFor(productIds), ledger.email);
}
