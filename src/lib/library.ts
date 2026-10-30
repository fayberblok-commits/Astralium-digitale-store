/**
 * My Library (Phase 3, feature 1) — the customer's purchases with
 * re-download, version badges and "updated" markers.
 *
 * Ownership rule (security-critical): an entry is only ever built from
 * an order row that belongs to the requesting customer. The DB path
 * filters by the verified order email server-side; the device-local path
 * uses only order records the customer's own browser presents. Tests pin
 * this: buildLibraryEntries receives ONLY the caller's orders — and the
 * DB fetcher below queries with the email in the WHERE clause.
 *
 * Fresh download links are minted per request through the existing
 * signed-token grant flow (createDownloadToken) — tokens are never
 * stored in the library payload beyond the response.
 */
import { getDb } from "./db.ts";
import { getProductById, type Product } from "../data/products.ts";
import { createDownloadToken } from "./tokens.ts";
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

/** Pure builder — versionsByProduct maps productId → its version history. */
export function buildLibraryEntries(
  orders: LibraryOrderInput[],
  versionsByProduct: Map<string, ProductVersionRecord[]>,
  tokenFor: (productId: string, orderId: string) => string = (pid, oid) => createDownloadToken(pid, oid),
): LibraryEntry[] {
  const entries: LibraryEntry[] = [];
  for (const order of orders) {
    if (order.status !== "paid" && order.status !== "fulfilled" && order.status !== "initiated") continue;
    for (const pid of new Set(order.productIds)) {
      const product = getProductById(pid);
      if (!product) continue;
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
        downloadUrl: `/api/download/${tokenFor(pid, order.orderId)}`,
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

/** Map the browser's local OrderRecords (existing account flow) to inputs. */
export function localOrdersToInputs(
  records: { orderId: string; createdAt: string; status: string; items: { id: string; productIds?: string[] }[] }[],
): LibraryOrderInput[] {
  return records.map((r) => ({
    orderId: r.orderId,
    createdAt: r.createdAt,
    status: r.status === "paid" ? "paid" : "initiated",
    productIds: r.items.flatMap((i) => i.productIds ?? [i.id]).filter((id) => Boolean(getProductById(id))),
  }));
}
