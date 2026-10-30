/**
 * Astralium Digitale Store — idempotent starter seed.
 * Creates the owner account, AI teams, a starter catalogue, coupons, FAQs and journal posts.
 * Run with: node scripts/seed.mjs
 */
import "dotenv/config";
import crypto from "node:crypto";
import { Client } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const KEY_MATERIAL = process.env.APP_ENCRYPTION_KEY ?? databaseUrl;
const key = crypto.scryptSync(KEY_MATERIAL, "astralium.vault.v1", 32);

function scryptHash(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

const adminEmail = (process.env.ADMIN_EMAIL ?? "owner@astralium.store").toLowerCase();
const adminPassword = process.env.ADMIN_PASSWORD ?? "Astralium!Owner2026";
const totpSecret = process.env.ADMIN_TOTP_SECRET ?? "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

const products = [
  {
    slug: "deep-focus-playbook",
    title: "دليل التركيز العميق",
    titleEn: "The Deep Focus Playbook",
    subtitle: "نظام عملي لبناء تركيز يومي مستمر في 21 يومًا",
    subtitleEn: "A practical 21-day system for sustained daily focus",
    description:
      "دليل تحريري من 96 صفحة يحوّل مفهوم التركيز من نصيحة عامة إلى نظام تنفيذي: جدول جلسات محمي، قواعد إغلاق المشتتات، وسجل أسبوعي لقياس العمق الفعلي للعمل.\n\nالكتاب مبني على بروتوكولات مستخدمة مع فرق منتجات ومستقلين، ويقدّم لك أدوات جاهزة للطباعة: مصفوفة الأولويات، عقد الجلسة، وقائمة مراجعة نهاية اليوم، إضافة إلى خطة 21 يومًا تبدأ من أول ساعة.",
    descriptionEn:
      "A 96-page editorial playbook that turns focus from generic advice into an operating system: a protected session calendar, distraction shutdown rules and a weekly depth log.\n\nIt includes printable tools — priority matrix, session contract and shutdown checklist — plus a 21-day plan you can start in the first hour.",
    category: "ebook",
    priceCents: 3900,
    compareAtCents: 5900,
    coverStyle: "nebula",
    coverGlyph: "📖",
    tags: ["إنتاجية", "تركيز", "عمل"],
    features: ["ملف PDF من 96 صفحة", "خطة 21 يومًا قابلة للتنفيذ", "أدوات قابلة للطباعة", "ترخيص شخصي دائم"],
    featuresEn: ["96-page PDF", "Actionable 21-day plan", "Printable tools", "Lifetime personal licence"],
    format: "PDF",
    featured: true,
    salesCount: 128,
    ratingSum: 47,
    ratingCount: 10,
  },
  {
    slug: "atelier-brand-templates",
    title: "حزمة قوالب أتيليه للعلامات",
    titleEn: "Atelier Brand Template Suite",
    subtitle: "هوية بصرية كاملة قابلة للتخصيص في Figma وCanva",
    subtitleEn: "A complete, editable identity system for Figma and Canva",
    description:
      "حزمة تصميم متكاملة تضم 48 قالبًا: لوحات هوية، بطاقات عمل، أغلفة منشورات، شرائح عرض، وقوالب متجر. كل عنصر مبني على شبكة تصميم واضحة ونظام ألوان قابل للتبديل من متغيّر واحد.\n\nمثالية للاستوديوهات الصغيرة والعلامات الشخصية: عدّل الاسم واللون، ثم صدّر كل ما تحتاجه خلال ساعة، مع دليل استخدام مختصر لكل قالب وترخيص تجاري لمشروع واحد.",
    descriptionEn:
      "A 48-template design suite: identity boards, business cards, social covers, pitch slides and store templates. Every element follows a clear design grid and a colour system you can swap from a single variable.\n\nIdeal for small studios and personal brands: change the name and colour, export everything within an hour, with a short usage guide per template and a commercial licence for one project.",
    category: "template",
    priceCents: 7900,
    compareAtCents: 11900,
    coverStyle: "gold",
    coverGlyph: "🗂",
    tags: ["تصميم", "هوية", "قوالب"],
    features: ["48 قالبًا قابلاً للتخصيص", "ملفات Figma + Canva", "دليل تخصيص مختصر", "ترخيص تجاري لمشروع واحد"],
    featuresEn: ["48 editable templates", "Figma + Canva files", "Concise customisation guide", "Commercial licence for one project"],
    format: "ZIP / Figma",
    featured: true,
    salesCount: 86,
    ratingSum: 36,
    ratingCount: 8,
  },
  {
    slug: "quiet-mornings-audiobook",
    title: "صباح هادئ — كتاب صوتي",
    titleEn: "Quiet Mornings — Audiobook",
    subtitle: "ست ساعات صوتية عن تصميم صباح يخدم عملًا عميقًا",
    subtitleEn: "Six audio hours on designing a morning that serves deep work",
    description:
      "كتاب صوتي من ست ساعات و42 دقيقة، بصوت هادئ وإنتاج صوتي نقّي، يشرح كيف تبني صباحًا يمنحك ساعتين من العمل العميق قبل أن يبدأ العالم في الطلب.\n\nست حلقات قصيرة، كل حلقة تنتهي بتمرين عملي واحد تبدأ به فورًا: تثبيت موعد الاستيقاظ، إغلاق المدخلات، تثبيت أول مهمة، وبناء مراسم إغلاق تمنع الاستنزاف.",
    descriptionEn:
      "A six-hour audiobook, calmly narrated and cleanly produced, explaining how to design a morning that buys you two hours of deep work before the world starts asking.\n\nSix short chapters, each ending with one practical exercise you can apply immediately: anchor your wake time, close inputs, fix the first task, and build a shutdown ritual that prevents depletion.",
    category: "audiobook",
    priceCents: 4900,
    coverStyle: "violet",
    coverGlyph: "🎧",
    tags: ["صوتي", "صباح", "إنتاجية"],
    features: ["6 ساعات و42 دقيقة", "جودة صوت 320kbps", "6 تمارين تطبيقية", "تحميل دائم بعد الشراء"],
    featuresEn: ["6h 42m of audio", "320kbps audio quality", "6 applied exercises", "Lifetime downloads"],
    format: "MP3",
    featured: false,
    salesCount: 64,
    ratingSum: 29,
    ratingCount: 6,
  },
  {
    slug: "lumen-motion-collection",
    title: "مجموعة Lumen للحركة",
    titleEn: "Lumen Motion Collection",
    subtitle: "120 مؤثرًا بصريًا سينمائيًا جاهزًا للمونتاج",
    subtitleEn: "120 cinematic visual effects ready for editing",
    description:
      "مجموعة مؤثرات حركية مبنية بعناية للاستخدام في إعلانات المنتجات والمحتوى الرقمي: انتقالات ضوئية، نفقات ذهبية، حركات كاميرا ناعمة، وخلفيات جسيمات بشفافية كاملة.\n\nالملفات بصيغة ProRes بشفافية ألفا ودقة 4K، مع إصدار خفيف 1080p لأجهزة أقل قدرة، ودليل دقيقتين لكل نوع انتقال لتبدأ بسرعة.",
    descriptionEn:
      "A curated motion-effects collection for product films and digital content: light transitions, gold dust, soft camera moves and full-alpha particle backgrounds.\n\nFiles ship as 4K ProRes with alpha plus a lighter 1080p set, with a two-minute guide per transition type.",
    category: "video",
    priceCents: 9900,
    compareAtCents: 13900,
    coverStyle: "solar",
    coverGlyph: "🎬",
    tags: ["فيديو", "مونتاج", "مؤثرات"],
    features: ["120 مؤثرًا بدقة 4K", "ProRes بشفافية ألفا", "إصدار 1080p خفيف", "استخدام في مشاريع غير محدودة"],
    featuresEn: ["120 effects in 4K", "ProRes with alpha", "Light 1080p set", "Unlimited project use"],
    format: "ZIP / ProRes",
    featured: true,
    salesCount: 41,
    ratingSum: 23,
    ratingCount: 5,
  },
  {
    slug: "revenue-architecture-course",
    title: "دورة هندسة الإيرادات",
    titleEn: "Revenue Architecture Course",
    subtitle: "أربع ساعات ونصف لبناء مسار إيراد واضح لمنتج رقمي",
    subtitleEn: "Four and a half hours to build a clear revenue path for a digital product",
    description:
      "دورة مسجلة عالية الكثافة تركّز على سؤال واحد: كيف تجعل المنتج الرقمي يبيع بشكل متكرر دون أن تفقد جودة العلاقة مع العميل؟\n\nأربعة مسارات: التسعير، صفحة المنتج، البريد بعد الشراء، وقياس الاحتفاظ. كل مسار معه قالب عمل ومراجعة لأمثلة حقيقية وتمرين تخرج بنتيجة واحدة قابلة للقياس.",
    descriptionEn:
      "A dense recorded course built around one question: how does a digital product sell repeatedly without degrading the customer relationship?\n\nFour tracks — pricing, the product page, post-purchase email and retention measurement — each with a worksheet, real example reviews and an exercise that produces one measurable outcome.",
    category: "course",
    priceCents: 14900,
    compareAtCents: 19900,
    coverStyle: "ocean",
    coverGlyph: "🎓",
    tags: ["دورة", "إيرادات", "تسويق"],
    features: ["4.5 ساعة فيديو", "4 مسارات عملية", "قوالب وجداول قياس", "وصول دائم وتحديثات"],
    featuresEn: ["4.5 hours of video", "Four practical tracks", "Templates and measurement sheets", "Lifetime access and updates"],
    format: "MP4 + PDF",
    featured: true,
    salesCount: 57,
    ratingSum: 34,
    ratingCount: 7,
  },
  {
    slug: "astral-planner-software",
    title: "Astral Planner — تطبيق تخطيط",
    titleEn: "Astral Planner — Planning App",
    subtitle: "تطبيق سطح مكتب للتخطيط الأسبوعي يعمل بدون اتصال",
    subtitleEn: "An offline-first weekly planning desktop app",
    description:
      "تطبيق تخطيط أسبوعي يعمل محليًا بالكامل: لا حساب، لا تتبّع، وبياناتك في ملف واحد يمكنك نسخه احتياطيًا. مبني حول فكرة واحدة: ثلاث أولويات فقط لكل أسبوع.\n\nيشمل تصدير PDF للطباعة، اختصارات لوحة مفاتيح، ومراجعة أسبوعية موجهة بأسئلة قصيرة، مع ترخيص شخصي لجهازين.",
    descriptionEn:
      "A fully local weekly planning app: no account, no tracking, your data in a single backup-friendly file. Built around one idea — only three priorities per week.\n\nIncludes PDF export for printing, keyboard shortcuts and a guided weekly review, licensed for two personal devices.",
    category: "software",
    priceCents: 5900,
    coverStyle: "ivory",
    coverGlyph: "⚙️",
    tags: ["برمجيات", "تخطيط", "سطح مكتب"],
    features: ["يعمل بدون إنترنت", "لا حسابات ولا تتبّع", "تصدير PDF", "ترخيص لجهازين"],
    featuresEn: ["Offline-first", "No accounts or tracking", "PDF export", "Two-device licence"],
    format: "DMG / EXE",
    featured: false,
    salesCount: 33,
    ratingSum: 18,
    ratingCount: 4,
  },
  {
    slug: "celestial-stock-collection",
    title: "مجموعة الصور السماوية",
    titleEn: "Celestial Stock Collection",
    subtitle: "80 صورة فائقة الدقة بطابع كوني فاخر",
    subtitleEn: "80 ultra-high-resolution cosmic images",
    description:
      "ثمانون صورة بطابع كوني داكن وغبار ذهبي، مخصّصة للاستخدام في أغلفة المنتجات، خلفيات العلامات، والمواد التحريرية. جميع الصور بدقة 6000 بكسل مع معالجة لونية موحّدة.\n\nتحصل على نسختين من كل صورة: نسخة كاملة ونسخة مضغوطة للويب، مع سجل استخدام ودليل ترخيص واضح يسمح بالاستخدام التجاري في مواد غير مجانية.",
    descriptionEn:
      "Eighty dark cosmic images with gold dust, made for product covers, brand backdrops and editorial work. All frames at 6000px with consistent colour grading.\n\nEach image comes in full and web-optimised versions, with a usage sheet and clear commercial licence for paid projects.",
    category: "image",
    priceCents: 6900,
    coverStyle: "nebula",
    coverGlyph: "🖼",
    tags: ["صور", "خلفيات", "علامة"],
    features: ["80 صورة بدقة 6000px", "معالجة لونية موحّدة", "نسخة ويب مضغوطة", "ترخيص تجاري للمواد المدفوعة"],
    featuresEn: ["80 images at 6000px", "Consistent colour grading", "Web-optimised set", "Commercial licence for paid work"],
    format: "JPG / ZIP",
    featured: false,
    salesCount: 72,
    ratingSum: 28,
    ratingCount: 6,
  },
  {
    slug: "founder-soundscape-vol1",
    title: "مشاهد صوتية للمؤسس — الإصدار الأول",
    titleEn: "Founder Soundscape Vol. 1",
    subtitle: "ساعتان من الموسيقى الهادئة لجلسات العمل العميق",
    subtitleEn: "Two hours of calm music for deep work sessions",
    description:
      "ساعتان من الموسيقى المحيطة المصمّمة لجلسات عمل طويلة بدون كلمات أو نبرات مفاجئة: ثلاث مقامات، ثلاثة إيقاعات، وتدرّج هادئ من البداية إلى النهاية.\n\nالملفات بصيغة WAV عالية الجودة وMP3 للاستماع السريع، وجاهزة كخلفية للفيديو مع علم بعدم وجود مطالبات حقوق.",
    descriptionEn:
      "Two hours of ambient music designed for long working sessions with no words or sudden swells: three modes, three tempos and a gentle arc from start to finish.\n\nDelivered as high-quality WAV plus MP3 for quick listening, and ready for video backdrops with no copyright claims.",
    category: "audio",
    priceCents: 2900,
    coverStyle: "violet",
    coverGlyph: "🎼",
    tags: ["صوتيات", "موسيقى", "عمل"],
    features: ["ساعتان من الموسيقى", "WAV + MP3", "خالٍ من حقوق المحتوى", "استخدام في فيديوهاتك"],
    featuresEn: ["Two hours of music", "WAV + MP3", "Copyright-claim free", "Usable in your videos"],
    format: "WAV / MP3",
    featured: false,
    salesCount: 95,
    ratingSum: 40,
    ratingCount: 9,
  },
  {
    slug: "astralium-collector-bundle",
    title: "حزمة أسترا الكاملة",
    titleEn: "The Astralium Collector Bundle",
    subtitle: "كل الإصدارات الأساسية في حزمة واحدة موفّرة",
    subtitleEn: "Every core release in one saving bundle",
    description:
      "الحزمة الكاملة التي تجمع دليل التركيز العميق، حزمة قوالب أتيليه، دورة هندسة الإيرادات، ومجموعة الصور السماوية في ترخيص واحد.\n\nالأسعار مجتمعة تتجاوز 40 دولارًا، والحزمة تمنحك كل الملفات مع تحديثاتها القادمة لمدة سنة، ودعوة لمراجعة جماعية ربع سنوية عبر البريد.",
    descriptionEn:
      "The full bundle combining the Deep Focus Playbook, Atelier Template Suite, Revenue Architecture Course and Celestial Stock Collection under one licence.\n\nIndividually these exceed $40; the bundle includes a year of updates and an invitation to a quarterly group review by email.",
    category: "bundle",
    priceCents: 9900,
    compareAtCents: 22500,
    coverStyle: "gold",
    coverGlyph: "🎁",
    tags: ["حزمة", "توفير", "أسترا"],
    features: ["4 إصدارات كاملة", "تحديثات لمدة سنة", "ترخيص شخصي", "مراجعة جماعية ربع سنوية"],
    featuresEn: ["Four full releases", "One year of updates", "Personal licence", "Quarterly group review"],
    format: "ZIP",
    featured: true,
    salesCount: 38,
    ratingSum: 26,
    ratingCount: 5,
  },
];

const agents = [
  {
    slug: "reception",
    name: "سلمى",
    title: "موظفة استقبال",
    team: "customer",
    specialty: "تسأل عن احتياجك وهدفك وميزانيتك ثم ترشدك إلى المنتج المناسب",
    glyph: "✦",
    greeting: "أهلًا بك في Astralium. أنا سلمى، موظفة الاستقبال. أخبرني: ماذا تريد أن تحصل عليه الآن، وما ميزانيتك؟ وسأرشدك مباشرة إلى الأنسب.",
    greetingEn: "Welcome to Astralium. I'm Salma, the reception agent. What do you want to achieve, and what is your budget? I'll point you straight to the best fit.",
    instructions: "اسألي سؤالًا واحدًا قصيرًا في كل مرة.",
    sortOrder: 1,
  },
  {
    slug: "sales",
    name: "كريم",
    title: "مستشار مبيعات",
    team: "customer",
    specialty: "يقارن لك الإصدارات من حيث القيمة والنتيجة، ويشرح الفروقات بصدق",
    glyph: "⚖",
    greeting: "مرحبًا، أنا كريم مستشار المبيعات. سأساعدك على المقارنة بين الإصدارات بحسب نتيجتك وميزانيتك، بلا مبالغة.",
    greetingEn: "Hello, I'm Karim, your sales advisor. I'll help you compare releases by outcome and budget, without exaggeration.",
    sortOrder: 2,
  },
  {
    slug: "support",
    name: "ليان",
    title: "موظفة دعم",
    team: "customer",
    specialty: "تساعد في التحميل والفواتير والتراخيص وتحوّل الحالات الحساسة إلى تذكرة بشرية",
    glyph: "✉",
    greeting: "مرحبًا، أنا ليان من فريق الدعم. أخبرني بالمشكلة ورقم الطلب إن وُجد، وسأوضح لك الخطوات فورًا.",
    greetingEn: "Hello, I'm Layan from support. Tell me the issue and your order number if you have one, and I'll explain the steps.",
    sortOrder: 3,
  },
  {
    slug: "follow-up",
    name: "آدم",
    title: "موظف متابعة ما بعد الشراء",
    team: "customer",
    specialty: "يتابع تجربتك بعد الشراء، يساعد في تفعيل الترخيص والملفات والتحديثات",
    glyph: "↺",
    greeting: "أهلًا بعودتك، أنا آدم من فريق المتابعة. هل احتجت مساعدة في ملفاتك أو ترخيصك أو تحديث إصدار؟",
    greetingEn: "Welcome back, I'm Adam from post-purchase. Do you need help with your files, licence or an edition update?",
    sortOrder: 4,
  },
  {
    slug: "catalogue-warden",
    name: "ناظر الكتالوج",
    title: "مدير المنتجات والأسعار",
    team: "manager",
    specialty: "إضافة وتعديل المنتجات والأسعار والوصف، وضبط حالة النشر",
    glyph: "⌘",
    greeting: "جاهز لأوامر الكتالوج.",
    greetingEn: "Ready for catalogue commands.",
    instructions: "لا يحذف منتجًا مرتبطًا بطلبات؛ يؤرشف بدلًا من ذلك.",
    sortOrder: 1,
  },
  {
    slug: "revenue-analyst",
    name: "محلل الإيرادات",
    title: "تحليل المبيعات والأرباح",
    team: "manager",
    specialty: "تحليل الإيرادات ومتوسط الطلب والتوزيع حسب البوابة والمنتج",
    glyph: "◭",
    greeting: "جاهز لتحويل بيانات الطلبات إلى قرارات.",
    greetingEn: "Ready to turn order data into decisions.",
    sortOrder: 2,
  },
  {
    slug: "content-director",
    name: "مدير المحتوى والإعلان",
    title: "كتابة المحتوى والإعلانات",
    team: "manager",
    specialty: "صياغة الأوصاف والإعلانات والنشرات اعتمادًا على بيانات الكتالوج",
    glyph: "✎",
    greeting: "أعطني المنتج، وأعيد لك نصًا جاهزًا للنشر.",
    greetingEn: "Give me a product and I'll return publish-ready copy.",
    sortOrder: 3,
  },
  {
    slug: "payments-auditor",
    name: "مراقب المدفوعات",
    title: "مراقبة الدفع واكتشاف الأخطاء",
    team: "manager",
    specialty: "مراقبة الطلبات المعلّقة والفاشلة وأحداث البوابات، وتنبيه المالك قبل أي تسليم خاطئ",
    glyph: "▣",
    greeting: "أراقب كل حدث دفع وأرفع أي شذوذ للمالك.",
    greetingEn: "I watch every payment event and raise anomalies to the owner.",
    sortOrder: 4,
  },
];

const faqs = [
  ["كيف أستلم المنتج بعد الدفع؟", "بعد تأكيد البوابة أو الـ Webhook تظهر روابط تحميل موقّعة في صفحة الطلب مباشرة، وتُرسل إلى بريدك، وتبقى متاحة دائمًا من «حسابي ← تحميل الملفات».", "delivery", 1],
  ["هل يمكنني تحميل الملف أكثر من مرة؟", "نعم، حد التحميل لكل ترخيص مذكور في صفحة المنتج (عادة 5 مرات). إذا وصلت للحد، افتح تذكرة وسنعيد تفعيل الرابط بعد التحقق من الطلب.", "delivery", 2],
  ["ما بوابات الدفع المتاحة؟", "Stripe للبطاقات وApple Pay وGoogle Pay، وPayPal. في وضع الاختبار تتوفر بوابة محاكاة آمنة لاختبار المسار كاملًا قبل التشغيل الحقيقي.", "payment", 3],
  ["هل تُخزَّن بيانات بطاقتي؟", "لا. تمرّ بيانات البطاقة عبر بوابة الدفع فقط، ولا تُخزَّن على خوادم المتجر. نحفظ مرجع العملية وحالتها فقط لبناء الفاتورة.", "security", 4],
  ["هل الأسعار بعملتي؟", "الأسعار الأساسية بالدولار الأمريكي وتُحوَّل تلقائيًا إلى 14 عملة عند العرض والدفع، مع إظهار سعر الصرف المستخدم في الطلب.", "payment", 5],
  ["هل أحتاج حسابًا للشراء؟", "لا، يمكنك الشراء كضيف وستحصل على رابط الطلب للوصول إلى الملف والفاتورة. إن أنشأت حسابًا فستجد كل مشترياتك محفوظة.", "account", 6],
  ["كيف أطلب استرجاعًا؟", "من «حسابي ← مشترياتي» اضغط طلب استرجاع مع رقم الطلب والسبب، أو افتح تذكرة. راجع سياسة الاسترجاع للشروط والمدة.", "refund", 7],
  ["هل الترخيص تجاري؟", "الترخيص الافتراضي شخصي. بعض الإصدارات تتيح استخدامًا تجاريًا محدودًا، والترقية التجارية متاحة عبر تذكرة. التفاصيل في كل صفحة منتج.", "license", 8],
];

const posts = [
  {
    slug: "why-we-publish-fewer-products",
    title: "لماذا ننشر منتجات أقل؟",
    excerpt: "الكتالوج الصغير المراجع أفضل من متجر مزدحم بمنتجات لا نعرف مصدرها. هذا معيارنا في النشر.",
    category: "أخبار",
    body: "## الانتقاء قبل التوزيع\nكل منتج رقمي يبدأ بمراجعة ملكية وملفات ووضوح ترخيص. إذا لم نستطع التحقق، لا ننشر.\n\n- ملكية موثقة\n- ملفات مختبرة على أكثر من جهاز\n- وصف يذكر ما لا يشمله المنتج\n- ترخيص مكتوب بلغة واضحة\n\n## النتيجة للعميل\n- قرار شراء أسرع\n- توقعات واقعية\n- دعم أقل ارتباكًا\n\nنحن نفضّل أن يكون لدينا ثلاثون إصدارًا نفتخر بها، على ثلاث مئة لا نعرف مصدر نصفها.",
  },
  {
    slug: "digital-licensing-explained",
    title: "الترخيص الرقمي: ما الذي تشتريه فعلًا؟",
    excerpt: "المنتج الرقمي ليس ملفًا فقط؛ إنه حق استخدام محدد. اقرأ الفروقات قبل الشراء.",
    category: "دليل",
    body: "## ثلاثة أنواع شائعة\n- ترخيص شخصي: للاستخدام الذاتي، بلا إعادة بيع.\n- ترخيص تجاري: للاستخدام في مشاريع تدرّ إيرادًا، عادة لمشروع واحد.\n- ترخيص فريق: لعدد محدد من المستخدمين داخل مؤسسة.\n\n## ماذا يحدث عند المشاركة؟\nروابط التحميل شخصية وموقّعة. مشاركتها تُبطل الترخيص وتُوقف الوصول، وقد يؤدي ذلك إلى إلغاء العملية دون استرجاع.\n\n## الخلاصة\nقبل الشراء، اقرأ نطاق الاستخدام في صفحة المنتج. إن كان احتياجك تجاريًا، اسألنا قبل الدفع وسنوضح لك الخيار المناسب.",
  },
  {
    slug: "secure-instant-delivery",
    title: "كيف يعمل التسليم الفوري الآمن؟",
    excerpt: "من تأكيد الدفع إلى رابط موقّع ينتهي خلال 72 ساعة: شرح مبسّط للمسار التقني.",
    category: "تقنية",
    body: "## المسار\n- ينشئ المتجر طلبًا بحالة pendيng مع منع التكرار لنفس البريد والمنتج.\n- تُنشأ جلسة دفع لدى البوابة ويُسجَّل مرجعها.\n- يصل تأكيد الدفع من البوابة أو من Webhook موقّع.\n- يتحول الطلب إلى paid مرة واحدة فقط، ثم تُنشأ الترخيصات والروابط.\n\n## الحماية\nكل رابط تحميل يحمل توقيعًا وتاريخ انتهاء، ويرتبط ببريد المشتري وحد التحويل. عند الاسترجاع يُلغى الوصول فورًا.\n\n## إن تأخر التأكيد\nبعض البوابات تتأخر ثوانيَ. لا تُسلَّم الملفات قبل التأكيد، ويمكنك تحديث صفحة الطلب أو مراسلة الدعم برقم الطلب.",
  },
  {
    slug: "pricing-digital-products-2026",
    title: "تسعير المنتجات الرقمية في 2026",
    excerpt: "ثلاث طرق للتسعير، ومتى تختار كل واحدة، مع أخطاء نراها تتكرر.",
    category: "إستراتيجية",
    body: "## الطرق الثلاث\n- تسعير القيمة: تحدد السعر بحسب النتيجة المتوقعة.\n- تسعير الحزمة: تجمع إصدارات لتقليل المقارنة الفردية.\n- تسعير المصعد: إصدار أساسي ثم ترقية تجارية.\n\n## أخطاء متكررة\n- خصم دائم يعلّم العميل ألا يشتري بالسعر الكامل.\n- وصف مبالغ فيه يرفع التوقع ثم يخفض التقييم.\n- تجاهل العملة المحلية في الأسواق العربية.\n\n## توصيتنا\nاختبر سعرًا واحدًا لمدة 30 يومًا، وقس نسبة التحويل ومتوسط قيمة الطلب معًا. لا تختبر السعر والوصف في الوقت نفسه.",
  },
];

const client = new Client({ connectionString: databaseUrl });
await client.connect();

try {
  await client.query(
    `insert into admin_users (email, name, password_hash, totp_secret, totp_enabled, role)
     values ($1, $2, $3, $4, true, 'owner')
     on conflict (email) do update set password_hash = excluded.password_hash, totp_secret = excluded.totp_secret, totp_enabled = true`,
    [adminEmail, "مالك Astralium", scryptHash(adminPassword), encryptSecret(totpSecret)],
  );

  for (const product of products) {
    await client.query(
      `insert into products (slug, title, title_en, subtitle, subtitle_en, description, description_en, category, price_cents, compare_at_cents,
        cover_style, cover_glyph, tags, features, features_en, format, featured, status, sales_count, rating_sum, rating_count)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'active',$18,$19,$20)
       on conflict (slug) do update set title = excluded.title, title_en = excluded.title_en, subtitle = excluded.subtitle,
         subtitle_en = excluded.subtitle_en, description = excluded.description, description_en = excluded.description_en,
         category = excluded.category, cover_style = excluded.cover_style, cover_glyph = excluded.cover_glyph,
         tags = excluded.tags, features = excluded.features, features_en = excluded.features_en, format = excluded.format`,
      [
        product.slug,
        product.title,
        product.titleEn,
        product.subtitle,
        product.subtitleEn,
        product.description,
        product.descriptionEn,
        product.category,
        product.priceCents,
        product.compareAtCents ?? null,
        product.coverStyle,
        product.coverGlyph,
        JSON.stringify(product.tags),
        JSON.stringify(product.features),
        JSON.stringify(product.featuresEn),
        product.format,
        product.featured,
        product.salesCount,
        product.ratingSum,
        product.ratingCount,
      ],
    );
  }

  for (const agent of agents) {
    await client.query(
      `insert into ai_agents (slug, name, title, team, specialty, glyph, greeting, greeting_en, instructions, languages, active, sort_order)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11)
       on conflict (slug) do update set name = excluded.name, title = excluded.title, team = excluded.team,
         specialty = excluded.specialty, greeting = excluded.greeting, greeting_en = excluded.greeting_en, sort_order = excluded.sort_order`,
      [
        agent.slug,
        agent.name,
        agent.title,
        agent.team,
        agent.specialty,
        agent.glyph,
        agent.greeting,
        agent.greetingEn,
        agent.instructions ?? "",
        JSON.stringify(["ar", "en", "fr", "es", "de", "it", "pt", "tr", "ru", "zh", "ja", "hi"]),
        agent.sortOrder,
      ],
    );
  }

  await client.query("delete from faqs");
  for (const [question, answer, category, order] of faqs) {
    await client.query("insert into faqs (question, answer, category, sort_order, active) values ($1,$2,$3,$4,true)", [
      question,
      answer,
      category,
      order,
    ]);
  }

  for (const post of posts) {
    await client.query(
      `insert into blog_posts (slug, title, excerpt, body, category, published, published_at)
       values ($1,$2,$3,$4,$5,true, now())
       on conflict (slug) do update set title = excluded.title, excerpt = excluded.excerpt, body = excluded.body, category = excluded.category`,
      [post.slug, post.title, post.excerpt, post.body, post.category],
    );
  }

  const reviews = [
    ["deep-focus-playbook", "سارة العتيبي", 5, "الخطة عملية من أول يوم. استخدمت مصفوفة الأولويات وأصبحت أنهي جلستين عميقتين قبل الظهر."],
    ["deep-focus-playbook", "عبدالله الحربي", 4, "المحتوى مركّز بلا حشو. كنت أتمنى أمثلة أكثر لفرق العمل، لكن الأدوات ممتازة."],
    ["atelier-brand-templates", "ريم الأنصاري", 5, "وفّرت عليّ أسبوعين من العمل. تغيير المتغيّرات واحدة يجعل الحزمة متسقة بالكامل."],
    ["revenue-architecture-course", "محمد الشمري", 5, "مسار القياس وحده يستحق السعر. طبّقت التمرين وخرجت بخريطة تسعير واضحة."],
    ["quiet-mornings-audiobook", "نوف القحطاني", 4, "الصوت هادئ والإنتاج نظيف. التمارين القصيرة هي ما جعلني أستمر."],
    ["celestial-stock-collection", "فهد المطيري", 5, "جودة الصور عالية والتدرج اللوني موحّد، استخدمتها في حملة كاملة."],
  ];
  for (const [slug, author, rating, body] of reviews) {
    const existing = await client.query("select id from reviews where product_id = (select id from products where slug=$1) and author_name=$2", [slug, author]);
    if (existing.rowCount === 0) {
      await client.query("insert into reviews (product_id, author_name, rating, body) values ((select id from products where slug=$1),$2,$3,$4)", [slug, author, rating, body]);
    }
  }

  const couponRows = [
    ["ASTRAL10", "percent", 10, 0, 500, true],
    ["WELCOME15", "percent", 15, 2000, null, true],
    ["AURA5", "fixed", 500, 3900, 100, true],
  ];
  for (const [code, kind, value, min, max, active] of couponRows) {
    await client.query(
      `insert into coupons (code, kind, value, min_subtotal_cents, max_redemptions, active)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (code) do nothing`,
      [code, kind, value, min, max, active],
    );
  }

  console.log("Seed complete:");
  console.log(`  owner: ${adminEmail}`);
  console.log(`  products: ${products.length}, agents: ${agents.length}, coupons: ${couponRows.length}`);
} finally {
  await client.end();
}
