import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getLocaleContext } from "@/lib/locale";
import { getSettings } from "@/lib/settings";

type Block = { heading: string; paragraphs: string[] };
type Doc = { titleAr: string; titleEn: string; introAr: string; introEn: string; blocks: { ar: Block; en: Block }[] };

const DOCS: Record<string, Doc> = {
  about: {
    titleAr: "عن المتجر",
    titleEn: "About the store",
    introAr: "Astralium Digitale Store بيت رقمي مستقل يقدّم معرفة وأدوات منتقاة بعناية، بمعايير تحرير وتوزيع استثنائية.",
    introEn: "Astralium Digitale Store is an independent digital house offering carefully curated knowledge and tools with exceptional editorial and delivery standards.",
    blocks: [
      {
        ar: {
          heading: "قصتنا",
          paragraphs: [
            "بدأ Astralium من فكرة بسيطة: المنتج الرقمي الجيد لا يحتاج ضجيجًا، بل يحتاج وصفًا صادقًا، ترخيصًا واضحًا، وتسليمًا فوريًا. نبني مكتبة صغيرة العدد، عالية القيمة، يختارها فريقنا قبل أن تُنشر.",
            "لا ننشر كل ما يصلنا. نراجع البنية، جودة الملفات، دقة الوصف، ونطاق الترخيص. وإذا لم يستوفِ المنتج المعيار، لا يُعرض في المتجر.",
          ],
        },
        en: {
          heading: "Our story",
          paragraphs: [
            "Astralium began with a simple idea: a good digital product does not need noise — it needs an honest description, clear licensing and instant delivery. We build a small, high-value library chosen by our team before publication.",
            "We do not publish everything we receive. We review structure, file quality, description accuracy and licence scope. If a product does not meet the bar, it is not listed.",
          ],
        },
      },
      {
        ar: {
          heading: "معايير الجودة",
          paragraphs: [
            "كل منتج يمر بأربع مراحل: تحقق الملكية، فحص الملفات، تحرير الوصف والترجمة، ثم اختبار مسار الشراء والتحميل. نراجع بعد ذلك تقييمات العملاء ونحدّث الوصف عند الحاجة.",
            "الملفات تُسلَّم بروابط موقّعة مؤقتة، وكل عملية تحميل مرتبطة بترخيص المشتري وحدّه الأقصى، لحماية عملك.",
          ],
        },
        en: {
          heading: "Quality standards",
          paragraphs: [
            "Every product passes four stages: ownership verification, file inspection, description and translation editing, then purchase and download path testing. Customer reviews are reviewed afterwards and descriptions updated when needed.",
            "Files are delivered through temporary signed links, and every download is tied to the buyer's licence and its limit to protect your work.",
          ],
        },
      },
      {
        ar: {
          heading: "فريق العمل",
          paragraphs: [
            "يعمل المتجر بفريق اصطناعي مدرّب على الكتالوج للرد الفوري في 12 لغة، مع مراجعة بشرية للتذاكر الحساسة والاسترجاع. الموظفون الاصطناعيون لا يخترعون معلومات ولا يصلون إلى بيانات الدفع.",
          ],
        },
        en: {
          heading: "How the store operates",
          paragraphs: [
            "The store runs with an AI team trained on the live catalogue for instant answers in 12 languages, with human review for sensitive tickets and refunds. AI employees never invent facts and never access payment data.",
          ],
        },
      },
    ],
  },
  privacy: {
    titleAr: "سياسة الخصوصية",
    titleEn: "Privacy policy",
    introAr: "نحترم خصوصيتك ونعالج الحد الأدنى من البيانات اللازمة لتسليم مشترياتك وحمايتك.",
    introEn: "We respect your privacy and process the minimum data required to deliver your purchase and keep you protected.",
    blocks: [
      {
        ar: {
          heading: "البيانات التي نجمعها",
          paragraphs: [
            "بيانات الحساب: الاسم، البريد الإلكتروني، كلمة مرور مشفّرة (scrypt)، الدولة، اللغة، والتفضيلات البريدية. بيانات الطلب: المنتج، المبلغ، العملة، طريقة الدفع، وحالة الدفع. بيانات الدعم: محتوى التذاكر والمحادثات.",
            "لا نخزّن أرقام البطاقات أو رموز التحقق. تُعالج بيانات البطاقة بواسطة بوابة الدفع (Stripe/PayPal) ولا تمرّ عبر خوادمنا.",
          ],
        },
        en: {
          heading: "Data we collect",
          paragraphs: [
            "Account data: name, email, hashed password (scrypt), country, language and email preferences. Order data: product, amount, currency, payment method and payment status. Support data: ticket and chat content.",
            "We never store card numbers or verification codes. Card data is processed by the payment gateway (Stripe/PayPal) and never passes through our servers.",
          ],
        },
      },
      {
        ar: {
          heading: "الغرض ومدة الاحتفاظ",
          paragraphs: [
            "نستخدم البيانات لتسليم المنتج، إصدار الفواتير، الوفاء بالالتزامات الضريبية، منع الاحتيال، وتحسين الكتالوج. تُحفظ سجلات الطلبات للمدة التي يقتضيها النظام المالي، ويمكن حذف بيانات الحساب عند الطلب مع الاحتفاظ بالحد الأدنى القانوني.",
            "سجلات محادثات الموظفين الاصطناعيين تُحفظ لأغراض الجودة فقط، ولا تُستخدم للإعلان.",
          ],
        },
        en: {
          heading: "Purpose and retention",
          paragraphs: [
            "We use data to deliver products, issue invoices, meet tax obligations, prevent fraud and improve the catalogue. Order records are kept for the period required by financial rules; account data can be deleted on request while retaining the legal minimum.",
            "AI chat transcripts are retained for quality purposes only and are never used for advertising.",
          ],
        },
      },
      {
        ar: {
          heading: "حقوقك",
          paragraphs: [
            "يمكنك طلب نسخة من بياناتك، تصحيحها، أو حذفها عبر صفحة الاتصال أو التذاكر. سنرد خلال 30 يومًا. إذا كنت في نطاق GDPR أو قوانين حماية البيانات المحلية، فلديك أيضًا حق الاعتراض على المعالجة وحق تقديم شكوى للجهة المختصة.",
          ],
        },
        en: {
          heading: "Your rights",
          paragraphs: [
            "You may request a copy of your data, correct it or delete it via the contact page or a ticket. We respond within 30 days. Under GDPR or local data-protection laws you also have the right to object to processing and to complain to a supervisory authority.",
          ],
        },
      },
      {
        ar: {
          heading: "الأمان والإفصاح",
          paragraphs: [
            "نستخدم تشفير TLS، تجزئة كلمات المرور، جلسات موقّعة وHttpOnly، تحديد محاولات الدخول، وسجل عمليات للمكتب. لا نبيع البيانات. نشارك فقط مع مزودي الدفع والبريد والاستضافة بالقدر اللازم لتشغيل الخدمة.",
            "بيانات المالك المصرفية تُخزَّن مشفّرة (AES-256-GCM) ولا تظهر في أي صفحة عامة أو في كود الواجهة.",
          ],
        },
        en: {
          heading: "Security and disclosure",
          paragraphs: [
            "We use TLS, hashed passwords, signed HttpOnly sessions, login rate limiting and an office audit log. We do not sell data. We share only with payment, email and hosting providers to the extent needed to run the service.",
            "Owner banking details are stored encrypted (AES-256-GCM) and never appear on public pages or in front-end code.",
          ],
        },
      },
    ],
  },
  terms: {
    titleAr: "الشروط والأحكام",
    titleEn: "Terms & conditions",
    introAr: "باستخدامك المتجر أو إتمام أي شراء فإنك توافق على الشروط الموضّحة أدناه.",
    introEn: "By using the store or completing any purchase you agree to the terms below.",
    blocks: [
      {
        ar: {
          heading: "الترخيص",
          paragraphs: [
            "تُمنح لك رخصة شخصية، غير حصرية، غير قابلة للتحويل لاستخدام المنتج الرقمي وفق ما يوضّح في صفحة المنتج. لا يجوز إعادة بيع الملفات أو نشرها للعامة أو مشاركة روابط التحميل. الترخيص التجاري متاح بإصدار منفصل عند الطلب.",
          ],
        },
        en: {
          heading: "Licence",
          paragraphs: [
            "You receive a personal, non-exclusive, non-transferable licence to use the digital product as described on its page. Files may not be resold, publicly shared or their download links redistributed. Commercial licensing is available separately on request.",
          ],
        },
      },
      {
        ar: {
          heading: "الأسعار والدفع",
          paragraphs: [
            "الأسعار الأساسية بالدولار الأمريكي وتُحوَّل وقت الشراء إلى عملتك وفق سعر الصرف المعروض. أي ضرائب مطبقة تظهر في ملخص الطلب قبل الدفع. لا نُسلِّم المنتج إلا بعد تأكيد البوابة أو Webhook موقّع.",
            "يمنع استخدام وسيلة دفع لا تملكها. تُرفض الطلبات المشتبه بها، ويُسجَّل الحدث لأغراض الأمان.",
          ],
        },
        en: {
          heading: "Pricing and payment",
          paragraphs: [
            "Base prices are in USD and converted to your currency at purchase using the displayed rate. Applicable taxes appear in the order summary before payment. We deliver only after gateway or signed-webhook confirmation.",
            "You may not use a payment method you do not own. Suspicious orders are rejected and logged for security purposes.",
          ],
        },
      },
      {
        ar: {
          heading: "الاستخدام المحظور",
          paragraphs: [
            "يُمنع مشاركة الحساب، محاولة تجاوز روابط التحميل أو حدودها، إعادة توزيع الملفات، أو استخدام المنتجات في أنشطة غير قانونية. نحتفظ بحق تعليق الحساب أو إلغاء الترخيص عند إثبات المخالفة.",
          ],
        },
        en: {
          heading: "Prohibited use",
          paragraphs: [
            "Account sharing, attempting to bypass download links or their limits, redistributing files and using products for unlawful activity are prohibited. We may suspend an account or revoke a licence where violation is established.",
          ],
        },
      },
      {
        ar: {
          heading: "المسؤولية والتعديلات",
          paragraphs: [
            "نقدّم المنتجات كما هي، مع التزامنا بوصفها بدقة وتحديثها عند الحاجة. لا نتحمل مسؤولية النتائج التجارية المباشرة أو غير المباشرة. تُحل النزاعات وفق قوانين بلد تسجيل المتجر، ويُعد إجراء الدفع أو عرض السعر إقرارًا بالأسعار والترخيص المعروضين.",
            "قد نحدّث الشروط، ويسري التحديث من تاريخ نشره مع احترام الطلبات المكتملة.",
          ],
        },
        en: {
          heading: "Liability and changes",
          paragraphs: [
            "Products are provided as described, with our commitment to accurate descriptions and updates where relevant. We are not liable for direct or indirect commercial outcomes. Disputes are governed by the laws of the store's country of registration, and paying or claiming an offer affirms the prices and licence displayed.",
            "We may update these terms; changes take effect when published and do not affect completed orders.",
          ],
        },
      },
    ],
  },
  refunds: {
    titleAr: "سياسة الاسترجاع",
    titleEn: "Refund policy",
    introAr: "نهدف إلى قرار شراء واثق. إذا لم يكن المنتج كما وُصف، فلديك حق واضح في الاسترجاع.",
    introEn: "We aim for a confident purchase decision. If a product is not as described, you have a clear right to a refund.",
    blocks: [
      {
        ar: {
          heading: "المدة والشروط",
          paragraphs: [
            "يمكن طلب الاسترجاع خلال 14 يومًا من تأكيد الدفع، إذا لم يتم تفعيل حد التحميل بالكامل أو إذا كان الملف معطوبًا أو مخالفًا لوصفه. تُراجَع الطلبات من مكتب المتجر خلال يومي عمل.",
          ],
        },
        en: {
          heading: "Window and conditions",
          paragraphs: [
            "Refunds can be requested within 14 days of payment confirmation if the download limit has not been fully consumed, or if a file is corrupt or materially different from its description. Requests are reviewed by the store office within two business days.",
          ],
        },
      },
      {
        ar: {
          heading: "الحالات غير المشمولة",
          paragraphs: [
            "لا تُقبل الاسترجاعات بسبب تغيّر الرأي بعد استهلاك التحميل الكامل، أو عند استخدام الملف تجاريًا دون ترخيص تجاري، أو عند الاشتباه بمخالفة شروط الترخيص. المنتجات المجانية أو الترقيات لا تُسترجع نقديًا.",
          ],
        },
        en: {
          heading: "Exclusions",
          paragraphs: [
            "Refunds are not accepted for change of mind after the full download limit is consumed, for commercial use without a commercial licence, or where licence violations are suspected. Free items and upgrades are not refunded in cash.",
          ],
        },
      },
      {
        ar: {
          heading: "كيف أطلب؟",
          paragraphs: [
            "افتح «حسابي → مشترياتي» واضغط «طلب استرجاع» مع رقم الطلب والسبب، أو أنشئ تذكرة من صفحة الدعم. لا تشارك أي بيانات بنكية في الرسالة؛ يُعاد المبلغ إلى وسيلة الدفع الأصلية فقط.",
          ],
        },
        en: {
          heading: "How to request",
          paragraphs: [
            "Open “My account → Purchases” and press “Request refund” with the order number and reason, or open a support ticket. Never share banking data in the message; refunds are returned to the original payment method only.",
          ],
        },
      },
      {
        ar: {
          heading: "الاسترجاع والتوقيت",
          paragraphs: [
            "عند الموافقة يُنفَّذ الاسترجاع من مكتب المدير عبر البوابة، وتُلغى صلاحية روابط التحميل، وتصلك رسالة تأكيد. تظهر الأموال عادة خلال 5 إلى 10 أيام عمل حسب مصدر البطاقة أو PayPal.",
          ],
        },
        en: {
          heading: "Processing and timing",
          paragraphs: [
            "Once approved, the refund is executed from the owner's office through the gateway, download links are revoked and a confirmation email is sent. Funds typically appear within 5–10 business days depending on the card issuer or PayPal.",
          ],
        },
      },
    ],
  },
};

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const doc = DOCS[slug];
  if (!doc) return { title: "الصفحة غير موجودة" };
  return { title: doc.titleAr, description: doc.introAr };
}

export default async function StaticContentPage({ params }: Props) {
  const { slug } = await params;
  const doc = DOCS[slug];
  if (!doc) notFound();
  const { locale, t } = await getLocaleContext();
  const settings = await getSettings();

  return (
    <div className="mx-auto max-w-4xl px-4 py-12">
      <p className="text-[10px] uppercase tracking-[0.32em] text-[#d9b26a]">Astralium</p>
      <h1 className="mt-2 font-display text-3xl text-[#f8f3e6] sm:text-4xl">{locale === "ar" ? doc.titleAr : doc.titleEn}</h1>
      <p className="mt-3 rounded-xl border border-[rgba(217,178,106,0.2)] bg-[rgba(217,178,106,0.05)] px-4 py-3 text-[13px] leading-relaxed text-[#d8cbaa]">
        {locale === "ar" ? doc.introAr : doc.introEn}
      </p>

      <div className="mt-8 space-y-7">
        {doc.blocks.map((block) => {
          const content = locale === "ar" ? block.ar : block.en;
          return (
            <section key={content.heading} className="glass rounded-2xl p-5">
              <h2 className="font-display text-xl text-[#f4efe3]">{content.heading}</h2>
              {content.paragraphs.map((paragraph) => (
                <p key={paragraph.slice(0, 40)} className="mt-2 text-[13px] leading-loose text-[#b3aec1]">
                  {paragraph}
                </p>
              ))}
            </section>
          );
        })}
      </div>

      <div className="glass mt-8 rounded-2xl p-5 text-[12.5px] leading-relaxed text-[#a9a4b8]">
        <p>
          {locale === "ar" ? "لأي سؤال حول هذه الصفحة:" : "Questions about this page:"}{" "}
          <a href={`mailto:${settings.supportEmail}`} className="text-[#e6d6ae] hover:underline" dir="ltr">
            {settings.supportEmail}
          </a>
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href="/contact" className="btn-ghost px-3 py-1.5 text-[11.5px]">
            {t("nav_contact")}
          </Link>
          <Link href="/support" className="btn-ghost px-3 py-1.5 text-[11.5px]">
            {t("nav_support")}
          </Link>
          <Link href="/catalog" className="btn-ghost px-3 py-1.5 text-[11.5px]">
            {t("nav_catalog")}
          </Link>
        </div>
      </div>
    </div>
  );
}
