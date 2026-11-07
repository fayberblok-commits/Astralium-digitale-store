/**
 * My Library (Phase 3, feature 1) — the customer's purchases with
 * re-download, version badges and "updated" markers.
 *
 * Ownership rule (security-critical; delivery-audit findings 71/72):
 * an entry is only ever built from a LEDGER order the server itself
 * holds as paid/fulfilled, admitted through verifiedLibraryOrders —
 * never from client claims. Admission requires an unguessable
 * ownership capability per order: the provider reference (PayPal
 * order id / Stripe session id) the buyer's own browser holds in its
 * device record — the same capability the success page verifies. A
 * fabricated record, a claimed "paid" status, or an email address
 * alone admits NOTHING. Download URLs are the order's ledger GRANT
 * tokens (grantTokensForOrder): counted, capped, revocable.
 */
import { getDb } from "./db.ts";
import { getProductById, type Product } from "../data/products.ts";
import { createDownloadToken } from "./tokens.ts";
import { getOrderByRef, listOrdersByEmail, grantTokensForOrder, type OrderRecord } from "./orders.ts";
import { listVersions, versionAt, latestVersionOf, isNewerVersion, type ProductVersionRecord } from "./versions.ts";

export interface LibraryOrderInput {
  orderId: string;
  createdAt: string; // ISO
  status: string;
  productIds: string[];
}

export interface LibraryEntry {
  orderId: string;
  purchasedAt: string;
  product: Product;
  purchasedVersion: string;
  latestVersion: string;
  updated: boolean;
  downloadUrl: string;
}

/** Pure builder — versionsByProduct maps productId → its version history.
 *  Product resolution: callers with the real (DB-first) catalog pass
 *  `productsById` — office-created books exist only there, and the
 *  seed-only lookup silently dropped them from buyers' libraries
 *  (thermal fix). Without a map, the seed list is the fallback.
 *  Only paid/fulfilled orders ever produce entries, and an entry is
 *  emitted only when `tokenFor` returns a token for it — the route
 *  passes grant-backed tokens for ledger-verified orders, so an
 *  order/product without a live grant yields NO download link. */
export function buildLibraryEntries(
  orders: LibraryOrderInput[],
  versionsByProduct: Map<string, ProductVersionRecord[]>,
  tokenFor: (productId: string, orderId: string) => string | null = (pid, oid) => createDownloadToken(pid, oid),
  productsById?: ReadonlyMap<string, Product>,
): LibraryEntry[] {
  const entries: LibraryEntry[] = [];
  for (const order of orders) {
    if (order.status !== "paid" && order.status !== "fulfilled") continue;
    for (const pid of new Set(order.productIds)) {
      const product = productsById ? productsById.get(pid) : getProductById(pid);
      if (!product) continue;
      const token = tokenFor(pid, order.orderId);
      if (!token) continue;
      const history = versionsByProduct.get(pid) ?? [];
      const purchasedVersion = versionAt(history, order.createdAt);
      const latest = latestVersionOf(history);
      const latestVersion = latest?.version ?? purchasedVersion;
      entries.push({
        orderId: order.orderId,
        purchasedAt: order.createdAt,
        product,
        purchasedVersion,
        latestVersion,
        updated: isNewerVersion(latestVersion, purchasedVersion),
        downloadUrl: `/api/download/${token}`,
      });
    }
  }
  return entries.sort((a, b) => b.purchasedAt.localeCompare(a.purchasedAt));
}

/** All version histories for the products in `orders`, keyed by product id. */
export async function versionMapFor(orders: LibraryOrderInput[]): Promise<Map<string, ProductVersionRecord[]>> {
  const map = new Map<string, ProductVersionRecord[]>();
  const ids = new Set(orders.flatMap((o) => o.productIds));
  for (const id of ids) map.set(id, await listVersions(id));
  return map;
}

/**
 * DB path: orders that belong to `email` — the email lives in the WHERE
 * clause, so another customer's orders can never be returned. Only paid
 * or fulfilled orders grant library access.
 * DATA LOOKUP ONLY (finding 72): an email is not an ownership proof —
 * callers must not mint downloads from this result alone; /api/library
 * admits orders through verifiedLibraryOrders' capability check.
 */
export async function ordersForEmailDb(email: string): Promise<LibraryOrderInput[] | null> {
  try {
    const db = await getDb();
    if (!db) return null;
    const rows = await db.order.findMany({
      where: { email: email.trim().toLowerCase(), status: { in: ["paid", "fulfilled"] } },
      include: { items: true },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((o) => ({
      orderId: o.id,
      createdAt: o.createdAt.toISOString(),
      status: o.status,
      productIds: o.items.map((i) => i.productId),
    }));
  } catch {
    return null;
  }
}

export interface VerifiedLibrary {
  orders: OrderRecord[];
  /** `${orderId}:${productId}` → the order's grant token. */
  tokens: Map<string, string>;
}

/**
 * The ONLY road to library entries (delivery-audit findings 71/72).
 *
 * Every admitted order comes from the server ledger as paid/fulfilled
 * and is admitted ONLY through an unguessable ownership capability:
 * a provider reference (PayPal order id / Stripe session id) that the
 * buyer's own browser legitimately holds in its device record — the
 * same capability verifyPaypalOrder checks on the success page. The
 * record's claimed status and items are ignored entirely; the ledger
 * order's own items are what get entries.
 *
 * An email address alone admits nothing (emails are not secrets):
 * email-matched ledger orders join only when a presented record
 * proves the SAME order's providerRef.
 */
export async function verifiedLibraryOrders(input: {
  email?: string | null;
  records?: { providerRef?: unknown }[] | null;
}): Promise<VerifiedLibrary> {
  const refs = new Set<string>();
  for (const r of input.records ?? []) {
    const ref = r?.providerRef;
    if (typeof ref === "string" && ref.length >= 6 && ref.length <= 128) refs.add(ref);
  }
  const byId = new Map<string, OrderRecord>();
  const admit = (o: OrderRecord | null) => {
    if (o && (o.status === "paid" || o.status === "fulfilled")) byId.set(o.id, o);
  };
  for (const ref of refs) admit(await getOrderByRef(ref).catch(() => null));
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const emailOrders = await listOrdersByEmail(email).catch(() => [] as OrderRecord[]);
    for (const o of emailOrders) {
      if (refs.has(o.providerRef)) admit(o);
    }
  }
  const orders = [...byId.values()];
  const tokens = new Map<string, string>();
  for (const order of orders) {
    const map = await grantTokensForOrder(order);
    for (const [pid, token] of map) tokens.set(`${order.id}:${pid}`, token);
  }
  return { orders, tokens };
}

/** A ledger order as a library-builder input — status and items are
 *  the ledger's, never a client's. */
export function ledgerOrderToLibraryInput(order: OrderRecord): LibraryOrderInput {
  return {
    orderId: order.id,
    createdAt: order.createdAt,
    status: order.status,
    productIds: order.items.map((i) => i.productId),
  };
}

/** Map the browser's local OrderRecords (existing account flow) to inputs.
 *  Unknown ids are dropped — against the caller's catalog id set when
 *  provided (the seed list alone used to eat every real book here),
 *  else against the seed list.
 *  DISPLAY/LEGACY SHAPE ONLY: these inputs carry client claims and
 *  must never authorize a download by themselves — /api/library
 *  admits orders exclusively through verifiedLibraryOrders. */
export function localOrdersToInputs(
  records: { orderId: string; createdAt: string; status: string; items: { id: string; productIds?: string[] }[] }[],
  knownProductIds?: ReadonlySet<string>,
): LibraryOrderInput[] {
  const known = (id: string) => (knownProductIds ? knownProductIds.has(id) : Boolean(getProductById(id)));
  return records.map((r) => ({
    orderId: r.orderId,
    createdAt: r.createdAt,
    status: r.status === "paid" ? "paid" : "initiated",
    productIds: r.items.flatMap((i) => i.productIds ?? [i.id]).filter(known),
  }));
}
