import { NextRequest, NextResponse } from "next/server";
import { recordAudit, requireAdmin } from "../../../../lib/team";
import { adminCreateProduct, adminUpdateProduct, listAdminProducts, sanitizeNewProduct, type ProductPatch } from "../../../../lib/catalog";
import { z } from "zod";
import { httpErrorResponse, readJsonBody } from "../../../../lib/http";

export const runtime = "nodejs";

/**
 * Admin product edits (Phase 1 upgrade, F2). The storefront's source of
 * truth is the database when configured (else the .data overlay):
 * a PATCH here changes what home/shop/product/search render — no file
 * edit, no redeploy. Reads need "read"; writes need "content".
 * Inputs are zod-validated (§3).
 */
const patchSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().trim().min(1).max(200).optional(),
  priceUSD: z.number().min(0).max(1_000_000).optional(),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,80}$/).optional(),
  active: z.boolean().optional(),
  subtitle: z.string().max(300).optional(),
  description: z.string().max(5000).optional(),
  // Phase 4 upgrade: office product manager fields.
  category: z.string().trim().min(1).max(80).nullable().optional(),
  compareAtUSD: z.number().min(0).max(1_000_000).nullable().optional(),
  badge: z.enum(["bestseller", "new"]).nullable().optional(),
  language: z.string().trim().min(2).max(5).nullable().optional(),
  costUSD: z.number().min(0).max(1_000_000).optional(),
  publishAt: z.string().max(40).nullable().optional(),
  priceOverrides: z.record(z.string().max(3), z.number().min(0).max(1_000_000)).nullable().optional(),
  translations: z.record(z.string().max(5), z.object({
    title: z.string().max(300).optional(),
    subtitle: z.string().max(600).optional(),
    description: z.string().max(20_000).optional(),
  })).nullable().optional(),
}).strict();

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req, "read");
  if ("error" in auth) return auth.error;
  const { products, inactiveIds, source } = await listAdminProducts();
  return NextResponse.json({
    source,
    products: products.map((p) => ({ ...p, active: !inactiveIds.includes(p.id) })),
  });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin(req, "content");
  if ("error" in auth) return auth.error;
  let raw: unknown;
  try {
    raw = await readJsonBody(req, { maxBytes: 16 * 1024 });
  } catch (err) {
    return httpErrorResponse(err);
  }
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_PRODUCT_PATCH", issues: parsed.error.issues.map((i) => i.path.join(".")) }, { status: 400 });
  }
  const { id, ...patch } = parsed.data;
  const result = await adminUpdateProduct(id, patch as ProductPatch);
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "UPDATE_FAILED" }, { status: 400 });
  }
  await recordAudit({
    actor: auth.actor,
    action: "product.update",
    target: id,
    detail: { fields: Object.keys(patch), persisted: result.persisted },
  });
  return NextResponse.json({ ok: true, persisted: result.persisted });
}

/**
 * Create / duplicate (Phase 4 upgrade, item 4). Needs "content".
 * Duplicate clones the source product's fields under a new id+slug,
 * created INACTIVE so the owner reviews it before it sells.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, "content");
  if ("error" in auth) return auth.error;
  let body: { action?: string; product?: unknown; sourceId?: string; id?: string; slug?: string; title?: string } | null;
  try {
    body = await readJsonBody(req, { maxBytes: 64 * 1024 });
  } catch (err) {
    return httpErrorResponse(err);
  }
  if (body?.action === "duplicate") {
    const { products } = await listAdminProducts();
    const source = products.find((p) => p.id === body.sourceId);
    if (!source) return NextResponse.json({ error: "SOURCE_NOT_FOUND" }, { status: 404 });
    const input = sanitizeNewProduct({
      id: body.id ?? `p-${body.slug ?? `${source.slug}-copy`}`,
      slug: body.slug ?? `${source.slug}-copy`,
      title: body.title ?? `${source.title} (copy)`,
      priceUSD: source.priceUSD,
      category: source.category,
      subtitle: source.subtitle,
      description: source.description,
    });
    if (!input) return NextResponse.json({ error: "INVALID_PRODUCT" }, { status: 400 });
    const result = await adminCreateProduct(input, { duplicateOf: source, active: false });
    if (!result.ok) return NextResponse.json({ error: result.error ?? "CREATE_FAILED" }, { status: 400 });
    await recordAudit({ actor: auth.actor, action: "product.duplicate", target: input.id, detail: { sourceId: source.id, persisted: result.persisted } });
    return NextResponse.json({ ok: true, id: input.id, persisted: result.persisted });
  }
  if (body?.action === "create") {
    const input = sanitizeNewProduct(body.product);
    if (!input) return NextResponse.json({ error: "INVALID_PRODUCT" }, { status: 400 });
    const result = await adminCreateProduct(input);
    if (!result.ok) return NextResponse.json({ error: result.error ?? "CREATE_FAILED" }, { status: 400 });
    await recordAudit({ actor: auth.actor, action: "product.create", target: input.id, detail: { slug: input.slug, persisted: result.persisted } });
    return NextResponse.json({ ok: true, id: input.id, persisted: result.persisted });
  }
  return NextResponse.json({ error: "UNKNOWN_ACTION" }, { status: 400 });
}
