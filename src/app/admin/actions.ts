"use server";

import crypto from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, gte, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  adminUsers,
  aiAgents,
  contactMessages,
  coupons,
  customers,
  orderItems,
  orders,
  products,
  settings as settingsTable,
  ticketMessages,
  tickets,
  webhookEvents,
} from "@/db/schema";
import { getAdminSession, writeAudit } from "@/lib/auth";
import { decryptSecret, encryptSecret, generateTotpSecret, scryptHash, verifyPassword } from "@/lib/crypto";
import { CATEGORIES, LOCALE_CODES, isLocale } from "@/lib/i18n";
import { getSettings, savePayoutDetails, saveSiteSettings, type PayoutDetails } from "@/lib/settings";
import { getAdminStats } from "@/lib/store";
import { refundOrder } from "@/lib/payments";

async function guard() {
  const admin = await getAdminSession();
  if (!admin) redirect("/admin/login");
  return admin;
}

function text(value: unknown, max = 3000): string {
  return String(value ?? "").trim().slice(0, max);
}

function slugify(value: string): string {
  const base = value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return base.length > 2 ? base.slice(0, 60) : `product-${crypto.randomBytes(3).toString("hex")}`;
}

function money(value: unknown): number {
  const num = Number(String(value ?? "0").replace(",", "."));
  return Number.isFinite(num) && num >= 0 ? Math.round(num * 100) : 0;
}

function refreshStorefront() {
  revalidatePath("/", "layout");
  revalidatePath("/catalog");
  revalidatePath("/admin", "layout");
}

/* --------------------------------- products -------------------------------- */

export async function saveProduct(formData: FormData) {
  const admin = await guard();
  const id = Number(formData.get("id") ?? 0);
  const title = text(formData.get("title"), 160);
  if (!title) redirect("/admin/products?state=title_required");
  const payload = {
    title,
    titleEn: text(formData.get("titleEn"), 160) || null,
    subtitle: text(formData.get("subtitle"), 240) || null,
    subtitleEn: text(formData.get("subtitleEn"), 240) || null,
    description: text(formData.get("description"), 6000) || title,
    descriptionEn: text(formData.get("descriptionEn"), 6000) || null,
    category: CATEGORIES.some((category) => category.value === formData.get("category")) ? String(formData.get("category")) : "ebook",
    priceCents: money(formData.get("price")),
    compareAtCents: money(formData.get("compareAt")) || null,
    coverStyle: text(formData.get("coverStyle"), 30) || "nebula",
    coverGlyph: text(formData.get("coverGlyph"), 8) || "✦",
    features: text(formData.get("features"), 2000).split("\n").map((line) => line.trim()).filter(Boolean),
    featuresEn: text(formData.get("featuresEn"), 2000).split("\n").map((line) => line.trim()).filter(Boolean),
    tags: text(formData.get("tags"), 400).split(",").map((tag) => tag.trim()).filter(Boolean),
    format: text(formData.get("format"), 60) || "PDF",
    status: formData.get("status") === "draft" ? "draft" : "active",
    featured: formData.get("featured") === "on",
    downloadLimit: Math.max(1, Math.min(50, Number(formData.get("downloadLimit")) || 5)),
    updatedAt: new Date(),
  };

  let productId = id;
  if (id > 0) {
    await db.update(products).set(payload).where(eq(products.id, id));
  } else {
    const baseSlug = slugify(text(formData.get("slug"), 70) || title);
    let slug = baseSlug;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const clash = await db.select({ id: products.id }).from(products).where(eq(products.slug, slug)).limit(1);
      if (!clash[0]) break;
      slug = `${baseSlug}-${crypto.randomBytes(2).toString("hex")}`;
    }
    const [created] = await db.insert(products).values({ ...payload, slug }).returning();
    productId = created.id;
  }

  const upload = formData.get("file");
  if (upload instanceof File && upload.size > 0) {
    if (upload.size > 30 * 1024 * 1024) redirect("/admin/products?state=file_too_large");
    const extension = (upload.name.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
    const key = `${productId}-${crypto.randomBytes(6).toString("hex")}.${extension}`;
    const directory = path.join(process.cwd(), "storage", "uploads");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, key), Buffer.from(await upload.arrayBuffer()));
    await db
      .update(products)
      .set({ fileKey: key, fileName: upload.name.slice(0, 160), fileSizeKb: Math.round(upload.size / 1024) })
      .where(eq(products.id, productId));
  }

  await writeAudit(id > 0 ? "product.updated" : "product.created", "product", productId, { title, priceCents: payload.priceCents }, admin.email);
  refreshStorefront();
  redirect(`/admin/products?state=saved&edit=${productId}`);
}

export async function deleteProduct(formData: FormData) {
  const admin = await guard();
  const id = Number(formData.get("id") ?? 0);
  if (!id) redirect("/admin/products?state=missing");
  const used = await db.select({ count: sql<number>`count(*)::int` }).from(orderItems).where(eq(orderItems.productId, id));
  if ((used[0]?.count ?? 0) > 0) {
    await db.update(products).set({ status: "draft", featured: false }).where(eq(products.id, id));
    await writeAudit("product.archived", "product", id, { reason: "has_orders" }, admin.email);
    refreshStorefront();
    redirect("/admin/products?state=archived");
  }
  await db.delete(products).where(eq(products.id, id));
  await writeAudit("product.deleted", "product", id, {}, admin.email);
  refreshStorefront();
  redirect("/admin/products?state=deleted");
}

/* --------------------------------- coupons --------------------------------- */

export async function saveCoupon(formData: FormData) {
  const admin = await guard();
  const code = text(formData.get("code"), 40).toUpperCase().replace(/\s+/g, "");
  const kind = formData.get("kind") === "fixed" ? "fixed" : "percent";
  const rawValue = Number(formData.get("value")) || 0;
  if (!code || rawValue <= 0) redirect("/admin/coupons?state=invalid");
  const value = kind === "percent" ? Math.min(90, Math.round(rawValue)) : money(formData.get("value"));
  const expiresRaw = text(formData.get("expiresAt"), 30);
  const maxRaw = Number(formData.get("maxRedemptions")) || 0;
  const payload = {
    code,
    kind,
    value,
    minSubtotalCents: money(formData.get("minSubtotal")),
    maxRedemptions: maxRaw > 0 ? maxRaw : null,
    active: formData.get("active") === "on",
    expiresAt: expiresRaw ? new Date(expiresRaw) : null,
  };
  await db
    .insert(coupons)
    .values(payload)
    .onConflictDoUpdate({ target: coupons.code, set: payload });
  await writeAudit("coupon.saved", "coupon", code, { kind, value }, admin.email);
  refreshStorefront();
  redirect("/admin/coupons?state=saved");
}

export async function toggleCoupon(formData: FormData) {
  const admin = await guard();
  const id = Number(formData.get("id") ?? 0);
  const active = formData.get("active") === "true";
  await db.update(coupons).set({ active }).where(eq(coupons.id, id));
  await writeAudit("coupon.toggled", "coupon", id, { active }, admin.email);
  refreshStorefront();
  redirect("/admin/coupons?state=updated");
}

export async function deleteCoupon(formData: FormData) {
  const admin = await guard();
  const id = Number(formData.get("id") ?? 0);
  await db.delete(coupons).where(eq(coupons.id, id));
  await writeAudit("coupon.deleted", "coupon", id, {}, admin.email);
  refreshStorefront();
  redirect("/admin/coupons?state=deleted");
}

/* ---------------------------------- orders --------------------------------- */

export async function refundOrderAction(formData: FormData) {
  const admin = await guard();
  const number = text(formData.get("orderNumber"), 40);
  const result = await refundOrder(number);
  await writeAudit("order.refund", "order", number, { result }, admin.email);
  revalidatePath("/admin/orders");
  redirect(`/admin/orders?state=${result.ok ? "refunded" : "refund_failed"}&message=${encodeURIComponent(result.message)}`);
}

/* --------------------------------- support --------------------------------- */

export async function replyTicket(formData: FormData) {
  const admin = await guard();
  const ticketId = Number(formData.get("ticketId") ?? 0);
  const body = text(formData.get("message"), 3000);
  if (!ticketId || body.length < 2) redirect("/admin/support?state=invalid");
  const rows = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
  if (!rows[0]) redirect("/admin/support?state=missing");
  await db.insert(ticketMessages).values({ ticketId, author: "support", body });
  await db.update(tickets).set({ status: "answered", updatedAt: new Date() }).where(eq(tickets.id, ticketId));
  await writeAudit("ticket.replied", "ticket", ticketId, { body: body.slice(0, 120) }, admin.email);
  revalidatePath("/admin/support");
  redirect("/admin/support?state=replied");
}

export async function closeTicket(formData: FormData) {
  const admin = await guard();
  const ticketId = Number(formData.get("ticketId") ?? 0);
  await db.update(tickets).set({ status: "closed", updatedAt: new Date() }).where(eq(tickets.id, ticketId));
  await writeAudit("ticket.closed", "ticket", ticketId, {}, admin.email);
  redirect("/admin/support?state=closed");
}

export async function markContactHandled(formData: FormData) {
  const admin = await guard();
  const id = Number(formData.get("id") ?? 0);
  await db.update(contactMessages).set({ handled: true }).where(eq(contactMessages.id, id));
  await writeAudit("contact.handled", "contact", id, {}, admin.email);
  redirect("/admin/support?state=handled#messages");
}

/* ---------------------------------- agents --------------------------------- */

export async function saveAgent(formData: FormData) {
  const admin = await guard();
  const id = Number(formData.get("id") ?? 0);
  const name = text(formData.get("name"), 80);
  if (!name) redirect("/admin/agents?state=invalid");
  const payload = {
    name,
    title: text(formData.get("title"), 120),
    specialty: text(formData.get("specialty"), 300),
    greeting: text(formData.get("greeting"), 600),
    greetingEn: text(formData.get("greetingEn"), 600) || null,
    instructions: text(formData.get("instructions"), 1500),
    glyph: text(formData.get("glyph"), 8) || "✦",
    team: formData.get("team") === "manager" ? "manager" : "customer",
    active: formData.get("active") === "on",
  };
  if (id > 0) {
    await db.update(aiAgents).set(payload).where(eq(aiAgents.id, id));
  } else {
    const slug = `${slugify(name)}-${crypto.randomBytes(2).toString("hex")}`;
    await db.insert(aiAgents).values({
      ...payload,
      slug,
      languages: ["ar", "en"],
      sortOrder: 90,
    });
  }
  await writeAudit(id > 0 ? "agent.updated" : "agent.created", "agent", id || null, { name }, admin.email);
  refreshStorefront();
  redirect("/admin/agents?state=saved");
}

export async function toggleAgent(formData: FormData) {
  const admin = await guard();
  const id = Number(formData.get("id") ?? 0);
  const active = formData.get("active") === "true";
  await db.update(aiAgents).set({ active }).where(eq(aiAgents.id, id));
  await writeAudit("agent.toggled", "agent", id, { active }, admin.email);
  refreshStorefront();
  redirect("/admin/agents?state=updated");
}

/* -------------------------------- site design ------------------------------- */

export async function saveSiteContent(formData: FormData) {
  const admin = await guard();
  const current = await getSettings();
  const enabled = LOCALE_CODES.filter((code) => formData.get(`locale_${code}`) === "on");
  const defaultLocaleRaw = String(formData.get("defaultLocale") ?? current.defaultLocale);
  const defaultLocale = isLocale(defaultLocaleRaw) && enabled.includes(defaultLocaleRaw) ? defaultLocaleRaw : enabled[0] ?? "ar";
  await saveSiteSettings({
    heroTitleAr: text(formData.get("heroTitleAr"), 180) || current.heroTitleAr,
    heroTitleEn: text(formData.get("heroTitleEn"), 180) || current.heroTitleEn,
    heroSubtitleAr: text(formData.get("heroSubtitleAr"), 600) || current.heroSubtitleAr,
    heroSubtitleEn: text(formData.get("heroSubtitleEn"), 600) || current.heroSubtitleEn,
    announcementAr: text(formData.get("announcementAr"), 220) || current.announcementAr,
    announcementEn: text(formData.get("announcementEn"), 220) || current.announcementEn,
    supportEmail: text(formData.get("supportEmail"), 160) || current.supportEmail,
    whatsapp: text(formData.get("whatsapp"), 40) || current.whatsapp,
    instagram: text(formData.get("instagram"), 200) || current.instagram,
    x: text(formData.get("x"), 200) || current.x,
    linkedin: text(formData.get("linkedin"), 200) || current.linkedin,
    aboutAr: text(formData.get("aboutAr"), 2000) || current.aboutAr,
    aboutEn: text(formData.get("aboutEn"), 2000) || current.aboutEn,
    accent: /^#[0-9a-fA-F]{6}$/.test(String(formData.get("accent"))) ? String(formData.get("accent")) : current.accent,
    heroImage: text(formData.get("heroImage"), 200) || current.heroImage,
    taxPercent: Math.max(0, Math.min(30, Number(formData.get("taxPercent")) || 0)),
    taxLabelAr: text(formData.get("taxLabelAr"), 80) || current.taxLabelAr,
    taxLabelEn: text(formData.get("taxLabelEn"), 80) || current.taxLabelEn,
    refundWindowDays: Math.max(0, Math.min(90, Number(formData.get("refundWindowDays")) || 14)),
    invoicePrefix: text(formData.get("invoicePrefix"), 12).toUpperCase() || current.invoicePrefix,
    testMode: formData.get("testMode") === "on",
    defaultLocale,
    enabledLocales: enabled.length > 0 ? enabled : current.enabledLocales,
  });
  await writeAudit("settings.updated", "settings", "site", { sections: ["design", "languages", "tax"] }, admin.email);
  refreshStorefront();
  redirect(`/admin/${String(formData.get("redirectTo") ?? "design")}?state=saved`);
}

/* --------------------------------- payments -------------------------------- */

export async function savePayoutDetailsAction(formData: FormData) {
  const admin = await guard();
  const iban = text(formData.get("iban"), 40).replace(/\s+/g, "").toUpperCase();
  const details: PayoutDetails = {
    accountHolder: text(formData.get("accountHolder"), 120),
    bankName: text(formData.get("bankName"), 120),
    iban,
    swift: text(formData.get("swift"), 20).toUpperCase(),
    country: text(formData.get("country"), 2).toUpperCase() || "SA",
    currency: text(formData.get("currency"), 3).toUpperCase() || "USD",
    taxId: text(formData.get("taxId"), 60),
  };
  if (details.accountHolder.length < 2 || details.bankName.length < 2 || iban.length < 8) {
    redirect("/admin/payments?state=invalid");
  }
  await savePayoutDetails(details);
  await writeAudit("payout.saved", "payout", "bank", { bank: details.bankName, country: details.country }, admin.email);
  redirect("/admin/payments?state=vault_saved");
}

export async function saveGatewayMode(formData: FormData) {
  const admin = await guard();
  const testMode = formData.get("testMode") === "on";
  await saveSiteSettings({ testMode });
  await writeAudit("payments.mode", "settings", "testMode", { testMode }, admin.email);
  redirect("/admin/payments?state=mode_saved");
}

export async function clearPayoutVault() {
  const admin = await guard();
  await db.delete(settingsTable).where(eq(settingsTable.key, "payout_vault"));
  await writeAudit("payout.cleared", "payout", "bank", {}, admin.email);
  redirect("/admin/payments?state=vault_cleared");
}

/* --------------------------------- security -------------------------------- */

export async function changeAdminPassword(formData: FormData) {
  const admin = await guard();
  const current = String(formData.get("currentPassword") ?? "");
  const next = String(formData.get("newPassword") ?? "");
  if (next.length < 10) redirect("/admin/security?state=password_short");
  const rows = await db.select().from(adminUsers).where(eq(adminUsers.id, admin.id)).limit(1);
  if (!rows[0] || !verifyPassword(current, rows[0].passwordHash)) {
    await writeAudit("security.password_failed", "admin", admin.id, {}, admin.email);
    redirect("/admin/security?state=password_invalid");
  }
  await db.update(adminUsers).set({ passwordHash: scryptHash(next) }).where(eq(adminUsers.id, admin.id));
  await writeAudit("security.password_changed", "admin", admin.id, {}, admin.email);
  redirect("/admin/security?state=password_saved");
}

export async function rotateTwoFactor() {
  const admin = await guard();
  const secret = generateTotpSecret();
  await db.update(adminUsers).set({ totpSecret: encryptSecret(secret), totpEnabled: true }).where(eq(adminUsers.id, admin.id));
  await writeAudit("security.totp_rotated", "admin", admin.id, {}, admin.email);
  redirect("/admin/security?state=totp_rotated");
}

export async function revokeAllAdminSessions() {
  const admin = await guard();
  await db.execute(sql`delete from admin_sessions where admin_id = ${admin.id}`);
  await writeAudit("security.sessions_revoked", "admin", admin.id, {}, admin.email);
  redirect("/admin/login");
}

export async function createBackupRecord() {
  const admin = await guard();
  const stats = await getAdminStats();
  await writeAudit(
    "backup.snapshot",
    "database",
    new Date().toISOString(),
    { products: stats.products, orders: stats.paidOrders, customers: stats.customers },
    admin.email,
  );
  redirect("/admin/security?state=backup_created");
}

/* ------------------------------- manager AI -------------------------------- */

type ManagerResult = { reply: string; actions: string[] };

const SECRET_QUERY = /(iban|swift|بطاق|iban|مفتاح|key|password|كلمة المرور|رقم الحساب|بيانات.*بنك)/i;

function extractQuoted(input: string): string | null {
  const quoted = input.match(/[«"“'‘]([^»"”'’]{2,90})[»"”'’]/);
  return quoted ? quoted[1].trim() : null;
}

async function findProductByName(term: string) {
  const clean = term.replace(/(بسعر|price|إلى|to|=).*$/i, "").trim();
  const rows = await db
    .select()
    .from(products)
    .where(or(ilike(products.title, `%${clean}%`), ilike(products.titleEn, `%${clean}%`)))
    .limit(1);
  return rows[0] ?? null;
}

export async function runManagerCommand(command: string): Promise<ManagerResult> {
  const admin = await guard();
  const input = command.trim().slice(0, 1200);
  if (input.length < 3) return { reply: "اكتب أمرًا واضحًا، مثال: أضف منتج «دليل الإنتاجية» بسعر 39", actions: [] };
  if (SECRET_QUERY.test(input) && /(أعطني|اعرض|اطبع|show|print|reveal|أرسل)/i.test(input)) {
    await writeAudit("ai.secret_request_blocked", "security", null, { command: input.slice(0, 200) }, admin.email);
    return {
      reply:
        "لن أطبع بيانات الحساب البنكي أو المفاتيح السرية في المحادثة حتى لو طلبتها. تجدها داخل مكتب المدير ← الدفع، مع إخفاء جزئي. المفاتيح الحساسة تبقى في متغيرات بيئة الخادم فقط.",
      actions: ["تم رفض الطلب وتسجيله في سجل الأمان"],
    };
  }

  const actions: string[] = [];

  // Add a product
  if (/(أضف|اضف|أنشئ|انشئ|create|add).*(منتج|product)/i.test(input)) {
    const title = extractQuoted(input) ?? input.replace(/.*(?:باسم|named|عن)\s*/i, "").split(/بسعر|price|في تصنيف/i)[0].trim();
    const priceMatch = input.match(/(?:بسعر|price|بـ|for)\s*([0-9]+(?:[.,][0-9]{1,2})?)/i) ?? input.match(/([0-9]+(?:[.,][0-9]{1,2})?)\s*(?:دولار|usd|\$)/i);
    const price = priceMatch ? money(priceMatch[1]) : 2900;
    if (!title || title.length < 2) return { reply: "حدد اسم المنتج بين علامتي تنصيص، مثال: أضف منتج «دليل الإنتاجية» بسعر 39", actions };
    const category = CATEGORIES.find((item) => input.toLowerCase().includes(item.en.toLowerCase()) || input.includes(item.ar))?.value ?? "ebook";
    const slugBase = slugify(title);
    let slug = slugBase;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const clash = await db.select({ id: products.id }).from(products).where(eq(products.slug, slug)).limit(1);
      if (!clash[0]) break;
      slug = `${slugBase}-${crypto.randomBytes(2).toString("hex")}`;
    }
    const categoryMeta = CATEGORIES.find((item) => item.value === category);
    const [created] = await db
      .insert(products)
      .values({
        slug,
        title,
        titleEn: null,
        subtitle: `إصدار رقمي من فئة ${categoryMeta?.ar ?? "كتب إلكترونية"} جاهز للتحميل الفوري`,
        subtitleEn: `A digital ${categoryMeta?.en ?? "edition"} release with instant delivery`,
        description: `${title} — إصدار رقمي يقدّمه Astralium Digitale Store. صُمم هذا المنتج ليمنحك نتيجة عملية سريعة: محتوى منظّم، أمثلة قابلة للتطبيق، وخطوات واضحة تمشي عليها من أول جلسة.\n\nتحصل معه على ترخيص شخصي، وتحديثات للملفات داخل نفس الإصدار، وروابط تحميل آمنة مع كل مشترٍ.`,
        descriptionEn: `${title} — a digital release from Astralium Digitale Store, built to deliver a practical outcome: structured content, applicable examples and clear steps from the first session.\n\nIncludes a personal licence, in-edition file updates and secure per-buyer download links.`,
        category,
        priceCents: price,
        coverStyle: "nebula",
        coverGlyph: categoryMeta?.glyph ?? "✦",
        features: ["ملف رقمي كامل", "ترخيص شخصي", "تحميل فوري", "تحديثات الإصدار"],
        featuresEn: ["Complete digital file", "Personal licence", "Instant delivery", "Edition updates"],
        tags: [categoryMeta?.en ?? "digital", "astralium"],
        format: "PDF",
        status: "draft",
        featured: false,
      })
      .returning();
    await writeAudit("ai.product_created", "product", created.id, { title, priceCents: price }, admin.email);
    refreshStorefront();
    return {
      reply: `تم إنشاء المسودة «${title}» بسعر ${(price / 100).toFixed(2)} USD في تصنيف ${categoryMeta?.ar}. الصفحة: /product/${slug}\nالمنتج في حالة مسودة: افتح صفحة المنتجات، راجع الوصف، ارفع الملف، ثم انشره.`,
      actions: [`إنشاء منتج #${created.id}`, "حفظ كمسودة", "تجهيز وصف عربي/إنجليزي"],
    };
  }

  // Change price
  if (/(سعر|price)/i.test(input) && /(غيّر|غير|عدّل|عدل|حدّث|update|change|set)/i.test(input)) {
    const quoted = extractQuoted(input);
    const namePart = quoted ?? input.replace(/.*(?:سعر|price)\s*/i, "").split(/إلى|to|=|بـ/i)[0].trim();
    const target = await findProductByName(namePart);
    const valueMatch = input.match(/(?:إلى|to|=|بـ)\s*([0-9]+(?:[.,][0-9]{1,2})?)/i) ?? input.match(/([0-9]+(?:[.,][0-9]{1,2})?)\s*(?:دولار|usd|\$)/i);
    if (!target) return { reply: "لم أجد منتجًا بهذا الاسم. اكتب جزءًا من الاسم الحقيقي كما يظهر في الكتالوج.", actions };
    if (!valueMatch) return { reply: `وجدت «${target.title}» بسعر ${(target.priceCents / 100).toFixed(2)} USD. حدد السعر الجديد: مثال: غيّر سعر «${target.title}» إلى 29`, actions };
    const newPrice = money(valueMatch[1]);
    await db.update(products).set({ priceCents: newPrice, updatedAt: new Date() }).where(eq(products.id, target.id));
    await writeAudit("ai.product_price", "product", target.id, { from: target.priceCents, to: newPrice }, admin.email);
    refreshStorefront();
    return { reply: `تم تحديث سعر «${target.title}» من ${(target.priceCents / 100).toFixed(2)} إلى ${(newPrice / 100).toFixed(2)} USD.`, actions: [`تعديل سعر المنتج #${target.id}`] };
  }

  // Create coupon
  if (/(كوبون|coupon|خصم)/i.test(input) && /(أنشئ|انشئ|اعمل|create|make)/i.test(input)) {
    const codeMatch = input.match(/(?:كوبون|coupon)\s*[«"']?([A-Za-z0-9_-]{3,24})/i);
    const valueMatch = input.match(/([0-9]{1,3})\s*%/) ?? input.match(/(?:بنسبة|بقيمة|بـ|value)\s*([0-9]{1,4}(?:[.,][0-9]{1,2})?)/i);
    if (!codeMatch || !valueMatch) return { reply: "الصيغة: أنشئ كوبون SAVE20 بنسبة 20", actions };
    const code = codeMatch[1].toUpperCase();
    const isPercent = /%|نسبة|percent/i.test(input);
    const value = isPercent ? Math.min(90, Math.round(Number(valueMatch[1]))) : money(valueMatch[1]);
    const payload = { code, kind: isPercent ? "percent" : "fixed", value, active: true };
    await db.insert(coupons).values(payload).onConflictDoUpdate({ target: coupons.code, set: payload });
    await writeAudit("ai.coupon_created", "coupon", code, payload, admin.email);
    refreshStorefront();
    return {
      reply: `تم إنشاء الكوبون ${code}: ${isPercent ? `${value}% خصم` : `${(value / 100).toFixed(2)} USD خصم`}. يعمل فورًا عند الدفع ويظهر في صفحة العروض.`,
      actions: [`إنشاء كوبون ${code}`, "تفعيل فوري"],
    };
  }

  // Sales analysis
  if (/(مبيعات|إيرادات|ايرادات|تحليل|sales|revenue|analysis)/i.test(input)) {
    const stats = await getAdminStats();
    const top = stats.topProducts
      .map((entry) => `• ${entry.product.title} — ${entry.sold} نسخة`)
      .join("\n");
    const providers = stats.byProvider.map((entry) => `${entry.provider}: ${(entry.revenue / 100).toFixed(2)} USD / ${entry.count} طلب`).join(" · ");
    return {
      reply: `تحليل المبيعات الحالي:\n• الإيرادات المؤكدة: ${(stats.revenueCents / 100).toFixed(2)} USD من ${stats.paidOrders} طلبًا\n• متوسط قيمة الطلب: ${(stats.aovCents / 100).toFixed(2)} USD\n• طلبات معلّقة/فاشلة: ${stats.pendingOrders}\n• مسترجعات: ${(stats.refundedCents / 100).toFixed(2)} USD (${stats.refundedOrders})\n• العملاء المسجلون: ${stats.customers} · المنتجات: ${stats.products}\n${top ? `\nالأكثر مبيعًا:\n${top}` : ""}\n${providers ? `\nتوزيع البوابات: ${providers}` : ""}\n\nالتوصية: ركّز عرضًا محدودًا على المنتج الأكثر مبيعًا واختبر زيادة 10% على السعر لقياس المرونة.`,
      actions: ["قراءة إحصائيات الطلبات", "ترتيب المنتجات بالمبيعات", "صياغة توصية تجارية"],
    };
  }

  // Payment monitoring
  if (/(دفع|مدفوعات|payment|بوابة|webhook)/i.test(input)) {
    const [pending, failed, events] = await Promise.all([
      db.select().from(orders).where(eq(orders.status, "pending")).limit(5),
      db.select().from(orders).where(eq(orders.status, "failed")).limit(5),
      db.select().from(webhookEvents).orderBy(sql`${webhookEvents.createdAt} desc`).limit(5),
    ]);
    return {
      reply: `مراقبة المدفوعات:\n• طلبات معلّقة: ${pending.length}${pending.length ? ` (${pending.map((order) => order.orderNumber).join(", ")})` : ""}\n• طلبات فاشلة: ${failed.length}${failed.length ? ` (${failed.map((order) => order.orderNumber).join(", ")})` : ""}\n• آخر أحداث البوابات: ${events.length ? events.map((event) => `${event.provider}/${event.kind}`).join(" · ") : "لا أحداث مسجلة"}\n\nملاحظة: أي طلب يبقى معلّقًا أكثر من 30 دقيقة يُراجع يدويًا من صفحة الطلبات قبل أي تسليم.`,
      actions: ["فحص الطلبات المعلّقة", "فحص أحداث Webhook"],
    };
  }

  // Tickets & customer requests
  if (/(تذاكر|دعم|شكاوى|tickets|support|requests)/i.test(input)) {
    const open = await db.select().from(tickets).where(inArray(tickets.status, ["open", "answered"])).limit(8);
    return {
      reply: `مراجعة طلبات العملاء:\n${open.length ? open.map((ticket) => `• ${ticket.ticketNumber} — ${ticket.subject} (${ticket.status})`).join("\n") : "لا توجد تذاكر مفتوحة."}\n\nافتح صفحة الدعم للرد على كل تذكرة؛ سيصل الرد إلى بريد العميل من نفس الرقم المرجعي.`,
      actions: ["قراءة تذاكر الدعم", "تجهيز قائمة الأولويات"],
    };
  }

  // Write content / ads
  if (/(اكتب|صياغة|إعلان|اعلان|وصف|write|copy|ad)/i.test(input)) {
    const quoted = extractQuoted(input);
    const namePart = quoted ?? input.replace(/.*(?:لـ|ل|for)\s*/i, "").trim();
    const target = namePart.length > 2 ? await findProductByName(namePart) : null;
    const subject = target?.title ?? quoted ?? "إصدارات Astralium الرقمية";
    const price = target ? `${(target.priceCents / 100).toFixed(2)} USD` : "ابتداءً من 19 USD";
    return {
      reply: `نص جاهز للنشر عن «${subject}»:\n\n١) العنوان: ${subject} — نتيجة عملية من أول جلسة.\n٢) الوصف القصير: ${target?.subtitle ?? "محتوى منظّم وأدوات قابلة للتطبيق، بتسليم فوري وترخيص واضح"}.\n٣) الوصف الممتد: ${subject} صُمم لمن يريد نتيجة واضحة لا محتوى إضافي. تحصل على ملفات منظمة، أمثلة قابلة للتطبيق فورًا، وتحديثات داخل الإصدار — بسعر ${price} ووصول دائم.\n٤) إعلان قصير: ${subject}. تسليم فوري. ترخيص واضح. ${price}. من Astralium Digitale Store.\n٥) دعوة الشراء: ابدأ الآن وستجد ملفك في حسابك بعد تأكيد الدفع.`,
      actions: ["صياغة عنوان ووصف وإعلان", "الاعتماد على بيانات الكتالوج الفعلية"],
    };
  }

  // Design suggestions
  if (/(تصميم|design|ألوان|colors|تحسين)/i.test(input)) {
    const current = await getSettings();
    return {
      reply: `مراجعة التصميم الحالية:\n• اللون الأساسي ${current.accent} على خلفية داكنة — التباين مناسب للنصوص الكبيرة، تأكد من عدم استخدامه في نص صغير.\n• صورة الواجهة: ${current.heroImage} — يُفضّل صورة داكنة مع مساحة فارغة للنص.\n• عنوان الواجهة بطول ${current.heroTitleAr.length} حرفًا؛ المثالي أقل من 60 حرفًا.\n• إعلان الشريط العلوي ${current.announcementAr.length} حرفًا؛ الأفضل أقل من 90.\n\nخطوات مقترحة: ثبّت العرض على شاشة 390px، اختبر زر الشراء بيد واحدة، وأضف تقييمات المنتج فوق الطية.`,
      actions: ["قراءة إعدادات التصميم", "فحص أطوال النصوص"],
    };
  }

  return {
    reply:
      "أنا مساعدك الإداري. الأوامر المدعومة: \n• أضف منتج «العنوان» بسعر 39\n• غيّر سعر «العنوان» إلى 29\n• أنشئ كوبون SAVE20 بنسبة 20\n• تحليل المبيعات\n• راقب المدفوعات\n• راجع تذاكر الدعم\n• اكتب إعلان لـ«العنوان»\n• اقترح تحسينات تصميم\nكل تنفيذ يُسجَّل في سجل العمليات، والعمليات الحساسة تُنفَّذ بصلاحية المالك فقط.",
    actions: ["عرض قائمة الأوامر المدعومة"],
  };
}

export async function loadRecentConversations() {
  await guard();
  const rows = await db
    .select()
    .from(contactMessages)
    .orderBy(sql`${contactMessages.createdAt} desc`)
    .limit(5);
  return rows.map((row) => ({ id: row.id, subject: row.subject, handled: row.handled }));
}

export async function getManagerSnapshot() {
  await guard();
  const [latestCustomers, failedEvents] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(customers).where(gte(customers.createdAt, new Date(Date.now() - 7 * 864e5))),
    db.select({ count: sql<number>`count(*)::int` }).from(webhookEvents).where(and(eq(webhookEvents.status, "processed"), gte(webhookEvents.createdAt, new Date(Date.now() - 7 * 864e5)))),
  ]);
  return { newCustomers: latestCustomers[0]?.count ?? 0, gatewayEvents: failedEvents[0]?.count ?? 0 };
}

export async function revealTotpSecret(): Promise<string | null> {
  const admin = await guard();
  const rows = await db.select().from(adminUsers).where(eq(adminUsers.id, admin.id)).limit(1);
  if (!rows[0]) return null;
  const secret = decryptSecret(rows[0].totpSecret);
  await writeAudit("security.totp_revealed", "admin", admin.id, {}, admin.email);
  return secret || null;
}
