import { NextRequest, NextResponse } from "next/server";
import { recordAudit, requireAdmin } from "../../../../../lib/team";
import { listAllOrders } from "../../../../../lib/orders";
import { listAdminProducts } from "../../../../../lib/catalog";
import {
  filterOrdersByRange, getAdSpend, getFinanceSettings, previousRange, salesCsv, salesReport,
  setAdSpend, setFinanceSettings, type AdSpendEntry,
} from "../../../../../lib/office-finance";
import { httpErrorResponse, readJsonBody } from "../../../../../lib/http";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";

/**
 * Manager's Office — sales & profit (Phase 4 upgrade, item 2).
 *
 * `finance` permission: owner + accountant only. Every figure is
 * computed from the order ledger; fees/taxes are labelled estimates
 * (owner-configured rates — the ledger never sees real provider fee
 * data). `?format=csv` downloads the report. POST manages the fee
 * settings and the ad-spend entries (audit-logged).
 */
function parseRange(req: NextRequest): { fromISO: string; toISO: string } {
  const now = new Date();
  const fromParam = req.nextUrl.searchParams.get("from");
  const toParam = req.nextUrl.searchParams.get("to");
  const from = fromParam && Number.isFinite(new Date(fromParam).getTime())
    ? new Date(fromParam)
    : new Date(now.getTime() - 29 * 24 * 3600 * 1000);
  const to = toParam && Number.isFinite(new Date(toParam).getTime()) ? new Date(toParam) : now;
  // A date-only "to" means the whole day.
  const toEnd = toParam && /^\d{4}-\d{2}-\d{2}$/.test(toParam)
    ? new Date(to.getTime() + 24 * 3600 * 1000 - 1)
    : to;
  return { fromISO: from.toISOString(), toISO: toEnd.toISOString() };
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req, "finance");
  if ("error" in auth) return auth.error;
  const range = parseRange(req);
  const [orders, settings, adSpend, catalog] = await Promise.all([
    listAllOrders(), getFinanceSettings(), getAdSpend(), listAdminProducts(),
  ]);
  const costByProductId = new Map(catalog.products.map((p) => [p.id, p.costUSD ?? 0]));
  const inRange = filterOrdersByRange(orders, range.fromISO, range.toISO);
  const report = salesReport(inRange, { settings, costByProductId, adSpend, ...range });
  const prev = previousRange(range.fromISO, range.toISO);
  const prevReport = salesReport(filterOrdersByRange(orders, prev.fromISO, prev.toISO), {
    settings, costByProductId, adSpend, ...prev,
  });

  if (req.nextUrl.searchParams.get("format") === "csv") {
    return new NextResponse(salesCsv(report, range), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="astralium-sales.csv"',
      },
    });
  }
  return NextResponse.json({
    range,
    settings,
    adSpend: adSpend.filter((e) => e.date >= range.fromISO.slice(0, 10) && e.date <= range.toISO.slice(0, 10)),
    report,
    previous: {
      range: prev,
      grossUSD: prevReport.grossUSD,
      netProfitUSD: prevReport.netProfitUSD,
      fulfilled: prevReport.counts.fulfilled,
    },
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, "finance");
  if ("error" in auth) return auth.error;
  let body: {
    action?: string;
    settings?: Record<string, unknown>;
    entry?: { date?: string; amountUSD?: number; label?: string };
    id?: string;
  } | null;
  try {
    body = await readJsonBody(req, { maxBytes: 16 * 1024 });
  } catch (err) {
    return httpErrorResponse(err);
  }
  if (!body?.action) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });

  if (body.action === "settings") {
    const { value } = await setFinanceSettings(body.settings ?? {});
    await recordAudit({ actor: auth.actor, action: "office.finance_settings", target: "rates", detail: { ...value } });
    return NextResponse.json({ ok: true, settings: value });
  }
  if (body.action === "adspend.add") {
    const e = body.entry ?? {};
    if (typeof e.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)
      || typeof e.amountUSD !== "number" || !(e.amountUSD > 0)) {
      return NextResponse.json({ error: "INVALID_ENTRY" }, { status: 400 });
    }
    const entry: AdSpendEntry = {
      id: randomUUID(), date: e.date, amountUSD: Math.round(e.amountUSD * 100) / 100,
      label: typeof e.label === "string" ? e.label.slice(0, 120) : "",
    };
    const all = await getAdSpend();
    const { value } = await setAdSpend([...all, entry]);
    await recordAudit({ actor: auth.actor, action: "office.adspend_add", target: entry.id, detail: { date: entry.date, amountUSD: entry.amountUSD } });
    return NextResponse.json({ ok: true, adSpend: value });
  }
  if (body.action === "adspend.remove") {
    if (!body.id) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
    const all = await getAdSpend();
    const { value } = await setAdSpend(all.filter((e) => e.id !== body.id));
    await recordAudit({ actor: auth.actor, action: "office.adspend_remove", target: body.id });
    return NextResponse.json({ ok: true, adSpend: value });
  }
  return NextResponse.json({ error: "UNKNOWN_ACTION" }, { status: 400 });
}
