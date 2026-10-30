import { NextRequest, NextResponse } from "next/server";
import { getProductById } from "../../../../data/products";
import { getFlag } from "../../../../lib/flags";
import { verifyStripeSession } from "../../../../lib/fulfill";
import { buildReceiptPdf, receiptDataFor, type ReceiptItem } from "../../../../lib/receipt";

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
  const { orderId } = await params;
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
  const body = (await req.json().catch(() => null)) as {
    localOrder?: { orderId: string; email?: string; status?: string; items?: { id: string; productIds?: string[] }[] };
  } | null;
  const order = body?.localOrder;
  if (!order || order.orderId !== orderId || !Array.isArray(order.items)) {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }
  if (order.status !== "paid") {
    return NextResponse.json({ error: "ORDER_NOT_PAID" }, { status: 403 });
  }
  const productIds = order.items.flatMap((i) => i.productIds ?? [i.id]);
  return pdfResponse(orderId, itemsFor(productIds), order.email ?? null);
}
