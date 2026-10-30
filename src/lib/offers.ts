/**
 * Order bumps + post-purchase upsells (Phase 3, feature 4).
 *
 * Owner configuration lives in one JSON document — the DB Setting row
 * "product_offers" when a database is configured, else
 * .data/offers.json. Shape:
 *   { [productId]: { bump?: {productId, discountPercent},
 *                    upsell?: {productId, discountPercent} } }
 *
 * Money safety: the discount ALWAYS comes from this server-side config.
 * The checkout client may only REQUEST a bump product id; resolveBumps()
 * re-derives the price from the config + catalog. The upsell never
 * auto-charges: it builds parameters for a brand-new checkout session
 * the customer must explicitly confirm on the provider's page.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { getDb } from "./db.ts";
import { getProductById, type Product } from "../data/products.ts";
import { round2 } from "./byo.ts";

export interface OfferSlot {
  productId: string;
  discountPercent: number;
}

export interface ProductOffer {
  bump?: OfferSlot;
  upsell?: OfferSlot;
}

export type OfferConfig = Record<string, ProductOffer>;

const SETTING_KEY = "product_offers";
const STORE_PATH = path.join(process.cwd(), ".data", "offers.json");

function sanitize(raw: unknown): OfferConfig {
  if (!raw || typeof raw !== "object") return {};
  const out: OfferConfig = {};
  for (const [pid, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!getProductById(pid) || !v || typeof v !== "object") continue;
    const slot = (s: unknown): OfferSlot | undefined => {
      if (!s || typeof s !== "object") return undefined;
      const { productId, discountPercent } = s as { productId?: unknown; discountPercent?: unknown };
      if (typeof productId !== "string" || !getProductById(productId)) return undefined;
      const pct = Math.min(90, Math.max(0, Number(discountPercent) || 0));
      return { productId, discountPercent: pct };
    };
    const entry = v as { bump?: unknown; upsell?: unknown };
    const offer: ProductOffer = {};
    const bump = slot(entry.bump);
    const upsell = slot(entry.upsell);
    if (bump) offer.bump = bump;
    if (upsell) offer.upsell = upsell;
    if (offer.bump || offer.upsell) out[pid] = offer;
  }
  return out;
}

export async function getOfferConfig(): Promise<OfferConfig> {
  try {
    const db = await getDb();
    if (db) {
      const row = await db.setting.findUnique({ where: { key: SETTING_KEY } });
      if (row) return sanitize(row.value);
    }
  } catch {
    // fall through
  }
  try {
    return sanitize(JSON.parse(await fs.readFile(STORE_PATH, "utf8")));
  } catch {
    return {};
  }
}

export async function setOfferConfig(config: OfferConfig): Promise<{ persisted: "db" | "file" }> {
  const clean = sanitize(config);
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const jsonValue = JSON.parse(JSON.stringify(clean)) as import("@prisma/client").Prisma.InputJsonValue;
      await db.setting.upsert({
        where: { key: SETTING_KEY },
        create: { key: SETTING_KEY, value: jsonValue },
        update: { value: jsonValue },
      });
      return { persisted: "db" };
    } catch {
      // fall through to file
    }
  }
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(clean, null, 2), "utf8");
  return { persisted: "file" };
}

export interface BumpLine {
  productId: string;
  title: string;
  fullPriceUSD: number;
  priceUSD: number;
  discountPercent: number;
}

/**
 * Resolve requested bump ids against the server config. A bump is added
 * only when: a cart product's config points at exactly that bump product,
 * the bump is not already in the cart, and it is requested at most once.
 */
export function resolveBumps(
  cartProductIds: string[],
  requestedBumpIds: string[],
  config: OfferConfig,
): BumpLine[] {
  const lines: BumpLine[] = [];
  const inCart = new Set(cartProductIds);
  for (const requested of new Set(requestedBumpIds)) {
    if (inCart.has(requested) || lines.some((l) => l.productId === requested)) continue;
    const owner = cartProductIds.find((pid) => config[pid]?.bump?.productId === requested);
    if (!owner) continue;
    const slot = config[owner].bump!;
    const product = getProductById(slot.productId);
    if (!product) continue;
    lines.push({
      productId: product.id,
      title: product.title,
      fullPriceUSD: product.priceUSD,
      priceUSD: round2(product.priceUSD * (1 - slot.discountPercent / 100)),
      discountPercent: slot.discountPercent,
    });
  }
  return lines;
}

/** Discounted price of one product at a percent (shared math). */
export function discountedPrice(product: Product, discountPercent: number): number {
  const pct = Math.min(90, Math.max(0, discountPercent));
  return round2(product.priceUSD * (1 - pct / 100));
}

/**
 * Parameters for the one-click upsell checkout session. Pure builder so
 * tests can pin the money math: the session charges the DISCOUNTED price
 * exactly once, as a new session — it can never reuse the paid session.
 */
export function buildUpsellCheckoutParams(input: {
  product: Product;
  discountPercent: number;
  email: string;
  orderId: string;
  base: string;
  locale: string;
}): URLSearchParams {
  const price = discountedPrice(input.product, input.discountPercent);
  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("customer_email", input.email);
  form.set("client_reference_id", `${input.orderId}-UPSELL`);
  form.set("success_url", `${input.base}/${input.locale}/success?session_id={CHECKOUT_SESSION_ID}`);
  form.set("cancel_url", `${input.base}/${input.locale}/success`);
  form.set("metadata[order_id]", `${input.orderId}-UPSELL`);
  form.set("metadata[product_ids]", input.product.id);
  form.set("metadata[upsell_of]", input.orderId);
  form.set("payment_method_types[0]", "card");
  form.set("payment_method_types[1]", "link");
  form.set("line_items[0][quantity]", "1");
  form.set("line_items[0][price_data][currency]", "usd");
  form.set("line_items[0][price_data][unit_amount]", String(Math.round(price * 100)));
  form.set("line_items[0][price_data][product_data][name]", input.product.title);
  return form;
}
