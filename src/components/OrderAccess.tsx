"use client";
import { useEffect } from "react";

/**
 * Binds this browser to the just-verified order (Phase 1 upgrade, §7):
 * exchanges the Stripe session id for the httpOnly order-access cookie
 * so the receipt endpoint can authorize without the session id being
 * re-shared, and without any buyer email touching the page.
 */
export default function OrderAccess({ sessionId }: { sessionId: string }) {
  useEffect(() => {
    void fetch("/api/orders/access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    }).catch(() => undefined);
  }, [sessionId]);
  return null;
}
