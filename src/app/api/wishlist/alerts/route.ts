import { NextRequest, NextResponse } from "next/server";
import { getFlag } from "../../../../lib/flags";
import { registerAlert } from "../../../../lib/wishlist-alerts";

export const runtime = "nodejs";

/**
 * Wishlist price-drop alert registration (Phase 3, feature 8).
 * Flag OFF by default (sends email) — when off, 403. Opt-in is
 * mandatory and checked server-side; the email is stored only as
 * AES-256-GCM ciphertext (registration refuses with 503 when PII
 * encryption is not configured rather than storing plaintext).
 */
export async function POST(req: NextRequest) {
  if (!(await getFlag("wishlist_alerts"))) {
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as {
    email?: string; productId?: string; optIn?: boolean;
  } | null;
  if (!body?.email || !body?.productId) {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }
  const result = await registerAlert({ email: body.email, productId: body.productId, optIn: body.optIn === true });
  if (!result.ok) {
    const status = result.error === "OPTIN_REQUIRED" || result.error === "INVALID_EMAIL" ? 400
      : result.error === "PRODUCT_NOT_FOUND" ? 404 : 503;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true, persisted: result.persisted });
}
