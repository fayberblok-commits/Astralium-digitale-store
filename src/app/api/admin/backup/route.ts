import { NextResponse } from "next/server";
import { db } from "@/db";
import { coupons, customers, orderItems, orders, products, settings, tickets } from "@/db/schema";
import { getAdminSession, writeAudit } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Owner-only JSON backup. Secrets, password hashes and the payout vault are excluded. */
export async function GET() {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [productRows, orderRows, itemRows, customerRows, couponRows, ticketRows, settingRows] = await Promise.all([
    db.select().from(products),
    db.select().from(orders),
    db.select().from(orderItems),
    db.select().from(customers),
    db.select().from(coupons),
    db.select().from(tickets),
    db.select().from(settings),
  ]);

  const safeSettings = settingRows.filter((row) => row.key !== "payout_vault");
  const backup = {
    generatedAt: new Date().toISOString(),
    store: "Astralium Digitale Store",
    counts: {
      products: productRows.length,
      orders: orderRows.length,
      customers: customerRows.length,
      coupons: couponRows.length,
      tickets: ticketRows.length,
    },
    products: productRows,
    orders: orderRows.map(({ accessToken, ...rest }) => ({ ...rest, accessToken: "[redacted]" })),
    orderItems: itemRows,
    customers: customerRows.map(({ passwordHash, ...rest }) => ({ ...rest, passwordHash: "[redacted]" })),
    coupons: couponRows,
    tickets: ticketRows,
    settings: safeSettings,
  };

  await writeAudit("backup.downloaded", "database", new Date().toISOString(), backup.counts, admin.email);
  return new NextResponse(JSON.stringify(backup, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="astralium-backup-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
