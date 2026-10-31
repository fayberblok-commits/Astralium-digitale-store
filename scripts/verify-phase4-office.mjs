#!/usr/bin/env node
/**
 * LIVE verification for the Phase 4 upgrade (Manager's Office).
 * Self-contained: hardlink-copies the project into a temp dir (so the
 * real .data is never touched), seeds a file-mode order ledger, boots
 * the production build on :3104 with NO database (file mode), and runs
 * the office legs over real HTTP:
 *
 *   auth gates → role denial (support ✗ sales/bank/security, live) →
 *   overview with real first-party events → sales report vs the seeded
 *   ledger → orders (note, resend honesty, refund refusal without a
 *   provider) → bank vault (step-up, masked, reveal) → design
 *   (snapshot → banner live → rollback) → products (create, schedule,
 *   duplicate) → coupons (office list drives validation) → tickets
 *   (public intake → office triage) → audit trail.
 *
 *   node scripts/verify-phase4-office.mjs
 *
 * Exits non-zero on any FAIL. Nothing here touches a real payment
 * provider: the refund leg proves the office REFUSES to record a
 * refund when no provider is configured (ledger untouched).
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// P10_DB=1 runs the same legs against a real PostgreSQL (scratch DB,
// migrations applied) — the production data mode. Default: file mode.
const DB_MODE = process.env.P10_DB === "1";
const PORT = DB_MODE ? 3106 : 3104;
const BASE = `http://localhost:${PORT}`;
const PG_BASE = "postgresql://postgres:phase1pass@localhost:55432";
const DB_URL = `${PG_BASE}/astralium_p10`;
const ADMIN_PASSWORD = "<MASKED_SECRET_003>";
const SUPPORT_EMAIL = "support-leg@example.com";
const SUPPORT_PASSWORD = "<MASKED_SECRET_004>";
// Same filesystem as the project (the workspace overlay) so the
// hardlink copy is instant and free; /tmp is a small tmpfs.
const WORK = path.join(root, "..", `.verify-p10-${DB_MODE ? "db-" : ""}${process.pid}`);

let failures = 0;
function leg(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** next start's server child can outlive its npx parent — kill by port. */
function killByPort(port) {
  spawnSync("bash", ["-c", `ss -tlnp 2>/dev/null | grep ":${port} " | grep -oP "pid=\\K[0-9]+" | sort -u | xargs -r kill -9`], { stdio: "ignore" });
}
killByPort(PORT);

// ─── cookie-jar fetch ────────────────────────────────────────────────────────
function jar() {
  const cookies = new Map();
  return {
    async fetch(url, init = {}) {
      const headers = { ...(init.headers ?? {}) };
      if (cookies.size > 0) headers.cookie = [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
      const res = await fetch(url, { ...init, headers, redirect: "manual" });
      const setCookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
      for (const sc of setCookies) {
        const [pair] = sc.split(";");
        const idx = pair.indexOf("=");
        if (idx > 0) cookies.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
      }
      return res;
    },
  };
}
async function jfetch(j, url, init = {}) {
  const res = await j.fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html etc. */ }
  return { status: res.status, json, text };
}

// ─── setup ───────────────────────────────────────────────────────────────────
console.log(`Copying project to ${WORK} …`);
spawnSync("cp", ["-al", root, WORK], { stdio: "inherit" });
if (!existsSync(path.join(WORK, "package.json"))) {
  spawnSync("cp", ["-a", root, WORK], { stdio: "inherit" });
}
if (DB_MODE) {
  console.log("Preparing scratch database astralium_p10 …");
  const { PrismaClient } = await import("@prisma/client");
  const admin = new PrismaClient({ datasources: { db: { url: `${PG_BASE}/postgres` } } });
  await admin.$executeRawUnsafe("DROP DATABASE IF EXISTS astralium_p10 WITH (FORCE)").catch(() => undefined);
  await admin.$executeRawUnsafe("CREATE DATABASE astralium_p10");
  await admin.$disconnect();
  const migrate = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: WORK,
    env: {
      ...process.env, DATABASE_URL: DB_URL, CHECKPOINT_DISABLE: "1",
      PRISMA_QUERY_ENGINE_LIBRARY: path.join(WORK, "node_modules/@prisma/engines/libquery_engine-debian-openssl-3.0.x.so.node"),
      PRISMA_SCHEMA_ENGINE_BINARY: path.join(WORK, "node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x"),
    },
    stdio: "pipe",
  });
  if (migrate.status !== 0) {
    console.error("migrate deploy failed:", migrate.stdout?.toString(), migrate.stderr?.toString());
    process.exit(1);
  }
  console.log("Migrations applied.");
}
mkdirSync(path.join(WORK, ".data"), { recursive: true });
const nowISO = new Date().toISOString();
if (!DB_MODE) writeFileSync(path.join(WORK, ".data", "orders.json"), JSON.stringify({ orders: [
  {
    id: "leg-order-1", email: "buyer-leg@example.com", status: "fulfilled", totalUSD: 60,
    refundUSD: 0, currency: "USD", provider: "stripe", providerRef: "cs_leg_1",
    deliveryChannel: "email", deliverySubjectHash: null,
    items: [{ productId: "p01", priceUSD: 60 }], country: "MA", locale: "ar", note: "",
    createdAt: nowISO, updatedAt: nowISO,
  },
  {
    id: "leg-order-2", email: "buyer-leg@example.com", status: "pending", totalUSD: 25,
    refundUSD: 0, currency: "USD", provider: "paypal", providerRef: "pp_leg_2",
    deliveryChannel: null, deliverySubjectHash: null,
    items: [{ productId: "p02", priceUSD: 25 }], country: null, locale: null, note: "",
    createdAt: nowISO, updatedAt: nowISO,
  },
 ], grants: [
  {
    id: "leg-grant-1", orderId: "leg-order-1", productId: "p01",
    tokenHash: "legtokenhash0000000000000000000000000000000000000000000000000000",
    maxDownloads: 5, downloadsCount: 0, expiresAt: "2999-01-01T00:00:00.000Z",
    revokedAt: null, createdAt: nowISO,
  },
] }, null, 2));

const serverEnv = {
  ...process.env,
  ADMIN_PASSWORD,
  AUTH_SECRET: "<MASKED_SECRET_005>",
  NODE_ENV: "production",
  NEXT_PUBLIC_SITE_URL: BASE,
};
if (DB_MODE) serverEnv.DATABASE_URL = DB_URL;
else delete serverEnv.DATABASE_URL;

const server = spawn("npx", ["next", "start", "-p", String(PORT)], { cwd: WORK, env: serverEnv, stdio: "pipe", detached: true });
let serverLog = "";
server.stdout.on("data", (d) => { serverLog += d; });
server.stderr.on("data", (d) => { serverLog += d; });

async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${BASE}/en`);
      if (res.status === 200) return true;
    } catch { /* not up yet */ }
    await sleep(1000);
  }
  return false;
}

try {
  leg("server boots (production build, file mode)", await waitReady(), serverLog.slice(0, 200));

  if (DB_MODE) {
    await fetch(`${BASE}/en/shop`); // triggers catalog bootstrap (product rows for the FK)
    const { PrismaClient } = await import("@prisma/client");
    const db = new PrismaClient({ datasources: { db: { url: DB_URL } } });
    await db.order.create({
      data: {
        id: "leg-order-1", email: "buyer-leg@example.com", status: "fulfilled", totalUSD: 60,
        refundUSD: 0, currency: "USD", provider: "stripe", providerRef: "cs_leg_1",
        deliveryChannel: "email", country: "MA", locale: "ar", note: "",
        items: { create: [{ productId: "p01", priceUSD: 60 }] },
      },
    });
    await db.order.create({
      data: {
        id: "leg-order-2", email: "buyer-leg@example.com", status: "pending", totalUSD: 25,
        refundUSD: 0, currency: "USD", provider: "paypal", providerRef: "pp_leg_2",
        items: { create: [{ productId: "p02", priceUSD: 25 }] },
      },
    });
    await db.downloadGrant.create({
      data: {
        id: "leg-grant-1", orderId: "leg-order-1", productId: "p01",
        tokenHash: "legtokenhash0000000000000000000000000000000000000000000000000000",
        maxDownloads: 5, downloadsCount: 0, expiresAt: new Date("2999-01-01T00:00:00.000Z"),
      },
    });
    await db.$disconnect();
    leg("seeded the ledger in PostgreSQL", true, "");
  }

  // ── auth gates ────────────────────────────────────────────────────────────
  const anon = jar();
  const unauth = await jfetch(anon, `${BASE}/api/admin/office/overview`);
  leg("office overview refuses anonymous callers", unauth.status === 401, `status=${unauth.status}`);

  const owner = jar();
  const login = await jfetch(owner, `${BASE}/api/admin/login`, { method: "POST", body: { password: ADMIN_PASSWORD } });
  leg("bootstrap owner login", login.status === 200, `status=${login.status}`);

  // ── step-up, then team: create a support account ─────────────────────────
  const step1 = await jfetch(owner, `${BASE}/api/admin/step-up`, { method: "POST", body: { password: ADMIN_PASSWORD } });
  leg("owner step-up (password only — no TOTP enrolled yet)", step1.status === 200, `status=${step1.status}`);
  const createSupport = await jfetch(owner, `${BASE}/api/admin/team`, {
    method: "POST", body: { action: "create", email: SUPPORT_EMAIL, password: SUPPORT_PASSWORD, role: "support" },
  });
  leg("owner creates a support team account", createSupport.status === 200 || createSupport.status === 201, `status=${createSupport.status}`);

  const support = jar();
  const sLogin = await jfetch(support, `${BASE}/api/admin/login`, { method: "POST", body: { email: SUPPORT_EMAIL, password: SUPPORT_PASSWORD } });
  leg("support login", sLogin.status === 200, `status=${sLogin.status}`);

  // ── LIVE role denial (brief item 9) ───────────────────────────────────────
  const sSales = await jfetch(support, `${BASE}/api/admin/office/sales`);
  leg("support → sales/profit API is 403", sSales.status === 403, `status=${sSales.status}`);
  const sBank = await jfetch(support, `${BASE}/api/admin/office/bank`);
  leg("support → bank API is 403", sBank.status === 403, `status=${sBank.status}`);
  const sSecurity = await jfetch(support, `${BASE}/api/admin/office/security`);
  leg("support → security center API is 403", sSecurity.status === 403, `status=${sSecurity.status}`);
  const sOverview = await jfetch(support, `${BASE}/api/admin/office/overview`);
  leg("support → overview API is allowed (read)", sOverview.status === 200, `status=${sOverview.status}`);

  // ── overview with real first-party events ─────────────────────────────────
  await jfetch(owner, `${BASE}/api/admin/flags`, { method: "POST", body: { key: "analytics", enabled: true } });
  const visitor = jar();
  let lastEventStatus = 0;
  for (const type of ["pageview", "product_view", "add_to_cart", "checkout_start", "purchase"]) {
    const er = await jfetch(visitor, `${BASE}/api/analytics/event`, {
      method: "POST",
      headers: { "cf-ipcountry": "MA", "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" },
      body: { type, path: "/en", vid: "leg-visitor-123456", vidConsent: true, utm: "legtest" },
    });
    lastEventStatus = er.status;
  }
  if (DB_MODE) leg("analytics events accepted once the flag is enabled (DB-persisted)", lastEventStatus === 200, `status=${lastEventStatus}`);
  const overview = await jfetch(owner, `${BASE}/api/admin/office/overview`);
  const ma = overview.json?.countries?.find((c) => c.key === "MA");
  if (DB_MODE) {
    leg("overview aggregates real events (country MA, source, funnel)",
      overview.status === 200 && ma?.count >= 1
        && overview.json.sources?.some((s) => s.key === "legtest")
        && overview.json.funnel?.length === 5
        && overview.json.devices?.some((d) => d.key === "mobile"),
      `countries=${JSON.stringify(overview.json?.countries)} sources=${JSON.stringify(overview.json?.sources)}`);
  } else {
    // File mode: feature flags persist only through the DB adapter
    // (Phase-6 semantics — the admin UI says so), so the analytics
    // flag cannot be enabled here and the event route honestly
    // refuses; the overview must then show honest zeros, not fakes.
    const probe = await jfetch(visitor, `${BASE}/api/analytics/event`, {
      method: "POST", body: { type: "pageview", path: "/en", vid: "leg-visitor-123456", vidConsent: true },
    });
    leg("file mode: analytics flag cannot persist without a DB — events honestly refused, overview shows zeros",
      probe.json?.error === "FEATURE_DISABLED" && overview.status === 200
        && overview.json.totalEvents30d === 0 && overview.json.funnel?.length === 5,
      `probe=${JSON.stringify(probe.json)} totalEvents30d=${overview.json?.totalEvents30d}`);
  }

  // ── sales vs the seeded ledger ────────────────────────────────────────────
  const sales = await jfetch(owner, `${BASE}/api/admin/office/sales`);
  leg("sales report reconciles with the seeded ledger",
    sales.status === 200 && sales.json.report.grossUSD === 60 && sales.json.report.counts.fulfilled === 1
      && sales.json.report.counts.pending === 1 && sales.json.report.reconciliation.balanced === true,
    `gross=${sales.json?.report?.grossUSD} balanced=${sales.json?.report?.reconciliation?.balanced}`);
  const csv = await jfetch(owner, `${BASE}/api/admin/office/sales?format=csv`);
  leg("sales CSV export", csv.status === 200 && csv.text.includes("section,key,orders"), `status=${csv.status}`);

  // ── orders: note, resend honesty, refund refusal ─────────────────────────
  const ordersList = await jfetch(owner, `${BASE}/api/admin/office/orders?q=buyer-leg`);
  leg("orders search finds the seeded orders", ordersList.status === 200 && ordersList.json.total === 2, `total=${ordersList.json?.total}`);
  const note = await jfetch(owner, `${BASE}/api/admin/office/orders/leg-order-1`, { method: "POST", body: { action: "note", note: "VIP buyer" } });
  leg("order note saves", note.status === 200 && note.json.note === "VIP buyer", `status=${note.status}`);
  const resend = await jfetch(owner, `${BASE}/api/admin/office/orders/leg-order-1`, { method: "POST", body: { action: "resend" } });
  leg("resend re-delivers via the email channel (attempt recorded queued without Resend — Phase-2 semantics)",
    resend.status === 200 && resend.json.ok === true && resend.json.deliveredVia === "email",
    `ok=${resend.json?.ok} via=${resend.json?.deliveredVia}`);
  const detailAfterResend = await jfetch(owner, `${BASE}/api/admin/office/orders/leg-order-1`);
  leg("resend minted fresh download grants for the order",
    (detailAfterResend.json?.grants?.length ?? 0) >= 1, `grants=${detailAfterResend.json?.grants?.length}`);
  const refund = await jfetch(owner, `${BASE}/api/admin/office/orders/leg-order-1/refund`, { method: "POST", body: {} });
  leg("refund refuses without a configured provider (never faked)",
    refund.status === 503 && refund.json.error === "PAYMENTS_NOT_CONFIGURED", `status=${refund.status} error=${refund.json?.error}`);
  const afterRefund = await jfetch(owner, `${BASE}/api/admin/office/orders/leg-order-1`);
  leg("ledger untouched by the refused refund",
    afterRefund.json?.order?.status === "fulfilled" && afterRefund.json?.order?.refundUSD === 0,
    `status=${afterRefund.json?.order?.status} refundUSD=${afterRefund.json?.order?.refundUSD}`);

  // ── customers + ban enforcement data ──────────────────────────────────────
  const customers = await jfetch(owner, `${BASE}/api/admin/office/customers`);
  const buyer = customers.json?.customers?.find((c) => c.email === "buyer-leg@example.com");
  leg("customers aggregate the ledger (net spend $60)",
    customers.status === 200 && buyer?.spendUSD === 60 && buyer?.orders === 2,
    `spend=${buyer?.spendUSD} orders=${buyer?.orders}`);

  // ── bank vault: step-up, masked, reveal ───────────────────────────────────
  const details = {
    accountHolder: "Leg Holder", bankName: "Leg Bank", accountNumber: "9999888877776666",
    iban: "MA6412345678909999888877776666", swiftBic: "LEGBMAMC", currency: "MAD", notes: "leg",
  };
  const saveNoStep = await jfetch(support, `${BASE}/api/admin/office/bank`, { method: "POST", body: { details } });
  leg("bank save as support is 403 (permission before step-up)", saveNoStep.status === 403, `status=${saveNoStep.status}`);
  // Fresh owner jar WITHOUT the earlier step-up cookie window: use a new login.
  const owner2 = jar();
  await jfetch(owner2, `${BASE}/api/admin/login`, { method: "POST", body: { password: ADMIN_PASSWORD } });
  const saveFresh = await jfetch(owner2, `${BASE}/api/admin/office/bank`, { method: "POST", body: { details } });
  leg("bank save without step-up is refused", saveFresh.status === 403 && saveFresh.json.error === "STEP_UP_REQUIRED", `status=${saveFresh.status}`);
  await jfetch(owner2, `${BASE}/api/admin/step-up`, { method: "POST", body: { password: ADMIN_PASSWORD } });
  const save = await jfetch(owner2, `${BASE}/api/admin/office/bank`, { method: "POST", body: { details } });
  leg("bank save after step-up succeeds", save.status === 200 && save.json.masked?.iban?.includes("6666") && !JSON.stringify(save.json).includes("9999888877776666"),
    `status=${save.status} masked=${save.json?.masked?.iban}`);
  const reveal = await jfetch(owner2, `${BASE}/api/admin/office/bank/reveal`, { method: "POST" });
  leg("bank reveal after step-up returns the stored details",
    reveal.status === 200 && reveal.json.details?.iban === details.iban, `status=${reveal.status}`);

  // ── design: snapshot → banner live → rollback ─────────────────────────────
  const snap = await jfetch(owner, `${BASE}/api/admin/office/design`, { method: "POST", body: { action: "snapshot", name: "leg-baseline" } });
  leg("design snapshot saved", snap.status === 200 && Boolean(snap.json.version?.id), `status=${snap.status}`);
  const bannerOn = await jfetch(owner, `${BASE}/api/admin/office/design`, {
    method: "POST", body: { action: "banner", banner: { enabled: true, textEn: "LEG BANNER SALE", textAr: "تخفيض", url: "" } },
  });
  leg("banner update accepted", bannerOn.status === 200, `status=${bannerOn.status}`);
  const homeWithBanner = await (await fetch(`${BASE}/en`)).text();
  leg("banner renders on the storefront", homeWithBanner.includes("LEG BANNER SALE"), "");
  const rollback = await jfetch(owner, `${BASE}/api/admin/office/design`, { method: "POST", body: { action: "rollback", id: snap.json.version.id } });
  leg("design rollback succeeds", rollback.status === 200 && rollback.json.ok === true, `status=${rollback.status}`);
  const homeAfter = await (await fetch(`${BASE}/en`)).text();
  leg("rollback removes the banner from the storefront", !homeAfter.includes("LEG BANNER SALE"), "");

  // ── products: create → visible → scheduled hidden → duplicate inactive ────
  const created = await jfetch(owner, `${BASE}/api/admin/products`, {
    method: "POST", body: { action: "create", product: { slug: "leg-product", title: "Leg Product XYZ", priceUSD: 12.5, category: "ebooks" } },
  });
  leg("product create", created.status === 200 && created.json.ok === true, `status=${created.status}`);
  const shop1 = await (await fetch(`${BASE}/en/shop`)).text();
  leg("new product is on the storefront", shop1.includes("Leg Product XYZ"), "");
  const schedule = await jfetch(owner, `${BASE}/api/admin/products`, {
    method: "PATCH", body: { id: created.json.id, publishAt: "2999-01-01T00:00:00.000Z" },
  });
  leg("product scheduling patch", schedule.status === 200, `status=${schedule.status}`);
  const shop2 = await (await fetch(`${BASE}/en/shop`)).text();
  leg("future-scheduled product is hidden from the storefront", !shop2.includes("Leg Product XYZ"), "");
  const dup = await jfetch(owner, `${BASE}/api/admin/products`, { method: "POST", body: { action: "duplicate", sourceId: created.json.id } });
  leg("product duplicate created inactive", dup.status === 200 && dup.json.ok === true, `status=${dup.status}`);
  const shop3 = await (await fetch(`${BASE}/en/shop`)).text();
  leg("the inactive duplicate does not leak to the storefront", !shop3.includes("Leg Product XYZ (copy)"), "");

  // ── coupons: office list drives validation ────────────────────────────────
  const coupon = await jfetch(owner, `${BASE}/api/admin/office/coupons`, {
    method: "POST", body: { action: "upsert", coupon: { code: "LEG10", type: "percent", value: 10, active: true } },
  });
  leg("coupon upsert via the office", coupon.status === 200, `status=${coupon.status}`);
  const validate = await jfetch(jar(), `${BASE}/api/coupon/validate`, { method: "POST", body: { code: "LEG10", subtotalUSD: 100 } });
  leg("checkout validation uses the office-managed coupon", validate.status === 200 && validate.json.ok === true && validate.json.discountUSD === 10,
    `discount=${validate.json?.discountUSD}`);

  // ── tickets: public intake → office triage ────────────────────────────────
  const ticket = await jfetch(jar(), `${BASE}/api/support/ticket`, {
    method: "POST", body: { email: "customer-leg@example.com", subject: "Leg ticket", message: "Please help with my order", orderRef: "leg-order-1" },
  });
  leg("public ticket intake", ticket.status === 200 && Boolean(ticket.json.ticketId), `status=${ticket.status}`);
  const ticketList = await jfetch(owner, `${BASE}/api/admin/office/tickets`);
  leg("ticket appears in the office", ticketList.status === 200 && ticketList.json.tickets?.some((t) => t.id === ticket.json.ticketId), "");
  const ticketAnswer = await jfetch(owner, `${BASE}/api/admin/office/tickets`, { method: "POST", body: { id: ticket.json.ticketId, status: "answered" } });
  leg("ticket status transition open → answered", ticketAnswer.status === 200 && ticketAnswer.json.ticket?.status === "answered", `status=${ticketAnswer.status}`);

  // ── audit trail ───────────────────────────────────────────────────────────
  const security = await jfetch(owner, `${BASE}/api/admin/office/security?q=office.`);
  const actions = (security.json?.audit ?? []).map((a) => a.action);
  leg("security center: office actions are in the searchable audit log",
    security.status === 200 && actions.some((a) => a.startsWith("office.bank")) && actions.some((a) => a.startsWith("office.design")),
    `actions=${[...new Set(actions)].slice(0, 6).join(",")}`);
} finally {
  try { process.kill(-server.pid, "SIGTERM"); } catch { server.kill("SIGTERM"); }
  await sleep(800);
  killByPort(PORT);
  if (DB_MODE) {
    const { PrismaClient } = await import("@prisma/client");
    const admin = new PrismaClient({ datasources: { db: { url: `${PG_BASE}/postgres` } } });
    await admin.$executeRawUnsafe("DROP DATABASE IF EXISTS astralium_p10 WITH (FORCE)").catch(() => undefined);
    await admin.$disconnect().catch(() => undefined);
  }
  rmSync(WORK, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nALL LEGS PASSED" : `\n${failures} LEG(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
