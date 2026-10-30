"use client";
import { useEffect } from "react";
import { useStore } from "../lib/store";

/** Marks the matching on-device order as paid once the success page has
 *  server-verified the payment with the provider. */
export default function MarkPaid({ providerRef }: { providerRef: string }) {
  const { orders, markPaid } = useStore();
  useEffect(() => {
    const match = orders.find((o) => o.providerRef === providerRef);
    if (match && match.status !== "paid") markPaid(match.orderId);
  }, [orders, providerRef, markPaid]);
  return null;
}
