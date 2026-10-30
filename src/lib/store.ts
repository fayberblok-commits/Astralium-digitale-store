import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  aiAgents,
  auditLogs,
  blogPosts,
  coupons,
  customers,
  faqs,
  orderItems,
  orders,
  products,
  reviews,
  tickets,
  type Product,
} from "@/db/schema";

export type ProductFilters = {
  q?: string;
  category?: string;
  minUsd?: number;
  maxUsd?: number;
  sort?: "newest" | "price_asc" | "price_desc" | "popular" | "rating";
  page?: number;
  perPage?: number;
  includeDrafts?: boolean;
};

function activeCondition(includeDrafts: boolean) {
  return includeDrafts ? undefined : eq(products.status, "active");
}

export async function listProducts(filters: ProductFilters = {}) {
  const { q, category, minUsd, maxUsd, sort = "newest", page = 1, perPage = 12, includeDrafts = false } = filters;
  const conditions = [activeCondition(includeDrafts)].filter(Boolean) as ReturnType<typeof eq>[];
  if (q && q.trim()) {
    const needle = `%${q.trim()}%`;
    const search = or(
      ilike(products.title, needle),
      ilike(products.titleEn, needle),
      ilike(products.description, needle),
      ilike(products.descriptionEn, needle),
      ilike(products.category, needle),
      sql`${products.tags}::text ILIKE ${needle}`,
    );
    if (search) conditions.push(search);
  }
  if (category && category !== "all") conditions.push(eq(products.category, category));
  if (typeof minUsd === "number" && !Number.isNaN(minUsd)) conditions.push(gte(products.priceCents, Math.round(minUsd * 100)));
  if (typeof maxUsd === "number" && !Number.isNaN(maxUsd)) conditions.push(lte(products.priceCents, Math.round(maxUsd * 100)));

  const where = conditions.length ? and(...conditions) : undefined;
  const orderBy =
    sort === "price_asc"
      ? asc(products.priceCents)
      : sort === "price_desc"
        ? desc(products.priceCents)
        : sort === "popular"
          ? desc(products.salesCount)
          : sort === "rating"
            ? desc(sql`CASE WHEN ${products.ratingCount} = 0 THEN 0 ELSE ${products.ratingSum}::numeric / ${products.ratingCount} END`)
            : desc(products.createdAt);

  const safePage = Math.max(1, page);
  const [items, totals] = await Promise.all([
    db
      .select()
      .from(products)
      .where(where)
      .orderBy(orderBy)
      .limit(perPage)
      .offset((safePage - 1) * perPage),
    db.select({ count: sql<number>`count(*)::int` }).from(products).where(where),
  ]);

  return { items, total: totals[0]?.count ?? 0, page: safePage, perPage };
}

export async function getProductBySlug(slug: string): Promise<Product | null> {
  const rows = await db.select().from(products).where(eq(products.slug, slug)).limit(1);
  return rows[0] ?? null;
}

export async function getFeaturedProducts(limit = 6): Promise<Product[]> {
  const rows = await db
    .select()
    .from(products)
    .where(and(eq(products.status, "active"), eq(products.featured, true)))
    .orderBy(desc(products.createdAt))
    .limit(limit);
  if (rows.length > 0) return rows;
  return db.select().from(products).where(eq(products.status, "active")).orderBy(desc(products.salesCount)).limit(limit);
}

export async function getNewestProducts(limit = 4): Promise<Product[]> {
  return db.select().from(products).where(eq(products.status, "active")).orderBy(desc(products.createdAt)).limit(limit);
}

export async function getCategoryCounts(): Promise<Record<string, number>> {
  const rows = await db
    .select({ category: products.category, count: sql<number>`count(*)::int` })
    .from(products)
    .where(eq(products.status, "active"))
    .groupBy(products.category);
  return Object.fromEntries(rows.map((row) => [row.category, row.count]));
}

export async function getProductReviews(productId: number) {
  return db.select().from(reviews).where(eq(reviews.productId, productId)).orderBy(desc(reviews.createdAt)).limit(20);
}

export async function getRelatedProducts(product: Product, limit = 3): Promise<Product[]> {
  return db
    .select()
    .from(products)
    .where(and(eq(products.category, product.category), eq(products.status, "active"), sql`${products.id} <> ${product.id}`))
    .orderBy(desc(products.salesCount))
    .limit(limit);
}

export function ratingOf(product: { ratingSum: number; ratingCount: number }): number {
  if (!product.ratingCount) return 0;
  return Math.round((product.ratingSum / product.ratingCount) * 10) / 10;
}

/* ------------------------------- coupons ---------------------------------- */

export async function findCoupon(code: string) {
  const rows = await db.select().from(coupons).where(eq(coupons.code, code.trim().toUpperCase())).limit(1);
  return rows[0] ?? null;
}

export async function validateCoupon(code: string, usdSubtotalCents: number) {
  const coupon = await findCoupon(code);
  if (!coupon || !coupon.active) return { ok: false as const, message: "الكوبون غير صالح أو موقوف." };
  if (coupon.expiresAt && coupon.expiresAt.getTime() < Date.now()) return { ok: false as const, message: "انتهت صلاحية هذا الكوبون." };
  if (coupon.maxRedemptions !== null && coupon.redemptions >= coupon.maxRedemptions)
    return { ok: false as const, message: "تم استهلاك هذا الكوبون بالكامل." };
  if (usdSubtotalCents < coupon.minSubtotalCents)
    return { ok: false as const, message: `الحد الأدنى لاستخدام الكوبون ${(coupon.minSubtotalCents / 100).toFixed(2)} USD.` };
  const discount =
    coupon.kind === "percent"
      ? Math.round((usdSubtotalCents * coupon.value) / 100)
      : Math.min(usdSubtotalCents, coupon.value);
  return { ok: true as const, coupon, discountUsdCents: discount };
}

/* --------------------------------- agents --------------------------------- */

export async function getAgents(team: "customer" | "manager" | "all" = "customer") {
  const where = team === "all" ? undefined : eq(aiAgents.team, team);
  return db.select().from(aiAgents).where(and(where, eq(aiAgents.active, true))).orderBy(asc(aiAgents.sortOrder));
}

export async function getAllAgents() {
  return db.select().from(aiAgents).orderBy(asc(aiAgents.team), asc(aiAgents.sortOrder));
}

export async function getFaqs() {
  return db.select().from(faqs).where(eq(faqs.active, true)).orderBy(asc(faqs.sortOrder));
}

/* ---------------------------------- blog ---------------------------------- */

export async function getBlogPosts(limit?: number) {
  const query = db.select().from(blogPosts).where(eq(blogPosts.published, true)).orderBy(desc(blogPosts.publishedAt));
  return limit ? query.limit(limit) : query;
}

export async function getBlogPost(slug: string) {
  const rows = await db.select().from(blogPosts).where(eq(blogPosts.slug, slug)).limit(1);
  return rows[0] ?? null;
}

/* --------------------------------- orders --------------------------------- */

export async function getOrderWithItems(orderNumber: string) {
  const rows = await db.select().from(orders).where(eq(orders.orderNumber, orderNumber)).limit(1);
  const order = rows[0];
  if (!order) return null;
  const items = await db
    .select({ item: orderItems, product: products })
    .from(orderItems)
    .innerJoin(products, eq(orderItems.productId, products.id))
    .where(eq(orderItems.orderId, order.id));
  return { order, items };
}

export async function getCustomerOrders(customerId: number) {
  const rows = await db.select().from(orders).where(eq(orders.customerId, customerId)).orderBy(desc(orders.createdAt));
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const items = await db
    .select({ item: orderItems, product: products })
    .from(orderItems)
    .innerJoin(products, eq(orderItems.productId, products.id))
    .where(inArray(orderItems.orderId, ids));
  return rows.map((order) => ({ order, items: items.filter((entry) => entry.item.orderId === order.id) }));
}

export async function getOrdersByEmail(email: string) {
  const rows = await db.select().from(orders).where(eq(orders.email, email.toLowerCase())).orderBy(desc(orders.createdAt));
  return rows;
}

/* ------------------------------- admin stats ------------------------------- */

export async function getAdminStats() {
  const [revenueRow] = await db
    .select({ sum: sql<number>`coalesce(sum(${orders.baseTotalCents}), 0)::int`, count: sql<number>`count(*)::int` })
    .from(orders)
    .where(eq(orders.status, "paid"));
  const [pendingRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(orders)
    .where(inArray(orders.status, ["pending", "failed"]));
  const [refundRow] = await db
    .select({ sum: sql<number>`coalesce(sum(${orders.baseTotalCents}), 0)::int`, count: sql<number>`count(*)::int` })
    .from(orders)
    .where(eq(orders.status, "refunded"));
  const [customerRow] = await db.select({ count: sql<number>`count(*)::int` }).from(customers);
  const [productRow] = await db.select({ count: sql<number>`count(*)::int` }).from(products);
  const [ticketRow] = await db.select({ count: sql<number>`count(*)::int` }).from(tickets).where(eq(tickets.status, "open"));
  const monthly = await db
    .select({
      month: sql<string>`to_char(date_trunc('month', ${orders.createdAt}), 'YYYY-MM')`,
      revenue: sql<number>`coalesce(sum(${orders.baseTotalCents}), 0)::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(orders)
    .where(eq(orders.status, "paid"))
    .groupBy(sql`date_trunc('month', ${orders.createdAt})`)
    .orderBy(sql`date_trunc('month', ${orders.createdAt})`);
  const recentOrders = await db.select().from(orders).orderBy(desc(orders.createdAt)).limit(8);
  const topProducts = await db
    .select({ product: products, sold: sql<number>`coalesce(sum(${orderItems.quantity}), 0)::int` })
    .from(orderItems)
    .innerJoin(products, eq(orderItems.productId, products.id))
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(eq(orders.status, "paid"))
    .groupBy(products.id)
    .orderBy(desc(sql`coalesce(sum(${orderItems.quantity}), 0)`))
    .limit(5);
  const byProvider = await db
    .select({ provider: orders.paymentProvider, count: sql<number>`count(*)::int`, revenue: sql<number>`coalesce(sum(${orders.baseTotalCents}),0)::int` })
    .from(orders)
    .where(eq(orders.status, "paid"))
    .groupBy(orders.paymentProvider);

  const revenueCents = revenueRow?.sum ?? 0;
  return {
    revenueCents,
    paidOrders: revenueRow?.count ?? 0,
    pendingOrders: pendingRow?.count ?? 0,
    refundedCents: refundRow?.sum ?? 0,
    refundedOrders: refundRow?.count ?? 0,
    customers: customerRow?.count ?? 0,
    products: productRow?.count ?? 0,
    openTickets: ticketRow?.count ?? 0,
    aovCents: revenueRow?.count ? Math.round(revenueCents / revenueRow.count) : 0,
    monthly,
    recentOrders,
    topProducts,
    byProvider,
  };
}

export async function getAuditLogs(limit = 30) {
  return db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(limit);
}
