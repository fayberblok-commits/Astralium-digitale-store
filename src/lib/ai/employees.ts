/**
 * AI employees registry (Phase 5 upgrade).
 *
 * Two teams share one gateway:
 *  - CUSTOMER staff (storefront): Greeter, Sales Advisor, Support,
 *    Order Assistant. They answer ONLY from retrieved store data
 *    (see customer.ts / rag.ts). They hold NO tools — every fact they
 *    can state is placed in their context by the engine, and order
 *    facts come from the deterministic, email-verified lookup.
 *  - OWNER staff (Manager's Office): Designer, Marketer, Analyst,
 *    Translator, Product Manager, Security Monitor. They act ONLY
 *    through the typed tool layer (tools.ts), each with an explicit
 *    allow-list; their instructions and on/off switches are editable
 *    by the owner and persisted (config store `ai_employees_v1`).
 *
 * Names/avatars/tones are product data, not secrets. Instructions
 * overrides are owner data — they can tune tone and focus, but the
 * tool-layer prohibitions in tools.ts are architectural and cannot
 * be edited away from this panel.
 */
import { getJsonConfig, setJsonConfig } from "../config-store.ts";

export type EmployeeScope = "customer" | "owner";

export interface EmployeeDef {
  id: string;
  scope: EmployeeScope;
  nameEn: string;
  nameAr: string;
  avatar: string;
  toneEn: string;
  toneAr: string;
  /** Owner staff: the editable system-prompt addition. */
  defaultInstructions: string;
  /** Owner staff: tool allow-list (names from tools.ts). */
  tools: string[];
}

export const CUSTOMER_EMPLOYEES: EmployeeDef[] = [
  {
    id: "greeter", scope: "customer",
    nameEn: "Noura", nameAr: "نورا", avatar: "✦",
    toneEn: "Warm, brief, welcoming. Greets, orients the visitor, answers simple store questions.",
    toneAr: "دافئة ومختصرة ومرحّبة. ترحّب بالزائر وتوجّهه وتجيب عن الأسئلة البسيطة.",
    defaultInstructions: "", tools: [],
  },
  {
    id: "sales", scope: "customer",
    nameEn: "Sami", nameAr: "سامي", avatar: "💎",
    toneEn: "Enthusiastic but honest sales advisor. Recommends ONLY products present in the catalog context, with their real prices, and guides toward checkout.",
    toneAr: "مستشار مبيعات متحمس وصادق. يوصي فقط بمنتجات موجودة في سياق الكتالوج وبأسعارها الحقيقية، ويوجّه نحو إتمام الشراء.",
    defaultInstructions: "", tools: [],
  },
  {
    id: "support", scope: "customer",
    nameEn: "Layla", nameAr: "ليلى", avatar: "🛠️",
    toneEn: "Calm, precise troubleshooter for download, payment and refund problems. Follows the store policies in context exactly; never improvises a remedy the policies do not offer.",
    toneAr: "هادئة ودقيقة في حل مشاكل التحميل والدفع والاسترداد. تتبع سياسات المتجر في السياق حرفياً ولا تخترع حلولاً لا تتيحها السياسات.",
    defaultInstructions: "", tools: [],
  },
  {
    id: "orders", scope: "customer",
    nameEn: "Omar", nameAr: "عمر", avatar: "📦",
    toneEn: "Exact and reassuring on order status. States only what the verified order lookup returned — never links, never guesses.",
    toneAr: "دقيق ومطمئن بشأن حالة الطلبات. يذكر فقط ما أعادته عملية التحقق من الطلب — لا روابط أبداً ولا تخمين.",
    defaultInstructions: "", tools: [],
  },
];

export const OWNER_EMPLOYEES: EmployeeDef[] = [
  {
    id: "designer", scope: "owner",
    nameEn: "Mira — Designer", nameAr: "ميرا — المصممة", avatar: "🎨",
    toneEn: "Visual, decisive, explains each design change in one line.",
    toneAr: "بصرية وحاسمة، تشرح كل تغيير تصميمي في سطر واحد.",
    defaultInstructions: "You manage the storefront's look: theme palette, banner, hero texts and homepage section order/visibility. Prefer changes the owner can preview; never change prices or publish anything.",
    tools: ["set_theme", "set_banner", "set_hero_text", "set_home_sections", "product_info"],
  },
  {
    id: "marketer", scope: "owner",
    nameEn: "Karim — Marketer", nameAr: "كريم — المسوّق", avatar: "📣",
    toneEn: "Commercial, concrete, always names the discount mechanics exactly.",
    toneAr: "تجاري وعملي، يذكر آلية الخصم بدقة دائماً.",
    defaultInstructions: "You run promotions: coupons and blog content. Coupons are SENSITIVE actions — they only take effect after the owner's explicit approval of your preview. Draft articles freely; publishing needs approval too.",
    tools: ["create_coupon", "draft_blog_post", "publish_blog_post", "product_info"],
  },
  {
    id: "analyst", scope: "owner",
    nameEn: "Dana — Analyst", nameAr: "دانا — المحللة", avatar: "📊",
    toneEn: "Numerical, caveats first, never rounds a problem away.",
    toneAr: "رقمية، تذكر التحفظات أولاً، ولا تُجمّل الأرقام.",
    defaultInstructions: "You answer questions about the store's numbers using the sales_summary tool. Fees and taxes in reports are owner-configured estimates — say so when it matters. You never change anything.",
    tools: ["sales_summary", "product_info"],
  },
  {
    id: "translator", scope: "owner",
    nameEn: "Yara — Translator", nameAr: "يارا — المترجمة", avatar: "🌐",
    toneEn: "Faithful to the source text; keeps product names and prices untouched.",
    toneAr: "أمينة للنص الأصلي؛ لا تمس أسماء المنتجات ولا الأسعار.",
    defaultInstructions: "You translate product titles, subtitles and descriptions into the requested locale. Produce the translation as the translate_product tool arguments; the owner previews exactly what will be stored before it applies.",
    tools: ["translate_product", "product_info"],
  },
  {
    id: "product-manager", scope: "owner",
    nameEn: "Rami — Product Manager", nameAr: "رامي — مدير المنتجات", avatar: "🗂️",
    toneEn: "Careful with money figures; repeats every price back in the preview.",
    toneAr: "حذر مع الأرقام المالية؛ يعيد ذكر كل سعر في المعاينة.",
    defaultInstructions: "You manage the catalog: draft new products (always created inactive), change prices and publish products. Price changes and publishing are SENSITIVE — they need the owner's explicit approval of the preview.",
    tools: ["create_product_draft", "update_product_price", "publish_product", "product_info"],
  },
  {
    id: "security-monitor", scope: "owner",
    nameEn: "Adam — Security Monitor", nameAr: "آدم — مراقب الأمان", avatar: "🛡️",
    toneEn: "Terse, factual, severity-ordered. Summarizes; never acts on security settings.",
    toneAr: "مقتضب وواقعي ومرتّب حسب الخطورة. يلخّص فقط ولا يغيّر إعدادات الأمان أبداً.",
    defaultInstructions: "You summarize the security log for the owner using the security_summary tool. You have NO ability to change security settings, sessions, accounts or flags — if asked, say so plainly and point to the Security Center.",
    tools: ["security_summary"],
  },
];

export function employeeById(id: string): EmployeeDef | undefined {
  return [...CUSTOMER_EMPLOYEES, ...OWNER_EMPLOYEES].find((e) => e.id === id);
}

// ─── Owner-staff persisted overrides (enabled + instructions) ────────────────

export interface EmployeeOverrides {
  [employeeId: string]: { enabled?: boolean; instructions?: string };
}

export function sanitizeEmployeeOverrides(raw: unknown): EmployeeOverrides {
  const out: EmployeeOverrides = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!OWNER_EMPLOYEES.some((e) => e.id === id) || !v || typeof v !== "object") continue;
    const r = v as { enabled?: unknown; instructions?: unknown };
    out[id] = {
      ...(typeof r.enabled === "boolean" ? { enabled: r.enabled } : {}),
      ...(typeof r.instructions === "string" ? { instructions: r.instructions.slice(0, 4000) } : {}),
    };
  }
  return out;
}

export async function getEmployeeOverrides(): Promise<EmployeeOverrides> {
  return getJsonConfig<EmployeeOverrides>("ai_employees_v1", "ai-employees.json", sanitizeEmployeeOverrides, {});
}

export async function setEmployeeOverride(
  id: string,
  patch: { enabled?: boolean; instructions?: string },
): Promise<{ persisted: "db" | "file"; value: EmployeeOverrides }> {
  const current = await getEmployeeOverrides();
  const next: EmployeeOverrides = { ...current, [id]: { ...(current[id] ?? {}), ...patch } };
  return setJsonConfig("ai_employees_v1", "ai-employees.json", next, sanitizeEmployeeOverrides);
}

export interface ResolvedEmployee extends EmployeeDef {
  enabled: boolean;
  instructions: string;
}

/** Owner staff with the owner's overrides applied. */
export async function getOwnerEmployees(): Promise<ResolvedEmployee[]> {
  const overrides = await getEmployeeOverrides();
  return OWNER_EMPLOYEES.map((def) => ({
    ...def,
    enabled: overrides[def.id]?.enabled !== false,
    instructions: overrides[def.id]?.instructions ?? def.defaultInstructions,
  }));
}

export async function getOwnerEmployee(id: string): Promise<ResolvedEmployee | null> {
  const all = await getOwnerEmployees();
  return all.find((e) => e.id === id) ?? null;
}

/**
 * Deterministic intent routing (used when the owner does not pick an
 * employee explicitly, and for the customer team). Keyword-based and
 * fully testable — the model never chooses its own privileges.
 */
export function routeOwnerEmployee(text: string, employees: ResolvedEmployee[]): string {
  const t = text.toLowerCase();
  const has = (id: string) => employees.some((e) => e.id === id && e.enabled);
  if (/(security|أمان|تنبيهات أمنية|اختراق)/i.test(t) && has("security-monitor")) return "security-monitor";
  if (/(translat|ترجم|ترجمة)/i.test(t) && has("translator")) return "translator";
  if (/(sales|revenue|profit|مبيعات|أرباح|إيرادات|summary|ملخص)/i.test(t) && has("analyst")) return "analyst";
  if (/(coupon|discount|offer|خصم|كوبون|عرض|article|blog|مقال|مدونة|campaign|حملة)/i.test(t) && has("marketer")) return "marketer";
  if (/(price|publish|product|سعر|انشر|نشر|منتج)/i.test(t) && has("product-manager")) return "product-manager";
  if (/(theme|palette|banner|hero|section|ثيم|لوحة|لافتة|أقسام|تصميم|design|color|لون)/i.test(t) && has("designer")) return "designer";
  return employees.find((e) => e.enabled)?.id ?? "designer";
}

export function routeCustomerEmployee(text: string, hasOrderContext: boolean): string {
  if (hasOrderContext || /(order|track|claim|طلب|تتبع|حالة الطلب)/i.test(text)) return "orders";
  if (/(refund|download|payment failed|charge|استرداد|تحميل|فشل الدفع|مشكلة)/i.test(text)) return "support";
  if (/(recommend|buy|gift|best|cheap|ترشيح|رشح|شراء|هدية|أفضل|أرخص)/i.test(text)) return "sales";
  return "greeter";
}
