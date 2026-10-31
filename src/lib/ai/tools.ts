/**
 * Owner-staff TOOL LAYER (Phase 5 upgrade) — the only hands the AI has.
 *
 * Owner employees never touch the database, the shell, the filesystem
 * or an admin route directly. They may only REQUEST one of the tools
 * below, each with zod-validated inputs, wrapping an existing Phase
 * 1–4 service. Safety is enforced HERE, not in prompts:
 *
 *  - Classification: "read" tools execute inline; "safe" writes are
 *    previewed, then applied by the owner's Apply click, with a
 *    one-click undo snapshot; "sensitive" writes (coupons, prices,
 *    publishing) additionally require the owner's explicit Approve.
 *  - A FORBIDDEN class exists only as refusals: no tool in this
 *    registry touches bank data, secrets, payment keys, refunds,
 *    deletions, admin accounts/permissions, sessions or security
 *    settings — and any invented tool name matching those areas is
 *    refused as FORBIDDEN_TOOL (and logged as a security event),
 *    whether the model, a poisoned customer text, or anyone else
 *    asked for it.
 *  - Employee allow-lists are checked on every call: holding the
 *    gateway does not widen an employee's hands.
 *
 * Previews are computed from live state and include a field-level
 * diff (before → after) plus the undo snapshot, so what the owner
 * approves is exactly what applies.
 */
import { z } from "zod";
import { isPaletteId, PALETTES } from "../themes.ts";
import { getThemeSettings, setThemeSettings, type ThemeSettings } from "../theme-settings.ts";
import { getSiteBanner, setSiteBanner, getHeroText, setHeroText, type SiteBanner, type HeroTextOverride } from "../design.ts";
import { getHomeSections, setHomeSections, HOME_SECTION_IDS, type HomeSectionsSettings } from "../home-settings.ts";
import { getCoupons, setCoupons } from "../coupons-store.ts";
import { sanitizeCoupon } from "../coupons.ts";
import { listBlogPosts, saveBlogPost, type BlogPostRecord } from "../blog.ts";
import {
  adminCreateProduct, adminUpdateProduct, listAdminProducts, sanitizeNewProduct,
} from "../catalog.ts";
import { listAllOrders } from "../orders.ts";
import {
  filterOrdersByRange, getAdSpend, getFinanceSettings, salesReport,
} from "../office-finance.ts";
import { listSecurityEvents } from "../security-log.ts";
import type { Permission } from "../team.ts";
import type { AiToolSpec } from "./types.ts";

export type ToolClass = "read" | "safe" | "sensitive";

export interface DiffEntry {
  field: string;
  before: string;
  after: string;
}

export interface ToolPreview {
  summary: string;
  diff: DiffEntry[];
  /** Opaque snapshot the action engine stores for one-click undo. */
  undo: unknown;
}

export interface ToolDef {
  name: string;
  cls: ToolClass;
  description: string;
  /** Permission the owner-actor must hold to apply/approve this tool. */
  requiredPermission: Permission;
  parameters: Record<string, unknown>;
  schema: z.ZodType;
  /** Read tools: execute immediately and return result text. */
  run?: (input: never) => Promise<string>;
  /** Write tools: compute the preview (diff + undo snapshot). */
  preview?: (input: never) => Promise<ToolPreview>;
  /** Write tools: perform the change (after owner apply/approval). */
  apply?: (input: never) => Promise<string>;
  /** Write tools: restore the preview's undo snapshot (owner's undo click). */
  undo?: (undoPayload: never, input: never) => Promise<string>;
}

async function resolveProduct(slugOrId: string) {
  const { products, inactiveIds } = await listAdminProducts();
  const p = products.find((x) => x.slug === slugOrId || x.id === slugOrId);
  if (!p) return null;
  return { product: p, active: !inactiveIds.includes(p.id) };
}

// ─── Tool definitions ────────────────────────────────────────────────────────

const tools: ToolDef[] = [
  {
    name: "product_info",
    cls: "read",
    description: "Look up one catalog product by slug or id: title, price, state, rating, translation locales.",
    requiredPermission: "read",
    parameters: {
      type: "object",
      properties: { productSlug: { type: "string", description: "Product slug or id" } },
      required: ["productSlug"],
    },
    schema: z.object({ productSlug: z.string().min(1).max(120) }),
    run: async (input: { productSlug: string }) => {
      const found = await resolveProduct(input.productSlug);
      if (!found) return `No product matches "${input.productSlug}".`;
      const p = found.product;
      return [
        `${p.title} (${p.slug}) — $${p.priceUSD}${p.compareAtUSD ? ` (compare-at $${p.compareAtUSD})` : ""}`,
        `State: ${found.active ? "active" : "inactive/draft"} · Category: ${p.category} · Rating: ${p.rating} (${p.reviewsCount} reviews)`,
        `Subtitle: ${p.subtitle}`,
        `Translation locales stored: ${p.translations ? Object.keys(p.translations).join(", ") || "none" : "none"}`,
      ].join("\n");
    },
  },
  {
    name: "sales_summary",
    cls: "read",
    description: "Sales and profit summary for the last N days from the order ledger (counts, gross, refunds, fee/tax estimates, net profit, top products).",
    requiredPermission: "read",
    parameters: {
      type: "object",
      properties: { days: { type: "number", description: "Look-back window in days (1-90, default 7)" } },
    },
    schema: z.object({ days: z.number().int().min(1).max(90).optional() }),
    run: async (input: { days?: number }) => {
      const days = input.days ?? 7;
      const to = new Date();
      const from = new Date(to.getTime() - days * 24 * 3600 * 1000);
      const range = { fromISO: from.toISOString(), toISO: to.toISOString() };
      const [orders, settings, adSpend, admin] = await Promise.all([
        listAllOrders(), getFinanceSettings(), getAdSpend(), listAdminProducts(),
      ]);
      const costByProductId = new Map(admin.products.map((p) => [p.id, p.costUSD ?? 0]));
      const report = salesReport(filterOrdersByRange(orders, range.fromISO, range.toISO), {
        settings, costByProductId, adSpend, ...range,
      });
      const titleById = new Map(admin.products.map((p) => [p.id, p.title]));
      const top = report.byProduct.slice(0, 5).map((r) => `${titleById.get(r.productId) ?? r.productId}: ${r.orders} orders, $${r.revenueUSD}`).join("; ") || "none";
      return [
        `Sales summary — last ${days} days (${range.fromISO.slice(0, 10)} → ${range.toISO.slice(0, 10)}):`,
        `Orders: ${report.counts.total} total · ${report.counts.fulfilled} fulfilled · ${report.counts.pending} pending · ${report.counts.refunded} refunded · ${report.counts.disputed} disputed`,
        `Gross revenue: $${report.grossUSD} · Refunds: $${report.refundsUSD} · Estimated fees: $${report.feesUSD} · Estimated taxes: $${report.taxesUSD}`,
        `Product costs: $${report.productCostsUSD} · Ad spend: $${report.adSpendUSD} · NET PROFIT: $${report.netProfitUSD}`,
        `Top products: ${top}`,
        `Note: fees and taxes are estimates from the owner's configured rates, not provider-reported figures.`,
      ].join("\n");
    },
  },
  {
    name: "security_summary",
    cls: "read",
    description: "Summarize recent security-log events (failed logins, denied access, webhook problems, disputes) for the owner.",
    requiredPermission: "read",
    parameters: { type: "object", properties: {} },
    schema: z.object({}),
    run: async () => {
      const events = await listSecurityEvents(200);
      const dayAgo = Date.now() - 24 * 3600 * 1000;
      const recent = events.filter((e) => new Date(e.createdAt).getTime() >= dayAgo);
      const counts = new Map<string, number>();
      for (const e of recent) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
      const byKind = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}: ${n}`).join(", ") || "none";
      const latest = events.slice(0, 5).map((e) => `${e.createdAt.slice(0, 16).replace("T", " ")} ${e.kind}`).join("; ") || "none";
      return [
        `Security summary: ${recent.length} events in the last 24h (${events.length} in the log window).`,
        `By kind (24h): ${byKind}.`,
        `Most recent: ${latest}.`,
        `This is a summary only — security settings, sessions and accounts can only be changed by the owner in the Security Center.`,
      ].join("\n");
    },
  },
  {
    name: "set_theme",
    cls: "safe",
    description: "Switch the storefront color palette (theme). Safe change: previewed, applied as a draft the owner can undo in one click.",
    requiredPermission: "settings",
    parameters: {
      type: "object",
      properties: { palette: { type: "string", enum: PALETTES.map((p) => p.id), description: "Palette id" } },
      required: ["palette"],
    },
    schema: z.object({ palette: z.string().refine((v) => isPaletteId(v), "unknown palette") }),
    preview: async (input: { palette: string }) => {
      const current = await getThemeSettings();
      return {
        summary: `Switch storefront palette to ${input.palette}`,
        diff: [{ field: "palette", before: current.palette, after: input.palette }],
        undo: current satisfies ThemeSettings,
      };
    },
    apply: async (input: { palette: string }) => {
      const r = await setThemeSettings({ palette: input.palette });
      return `Palette is now ${r.value.palette} (persisted: ${r.persisted}).`;
    },
    undo: async (undoPayload: ThemeSettings) => {
      const r = await setThemeSettings({
        palette: undoPayload.palette, mode: undoPayload.mode, motion: undoPayload.motion,
      });
      return `Palette restored to ${r.value.palette}.`;
    },
  },
  {
    name: "set_banner",
    cls: "safe",
    description: "Set the site-wide top banner (enabled flag, English/Arabic text, optional link). Safe change with undo.",
    requiredPermission: "settings",
    parameters: {
      type: "object",
      properties: {
        enabled: { type: "boolean" },
        textEn: { type: "string" },
        textAr: { type: "string" },
        url: { type: "string" },
      },
    },
    schema: z.object({
      enabled: z.boolean().optional(),
      textEn: z.string().max(200).optional(),
      textAr: z.string().max(200).optional(),
      url: z.string().max(300).optional(),
    }),
    preview: async (input: Partial<SiteBanner>) => {
      const current = await getSiteBanner();
      const next: SiteBanner = { ...current, ...input };
      return {
        summary: next.enabled ? `Show banner: "${next.textEn}"` : "Hide the site banner",
        diff: [
          { field: "banner.enabled", before: String(current.enabled), after: String(next.enabled) },
          { field: "banner.textEn", before: current.textEn || "(empty)", after: next.textEn || "(empty)" },
          { field: "banner.textAr", before: current.textAr || "(empty)", after: next.textAr || "(empty)" },
        ],
        undo: current satisfies SiteBanner,
      };
    },
    apply: async (input: Partial<SiteBanner>) => {
      const r = await setSiteBanner(input);
      return `Banner updated (enabled: ${r.value.enabled}, persisted: ${r.persisted}).`;
    },
    undo: async (undoPayload: SiteBanner) => {
      await setSiteBanner(undoPayload);
      return "Banner restored to its previous state.";
    },
  },
  {
    name: "set_hero_text",
    cls: "safe",
    description: "Override the homepage hero title/subtitle (English/Arabic). Empty string clears an override. Safe change with undo.",
    requiredPermission: "settings",
    parameters: {
      type: "object",
      properties: {
        titleEn: { type: "string" }, titleAr: { type: "string" },
        subEn: { type: "string" }, subAr: { type: "string" },
      },
    },
    schema: z.object({
      titleEn: z.string().max(200).optional(), titleAr: z.string().max(200).optional(),
      subEn: z.string().max(600).optional(), subAr: z.string().max(600).optional(),
    }),
    preview: async (input: Partial<HeroTextOverride>) => {
      const current = await getHeroText();
      const next: HeroTextOverride = { ...current, ...input };
      const diff: DiffEntry[] = (Object.keys(next) as (keyof HeroTextOverride)[])
        .filter((k) => next[k] !== current[k])
        .map((k) => ({ field: `hero.${k}`, before: current[k] || "(default)", after: next[k] || "(default)" }));
      return { summary: "Update homepage hero texts", diff, undo: current satisfies HeroTextOverride };
    },
    apply: async (input: Partial<HeroTextOverride>) => {
      const r = await setHeroText(input);
      return `Hero texts updated (persisted: ${r.persisted}).`;
    },
    undo: async (undoPayload: HeroTextOverride) => {
      await setHeroText(undoPayload);
      return "Hero texts restored.";
    },
  },
  {
    name: "set_home_sections",
    cls: "safe",
    description: "Reorder and/or hide homepage sections. Provide the full order (every section id exactly once) and/or the hidden list. Safe change with undo.",
    requiredPermission: "settings",
    parameters: {
      type: "object",
      properties: {
        order: { type: "array", items: { type: "string", enum: [...HOME_SECTION_IDS] } },
        hidden: { type: "array", items: { type: "string", enum: [...HOME_SECTION_IDS] } },
      },
    },
    schema: z.object({
      order: z.array(z.enum(HOME_SECTION_IDS)).length(HOME_SECTION_IDS.length).optional(),
      hidden: z.array(z.enum(HOME_SECTION_IDS)).optional(),
    }),
    preview: async (input: Partial<HomeSectionsSettings>) => {
      const current = await getHomeSections();
      const next: HomeSectionsSettings = {
        order: input.order ?? current.order,
        hidden: input.hidden ?? current.hidden,
      };
      return {
        summary: "Change homepage section order/visibility",
        diff: [
          { field: "sections.order", before: current.order.join(" › "), after: next.order.join(" › ") },
          { field: "sections.hidden", before: current.hidden.join(", ") || "(none)", after: next.hidden.join(", ") || "(none)" },
        ],
        undo: current satisfies HomeSectionsSettings,
      };
    },
    apply: async (input: Partial<HomeSectionsSettings>) => {
      const r = await setHomeSections(input);
      return `Homepage sections updated (persisted: ${r.persisted}).`;
    },
    undo: async (undoPayload: HomeSectionsSettings) => {
      await setHomeSections(undoPayload);
      return "Homepage sections restored.";
    },
  },
  {
    name: "translate_product",
    cls: "safe",
    description: "Store a translation of one product's title/subtitle/description for one locale. YOU (the model) write the translation as the tool arguments; the owner previews the exact stored text. Safe change with undo.",
    requiredPermission: "content",
    parameters: {
      type: "object",
      properties: {
        productSlug: { type: "string" },
        locale: { type: "string", description: "Target locale code, e.g. es, fr, de" },
        title: { type: "string" },
        subtitle: { type: "string" },
        description: { type: "string" },
      },
      required: ["productSlug", "locale", "title"],
    },
    schema: z.object({
      productSlug: z.string().min(1).max(120),
      locale: z.string().regex(/^[a-z]{2}(-[A-Za-z]{2,4})?$/),
      title: z.string().min(1).max(300),
      subtitle: z.string().max(600).optional(),
      description: z.string().max(20000).optional(),
    }),
    preview: async (input: { productSlug: string; locale: string; title: string; subtitle?: string; description?: string }) => {
      const found = await resolveProduct(input.productSlug);
      if (!found) throw new Error(`PRODUCT_NOT_FOUND: ${input.productSlug}`);
      const existing = found.product.translations?.[input.locale];
      return {
        summary: `Translate "${found.product.title}" into ${input.locale}`,
        diff: [
          { field: `translations.${input.locale}.title`, before: existing?.title ?? "(none)", after: input.title },
          { field: `translations.${input.locale}.subtitle`, before: existing?.subtitle ?? "(none)", after: input.subtitle ?? "(unchanged)" },
          { field: `translations.${input.locale}.description`, before: (existing?.description ?? "(none)").slice(0, 200), after: (input.description ?? "(unchanged)").slice(0, 200) },
        ],
        undo: { productId: found.product.id, translations: found.product.translations ?? null },
      };
    },
    apply: async (input: { productSlug: string; locale: string; title: string; subtitle?: string; description?: string }) => {
      const found = await resolveProduct(input.productSlug);
      if (!found) throw new Error(`PRODUCT_NOT_FOUND: ${input.productSlug}`);
      const merged = {
        ...(found.product.translations ?? {}),
        [input.locale]: {
          title: input.title,
          ...(input.subtitle !== undefined ? { subtitle: input.subtitle } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
        },
      };
      const r = await adminUpdateProduct(found.product.id, { translations: merged });
      if (!r.ok) throw new Error(r.error ?? "UPDATE_FAILED");
      return `Translation (${input.locale}) stored for ${found.product.slug} (persisted: ${r.persisted}).`;
    },
    undo: async (undoPayload: { productId: string; translations: Record<string, unknown> | null }) => {
      const r = await adminUpdateProduct(undoPayload.productId, {
        translations: (undoPayload.translations ?? {}) as never,
      });
      if (!r.ok) throw new Error(r.error ?? "UNDO_FAILED");
      return "Previous translations restored.";
    },
  },
  {
    name: "draft_blog_post",
    cls: "safe",
    description: "Write a blog article as a DRAFT (not published). The owner reviews and publishes it from the blog manager, or via your publish_blog_post preview. No undo: drafts are managed by the owner in the blog manager.",
    requiredPermission: "content",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        body: { type: "string", description: "Markdown body" },
        locale: { type: "string" },
      },
      required: ["title", "body"],
    },
    schema: z.object({
      title: z.string().min(3).max(200),
      body: z.string().min(10).max(100000),
      locale: z.string().max(10).optional(),
    }),
    preview: async (input: { title: string; body: string; locale?: string }) => ({
      summary: `Create blog DRAFT: "${input.title}"`,
      diff: [
        { field: "blog.new", before: "(does not exist)", after: `draft "${input.title}" (${input.locale ?? "en"}, ${input.body.length} chars)` },
      ],
      undo: null,
    }),
    apply: async (input: { title: string; body: string; locale?: string }) => {
      const r = await saveBlogPost({ title: input.title, bodyMd: input.body, locale: input.locale ?? "en", status: "draft" });
      if (!r.ok) throw new Error(r.error);
      return `Draft created: "${r.post.title}" (slug ${r.post.slug}, id ${r.post.id}). It is NOT published.`;
    },
  },
  {
    name: "create_product_draft",
    cls: "safe",
    description: "Create a new product as an INACTIVE draft (never live on creation). Publishing is a separate sensitive action. No undo: the owner archives drafts in the Products manager.",
    requiredPermission: "content",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        priceUSD: { type: "number" },
        category: { type: "string" },
        subtitle: { type: "string" },
        description: { type: "string" },
      },
      required: ["title", "priceUSD"],
    },
    schema: z.object({
      title: z.string().min(1).max(200),
      priceUSD: z.number().min(0).max(1000000),
      category: z.string().max(80).optional(),
      subtitle: z.string().max(300).optional(),
      description: z.string().max(5000).optional(),
    }),
    preview: async (input: { title: string; priceUSD: number; category?: string }) => ({
      summary: `Create product DRAFT "${input.title}" at $${input.priceUSD} (inactive)`,
      diff: [{ field: "product.new", before: "(does not exist)", after: `"${input.title}" — $${input.priceUSD} · ${input.category ?? "ebooks"} · INACTIVE` }],
      undo: null,
    }),
    apply: async (input: { title: string; priceUSD: number; category?: string; subtitle?: string; description?: string }) => {
      const slug = input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "product";
      const clean = sanitizeNewProduct({
        id: `p-${slug}`, slug, title: input.title, priceUSD: input.priceUSD,
        category: input.category ?? "ebooks", subtitle: input.subtitle ?? "", description: input.description ?? "",
      });
      if (!clean) throw new Error("INVALID_PRODUCT");
      const r = await adminCreateProduct(clean, { active: false });
      if (!r.ok) throw new Error(r.error ?? "CREATE_FAILED");
      return `Product draft created inactive: ${clean.title} (${clean.slug}).`;
    },
  },
  {
    name: "create_coupon",
    cls: "sensitive",
    description: "Create a discount coupon (percent or fixed USD). SENSITIVE: takes effect only after the owner's explicit approval of the preview.",
    requiredPermission: "commerce",
    parameters: {
      type: "object",
      properties: {
        code: { type: "string" },
        type: { type: "string", enum: ["percent", "fixed"] },
        value: { type: "number", description: "Percent (1-100) or USD amount" },
        minSubtotalUSD: { type: "number" },
        expiresAt: { type: "string", description: "ISO date YYYY-MM-DD" },
        usageLimit: { type: "number" },
        firstOrderOnly: { type: "boolean" },
      },
      required: ["code", "type", "value"],
    },
    schema: z.object({
      code: z.string().min(3).max(40),
      type: z.enum(["percent", "fixed"]),
      value: z.number().positive().max(100000),
      minSubtotalUSD: z.number().positive().max(1000000).optional(),
      expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
      usageLimit: z.number().int().positive().max(1000000).optional(),
      firstOrderOnly: z.boolean().optional(),
    }),
    preview: async (input: { code: string; type: "percent" | "fixed"; value: number; minSubtotalUSD?: number; expiresAt?: string; usageLimit?: number; firstOrderOnly?: boolean }) => {
      const coupon = sanitizeCoupon({ ...input, active: true });
      if (!coupon) throw new Error("INVALID_COUPON");
      const existing = await getCoupons();
      if (existing.some((c) => c.code === coupon.code)) throw new Error(`COUPON_EXISTS: ${coupon.code}`);
      return {
        summary: `Create coupon ${coupon.code}: ${coupon.type === "percent" ? `${coupon.value}% off` : `$${coupon.value} off`}`,
        diff: [
          { field: `coupon.${coupon.code}`, before: "(does not exist)", after: `${coupon.type} ${coupon.value}${coupon.expiresAt ? ` · expires ${coupon.expiresAt}` : ""}${coupon.minSubtotalUSD ? ` · min $${coupon.minSubtotalUSD}` : ""}${coupon.usageLimit ? ` · limit ${coupon.usageLimit}` : ""}` },
        ],
        undo: { code: coupon.code },
      };
    },
    apply: async (input: { code: string; type: "percent" | "fixed"; value: number }) => {
      const coupon = sanitizeCoupon({ ...input, active: true });
      if (!coupon) throw new Error("INVALID_COUPON");
      const existing = await getCoupons();
      if (existing.some((c) => c.code === coupon.code)) throw new Error(`COUPON_EXISTS: ${coupon.code}`);
      const r = await setCoupons([...existing, coupon]);
      return `Coupon ${coupon.code} is live (persisted: ${r.persisted}).`;
    },
    undo: async (undoPayload: { code: string }) => {
      // Owner-initiated undo of a coupon THIS action created: removes
      // exactly that code. (Employees have no delete tool; this is the
      // owner's restoration path, executed from the office UI.)
      const existing = await getCoupons();
      await setCoupons(existing.filter((c) => c.code !== undoPayload.code));
      return `Coupon ${undoPayload.code} removed (undo).`;
    },
  },
  {
    name: "update_product_price",
    cls: "sensitive",
    description: "Change a product's price (and optionally compare-at price). SENSITIVE: needs the owner's explicit approval of the preview.",
    requiredPermission: "content",
    parameters: {
      type: "object",
      properties: {
        productSlug: { type: "string" },
        priceUSD: { type: "number" },
        compareAtUSD: { type: "number" },
      },
      required: ["productSlug", "priceUSD"],
    },
    schema: z.object({
      productSlug: z.string().min(1).max(120),
      priceUSD: z.number().min(0).max(1000000),
      compareAtUSD: z.number().min(0).max(1000000).optional(),
    }),
    preview: async (input: { productSlug: string; priceUSD: number; compareAtUSD?: number }) => {
      const found = await resolveProduct(input.productSlug);
      if (!found) throw new Error(`PRODUCT_NOT_FOUND: ${input.productSlug}`);
      return {
        summary: `Change price of "${found.product.title}" to $${input.priceUSD}`,
        diff: [
          { field: `${found.product.slug}.priceUSD`, before: String(found.product.priceUSD), after: String(input.priceUSD) },
          ...(input.compareAtUSD !== undefined
            ? [{ field: `${found.product.slug}.compareAtUSD`, before: String(found.product.compareAtUSD ?? "(none)"), after: String(input.compareAtUSD) }]
            : []),
        ],
        undo: { productId: found.product.id, priceUSD: found.product.priceUSD, compareAtUSD: found.product.compareAtUSD ?? null },
      };
    },
    apply: async (input: { productSlug: string; priceUSD: number; compareAtUSD?: number }) => {
      const found = await resolveProduct(input.productSlug);
      if (!found) throw new Error(`PRODUCT_NOT_FOUND: ${input.productSlug}`);
      const r = await adminUpdateProduct(found.product.id, {
        priceUSD: input.priceUSD,
        ...(input.compareAtUSD !== undefined ? { compareAtUSD: input.compareAtUSD } : {}),
      });
      if (!r.ok) throw new Error(r.error ?? "UPDATE_FAILED");
      return `Price of ${found.product.slug} is now $${input.priceUSD} (persisted: ${r.persisted}).`;
    },
    undo: async (undoPayload: { productId: string; priceUSD: number; compareAtUSD: number | null }) => {
      const r = await adminUpdateProduct(undoPayload.productId, {
        priceUSD: undoPayload.priceUSD, compareAtUSD: undoPayload.compareAtUSD,
      });
      if (!r.ok) throw new Error(r.error ?? "UNDO_FAILED");
      return "Previous price restored.";
    },
  },
  {
    name: "publish_product",
    cls: "sensitive",
    description: "Publish (activate) a product so it appears on the storefront. SENSITIVE: needs the owner's explicit approval of the preview.",
    requiredPermission: "content",
    parameters: {
      type: "object",
      properties: { productSlug: { type: "string" } },
      required: ["productSlug"],
    },
    schema: z.object({ productSlug: z.string().min(1).max(120) }),
    preview: async (input: { productSlug: string }) => {
      const found = await resolveProduct(input.productSlug);
      if (!found) throw new Error(`PRODUCT_NOT_FOUND: ${input.productSlug}`);
      if (found.active) throw new Error(`ALREADY_ACTIVE: ${found.product.slug}`);
      return {
        summary: `Publish "${found.product.title}" on the storefront`,
        diff: [{ field: `${found.product.slug}.active`, before: "false (draft)", after: "true (live)" }],
        undo: { productId: found.product.id },
      };
    },
    apply: async (input: { productSlug: string }) => {
      const found = await resolveProduct(input.productSlug);
      if (!found) throw new Error(`PRODUCT_NOT_FOUND: ${input.productSlug}`);
      const r = await adminUpdateProduct(found.product.id, { active: true, publishAt: null });
      if (!r.ok) throw new Error(r.error ?? "UPDATE_FAILED");
      return `${found.product.slug} is now live on the storefront.`;
    },
    undo: async (undoPayload: { productId: string }) => {
      const r = await adminUpdateProduct(undoPayload.productId, { active: false });
      if (!r.ok) throw new Error(r.error ?? "UNDO_FAILED");
      return "Product returned to inactive/draft.";
    },
  },
  {
    name: "publish_blog_post",
    cls: "sensitive",
    description: "Publish an existing blog draft. SENSITIVE: needs the owner's explicit approval of the preview.",
    requiredPermission: "content",
    parameters: {
      type: "object",
      properties: { postId: { type: "string" }, slug: { type: "string" } },
    },
    schema: z.object({ postId: z.string().max(80).optional(), slug: z.string().max(120).optional() }),
    preview: async (input: { postId?: string; slug?: string }) => {
      const posts = await listBlogPosts({});
      const post = posts.find((p) => (input.postId && p.id === input.postId) || (input.slug && p.slug === input.slug));
      if (!post) throw new Error("POST_NOT_FOUND");
      if (post.status === "published") throw new Error(`ALREADY_PUBLISHED: ${post.slug}`);
      return {
        summary: `Publish blog post "${post.title}"`,
        diff: [{ field: `blog.${post.slug}.status`, before: "draft", after: "published" }],
        undo: { postId: post.id },
      };
    },
    apply: async (input: { postId?: string; slug?: string }) => {
      const posts = await listBlogPosts({});
      const post = posts.find((p) => (input.postId && p.id === input.postId) || (input.slug && p.slug === input.slug));
      if (!post) throw new Error("POST_NOT_FOUND");
      const r = await saveBlogPost({
        id: post.id, slug: post.slug, locale: post.locale, title: post.title,
        excerpt: post.excerpt, bodyMd: post.bodyMd, status: "published",
      });
      if (!r.ok) throw new Error(r.error);
      return `Blog post "${post.title}" is published.`;
    },
    undo: async (undoPayload: { postId: string }) => {
      const posts = await listBlogPosts({});
      const post: BlogPostRecord | undefined = posts.find((p) => p.id === undoPayload.postId);
      if (!post) throw new Error("POST_NOT_FOUND");
      const r = await saveBlogPost({
        id: post.id, slug: post.slug, locale: post.locale, title: post.title,
        excerpt: post.excerpt, bodyMd: post.bodyMd, status: "draft",
      });
      if (!r.ok) throw new Error(r.error);
      return "Blog post returned to draft.";
    },
  },
];

export const TOOL_REGISTRY: Map<string, ToolDef> = new Map(tools.map((t) => [t.name, t]));

// Registry self-check: no registered tool may sit in a forbidden area.
// (Runs at module load in tests too — a future tool that violates the
// owner's hard prohibitions fails loudly instead of shipping.)
const FORBIDDEN_NAME_PATTERNS: [RegExp, string][] = [
  [/refund/i, "refunds are owner-only, executed from the Orders panel with step-up"],
  [/bank|iban/i, "bank data is owner-only and never exposed to staff"],
  [/secret|api[_-]?key|password|credential/i, "secrets and credentials are never exposed to staff"],
  [/delete|remove|drop|purge/i, "staff cannot delete data"],
  [/team|account|role|permission/i, "staff cannot change admin accounts or permissions"],
  [/flag|security|totp|session/i, "staff cannot change security features, flags or sessions"],
  [/payout|payment[_-]?key|stripe|paypal/i, "payment configuration is owner-only"],
];

for (const name of TOOL_REGISTRY.keys()) {
  for (const [re] of FORBIDDEN_NAME_PATTERNS) {
    if (name !== "security_summary" && re.test(name)) {
      throw new Error(`tool registry violation: ${name} matches a forbidden pattern`);
    }
  }
}

export function forbiddenReasonFor(name: string): string | null {
  for (const [re, reason] of FORBIDDEN_NAME_PATTERNS) {
    if (re.test(name)) return reason;
  }
  return null;
}

export function toolSpec(def: ToolDef): AiToolSpec {
  return { name: def.name, description: def.description, parameters: def.parameters };
}

export type ToolCallOutcome =
  | { kind: "read"; toolName: string; text: string }
  | { kind: "preview"; toolName: string; def: ToolDef; input: Record<string, unknown>; preview: ToolPreview }
  | { kind: "refused"; toolName: string; code: string; text: string };

/**
 * Evaluate one model-requested tool call for one employee.
 * Read tools execute; write tools return a PREVIEW (never applied
 * here — the action engine + the owner's click do that); everything
 * else is a refusal with a machine-readable code.
 */
export async function evaluateToolCall(input: {
  employeeTools: string[];
  toolName: string;
  rawArguments: Record<string, unknown>;
  argumentsMalformed?: boolean;
}): Promise<ToolCallOutcome> {
  const { toolName } = input;
  const def = TOOL_REGISTRY.get(toolName);
  if (!def) {
    const reason = forbiddenReasonFor(toolName);
    if (reason) {
      return {
        kind: "refused", toolName, code: "FORBIDDEN_TOOL",
        text: `REFUSED (FORBIDDEN_TOOL): "${toolName}" is not available to AI staff — ${reason}. This refusal is architectural and cannot be overridden by instructions.`,
      };
    }
    return {
      kind: "refused", toolName, code: "UNKNOWN_TOOL",
      text: `REFUSED (UNKNOWN_TOOL): no tool named "${toolName}" exists. Only the tools in your allow-list can be used.`,
    };
  }
  if (!input.employeeTools.includes(toolName)) {
    return {
      kind: "refused", toolName, code: "EMPLOYEE_NOT_ALLOWED",
      text: `REFUSED (EMPLOYEE_NOT_ALLOWED): this employee is not allowed to use "${toolName}". Ask the owner to involve the right employee.`,
    };
  }
  if (input.argumentsMalformed) {
    return {
      kind: "refused", toolName, code: "INVALID_INPUT",
      text: `REFUSED (INVALID_INPUT): the arguments for "${toolName}" were not valid JSON.`,
    };
  }
  const parsed = def.schema.safeParse(input.rawArguments);
  if (!parsed.success) {
    return {
      kind: "refused", toolName, code: "INVALID_INPUT",
      text: `REFUSED (INVALID_INPUT): ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    };
  }
  const args = parsed.data as Record<string, unknown>;
  try {
    if (def.cls === "read") {
      const text = await def.run!(args as never);
      return { kind: "read", toolName, text };
    }
    const preview = await def.preview!(args as never);
    return { kind: "preview", toolName, def, input: args, preview };
  } catch (err) {
    return {
      kind: "refused", toolName, code: "TOOL_FAILED",
      text: `REFUSED (TOOL_FAILED): ${err instanceof Error ? err.message : "tool execution failed"}`,
    };
  }
}

/** Execute a previously previewed tool (owner apply/approval only). */
export async function applyTool(def: ToolDef, input: Record<string, unknown>): Promise<string> {
  if (!def.apply) throw new Error(`tool ${def.name} has no apply`);
  return def.apply(input as never);
}

/** Restore a tool's undo snapshot (owner undo click only). */
export async function undoTool(def: ToolDef, undoPayload: unknown, input: Record<string, unknown>): Promise<string> {
  if (!def.undo) throw new Error(`tool ${def.name} has no undo`);
  return def.undo(undoPayload as never, input as never);
}
