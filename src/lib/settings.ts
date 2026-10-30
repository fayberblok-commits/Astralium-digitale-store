import { db } from "@/db";
import { settings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { decryptSecret, encryptSecret, maskSecret } from "@/lib/crypto";
import { LOCALE_CODES } from "@/lib/i18n";

export type SiteSettings = {
  heroTitleAr: string;
  heroTitleEn: string;
  heroSubtitleAr: string;
  heroSubtitleEn: string;
  announcementAr: string;
  announcementEn: string;
  supportEmail: string;
  whatsapp: string;
  instagram: string;
  x: string;
  linkedin: string;
  aboutAr: string;
  aboutEn: string;
  accent: string;
  heroImage: string;
  defaultLocale: string;
  enabledLocales: string[];
  taxPercent: number;
  taxLabelAr: string;
  taxLabelEn: string;
  testMode: boolean;
  refundWindowDays: number;
  invoicePrefix: string;
  backupNote: string;
};

export type PayoutDetails = {
  accountHolder: string;
  bankName: string;
  iban: string;
  swift: string;
  country: string;
  currency: string;
  taxId: string;
};

export const DEFAULT_SITE: SiteSettings = {
  heroTitleAr: "معرفة فاخرة، تُسلَّم لك في لحظتها",
  heroTitleEn: "Luxury knowledge, delivered instantly",
  heroSubtitleAr:
    "مكتبة رقمية منتقاة من الكتب الإلكترونية والصوتية، القوالب، الدورات، البرمجيات والأصول البصرية — تسليم فوري، ترخيص واضح، ودفع محمي.",
  heroSubtitleEn:
    "A curated digital library of ebooks, audiobooks, templates, courses, software and visual assets — instant delivery, clear licensing and protected payment.",
  announcementAr: "تحميل فوري بعد الدفع • دعم بلغتك • ترخيص استخدام تجاري متاح",
  announcementEn: "Instant delivery after payment • Support in your language • Commercial licensing available",
  supportEmail: "care@astralium.store",
  whatsapp: "+966500000000",
  instagram: "https://instagram.com/astralium.store",
  x: "https://x.com/astraliumstore",
  linkedin: "https://linkedin.com/company/astralium-store",
  aboutAr:
    "Astralium Digitale Store بيت رقمي مستقل يقدّم معرفة وأدوات مختارة بعناية للمبدعين وأصحاب المشاريع. نعمل بمعايير تحرير صارمة: كل منتج يخضع لمراجعة الجودة، ولكل ترخيص نطاق استخدام واضح، ولكل عميل حق الوصول الدائم إلى ما اشتراه.",
  aboutEn:
    "Astralium Digitale Store is an independent digital house offering carefully curated knowledge and tools for creators and founders. Every product is quality reviewed, every licence has a clear scope, and every customer keeps lifetime access to their purchase.",
  accent: "#d9b26a",
  heroImage: "/images/hero-nebula.jpg",
  defaultLocale: "ar",
  enabledLocales: LOCALE_CODES,
  taxPercent: 0,
  taxLabelAr: "ضريبة القيمة المضافة",
  taxLabelEn: "VAT",
  testMode: true,
  refundWindowDays: 14,
  invoicePrefix: "AST",
  backupNote: "نسخة احتياطية مشفّرة تُنشأ تلقائيًا كل 24 ساعة على مستوى قاعدة البيانات.",
};

export async function getSettings(): Promise<SiteSettings> {
  try {
    const rows = await db.select().from(settings).where(eq(settings.key, "site"));
    const stored = (rows[0]?.value ?? {}) as Partial<SiteSettings>;
    return { ...DEFAULT_SITE, ...stored };
  } catch {
    return DEFAULT_SITE;
  }
}

export async function saveSiteSettings(patch: Partial<SiteSettings>): Promise<SiteSettings> {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await db
    .insert(settings)
    .values({ key: "site", value: next as unknown as Record<string, unknown> })
    .onConflictDoUpdate({ target: settings.key, set: { value: next as unknown as Record<string, unknown>, updatedAt: new Date() } });
  return next;
}

/* ------------------------------ owner payout vault --------------------------- */

export async function savePayoutDetails(details: PayoutDetails): Promise<void> {
  const encrypted = encryptSecret(JSON.stringify(details));
  await db
    .insert(settings)
    .values({ key: "payout_vault", value: { encrypted } })
    .onConflictDoUpdate({ target: settings.key, set: { value: { encrypted }, updatedAt: new Date() } });
}

export async function getPayoutDetails(): Promise<PayoutDetails | null> {
  const rows = await db.select().from(settings).where(eq(settings.key, "payout_vault"));
  const encrypted = (rows[0]?.value as { encrypted?: string } | undefined)?.encrypted;
  if (!encrypted) return null;
  try {
    const parsed = JSON.parse(decryptSecret(encrypted)) as PayoutDetails;
    if (!parsed || !parsed.accountHolder) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function getMaskedPayoutDetails(): Promise<Record<string, string> | null> {
  const details = await getPayoutDetails();
  if (!details) return null;
  return {
    accountHolder: maskSecret(details.accountHolder, 3),
    bankName: details.bankName,
    iban: maskSecret(details.iban, 4),
    swift: maskSecret(details.swift, 3),
    country: details.country,
    currency: details.currency,
    taxId: details.taxId ? maskSecret(details.taxId, 3) : "—",
  };
}

export function gatewayEnvStatus() {
  return {
    stripe: Boolean(process.env.STRIPE_SECRET_KEY),
    stripeWebhook: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
    paypal: Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET),
    paypalWebhook: Boolean(process.env.PAYPAL_WEBHOOK_ID),
    paypalMode: process.env.PAYPAL_ENV === "live" ? "live" : "sandbox",
    email: Boolean(process.env.RESEND_API_KEY),
    ai: Boolean(process.env.OPENAI_API_KEY),
  } as const;
}
