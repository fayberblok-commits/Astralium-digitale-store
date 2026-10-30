#!/usr/bin/env node
/**
 * e2e-smoke.mjs — production-build smoke test (no browser, plain HTTP).
 *
 * Boots `next start` on a test port with a scrubbed environment (no
 * optional integration keys, no FLAG_* overrides) so the assertions below
 * exercise the documented DEFAULT behaviour: storefront up in en + ar,
 * catalog + search working, SEO surfaces present, money/messaging flags
 * OFF by default, admin guarded, privacy center public.
 * One exception: a throwaway ADMIN_PASSWORD is set for this local boot
 * only — without one the admin is disabled entirely and the login page
 * renders a "not configured" notice instead of the password form.
 *
 * Usage: npm run test:e2e   (requires a prior `npm run build`)
 * Env:   E2E_PORT (default 3219), E2E_TIMEOUT_MS (default 90000)
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.E2E_PORT || 3219);
const BASE = `http://127.0.0.1:${PORT}`;
const TIMEOUT = Number(process.env.E2E_TIMEOUT_MS || 90000);

// Scrub every optional integration key + flag override so defaults apply.
const SCRUB = [
  "DATABASE_URL", "DOWNLOAD_SIGNING_SECRET",
  "STRIPE_SECRET_KEY", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "STRIPE_WEBHOOK_SECRET",
  "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_WEBHOOK_ID",
  "RESEND_API_KEY", "EMAIL_FROM", "OPENAI_API_KEY",
  "S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_ENDPOINT",
  "PII_ENCRYPTION_KEY", "CRON_SECRET", "PRICE_ALERT_CRON_SECRET",
];
const env = { ...process.env, NODE_ENV: "production", PORT: String(PORT), ADMIN_PASSWORD: "e2e-smoke-test-only" };
for (const k of SCRUB) delete env[k];
for (const k of Object.keys(env)) if (k.startsWith("FLAG_")) delete env[k];

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function get(p, opts = {}) {
  const res = await fetch(BASE + p, { redirect: "manual", ...opts });
  const body = await res.text();
  return { status: res.status, headers: res.headers, body };
}

async function waitForServer(deadline) {
  while (Date.now() < deadline) {
    try {
      const r = await fetch(BASE + "/en");
      if (r.status === 200) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

// Spawn the Next binary directly (not via npx) so server.kill() reaches
// the real server process — an npx wrapper would orphan it and a stale
// server from a previous run could silently answer the next run.
const server = spawn(process.execPath, [path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(PORT)], {
  cwd: ROOT,
  env,
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (d) => { serverLog += d; });
server.stderr.on("data", (d) => { serverLog += d; });

let exitCode = 1;
try {
  // Refuse to test against a stranger: the port must be free before boot,
  // otherwise we might be asserting against a stale server.
  let portBusy = false;
  try { await fetch(BASE + "/en"); portBusy = true; } catch { /* free */ }
  if (portBusy) {
    console.error(`Port ${PORT} is already serving — refusing to run against a possibly stale server. Set E2E_PORT to a free port.`);
    process.exit(1);
  }
  const up = await waitForServer(Date.now() + TIMEOUT);
  if (!up) {
    console.error("Server did not come up. Log tail:\n" + serverLog.slice(-2000));
    process.exit(1);
  }
  console.log(`e2e smoke against ${BASE} (production build, default env)\n`);

  // 1. Home EN + store marker
  let r = await get("/en");
  check("GET /en → 200", r.status === 200, `status ${r.status}`);
  check("home EN carries store brand marker", r.body.includes("Astralium"));

  // 2. Home AR + RTL
  r = await get("/ar");
  check("GET /ar → 200", r.status === 200, `status ${r.status}`);
  check("home AR is RTL", r.body.includes('lang="ar"') && r.body.includes('dir="rtl"'));

  // 3. Shop page lists the catalog
  r = await get("/en/shop");
  check("GET /en/shop → 200 with catalog product", r.status === 200 && r.body.includes("The AI Profit Blueprint"), `status ${r.status}`);

  // 4. Product page
  r = await get("/en/product/ai-profit-blueprint");
  check("GET /en/product/ai-profit-blueprint → 200 with title", r.status === 200 && r.body.includes("The AI Profit Blueprint"), `status ${r.status}`);

  // 5. Smart search tolerates a typo (blueprnt → Blueprint)
  r = await get("/api/search?q=blueprnt");
  let firstSlug = null;
  try { firstSlug = JSON.parse(r.body)?.results?.[0]?.slug ?? null; } catch { /* handled below */ }
  check("GET /api/search?q=blueprnt → typo-tolerant, Blueprint first", r.status === 200 && firstSlug === "ai-profit-blueprint", `status ${r.status}, first=${firstSlug}`);

  // 6. Sitemap with product URLs
  r = await get("/sitemap.xml");
  check("GET /sitemap.xml → 200 with product URLs", r.status === 200 && r.body.includes("/product/ai-profit-blueprint"), `status ${r.status}`);

  // 7. robots.txt
  r = await get("/robots.txt");
  check("GET /robots.txt → 200", r.status === 200 && /user-agent/i.test(r.body), `status ${r.status}`);

  // 8. PWA manifest
  r = await get("/manifest.webmanifest");
  check("GET /manifest.webmanifest → 200 with store name", r.status === 200 && r.body.includes("Astralium Digitale Store"), `status ${r.status}`);

  // 9. Flag-OFF endpoint refuses (order_bump defaults OFF — money feature)
  r = await get("/api/offers");
  check("GET /api/offers → 403 FEATURE_DISABLED (flag off by default)", r.status === 403 && r.body.includes("FEATURE_DISABLED"), `status ${r.status}`);

  // 10. Admin guard: unauthenticated visitors never see dashboard content.
  //     The App Router redirect() is delivered inside the streamed RSC
  //     payload (NEXT_REDIRECT → login), so over HTTP we assert the
  //     redirect instruction is present AND no dashboard HTML leaks.
  r = await get("/en/control-astralium");
  check("GET /en/control-astralium unauthenticated → NEXT_REDIRECT to login, no dashboard content",
    r.body.includes("NEXT_REDIRECT") && r.body.includes("/control-astralium/login") && !r.body.includes("Astralium Control"), `status ${r.status}`);
  r = await get("/api/admin/flags");
  check("GET /api/admin/flags unauthenticated → 401", r.status === 401, `status ${r.status}`);
  r = await get("/en/control-astralium/login");
  check("GET /en/control-astralium/login → 200 with password form", r.status === 200 && r.body.includes('type="password"'), `status ${r.status}`);

  // 11. Privacy center public (flag ON by default)
  r = await get("/en/privacy-center");
  check("GET /en/privacy-center → 200", r.status === 200, `status ${r.status}`);

  const failed = results.filter((x) => !x.ok);
  console.log(`\nE2E SMOKE: ${results.length - failed.length}/${results.length} checks passed`);
  exitCode = failed.length === 0 ? 0 : 1;
} finally {
  server.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 1500));
  try { server.kill("SIGKILL"); } catch { /* already gone */ }
}
process.exit(exitCode);
