/**
 * Phase 5 upgrade — AI tools layer + action engine (the safety core):
 *  - every write is a PREVIEW first; the store does not change until
 *    the owner's Apply (safe) or explicit Approve (sensitive);
 *  - undo restores the exact prior state for snapshot tools;
 *  - forbidden tool names are refused in the layer (refunds, bank,
 *    deletes, secrets, accounts, security) — for ANY employee;
 *  - allow-lists, zod validation, emergency stop and the action cap
 *    all refuse with stable codes;
 *  - every transition lands in the audit log naming the employee.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.chdir(mkdtempSync(path.join(tmpdir(), "astralium-p11-tools-")));
delete process.env.DATABASE_URL;
process.env.AUTH_SECRET = "p11-tools-secret";
process.env.ADMIN_PASSWORD = "p11-admin-pass";

const tools = await import("../src/lib/ai/tools.ts");
const actions = await import("../src/lib/ai/actions.ts");
const config = await import("../src/lib/ai/config.ts");
const usage = await import("../src/lib/ai/usage.ts");
const themeSettings = await import("../src/lib/theme-settings.ts");
const couponsStore = await import("../src/lib/coupons-store.ts");
const catalog = await import("../src/lib/catalog.ts");
const blog = await import("../src/lib/blog.ts");
const team = await import("../src/lib/team.ts");
const employees = await import("../src/lib/ai/employees.ts");

const actor = { actor: "bootstrap-owner", role: "owner", via: "password", userId: null, scope: "full", epoch: 0 };
const empTools = async (id) => (await employees.getOwnerEmployee(id)).tools;

async function propose(employeeId, outcome) {
  const def = tools.TOOL_REGISTRY.get(outcome.toolName);
  const r = await actions.proposeAction({
    actor, employeeId, def, toolInput: outcome.input, preview: outcome.preview,
  });
  assert.equal(r.ok, true, `propose failed: ${JSON.stringify(r)}`);
  return r.action;
}

// ─── 1. Safe flow: theme preview → apply → undo ──────────────────────────────

test("theme: preview changes nothing; apply switches; undo restores", async () => {
  const before = (await themeSettings.getThemeSettings()).palette;
  const outcome = await tools.evaluateToolCall({
    employeeTools: await empTools("designer"), toolName: "set_theme",
    rawArguments: { palette: "tropical-glow" },
  });
  assert.equal(outcome.kind, "preview");
  assert.equal((await themeSettings.getThemeSettings()).palette, before, "preview must not change the store");
  const action = await propose("designer", outcome);
  assert.equal(action.status, "preview");
  const applied = await actions.applyAction(action.id, actor);
  assert.equal(applied.ok, true);
  assert.equal(applied.action.status, "applied");
  assert.equal((await themeSettings.getThemeSettings()).palette, "tropical-glow");
  const undone = await actions.undoAction(action.id, actor);
  assert.equal(undone.ok, true);
  assert.equal((await themeSettings.getThemeSettings()).palette, before);
});

// ─── 2. Sensitive flow: coupon needs explicit approval ───────────────────────

test("coupon: awaiting_approval cannot Apply; Approve creates; undo removes exactly it", async () => {
  const outcome = await tools.evaluateToolCall({
    employeeTools: await empTools("marketer"), toolName: "create_coupon",
    rawArguments: { code: "STAFFTEST20", type: "percent", value: 20, expiresAt: "2030-01-06" },
  });
  assert.equal(outcome.kind, "preview");
  const action = await propose("marketer", outcome);
  assert.equal(action.status, "awaiting_approval");
  assert.equal((await couponsStore.getCoupons()).some((c) => c.code === "STAFFTEST20"), false);
  const wrongDoor = await actions.applyAction(action.id, actor);
  assert.equal(wrongDoor.ok, false, "sensitive actions must refuse the Apply door");
  assert.equal((await couponsStore.getCoupons()).some((c) => c.code === "STAFFTEST20"), false);
  const approved = await actions.decideAction(action.id, actor, "approve");
  assert.equal(approved.ok, true);
  const created = (await couponsStore.getCoupons()).find((c) => c.code === "STAFFTEST20");
  assert.ok(created, "coupon exists after approval");
  assert.equal(created.value, 20);
  const undone = await actions.undoAction(action.id, actor);
  assert.equal(undone.ok, true);
  assert.equal((await couponsStore.getCoupons()).some((c) => c.code === "STAFFTEST20"), false);
});

test("coupon: Reject leaves the store untouched", async () => {
  const outcome = await tools.evaluateToolCall({
    employeeTools: await empTools("marketer"), toolName: "create_coupon",
    rawArguments: { code: "REJECTME10", type: "percent", value: 10 },
  });
  const action = await propose("marketer", outcome);
  const rejected = await actions.decideAction(action.id, actor, "reject");
  assert.equal(rejected.ok, true);
  assert.equal(rejected.action.status, "rejected");
  assert.equal((await couponsStore.getCoupons()).some((c) => c.code === "REJECTME10"), false);
});

// ─── 3. Sensitive: price change + publish via draft ──────────────────────────

test("price: preview diff shows old → new; approval applies; undo restores", async () => {
  const admin = await catalog.listAdminProducts();
  const target = admin.products[0];
  const outcome = await tools.evaluateToolCall({
    employeeTools: await empTools("product-manager"), toolName: "update_product_price",
    rawArguments: { productSlug: target.slug, priceUSD: target.priceUSD + 5 },
  });
  assert.equal(outcome.kind, "preview");
  assert.ok(outcome.preview.diff.some((d) => d.after.includes(String(target.priceUSD + 5))));
  const action = await propose("product-manager", outcome);
  const still = (await catalog.listAdminProducts()).products.find((p) => p.id === target.id);
  assert.equal(still.priceUSD, target.priceUSD, "price unchanged before approval");
  await actions.decideAction(action.id, actor, "approve");
  const changed = (await catalog.listAdminProducts()).products.find((p) => p.id === target.id);
  assert.equal(changed.priceUSD, target.priceUSD + 5);
  await actions.undoAction(action.id, actor);
  const restored = (await catalog.listAdminProducts()).products.find((p) => p.id === target.id);
  assert.equal(restored.priceUSD, target.priceUSD);
});

test("draft product is created INACTIVE; publish is a separate sensitive step", async () => {
  const draftOutcome = await tools.evaluateToolCall({
    employeeTools: await empTools("product-manager"), toolName: "create_product_draft",
    rawArguments: { title: "AI Staff Test Product", priceUSD: 9, category: "ebooks" },
  });
  assert.equal(draftOutcome.kind, "preview");
  const draftAction = await propose("product-manager", draftOutcome);
  await actions.applyAction(draftAction.id, actor);
  const admin = await catalog.listAdminProducts();
  const created = admin.products.find((p) => p.title === "AI Staff Test Product");
  assert.ok(created, "draft exists in admin list");
  assert.ok(admin.inactiveIds.includes(created.id), "draft must be inactive");
  const storefront = await catalog.getStorefrontProducts("en");
  assert.equal(storefront.some((p) => p.id === created.id), false, "draft must not be storefront-visible");

  const pubOutcome = await tools.evaluateToolCall({
    employeeTools: await empTools("product-manager"), toolName: "publish_product",
    rawArguments: { productSlug: created.slug },
  });
  assert.equal(pubOutcome.kind, "preview");
  const pubAction = await propose("product-manager", pubOutcome);
  assert.equal(pubAction.status, "awaiting_approval");
  await actions.decideAction(pubAction.id, actor, "approve");
  const after = await catalog.listAdminProducts();
  assert.equal(after.inactiveIds.includes(created.id), false, "published after approval");
});

// ─── 4. Content tools ────────────────────────────────────────────────────────

test("blog draft + product translation merge (with undo)", async () => {
  const draftOutcome = await tools.evaluateToolCall({
    employeeTools: await empTools("marketer"), toolName: "draft_blog_post",
    rawArguments: { title: "AI Staff Announcement", body: "# Hello\n\nThis draft was proposed by the AI marketer for owner review.", locale: "en" },
  });
  assert.equal(draftOutcome.kind, "preview");
  const draftAction = await propose("marketer", draftOutcome);
  await actions.applyAction(draftAction.id, actor);
  const posts = await blog.listBlogPosts({});
  assert.ok(posts.some((p) => p.title === "AI Staff Announcement" && p.status === "draft"));

  const target = (await catalog.listAdminProducts()).products[0];
  const trOutcome = await tools.evaluateToolCall({
    employeeTools: await empTools("translator"), toolName: "translate_product",
    rawArguments: {
      productSlug: target.slug, locale: "es",
      title: "Título de prueba", subtitle: "Subtítulo", description: "Descripción de prueba.",
    },
  });
  assert.equal(trOutcome.kind, "preview");
  const trAction = await propose("translator", trOutcome);
  await actions.applyAction(trAction.id, actor);
  const merged = (await catalog.listAdminProducts()).products.find((p) => p.id === target.id);
  assert.equal(merged.translations?.es?.title, "Título de prueba");
  await actions.undoAction(trAction.id, actor);
  const restored = (await catalog.listAdminProducts()).products.find((p) => p.id === target.id);
  assert.notEqual(restored.translations?.es?.title, "Título de prueba");
});

// ─── 5. Read tools ───────────────────────────────────────────────────────────

test("read tools answer inline (product_info, sales_summary, security_summary)", async () => {
  const target = (await catalog.listAdminProducts()).products[0];
  const info = await tools.evaluateToolCall({
    employeeTools: await empTools("analyst"), toolName: "product_info",
    rawArguments: { productSlug: target.slug },
  });
  assert.equal(info.kind, "read");
  assert.ok(info.text.includes(target.title));
  const sales = await tools.evaluateToolCall({
    employeeTools: await empTools("analyst"), toolName: "sales_summary", rawArguments: { days: 7 },
  });
  assert.equal(sales.kind, "read");
  assert.ok(sales.text.includes("Orders:"));
  const sec = await tools.evaluateToolCall({
    employeeTools: await empTools("security-monitor"), toolName: "security_summary", rawArguments: {},
  });
  assert.equal(sec.kind, "read");
  assert.ok(sec.text.length > 10);
});

// ─── 6. The forbidden wall ───────────────────────────────────────────────────

test("forbidden tools are refused in the layer for every employee", async () => {
  const allTools = [...new Set((await employees.getOwnerEmployees()).flatMap((e) => e.tools))];
  for (const name of [
    "issue_refund", "process_refund", "get_bank_details", "update_bank_iban",
    "delete_product", "delete_order", "reveal_secret", "get_api_key",
    "create_admin_account", "set_role_permission", "disable_totp",
    "update_payment_keys", "stripe_payout",
  ]) {
    const outcome = await tools.evaluateToolCall({
      employeeTools: allTools, toolName: name, rawArguments: {},
    });
    assert.equal(outcome.kind, "refused", `${name} must be refused`);
    assert.equal(outcome.code, "FORBIDDEN_TOOL", `${name} → FORBIDDEN_TOOL, got ${outcome.code}`);
  }
  assert.ok(tools.forbiddenReasonFor("issue_refund"));
  // Unknown but harmless-sounding names are UNKNOWN_TOOL, never executed.
  const unknown = await tools.evaluateToolCall({
    employeeTools: allTools, toolName: "send_email_blast", rawArguments: {},
  });
  assert.equal(unknown.kind, "refused");
  assert.equal(unknown.code, "UNKNOWN_TOOL");
  // Every REGISTERED tool is reachable when an employee holds it —
  // the forbidden wall applies to unregistered names only. (The one
  // name-collision, security_summary, is a registered read tool: the
  // registry lookup wins over the name heuristic by design.)
  for (const name of tools.TOOL_REGISTRY.keys()) {
    const def = tools.TOOL_REGISTRY.get(name);
    const args = name === "set_theme" ? { palette: "maison-classic" }
      : name === "product_info" ? { productSlug: "ai-profit-blueprint" }
        : def.cls === "read" ? {} : null;
    if (args === null) continue; // write tools are exercised in their own flow tests
    const outcome = await tools.evaluateToolCall({ employeeTools: allTools, toolName: name, rawArguments: args });
    assert.notEqual(outcome.code, "FORBIDDEN_TOOL", `registered tool ${name} must not be forbidden`);
  }
});

test("allow-list + zod validation refuse with stable codes", async () => {
  const notAllowed = await tools.evaluateToolCall({
    employeeTools: await empTools("designer"), toolName: "create_coupon",
    rawArguments: { code: "NOPE10", type: "percent", value: 10 },
  });
  assert.equal(notAllowed.kind, "refused");
  assert.equal(notAllowed.code, "EMPLOYEE_NOT_ALLOWED");
  const badArgs = await tools.evaluateToolCall({
    employeeTools: await empTools("designer"), toolName: "set_theme",
    rawArguments: { palette: "not-a-palette" },
  });
  assert.equal(badArgs.kind, "refused");
  assert.equal(badArgs.code, "INVALID_INPUT");
  const malformed = await tools.evaluateToolCall({
    employeeTools: await empTools("designer"), toolName: "set_theme",
    rawArguments: {}, argumentsMalformed: true,
  });
  assert.equal(malformed.code, "INVALID_INPUT");
});

// ─── 7. Hard stops: emergency stop + action cap at proposal time ─────────────

test("emergency stop and daily action cap block new proposals", async () => {
  const outcome = await tools.evaluateToolCall({
    employeeTools: await empTools("designer"), toolName: "set_theme",
    rawArguments: { palette: "aurora-dawn" },
  });
  assert.equal(outcome.kind, "preview");
  const def = tools.TOOL_REGISTRY.get("set_theme");
  await config.setAiSettings({ emergencyStop: true });
  const stopped = await actions.proposeAction({ actor, employeeId: "designer", def, toolInput: outcome.input, preview: outcome.preview });
  assert.equal(stopped.ok, false);
  assert.equal(stopped.code, "EMERGENCY_STOP");
  await config.setAiSettings({ emergencyStop: false });
  const used = (await usage.getTodayUsage()).actions;
  await config.setAiSettings({ dailyActionCap: used });
  const capped = await actions.proposeAction({ actor, employeeId: "designer", def, toolInput: outcome.input, preview: outcome.preview });
  assert.equal(capped.ok, false);
  assert.equal(capped.code, "ACTION_CAP_REACHED");
  await config.setAiSettings({ dailyActionCap: 50 });
});

// ─── 8. Audit trail names the employee ───────────────────────────────────────

test("audit log records proposals/applies as executed-by-employee entries", async () => {
  const entries = await team.listAudit(200);
  const applied = entries.filter((e) => e.action === "ai.action_applied");
  assert.ok(applied.length >= 1, "at least one ai.action_applied entry");
  assert.ok(applied.every((e) => typeof e.detail?.employee === "string" && e.detail.employee.length > 0));
  assert.ok(entries.some((e) => e.action === "ai.action_proposed"));
  assert.ok(entries.some((e) => e.action === "ai.action_approved"));
  assert.ok(entries.some((e) => e.action === "ai.action_undone"));
});
