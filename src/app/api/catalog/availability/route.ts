import { NextRequest, NextResponse } from "next/server";
import { getStorefrontProductById } from "../../../../lib/catalog";
import { resolveBundle } from "../../../../lib/bundles";
import { getClientIp, httpErrorResponse, readJsonBody } from "../../../../lib/http";
import { rateLimiters, tooManyRequests } from "../../../../lib/ratelimit";

export const runtime = "nodejs";

/**
 * Cart revalidation (thermal fix, 2026-11): the on-device cart is a
 * localStorage snapshot taken at add-time — products can be
 * deactivated, repriced or renamed afterwards, and the snapshot never
 * noticed (a stale cart used to sail into checkout and die at the
 * payment button with a generic "payment failed"). The cart and
 * checkout pages POST their item ids here on mount and reconcile:
 * surviving items get fresh title/price/slug/hue, dead items are
 * pruned with a visible notice. Read-only; prices are display data —
 * /api/checkout always re-prices server-side regardless.
 */
export async function POST(req: NextRequest) {
  const ipCheck = rateLimiters.publicPostIp.check(`ip:${getClientIp(req)}`);
  if (!ipCheck.allowed) return tooManyRequests(ipCheck);
  let body: { ids?: unknown } | null;
  try {
    body = await readJsonBody(req, { maxBytes: 8 * 1024 });
  } catch (err) {
    return httpErrorResponse(err);
  }
  const ids = Array.isArray(body?.ids)
    ? [...new Set(body.ids.filter((x): x is string => typeof x === "string" && x.length > 0))].slice(0, 50)
    : [];
  const items: Record<string, unknown> = {};
  for (const id of ids) {
    const product = await getStorefrontProductById(id);
    if (product) {
      items[id] = {
        available: true, kind: "product",
        title: product.title, slug: product.slug, priceUSD: product.priceUSD, hue: product.hue,
      };
      continue;
    }
    const bundle = await resolveBundle(id);
    if (bundle) {
      items[id] = {
        available: true, kind: "bundle",
        title: bundle.title, slug: bundle.slug, priceUSD: bundle.priceUSD, hue: bundle.hue,
        productIds: bundle.productIds,
      };
      continue;
    }
    items[id] = { available: false };
  }
  return NextResponse.json({ items });
}
