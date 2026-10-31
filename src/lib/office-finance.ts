/**
 * Sales & profit accounting (Phase 4 upgrade — Manager's Office).
 *
 * Everything here is computed FROM the Phase-1 order ledger
 * (src/lib/orders.ts) — there is no second set of books. The pure
 * functions are unit-tested, including a reconciliation invariant:
 * the per-product revenue lines plus the discount gap (order totals
 * can be lower than the sum of item prices when coupons/discounts
 * applied) always add back up to gross revenue exactly.
 *
 * Honesty rules baked in:
 *  - Provider fees are ESTIMATES from owner-configured rates (the
 *    ledger never receives the providers' actual fee data) — the UI
 *    labels them "estimated" everywhere.
 *  - Taxes are an owner-configured flat percentage of gross (prices
 *    are treated as tax-inclusive), also labelled an estimate.
 *  - Product cost is the product's CURRENT costUSD in the catalog,
 *    applied at report time (costs are not snapshotted at purchase).
 *  - Pending/failed orders never count as revenue.
 */
import { randomUUID } from "node:crypto";
import { getJsonConfig, setJsonConfig } from "./config-store.ts";
import type { OrderRecord } from "./orders.ts";

export const round2 = (n: number): number => Math.round(n * 100) / 100;

// ─── Settings: fee/tax rates + ad spend ──────────────────────────────────────

export interface FinanceSettings {
  stripeFeePercent: number;
  stripeFeeFixedUSD: number;
  paypalFeePercent: number;
  paypalFeeFixedUSD: number;
  taxPercent: number;
}

export const DEFAULT_FINANCE_SETTINGS: FinanceSettings = {
  stripeFeePercent: 2.9,
  stripeFeeFixedUSD: 0.3,
  paypalFeePercent: 3.49,
  paypalFeeFixedUSD: 0.49,
  taxPercent: 0,
};

function clampRate(v: unknown, fallback: number, max: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return Math.min(Math.max(n, 0), max);
}

export function sanitizeFinanceSettings(raw: unknown): FinanceSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<FinanceSettings>;
  return {
    stripeFeePercent: clampRate(r.stripeFeePercent, DEFAULT_FINANCE_SETTINGS.stripeFeePercent, 30),
    stripeFeeFixedUSD: clampRate(r.stripeFeeFixedUSD, DEFAULT_FINANCE_SETTINGS.stripeFeeFixedUSD, 100),
    paypalFeePercent: clampRate(r.paypalFeePercent, DEFAULT_FINANCE_SETTINGS.paypalFeePercent, 30),
    paypalFeeFixedUSD: clampRate(r.paypalFeeFixedUSD, DEFAULT_FINANCE_SETTINGS.paypalFeeFixedUSD, 100),
    taxPercent: clampRate(r.taxPercent, DEFAULT_FINANCE_SETTINGS.taxPercent, 60),
  };
}

export async function getFinanceSettings(): Promise<FinanceSettings> {
  return getJsonConfig("office_finance_v1", "office-finance.json", sanitizeFinanceSettings, DEFAULT_FINANCE_SETTINGS);
}

export async function setFinanceSettings(next: Partial<FinanceSettings>): Promise<{ persisted: "db" | "file"; value: FinanceSettings }> {
  const current = await getFinanceSettings();
  return setJsonConfig("office_finance_v1", "office-finance.json", sanitizeFinanceSettings({ ...current, ...next }), sanitizeFinanceSettings);
}

export interface AdSpendEntry {
  id: string;
  date: string; // YYYY-MM-DD
  amountUSD: number;
  label: string;
}

export function sanitizeAdSpend(raw: unknown): AdSpendEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e): e is Record<string, unknown> => Boolean(e) && typeof e === "object")
    .map((e) => ({
      id: typeof e.id === "string" && e.id ? e.id : randomUUID(),
      date: typeof e.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e.date) ? e.date : "1970-01-01",
      amountUSD: typeof e.amountUSD === "number" && Number.isFinite(e.amountUSD) ? Math.max(0, round2(e.amountUSD)) : 0,
      label: typeof e.label === "string" ? e.label.slice(0, 120) : "",
    }))
    .filter((e) => e.amountUSD > 0)
    .slice(0, 500);
}

export async function getAdSpend(): Promise<AdSpendEntry[]> {
  return getJsonConfig<AdSpendEntry[]>("office_adspend_v1", "office-adspend.json", sanitizeAdSpend, []);
}

export async function setAdSpend(entries: AdSpendEntry[]): Promise<{ persisted: "db" | "file"; value: AdSpendEntry[] }> {
  return setJsonConfig("office_adspend_v1", "office-adspend.json", sanitizeAdSpend(entries), sanitizeAdSpend);
}

// ─── Pure accounting ─────────────────────────────────────────────────────────

/** Statuses that represent money actually taken (revenue-bearing). */
export const REVENUE_STATUSES = ["paid", "fulfilled", "refunded", "disputed"] as const;

export function isRevenueOrder(o: OrderRecord): boolean {
  return (REVENUE_STATUSES as readonly string[]).includes(o.status);
}

/** Estimated provider fee for one order (0 for non-revenue orders). */
export function estimateFeeUSD(order: OrderRecord, settings: FinanceSettings): number {
  if (!isRevenueOrder(order)) return 0;
  const pct = order.provider === "paypal" ? settings.paypalFeePercent : settings.stripeFeePercent;
  const fixed = order.provider === "paypal" ? settings.paypalFeeFixedUSD : settings.stripeFeeFixedUSD;
  return round2((order.totalUSD * pct) / 100 + fixed);
}

export function filterOrdersByRange(orders: OrderRecord[], fromISO: string, toISO: string): OrderRecord[] {
  const from = new Date(fromISO).getTime();
  const to = new Date(toISO).getTime();
  return orders.filter((o) => {
    const t = new Date(o.createdAt).getTime();
    return t >= from && t <= to;
  });
}

/** The equal-length period immediately before [fromISO, toISO]. */
export function previousRange(fromISO: string, toISO: string): { fromISO: string; toISO: string } {
  const from = new Date(fromISO).getTime();
  const to = new Date(toISO).getTime();
  const length = to - from;
  return { fromISO: new Date(from - length - 1).toISOString(), toISO: new Date(from - 1).toISOString() };
}

export interface ProductSalesRow {
  productId: string;
  orders: number;
  revenueUSD: number;
  refundsUSD: number;
  costUSD: number;
  profitUSD: number;
}

export interface DimensionSalesRow { key: string; orders: number; revenueUSD: number }

export interface SalesReport {
  counts: { fulfilled: number; pending: number; cancelled: number; refunded: number; disputed: number; total: number };
  grossUSD: number;
  refundsUSD: number;
  feesUSD: number;
  taxesUSD: number;
  productCostsUSD: number;
  adSpendUSD: number;
  netProfitUSD: number;
  byProduct: ProductSalesRow[];
  byCountry: DimensionSalesRow[];
  byLanguage: DimensionSalesRow[];
  byCurrency: DimensionSalesRow[];
  reconciliation: { itemsRevenueUSD: number; discountGapUSD: number; grossUSD: number; balanced: boolean };
}

function dimensionSales(orders: OrderRecord[], pick: (o: OrderRecord) => string | null): DimensionSalesRow[] {
  const map = new Map<string, DimensionSalesRow>();
  for (const o of orders) {
    if (!isRevenueOrder(o)) continue;
    const key = pick(o) ?? "unknown";
    const row = map.get(key) ?? { key, orders: 0, revenueUSD: 0 };
    row.orders += 1;
    row.revenueUSD = round2(row.revenueUSD + o.totalUSD);
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.revenueUSD - a.revenueUSD || a.key.localeCompare(b.key));
}

export function salesReport(
  ordersInRange: OrderRecord[],
  opts: { settings: FinanceSettings; costByProductId: Map<string, number>; adSpend: AdSpendEntry[]; fromISO: string; toISO: string },
): SalesReport {
  const counts = { fulfilled: 0, pending: 0, cancelled: 0, refunded: 0, disputed: 0, total: ordersInRange.length };
  let gross = 0;
  let refunds = 0;
  let fees = 0;
  let productCosts = 0;
  let itemsRevenue = 0;
  const byProductMap = new Map<string, ProductSalesRow>();

  for (const o of ordersInRange) {
    if (o.status === "paid" || o.status === "fulfilled") counts.fulfilled += 1;
    else if (o.status === "pending") counts.pending += 1;
    else if (o.status === "failed") counts.cancelled += 1;
    else if (o.status === "refunded") counts.refunded += 1;
    else if (o.status === "disputed") counts.disputed += 1;
    if (!isRevenueOrder(o)) continue;

    gross = round2(gross + o.totalUSD);
    refunds = round2(refunds + o.refundUSD);
    fees = round2(fees + estimateFeeUSD(o, opts.settings));
    for (const item of o.items) {
      itemsRevenue = round2(itemsRevenue + item.priceUSD);
      const cost = opts.costByProductId.get(item.productId) ?? 0;
      productCosts = round2(productCosts + cost);
      const row = byProductMap.get(item.productId) ?? {
        productId: item.productId, orders: 0, revenueUSD: 0, refundsUSD: 0, costUSD: 0, profitUSD: 0,
      };
      row.orders += 1;
      row.revenueUSD = round2(row.revenueUSD + item.priceUSD);
      row.costUSD = round2(row.costUSD + cost);
      byProductMap.set(item.productId, row);
    }
    // Attribute the order's refund to its products proportionally to
    // item prices (a single-item order — the common case — is exact).
    if (o.refundUSD > 0 && o.items.length > 0) {
      const itemsTotal = o.items.reduce((s, i) => s + i.priceUSD, 0);
      for (const item of o.items) {
        const row = byProductMap.get(item.productId);
        if (!row) continue;
        const share = itemsTotal > 0 ? (o.refundUSD * item.priceUSD) / itemsTotal : o.refundUSD / o.items.length;
        row.refundsUSD = round2(row.refundsUSD + share);
      }
    }
  }
  const byProduct = [...byProductMap.values()]
    .map((r) => ({ ...r, profitUSD: round2(r.revenueUSD - r.refundsUSD - r.costUSD) }))
    .sort((a, b) => b.revenueUSD - a.revenueUSD || a.productId.localeCompare(b.productId));

  const taxes = round2((gross * opts.settings.taxPercent) / 100);
  const fromDay = opts.fromISO.slice(0, 10);
  const toDay = opts.toISO.slice(0, 10);
  const adSpend = round2(
    opts.adSpend.filter((e) => e.date >= fromDay && e.date <= toDay).reduce((s, e) => s + e.amountUSD, 0),
  );
  const netProfit = round2(gross - refunds - fees - taxes - productCosts - adSpend);
  const discountGap = round2(gross - itemsRevenue);

  return {
    counts,
    grossUSD: gross,
    refundsUSD: refunds,
    feesUSD: fees,
    taxesUSD: taxes,
    productCostsUSD: productCosts,
    adSpendUSD: adSpend,
    netProfitUSD: netProfit,
    byProduct,
    byCountry: dimensionSales(ordersInRange, (o) => o.country),
    byLanguage: dimensionSales(ordersInRange, (o) => o.locale),
    byCurrency: dimensionSales(ordersInRange, (o) => o.currency),
    reconciliation: {
      itemsRevenueUSD: itemsRevenue,
      discountGapUSD: discountGap,
      grossUSD: gross,
      balanced: round2(itemsRevenue + discountGap) === gross,
    },
  };
}

// ─── Customers (pure) ────────────────────────────────────────────────────────

export interface CustomerRow {
  email: string;
  orders: number;
  spendUSD: number;
  refundedUSD: number;
  lastOrderAt: string;
  hasRefunded: boolean;
  hasDisputed: boolean;
}

export function aggregateCustomers(orders: OrderRecord[]): CustomerRow[] {
  const map = new Map<string, CustomerRow>();
  for (const o of orders) {
    const key = o.email.toLowerCase();
    const row = map.get(key) ?? {
      email: o.email, orders: 0, spendUSD: 0, refundedUSD: 0,
      lastOrderAt: o.createdAt, hasRefunded: false, hasDisputed: false,
    };
    row.orders += 1;
    if (isRevenueOrder(o)) {
      row.spendUSD = round2(row.spendUSD + Math.max(0, o.totalUSD - o.refundUSD));
      row.refundedUSD = round2(row.refundedUSD + o.refundUSD);
    }
    if (o.status === "refunded") row.hasRefunded = true;
    if (o.status === "disputed") row.hasDisputed = true;
    if (o.createdAt > row.lastOrderAt) row.lastOrderAt = o.createdAt;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.spendUSD - a.spendUSD || b.orders - a.orders || a.email.localeCompare(b.email));
}

// ─── CSV ─────────────────────────────────────────────────────────────────────

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function salesCsv(report: SalesReport, range: { fromISO: string; toISO: string }): string {
  const lines: string[] = [];
  lines.push(["section", "key", "orders", "revenue_usd", "refunds_usd", "cost_usd", "profit_usd"].join(","));
  lines.push(["summary", `${range.fromISO.slice(0, 10)}..${range.toISO.slice(0, 10)}`, report.counts.fulfilled, report.grossUSD, report.refundsUSD, report.productCostsUSD, report.netProfitUSD].map(csvCell).join(","));
  lines.push(["summary", "fees_estimated", "", "", report.feesUSD, "", ""].map(csvCell).join(","));
  lines.push(["summary", "taxes_estimated", "", "", report.taxesUSD, "", ""].map(csvCell).join(","));
  lines.push(["summary", "ad_spend", "", "", report.adSpendUSD, "", ""].map(csvCell).join(","));
  for (const p of report.byProduct) {
    lines.push(["product", p.productId, p.orders, p.revenueUSD, p.refundsUSD, p.costUSD, p.profitUSD].map(csvCell).join(","));
  }
  for (const c of report.byCountry) lines.push(["country", c.key, c.orders, c.revenueUSD, "", "", ""].map(csvCell).join(","));
  for (const l of report.byLanguage) lines.push(["language", l.key, l.orders, l.revenueUSD, "", "", ""].map(csvCell).join(","));
  for (const c of report.byCurrency) lines.push(["currency", c.key, c.orders, c.revenueUSD, "", "", ""].map(csvCell).join(","));
  return lines.join("\n") + "\n";
}
