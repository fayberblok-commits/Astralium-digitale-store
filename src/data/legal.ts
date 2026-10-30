/**
 * Legal & trust page templates.
 * ⚠️ These are reasonable starter templates only — the store owner MUST have
 * them reviewed by a qualified lawyer in each market they sell into before
 * relying on them. This notice is also rendered on every legal page.
 */
export interface LegalDoc {
  slug: string;
  title: string;
  updated: string;
  body: string[];
}

export const LEGAL_DOCS: LegalDoc[] = [
  {
    slug: "terms",
    title: "Terms & Conditions",
    updated: "2026-10-01",
    body: [
      "These terms govern purchases of digital products from Astralium Digitale Store ('Astralium', 'we'). By completing a purchase you agree to them.",
      "Products are digital goods delivered electronically immediately after confirmed payment. No physical shipment takes place and no shipping fees apply.",
      "Prices are displayed in your selected currency; applicable taxes for digital goods are calculated and shown before payment. Payment is processed by our payment providers (Stripe, PayPal); we never receive or store your card details.",
      "A purchase grants you the license described in our License terms for that product. Unless a product explicitly includes a commercial license, purchases are for personal use.",
      "We may update these terms; the version in force at the time of your purchase applies to that purchase.",
    ],
  },
  {
    slug: "privacy",
    title: "Privacy Policy",
    updated: "2026-10-01",
    body: [
      "We collect the minimum data needed to sell and deliver digital products: your email address, order records, and technical data required for security and fraud prevention.",
      "Payment data is handled directly by PCI-DSS compliant payment providers; card numbers never touch our servers.",
      "We do not sell personal data. Data is shared only with processors necessary to operate the store (payments, email delivery, hosting) under data-processing agreements.",
      "Under GDPR/CCPA and similar laws you may request access, export, correction or deletion of your personal data at any time via the contact page. We respond within 30 days.",
      "Download links are personal and signed; access logs are kept for abuse prevention and then deleted on a rolling basis.",
    ],
  },
  {
    slug: "refunds",
    title: "Refund Policy",
    updated: "2026-10-01",
    body: [
      "Every product is covered by a 14-day, no-questions-asked money-back guarantee from the date of purchase.",
      "To request a refund, reply to your order email or contact support with your order reference. Refunds are issued to the original payment method within 5–10 business days depending on your bank.",
      "On refund, download access for the refunded product is revoked, as the license is cancelled.",
      "Statutory consumer rights in your country (including EU/UK withdrawal rights for digital content) are not affected by this policy; where they grant you more, they prevail.",
    ],
  },
  {
    slug: "cookies",
    title: "Cookie Policy",
    updated: "2026-10-01",
    body: [
      "We use a small number of cookies and local-storage entries: strictly necessary ones for cart, language, currency and theme preferences, and — only with your consent — privacy-respecting analytics.",
      "You can accept or decline non-essential cookies in the consent banner at any time, and clear stored preferences from your browser settings.",
      "We do not use advertising trackers or cross-site behavioural profiling.",
    ],
  },
  {
    slug: "license",
    title: "License Terms",
    updated: "2026-10-01",
    body: [
      "Unless a product page states a broader license, your purchase grants a non-exclusive, non-transferable license to use the product personally, on your own devices, indefinitely.",
      "You may not redistribute, resell, sublicense, share download links, or upload products to file-sharing services. Download links are personal and signed with your order reference.",
      "Products marked with a commercial license (music, templates, design assets) may be used in commercial projects as described on their product pages; resale of the raw files themselves is never permitted.",
      "Some PDFs may carry an invisible watermark containing your order reference to deter piracy. It contains no other personal data.",
    ],
  },
  {
    slug: "about",
    title: "About Astralium",
    updated: "2026-10-01",
    body: [
      "Astralium Digitale Store is an independent digital storefront selling ebooks, audiobooks, courses, templates, music, software and design assets to customers worldwide.",
      "Our promise is simple: checkout in under two minutes, delivery in seconds, and a human-grade support experience in your language — backed by a 14-day money-back guarantee on everything.",
      "We are a small, fully remote team. Every product in the catalog is reviewed by a person before it is listed.",
    ],
  },
  {
    slug: "contact",
    title: "Contact Us",
    updated: "2026-10-01",
    body: [
      "The fastest way to reach us is the support assistant in the corner of every page — it answers instantly from our catalog and policies, and hands over to a human with the full conversation attached when needed.",
      "For order questions, include your order reference (it is in your receipt email) so we can help immediately.",
      "Support hours: we reply to email within one business day, in 40 languages.",
    ],
  },
];

export function getLegalDoc(slug: string): LegalDoc | undefined {
  return LEGAL_DOCS.find((d) => d.slug === slug);
}

/**
 * "Messaging & delivery privacy" — rendered as an extra section of the
 * Privacy Policy (Phase 2 social delivery). Native text in English and
 * Arabic; other locales resolve to the English text (the same fallback
 * rule as the rest of the storefront).
 */
export const MESSAGING_PRIVACY: Record<"en" | "ar", { title: string; body: string[] }> = {
  en: {
    title: "Messaging & delivery privacy",
    body: [
      "If you choose delivery via WhatsApp, Messenger or Instagram, we process the phone number or platform ID you provide for one purpose only: sending you your download links and helping with that order. We never use it for marketing unless you separately and explicitly opt in.",
      "Phone numbers are stored encrypted (AES-256-GCM) and indexed only by a one-way hash. They never appear in our logs or admin screens, and raw storage links are never sent — every message carries only our own signed, expiring download links.",
      "Reply STOP on WhatsApp at any time to opt out of WhatsApp messages immediately; email delivery is unaffected. You may also request deletion of your messaging data at any time via the contact page — we delete the stored number and conversation identifiers, keeping only the order records the law requires us to retain.",
      "Meta platforms (WhatsApp, Messenger, Instagram) process messages under their own privacy policies when you choose those channels.",
    ],
  },
  ar: {
    title: "خصوصية المراسلة والتسليم",
    body: [
      "إذا اخترت التسليم عبر واتساب أو ماسنجر أو إنستغرام، فإننا نعالج رقم الهاتف أو معرّف المنصة الذي تقدمه لغرض واحد فقط: إرسال روابط التحميل إليك ومساعدتك بشأن ذلك الطلب. لا نستخدمه أبداً في التسويق ما لم توافق على ذلك صراحة وبشكل منفصل.",
      "تُحفظ أرقام الهواتف مشفّرة (AES-256-GCM) ولا تُفهرس إلا ببصمة أحادية الاتجاه. لا تظهر أبداً في سجلاتنا أو شاشات الإدارة، ولا تُرسَل روابط التخزين الخام أبداً — كل رسالة تحمل فقط روابط التحميل الموقّعة والمنتهية الصلاحية من متجرنا.",
      "ردّ بكلمة STOP على واتساب في أي وقت لإلغاء رسائل واتساب فوراً؛ ويبقى التسليم بالبريد غير متأثر. يمكنك أيضاً طلب حذف بيانات المراسلة الخاصة بك في أي وقت عبر صفحة الاتصال — نحذف الرقم ومعرّفات المحادثة المحفوظة، مع الاحتفاظ فقط بسجلات الطلبات التي يلزمنا القانون بالاحتفاظ بها.",
      "تعالج منصات ميتا (واتساب وماسنجر وإنستغرام) الرسائل وفق سياسات الخصوصية الخاصة بها عندما تختار تلك القنوات.",
    ],
  },
};

export function getMessagingPrivacy(locale: string): { title: string; body: string[] } {
  return locale === "ar" ? MESSAGING_PRIVACY.ar : MESSAGING_PRIVACY.en;
}
