#!/usr/bin/env node
/**
 * audit-mobile.mjs — small-screen storefront audit (owner fix, 2026-11).
 *
 * Boots the production build (like e2e-smoke) and drives headless
 * Chromium at 320/360/390px in en + ar over home, shop, product, cart
 * and checkout, asserting:
 *   1. ZERO horizontal overflow (document scrollWidth ≤ viewport) and
 *      reporting the worst offending elements when it is violated;
 *   2. homepage: hero headline + primary CTA + "browse books" jump
 *      inside the first viewport;
 *   3. product: the sticky buy bar is visible and does NOT overlap
 *      the chat pill; the chat pill shows its text label everywhere;
 *   4. key tap targets are ≥44px tall.
 *
 * Requires: a prior `npm run build`, and playwright-core + a Chromium
 * build. Resolution order for playwright-core: bare import, then
 * $PLAYWRIGHT_CORE_PATH, then /tmp/rect-audit/node_modules.
 * Usage: node scripts/audit-mobile.mjs
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.AUDIT_PORT || 3227);
const BASE = `http://127.0.0.1:${PORT}`;

let chromium = null;
for (const candidate of [null, process.env.PLAYWRIGHT_CORE_PATH, "/tmp/rect-audit/node_modules/playwright-core"]) {
  try {
    const mod = candidate
      ? createRequire(import.meta.url)(candidate)
      : await import("playwright-core");
    chromium = mod.chromium ?? mod.default?.chromium;
    if (chromium) break;
  } catch { /* try next */ }
}
if (!chromium) {
  console.error("playwright-core not found (bare import, $PLAYWRIGHT_CORE_PATH, /tmp/rect-audit) — audit cannot run.");
  process.exit(2);
}

const SCRUB = [
  "DATABASE_URL", "DOWNLOAD_SIGNING_SECRET",
  "STRIPE_SECRET_KEY", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "STRIPE_WEBHOOK_SECRET",
  "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_WEBHOOK_ID",
  "RESEND_API_KEY", "EMAIL_FROM", "OPENAI_API_KEY",
  "S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_ENDPOINT",
  "PII_ENCRYPTION_KEY", "CRON_SECRET", "PRICE_ALERT_CRON_SECRET",
];
const env = { ...process.env, NODE_ENV: "production", PORT: String(PORT), ADMIN_PASSWORD: "audit-mobile-test-only" };
for (const k of SCRUB) delete env[k];
for (const k of Object.keys(env)) if (k.startsWith("FLAG_")) delete env[k];

const server = spawn(process.execPath, [path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(PORT)], {
  cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (d) => { serverLog += d; });
server.stderr.on("data", (d) => { serverLog += d; });

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function waitForServer() {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(BASE + "/en");
      if (r.status === 200) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

// First product slug from the live shop page (real catalog data).
async function firstProductSlug(locale) {
  const res = await fetch(`${BASE}/${locale}/shop`);
  const html = await res.text();
  const m = html.match(new RegExp(`/${locale}/product/([a-z0-9-]+)`));
  return m ? m[1] : null;
}

const OVERFLOW_FN = () => {
  const iw = window.innerWidth;
  const sw = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0);
  const offenders = [];
  if (sw > iw) {
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.right > iw + 1 || r.left < -1)) {
        offenders.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} [${Math.round(r.left)}..${Math.round(r.right)}]`);
        if (offenders.length >= 5) break;
      }
    }
  }
  return { iw, sw, offenders };
};

let exitCode = 1;
let browser;
try {
  if (!(await waitForServer())) throw new Error("server did not come up:\n" + serverLog.slice(-2000));
  browser = await chromium.launch();
  const slug = await firstProductSlug("en");
  check("catalog has a product to audit", Boolean(slug), slug ?? "none");

  const cartSeed = JSON.stringify([{
    id: "audit-item", kind: "product", slug: slug ?? "x", title: "Audit Item — a very long product title to stress the layout",
    priceUSD: 49, hue: 45,
  }]);

  for (const locale of ["en", "ar"]) {
    for (const width of [320, 360, 390]) {
      const context = await browser.newContext({
        viewport: { width, height: 740 },
        isMobile: true, hasTouch: true,
        userAgent: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36",
      });
      await context.addInitScript((cart) => {
        try { localStorage.setItem("astralium-cart", cart); } catch { /* ignore */ }
      }, cartSeed);
      const page = await context.newPage();
      const pages = [
        ["home", `/${locale}`],
        ["shop", `/${locale}/shop`],
        ["product", `/${locale}/product/${slug}`],
        ["cart", `/${locale}/cart`],
        ["checkout", `/${locale}/checkout`],
      ];
      for (const [name, url] of pages) {
        await page.goto(BASE + url, { waitUntil: "networkidle", timeout: 45000 }).catch(() => page.goto(BASE + url, { waitUntil: "load", timeout: 45000 }));
        const o = await page.evaluate(OVERFLOW_FN);
        // Two assertions, not one: scrollWidth ≤ innerWidth is not
        // enough — when content is too wide, the layout viewport
        // itself stretches to fit it (innerWidth grows past the
        // device width, the browser zooms out, and the owner sees
        // the "needs Desktop site mode" symptom). innerWidth must
        // EQUAL the emulated device width.
        check(`${locale}/${width} ${name}: viewport integrity (innerWidth == device width)`, o.iw === width,
          `innerWidth=${o.iw} device=${width}`);
        check(`${locale}/${width} ${name}: no horizontal overflow`, o.sw <= width + 1,
          o.sw > width + 1 ? `scrollWidth=${o.sw} device=${width} offenders: ${o.offenders.join(" | ")}` : `scrollWidth=${o.sw}`);
      }

      // Homepage first-viewport composition.
      await page.goto(`${BASE}/${locale}`, { waitUntil: "networkidle" }).catch(() => {});
      const hero = await page.evaluate(() => {
        const vh = window.innerHeight;
        const box = (sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height), display: cs.display, visible: r.height > 0 && cs.display !== "none" };
        };
        return {
          vh,
          h1: box(".hero h1"),
          cta: box(".hero-btns .btn"),
          jump: box(".hero-jump"),
          jumpText: document.querySelector(".hero-jump")?.textContent?.trim() ?? null,
          fab: box(".chat-fab"),
          fabLabel: document.querySelector(".chat-fab-label")?.textContent?.trim() ?? null,
        };
      });
      check(`${locale}/${width} home: hero headline in first viewport`, Boolean(hero.h1?.visible && hero.h1.bottom <= hero.vh),
        `h1 bottom=${hero.h1?.bottom} vh=${hero.vh}`);
      check(`${locale}/${width} home: primary CTA in first viewport`, Boolean(hero.cta?.visible && hero.cta.bottom <= hero.vh),
        `cta bottom=${hero.cta?.bottom} vh=${hero.vh}`);
      check(`${locale}/${width} home: "browse books" jump visible in first viewport`, Boolean(hero.jump?.visible && hero.jump.bottom <= hero.vh),
        `jump="${hero.jumpText}" bottom=${hero.jump?.bottom}`);
      check(`${locale}/${width} home: chat pill shows its label`, Boolean(hero.fab?.visible && hero.fabLabel),
        `label="${hero.fabLabel}" fab height=${hero.fab?.height}`);
      check(`${locale}/${width} home: chat pill ≥44px tall`, (hero.fab?.height ?? 0) >= 44, `height=${hero.fab?.height}`);

      // Product page: buy bar visible, chat pill clear of it.
      await page.goto(`${BASE}/${locale}/product/${slug}`, { waitUntil: "networkidle" }).catch(() => {});
      const prod = await page.evaluate(() => {
        const rect = (sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height, display: cs.display, position: cs.position };
        };
        const bar = rect(".sticky-buybar");
        const fab = rect(".chat-fab");
        const overlap = bar && fab
          ? !(fab.bottom <= bar.top || fab.top >= bar.bottom || fab.right <= bar.left || fab.left >= bar.right)
          : null;
        return { bar, fab, overlap, buyBtnH: rect(".sticky-buybar .btn")?.height ?? null };
      });
      check(`${locale}/${width} product: sticky buy bar visible`, Boolean(prod.bar && prod.bar.display !== "none" && prod.bar.position === "fixed"),
        `display=${prod.bar?.display} position=${prod.bar?.position}`);
      check(`${locale}/${width} product: buy bar BUY NOW ≥44px`, (prod.buyBtnH ?? 0) >= 44, `height=${prod.buyBtnH}`);
      check(`${locale}/${width} product: chat pill does not overlap buy bar`, prod.overlap === false,
        `overlap=${prod.overlap} fab=[${Math.round(prod.fab?.top ?? 0)}..${Math.round(prod.fab?.bottom ?? 0)}] bar=[${Math.round(prod.bar?.top ?? 0)}..${Math.round(prod.bar?.bottom ?? 0)}]`);

      // Tap targets on the masthead + mobile nav (home page).
      await page.goto(`${BASE}/${locale}`, { waitUntil: "networkidle" }).catch(() => {});
      const taps = await page.evaluate(() => {
        const heights = {};
        const measure = (key, sel) => {
          const el = document.querySelector(sel);
          heights[key] = el ? Math.round(el.getBoundingClientRect().height) : null;
        };
        measure("navLink", ".main-nav a");
        measure("mobileNavItem", ".mobile-nav-item");
        measure("heroBtn", ".hero-btns .btn");
        return heights;
      });
      for (const [key, h] of Object.entries(taps)) {
        check(`${locale}/${width} tap target ${key} ≥44px`, (h ?? 0) >= 44, `height=${h}`);
      }
      await context.close();
    }
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  exitCode = failed === 0 ? 0 : 1;
} catch (err) {
  console.error("audit failed:", err instanceof Error ? err.message : err);
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill("SIGTERM");
}
process.exit(exitCode);
