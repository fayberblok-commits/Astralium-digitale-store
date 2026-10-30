import { NextResponse } from "next/server";
import { db } from "@/db";
import { webhookEvents } from "@/db/schema";
import { markOrderFailed, markOrderPaid, verifyPayPalWebhook } from "@/lib/payments";

export const dynamic = "force-dynamic";

type PayPalEvent = {
  id?: string;
  event_type?: string;
  resource?: {
    id?: string;
    custom_id?: string;
    purchase_units?: { custom_id?: string }[];
    supplementary_data?: { related_ids?: { order_id?: string } };
  };
};

export async function POST(request: Request) {
  if (!process.env.PAYPAL_WEBHOOK_ID) {
    return NextResponse.json({ error: "PayPal webhook is not configured." }, { status: 503 });
  }
  const rawBody = await request.text();
  const verified = await verifyPayPalWebhook(request.headers, rawBody);
  if (!verified) {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 400 });
  }

  let event: PayPalEvent;
  try {
    event = JSON.parse(rawBody) as PayPalEvent;
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const eventId = event.id ?? `paypal_${Date.now()}`;
  const eventType = event.event_type ?? "unknown";
  const resource = event.resource ?? {};
  const orderNumber = resource.custom_id ?? resource.purchase_units?.[0]?.custom_id ?? null;

  if (eventType === "PAYMENT.CAPTURE.COMPLETED" && orderNumber) {
    const origin = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? new URL(request.url).origin;
    await markOrderPaid({
      orderNumber,
      provider: "paypal",
      reference: resource.id ?? eventId,
      origin,
    });
    return NextResponse.json({ received: true });
  }

  if ((eventType === "PAYMENT.CAPTURE.DENIED" || eventType === "BILLING.SUBSCRIPTION.PAYMENT.FAILED") && orderNumber) {
    await markOrderFailed(orderNumber, eventType, "paypal");
  }

  await db
    .insert(webhookEvents)
    .values({ provider: "paypal", eventId, kind: eventType, payload: { eventType }, status: "processed" })
    .onConflictDoNothing();
  return NextResponse.json({ received: true });
}
