import { NextResponse } from "next/server";
import { db } from "@/db";
import { webhookEvents } from "@/db/schema";
import { markOrderFailed, markOrderPaid, verifyStripeSignature } from "@/lib/payments";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Stripe webhook secret is not configured." }, { status: 503 });
  }
  const rawBody = await request.text();
  if (!verifyStripeSignature(rawBody, request.headers.get("stripe-signature"), secret)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  let event: { id?: string; type?: string; data?: { object?: Record<string, unknown> } };
  try {
    event = JSON.parse(rawBody) as typeof event;
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const eventId = event.id ?? `evt_${Date.now()}`;
  const eventType = event.type ?? "unknown";

  if (eventType === "checkout.session.completed" || eventType === "checkout.session.async_payment_succeeded") {
    const object = event.data?.object ?? {};
    const metadata = (object.metadata ?? {}) as { order_number?: string };
    const orderNumber = metadata.order_number;
    const reference = typeof object.id === "string" ? object.id : eventId;
    const paymentStatus = typeof object.payment_status === "string" ? object.payment_status : "paid";
    if (!orderNumber) {
      await db.insert(webhookEvents).values({ provider: "stripe", eventId, kind: eventType, payload: { eventType }, status: "ignored" }).onConflictDoNothing();
      return NextResponse.json({ received: true, ignored: "missing_order" });
    }
    if (paymentStatus !== "paid" && paymentStatus !== "no_payment_required") {
      await db.insert(webhookEvents).values({ provider: "stripe", eventId, kind: eventType, payload: { orderNumber }, status: "pending_payment" }).onConflictDoNothing();
      return NextResponse.json({ received: true, pending: true });
    }
    const origin = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? new URL(request.url).origin;
    await markOrderPaid({ orderNumber, provider: "stripe", reference, origin });
    return NextResponse.json({ received: true });
  }

  if (eventType === "checkout.session.expired" || eventType === "payment_intent.payment_failed") {
    const object = event.data?.object ?? {};
    const metadata = (object.metadata ?? {}) as { order_number?: string };
    if (metadata.order_number) {
      await markOrderFailed(metadata.order_number, eventType, "stripe");
    }
    await db.insert(webhookEvents).values({ provider: "stripe", eventId, kind: eventType, payload: { eventType }, status: "processed" }).onConflictDoNothing();
    return NextResponse.json({ received: true });
  }

  await db.insert(webhookEvents).values({ provider: "stripe", eventId, kind: eventType, payload: { eventType }, status: "ignored" }).onConflictDoNothing();
  return NextResponse.json({ received: true });
}
