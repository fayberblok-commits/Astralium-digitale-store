import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { orderItems, orders, products } from "@/db/schema";
import { createSignedToken, readSignedToken } from "@/lib/crypto";

const DOWNLOAD_TTL_SECONDS = 72 * 60 * 60;

/** Signed, expiring, per-order download capability. Cannot be re-used after expiry or refund. */
export function downloadUrl(orderNumber: string, productId: number): string {
  const token = createSignedToken({ order: orderNumber, product: productId, scope: "download" }, DOWNLOAD_TTL_SECONDS);
  return `/api/download?token=${encodeURIComponent(token)}`;
}

export function readDownloadToken(token: string) {
  const payload = readSignedToken(token);
  if (!payload || payload.scope !== "download") return null;
  const orderNumber = String(payload.order ?? "");
  const productId = Number(payload.product ?? 0);
  if (!orderNumber || !productId) return null;
  return { orderNumber, productId };
}

export async function resolveDownload(orderNumber: string, productId: number) {
  const rows = await db
    .select({ order: orders, item: orderItems, product: products })
    .from(orders)
    .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
    .innerJoin(products, eq(orderItems.productId, products.id))
    .where(and(eq(orders.orderNumber, orderNumber), eq(orderItems.productId, productId)))
    .limit(1);
  const row = rows[0];
  if (!row) return { ok: false as const, reason: "not_found" };
  if (row.order.status !== "paid") return { ok: false as const, reason: "not_paid" };
  if (row.item.downloadCount >= row.item.downloadLimit) return { ok: false as const, reason: "limit_reached" };
  await db
    .update(orderItems)
    .set({ downloadCount: row.item.downloadCount + 1 })
    .where(eq(orderItems.id, row.item.id));
  return { ok: true as const, ...row };
}

export function licenseDocument(input: {
  orderNumber: string;
  productTitle: string;
  buyerEmail: string;
  licenseScope: string;
  supportEmail: string;
}) {
  return `ASTRALIUM DIGITALE STORE — LICENSE & ACCESS CERTIFICATE
=========================================================

Order number : ${input.orderNumber}
Product      : ${input.productTitle}
Licensed to  : ${input.buyerEmail}
Issued       : ${new Date().toISOString()}

LICENSE SCOPE
${input.licenseScope}

TERMS
1. This purchase grants a non-exclusive, non-transferable licence to the named buyer.
2. Redistribution, resale or public sharing of the source files is prohibited.
3. Lifetime access is provided through the customer account; download links are personal.
4. Support and replacement files: ${input.supportEmail}

This certificate is your proof of purchase. Keep it with your records.
© Astralium Digitale Store — all rights reserved.
`;
}
