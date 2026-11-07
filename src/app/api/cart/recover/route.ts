import { NextRequest, NextResponse } from "next/server";
import { getFlag } from "../../../../lib/flags";
import { markSnapshotRecovered, resolveRecoveryToken } from "../../../../lib/email-automation";
import { getStorefrontProducts } from "../../../../lib/catalog";
import { httpErrorResponse, readJsonBody } from "../../../../lib/http";

export const runtime = "nodejs";

/**
 * Resolve a cart-recovery link (Phase 5, feature 20): verifies the
 * signed token against its stored hash, returns the snapshot's items in
 * cart shape, and closes the snapshot (one recovery per link).
 */
export async function POST(req: NextRequest) {
  if (!(await getFlag("email_automation"))) {
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 403 });
  }
  let body: { token?: string } | null;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return httpErrorResponse(err);
  }
  if (!body?.token) return NextResponse.json({ error: "TOKEN_REQUIRED" }, { status: 400 });
  const snapshot = await resolveRecoveryToken(body.token);
  if (!snapshot) return NextResponse.json({ error: "INVALID_OR_EXPIRED_LINK" }, { status: 403 });
  // Recovered items resolve against the LIVE storefront catalog
  // (register item 82 fix): a snapshot item whose product is no longer
  // on sale is dropped — the recovered cart holds only buyable items.
  const byId = new Map((await getStorefrontProducts()).map((p) => [p.id, p]));
  const items = snapshot.items
    .map((i) => byId.get(i.productId))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map((p) => ({
      id: p.id, kind: "product" as const, slug: p.slug, title: p.title,
      priceUSD: p.priceUSD, hue: p.hue,
    }));
  await markSnapshotRecovered(snapshot.id);
  return NextResponse.json({ ok: true, items });
}
