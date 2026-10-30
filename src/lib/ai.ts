import { categoryLabel, type LocaleCode } from "@/lib/i18n";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type AgentProfile = {
  slug: string;
  name: string;
  title: string;
  specialty: string;
  team: string;
  greeting: string;
  greetingEn?: string | null;
  instructions?: string | null;
};

export type CatalogItem = {
  slug: string;
  title: string;
  titleEn?: string | null;
  subtitle?: string | null;
  subtitleEn?: string | null;
  description: string;
  category: string;
  priceCents: number;
  coverStyle: string;
  coverGlyph: string;
  tags: string[];
};

export type AgentReply = {
  reply: string;
  quickReplies: string[];
  recommendations: { slug: string; title: string; priceCents: number; category: string; coverStyle: string; coverGlyph: string }[];
  escalate: boolean;
  language: LocaleCode;
};

const TEXTS: Record<LocaleCode, Record<string, string>> = {
  ar: {
    greeting: "أهلًا بك في Astralium. أنا {name}، {specialty}. دعنا نجد ما يناسبك بدقة.",
    askGoal: "ما الهدف الذي تريد تحقيقه الآن: تعلّم مهارة، إطلاق مشروع، تصميم علامة تجارية، أم تنظيم عملك؟",
    askBudget: "وما الميزانية التقريبية التي تريحك لهذا الاختيار؟",
    recommend: "بناءً على هدفك وميزانيتك، هذه أقرب اختياراتنا:",
    recommendMore: "أستطيع تضييق القائمة أكثر إن أخبرتني بمستواك (مبتدئ/متقدم) أو صيغة تفضلها.",
    guardrail:
      "لا أستطيع مناقشة معلومات المالك أو الأنظمة الداخلية أو البيانات المالية. يمكنني مساعدتك في المنتجات، الطلبات، التحميل، والدعم فقط.",
    escalate:
      "هذه الحالة تحتاج مراجعة من فريق الدعم. أنشئ تذكرة من صفحة الدعم وسيتم متابعتها معك حتى الحل.",
    orderHelp: "أرسل رقم طلبك (مثال AST-XXXXXX) من صفحة الدعم لأراجع حالة التحميل والفواتير معك.",
    thanks: "سعيد بخدمتك. إن احتجت خطوة تالية، أنا هنا.",
    fallback:
      "لم أفهم طلبك تمامًا. أخبرني: ماذا تريد أن تحصل عليه، وما ميزانيتك، وما هدفك؟ وسأرشدك إلى المنتج الأنسب.",
    postPurchase:
      "أهلًا بك مجددًا. بعد الشراء، ملفاتك متاحة دائمًا في «حسابي → تحميل الملفات». هل تحتاج مساعدة في تفعيل الترخيص أو في الوصول للملف؟",
    payment: "ندعم الدفع بالبطاقات (Stripe: Visa/Mastercard وApple Pay وGoogle Pay) وPayPal، وجميع الروابط مشفّرة.",
    delivery: "التسليم فوري: بعد تأكيد الدفع تُنشأ روابط تحميل مؤقتة صالحة 72 ساعة، وتبقى نسخك متاحة في حسابك دائمًا.",
    human: "يمكنك أيضًا مراسلة فريق الدعم عبر التذاكر أو الدردشة، ووقت الاستجابة المعتاد أقل من 24 ساعة.",
  },
  en: {
    greeting: "Welcome to Astralium. I am {name}, your {specialty}. Let's find exactly what fits you.",
    askGoal: "What are you trying to achieve: learn a skill, launch a project, design a brand, or organise your work?",
    askBudget: "What budget feels comfortable for this choice?",
    recommend: "Based on your goal and budget, these are our closest matches:",
    recommendMore: "I can narrow this further if you tell me your level (beginner/advanced) or preferred format.",
    guardrail:
      "I can't discuss owner information, internal systems or financial data. I can help with products, orders, downloads and support only.",
    escalate: "This needs a support specialist. Open a ticket from the support page and the team will follow through with you.",
    orderHelp: "Share your order number (for example AST-XXXXXX) from the support page so I can review downloads and invoices.",
    thanks: "Delighted to help. If you need the next step, I'm here.",
    fallback: "Tell me what you want to achieve, your budget, and your goal — then I'll point you to the best fit.",
    postPurchase:
      "Welcome back. After purchase your files stay available in “My account → Downloads”. Do you need help activating the license or accessing a file?",
    payment: "We accept cards through Stripe (Visa/Mastercard, Apple Pay, Google Pay) and PayPal. Every link is encrypted.",
    delivery: "Delivery is instant: signed download links are issued once payment is confirmed, valid for 72 hours, and your files remain in your account.",
    human: "You can also reach the support team through tickets or chat; typical response time is under 24 hours.",
  },
  fr: {
    greeting: "Bienvenue chez Astralium. Je suis {name}, {specialty}. Trouvons ce qui vous convient.",
    askGoal: "Quel est votre objectif : apprendre une compétence, lancer un projet, créer une marque ou organiser votre travail ?",
    askBudget: "Quel budget vous conviendrait ?",
    recommend: "Selon votre objectif et votre budget, voici nos meilleures correspondances :",
    recommendMore: "Je peux affiner si vous précisez votre niveau ou le format préféré.",
    guardrail: "Je ne peux pas discuter des informations du propriétaire, des systèmes internes ou des données financières.",
    escalate: "Un spécialiste doit vérifier ce point. Ouvrez un ticket depuis la page d'assistance.",
    orderHelp: "Communiquez votre numéro de commande depuis la page d'assistance.",
    thanks: "Avec plaisir. Je reste disponible pour la suite.",
    fallback: "Dites-moi votre objectif, votre budget et ce que vous cherchez, et je vous guiderai.",
    postPurchase: "Après l'achat, vos fichiers restent disponibles dans « Mon compte → Téléchargements ».",
    payment: "Nous acceptons Stripe (Visa/Mastercard, Apple Pay, Google Pay) et PayPal.",
    delivery: "Livraison immédiate : des liens signés de 72 heures sont émis après confirmation du paiement.",
    human: "L'équipe d'assistance répond généralement en moins de 24 heures.",
  },
  es: {
    greeting: "Bienvenido a Astralium. Soy {name}, {specialty}. Encontremos lo que encaja contigo.",
    askGoal: "¿Qué quieres lograr: aprender una habilidad, lanzar un proyecto, diseñar una marca u organizar tu trabajo?",
    askBudget: "¿Qué presupuesto te resulta cómodo?",
    recommend: "Según tu objetivo y presupuesto, estas son nuestras mejores opciones:",
    recommendMore: "Puedo afinar la lista si me dices tu nivel o el formato preferido.",
    guardrail: "No puedo hablar sobre información del propietario, sistemas internos ni datos financieros.",
    escalate: "Esto requiere un especialista de soporte. Abre un ticket en la página de soporte.",
    orderHelp: "Comparte tu número de pedido desde la página de soporte.",
    thanks: "Un placer ayudarte. Aquí estoy para el siguiente paso.",
    fallback: "Cuéntame tu objetivo, tu presupuesto y qué buscas, y te orientaré.",
    postPurchase: "Tras la compra, tus archivos siguen disponibles en «Mi cuenta → Descargas».",
    payment: "Aceptamos Stripe (Visa/Mastercard, Apple Pay, Google Pay) y PayPal.",
    delivery: "Entrega inmediata: enlaces firmados de 72 horas tras confirmar el pago.",
    human: "El equipo de soporte suele responder en menos de 24 horas.",
  },
  de: {
    greeting: "Willkommen bei Astralium. Ich bin {name}, {specialty}. Finden wir das Passende.",
    askGoal: "Was möchten Sie erreichen: eine Fähigkeit lernen, ein Projekt starten, eine Marke gestalten oder Arbeit organisieren?",
    askBudget: "Welches Budget ist für Sie angenehm?",
    recommend: "Basierend auf Ziel und Budget empfehle ich:",
    recommendMore: "Ich kann es weiter eingrenzen, wenn Sie Niveau oder Format nennen.",
    guardrail: "Ich kann keine Eigentümerinformationen, internen Systeme oder Finanzdaten besprechen.",
    escalate: "Das braucht einen Support-Spezialisten. Bitte eröffnen Sie ein Ticket.",
    orderHelp: "Teilen Sie Ihre Bestellnummer über die Support-Seite.",
    thanks: "Gern geschehen. Ich bin für den nächsten Schritt da.",
    fallback: "Nennen Sie mir Ziel, Budget und Wunsch, dann führe ich Sie zum passenden Produkt.",
    postPurchase: "Nach dem Kauf bleiben Ihre Dateien unter „Mein Konto → Downloads“ verfügbar.",
    payment: "Wir akzeptieren Stripe (Visa/Mastercard, Apple Pay, Google Pay) und PayPal.",
    delivery: "Sofortige Lieferung: signierte 72-Stunden-Links nach Zahlungsbestätigung.",
    human: "Das Support-Team antwortet in der Regel in unter 24 Stunden.",
  },
  it: {
    greeting: "Benvenuto in Astralium. Sono {name}, {specialty}. Troviamo ciò che fa per te.",
    askGoal: "Qual è il tuo obiettivo: imparare una competenza, lanciare un progetto, creare un brand o organizzarti?",
    askBudget: "Quale budget ti sembra adatto?",
    recommend: "In base a obiettivo e budget, ecco le opzioni più vicine:",
    recommendMore: "Posso restringere se mi indichi il livello o il formato preferito.",
    guardrail: "Non posso discutere informazioni del proprietario, sistemi interni o dati finanziari.",
    escalate: "Serve uno specialista del supporto. Apri un ticket dalla pagina di supporto.",
    orderHelp: "Condividi il numero d'ordine dalla pagina di supporto.",
    thanks: "Felice di aiutarti. Sono qui per il passo successivo.",
    fallback: "Dimmi obiettivo, budget e cosa cerchi, e ti guiderò.",
    postPurchase: "Dopo l'acquisto i file restano in «Il mio account → Download».",
    payment: "Accettiamo Stripe (Visa/Mastercard, Apple Pay, Google Pay) e PayPal.",
    delivery: "Consegna immediata: link firmati di 72 ore dopo la conferma del pagamento.",
    human: "Il team di supporto risponde di solito entro 24 ore.",
  },
  pt: {
    greeting: "Bem-vindo à Astralium. Sou {name}, {specialty}. Vamos encontrar o que combina com você.",
    askGoal: "O que deseja alcançar: aprender uma competência, lançar um projeto, criar uma marca ou organizar o trabalho?",
    askBudget: "Que orçamento lhe parece confortável?",
    recommend: "Com base no objetivo e orçamento, estas são as melhores opções:",
    recommendMore: "Posso refinar se indicar o nível ou o formato preferido.",
    guardrail: "Não posso discutir informações do proprietário, sistemas internos ou dados financeiros.",
    escalate: "Isto requer um especialista de suporte. Abra um ticket na página de suporte.",
    orderHelp: "Partilhe o número do pedido na página de suporte.",
    thanks: "Foi um prazer. Estou aqui para o próximo passo.",
    fallback: "Diga-me o objetivo, o orçamento e o que procura, e eu oriento.",
    postPurchase: "Após a compra, os ficheiros ficam em «Minha conta → Downloads».",
    payment: "Aceitamos Stripe (Visa/Mastercard, Apple Pay, Google Pay) e PayPal.",
    delivery: "Entrega imediata: links assinados de 72 horas após a confirmação do pagamento.",
    human: "A equipa de suporte responde normalmente em menos de 24 horas.",
  },
  tr: {
    greeting: "Astralium'a hoş geldiniz. Ben {name}, {specialty}. Size en uygun olanı bulalım.",
    askGoal: "Hedefiniz ne: beceri öğrenmek, proje başlatmak, marka tasarlamak veya işinizi düzenlemek?",
    askBudget: "Sizin için rahat olan bütçe nedir?",
    recommend: "Hedefinize ve bütçenize göre en yakın seçenekler:",
    recommendMore: "Seviyenizi veya tercih ettiğiniz formatı söylerseniz daraltabilirim.",
    guardrail: "Sahip bilgileri, iç sistemler veya finansal veriler hakkında konuşamam.",
    escalate: "Bu bir destek uzmanı gerektiriyor. Destek sayfasından talep açın.",
    orderHelp: "Destek sayfasından sipariş numaranızı paylaşın.",
    thanks: "Yardımcı olabildiysem ne mutlu. Sonraki adım için buradayım.",
    fallback: "Hedefinizi, bütçenizi ve ne aradığınızı söyleyin, sizi yönlendireyim.",
    postPurchase: "Satın alma sonrası dosyalarınız «Hesabım → İndirmeler» bölümünde kalır.",
    payment: "Stripe (Visa/Mastercard, Apple Pay, Google Pay) ve PayPal kabul ediyoruz.",
    delivery: "Anında teslim: ödeme onayından sonra 72 saatlik imzalı bağlantılar.",
    human: "Destek ekibi genellikle 24 saat içinde yanıt verir.",
  },
  ru: {
    greeting: "Добро пожаловать в Astralium. Я {name}, {specialty}. Найдём подходящий вариант.",
    askGoal: "Какова ваша цель: освоить навык, запустить проект, разработать бренд или упорядочить работу?",
    askBudget: "Какой бюджет комфортен?",
    recommend: "С учётом цели и бюджета предлагаем:",
    recommendMore: "Могу уточнить, если укажете уровень или формат.",
    guardrail: "Я не могу обсуждать данные владельца, внутренние системы или финансовую информацию.",
    escalate: "Нужен специалист поддержки. Создайте тикет на странице поддержки.",
    orderHelp: "Сообщите номер заказа на странице поддержки.",
    thanks: "Рад помочь. Готов к следующему шагу.",
    fallback: "Скажите цель, бюджет и что ищете — я подскажу.",
    postPurchase: "После покупки файлы остаются в «Мой аккаунт → Загрузки».",
    payment: "Принимаем Stripe (Visa/Mastercard, Apple Pay, Google Pay) и PayPal.",
    delivery: "Мгновенная доставка: подписанные ссылки на 72 часа после оплаты.",
    human: "Поддержка отвечает обычно менее чем за 24 часа.",
  },
  zh: {
    greeting: "欢迎来到 Astralium。我是 {name}，{specialty}。让我们找到最适合您的选择。",
    askGoal: "您的目标是什么：学习技能、启动项目、打造品牌，还是整理工作？",
    askBudget: "您希望的价格范围是多少？",
    recommend: "根据您的目标和预算，最接近的选择是：",
    recommendMore: "告诉我您的水平或偏好格式，我可以进一步缩小范围。",
    guardrail: "我无法讨论店主信息、内部系统或财务数据。",
    escalate: "这需要支持专家处理。请在支持页面提交工单。",
    orderHelp: "请在支持页面提供订单号。",
    thanks: "很高兴能帮到您，随时继续。",
    fallback: "请告诉我您的目标、预算和需求，我会为您推荐。",
    postPurchase: "购买后文件始终保留在「我的账户 → 下载」中。",
    payment: "我们支持 Stripe（Visa/Mastercard、Apple Pay、Google Pay）与 PayPal。",
    delivery: "即时交付：付款确认后生成 72 小时签名下载链接。",
    human: "支持团队通常在 24 小时内回复。",
  },
  ja: {
    greeting: "Astralium へようこそ。{name}、{specialty}です。最適なものを一緒に探しましょう。",
    askGoal: "目標は何ですか：スキル習得、プロジェクト開始、ブランド設計、業務整理？",
    askBudget: "ご予算の目安を教えてください。",
    recommend: "目標と予算に基づくおすすめです：",
    recommendMore: "レベルやご希望の形式を教えていただければ絞り込みます。",
    guardrail: "オーナー情報、内部システム、財務データについてはお答えできません。",
    escalate: "サポート専門家が必要です。サポートページからチケットを作成してください。",
    orderHelp: "サポートページで注文番号をお知らせください。",
    thanks: "お役に立てて嬉しいです。次のステップもどうぞ。",
    fallback: "目標・予算・ご希望を教えていただければご案内します。",
    postPurchase: "購入後もファイルは「マイアカウント → ダウンロード」に残ります。",
    payment: "Stripe（Visa/Mastercard、Apple Pay、Google Pay）と PayPal に対応しています。",
    delivery: "即時納品：支払い確認後に72時間有効な署名付きリンクを発行します。",
    human: "サポートは通常24時間以内に返信します。",
  },
  hi: {
    greeting: "Astralium में आपका स्वागत है। मैं {name}, {specialty} हूँ। आइए सही चुनाव खोजें।",
    askGoal: "आपका लक्ष्य क्या है: कौशल सीखना, प्रोजेक्ट शुरू करना, ब्रांड डिज़ाइन या काम व्यवस्थित करना?",
    askBudget: "आपके लिए आरामदायक बजट क्या है?",
    recommend: "आपके लक्ष्य और बजट के आधार पर सबसे उपयुक्त विकल्प:",
    recommendMore: "स्तर या पसंदीदा फॉर्मेट बताएँ तो और सीमित कर सकता हूँ।",
    guardrail: "मैं मालिक की जानकारी, आंतरिक सिस्टम या वित्तीय डेटा पर चर्चा नहीं कर सकता।",
    escalate: "इसके लिए सहायता विशेषज्ञ चाहिए। सहायता पेज से टिकट खोलें।",
    orderHelp: "सहायता पेज पर अपना ऑर्डर नंबर साझा करें।",
    thanks: "मदद करके खुशी हुई। अगले कदम के लिए मैं यहाँ हूँ।",
    fallback: "अपना लक्ष्य, बजट और आवश्यकता बताइए, मैं मार्गदर्शन करूँगा।",
    postPurchase: "खरीद के बाद फ़ाइलें «मेरा खाता → डाउनलोड» में रहती हैं।",
    payment: "हम Stripe (Visa/Mastercard, Apple Pay, Google Pay) और PayPal स्वीकार करते हैं।",
    delivery: "तुरंत डिलीवरी: भुगतान पुष्टि के बाद 72 घंटे के हस्ताक्षरित लिंक।",
    human: "सहायता टीम आमतौर पर 24 घंटे के भीतर जवाब देती है।",
  },
};

const GUARDRAIL =
  /(owner|admin|administrator|dashboard|bank|iban|swift|bic|salary|profit|api[\s_-]?key|password|secret|مالك|مدير|المدير|لوحة التحكم|بنك|بنكي|ايبان|آيبان|سويفت|مفاتيح|كلمة المرور|كلمة السر|الراتب|أرباح|ارباح|بيانات العملاء|بيانات بنكية)/i;

const HUMAN_REQUEST = /(human|agent person|refund|complaint|dispute|بشري|موظف حقيقي|استرجاع|شكوى|تذكرة)/i;

function detectLanguage(text: string, fallback: LocaleCode): LocaleCode {
  if (/[\u0600-\u06FF]/.test(text)) return "ar";
  if (/[\u0400-\u04FF]/.test(text)) return "ru";
  if (/[\u4E00-\u9FFF]/.test(text)) return "zh";
  if (/[\u3040-\u30FF]/.test(text)) return "ja";
  if (/[\u0900-\u097F]/.test(text)) return "hi";
  return fallback;
}

function format(text: string, vars: Record<string, string>) {
  return Object.entries(vars).reduce((acc, [key, value]) => acc.replaceAll(`{${key}}`, value), text);
}

const CATEGORY_HINTS: { category: string; words: string[] }[] = [
  { category: "ebook", words: ["كتاب", "كتب", "ebook", "book", "livre", "libro", "buch", "livro", "kitap", "книга", "书", "本", "पुस्तक"] },
  { category: "audiobook", words: ["صوتي", "صوتية", "audiobook", "audio book", "hörbuch", "audiolibro"] },
  { category: "template", words: ["قالب", "قوالب", "template", "modèle", "plantilla", "vorlage", "modelo", "şablon", "шаблон", "模板", "टेम्पलेट"] },
  { category: "course", words: ["دورة", "دورات", "course", "cours", "curso", "kurs", "курс", "课程", "कोर्स"] },
  { category: "software", words: ["برنامج", "برمجية", "software", "app", "logiciel", "programa", "yazılım", "программа", "软件", "सॉफ़्टवेयर"] },
  { category: "video", words: ["فيديو", "video", "vidéo", "vídeo", "видео", "视频", "वीडियो"] },
  { category: "image", words: ["صورة", "صور", "image", "photo", "preset", "bild", "imagen", "изображение", "图片", "तस्वीर"] },
  { category: "audio", words: ["موسيقى", "صوتيات", "music", "audio", "son", "musik", "музыка", "音乐", "संगीत"] },
  { category: "bundle", words: ["حزمة", "باقة", "bundle", "pack", "lot", "paket", "набор", "套装", "बंडल"] },
];

function extractBudget(text: string): number | null {
  const match = text.match(/(\d{1,6}(?:[.,]\d{1,2})?)/);
  if (!match) return null;
  const value = Number(match[1].replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

function recommend(catalog: CatalogItem[], query: string, budget: number | null) {
  const lower = query.toLowerCase();
  const categories = CATEGORY_HINTS.filter((hint) => hint.words.some((word) => lower.includes(word.toLowerCase()))).map(
    (hint) => hint.category,
  );
  const scored = catalog.map((item) => {
    let score = 0;
    const haystack = `${item.title} ${item.titleEn ?? ""} ${item.subtitle ?? ""} ${item.description} ${item.tags.join(" ")}`.toLowerCase();
    for (const token of lower.split(/\s+/).filter((t) => t.length > 2)) {
      if (haystack.includes(token)) score += 2;
    }
    if (categories.includes(item.category)) score += 3;
    if (budget !== null) {
      const price = item.priceCents / 100;
      if (price <= budget) score += 2;
      else score -= 3;
    }
    return { item, score };
  });
  return scored
    .sort((a, b) => b.score - a.score || a.item.priceCents - b.item.priceCents)
    .slice(0, 3)
    .filter((entry, index) => entry.score > 0 || index === 0)
    .map((entry) => entry.item);
}

const QUICK: Record<string, string[]> = {
  ar: ["أريد كتابًا إلكترونيًا", "أبحث عن قالب احترافي", "ما ميزانيتي المناسبة؟", "كيف أستلم الملف بعد الدفع؟"],
  en: ["I want an ebook", "Looking for a professional template", "What budget do I need?", "How do I receive the file?"],
};

export function generateAgentReply(input: {
  agent: AgentProfile;
  messages: ChatMessage[];
  locale: LocaleCode;
  catalog: CatalogItem[];
}): AgentReply {
  const { agent, messages, catalog } = input;
  const lastUser = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
  const fullUserText = messages.filter((m) => m.role === "user").map((m) => m.content).join(" ");
  const locale = detectLanguage(fullUserText, input.locale);
  const texts = TEXTS[locale] ?? TEXTS.en;
  const quickReplies = QUICK[locale] ?? QUICK.en;
  const greeting = format(locale === "ar" ? agent.greeting : agent.greetingEn || agent.greeting, {
    name: agent.name,
    specialty: agent.specialty,
  });

  if (GUARDRAIL.test(lastUser)) {
    return { reply: texts.guardrail, quickReplies, recommendations: [], escalate: false, language: locale };
  }

  if (!lastUser.trim()) {
    return { reply: greeting, quickReplies, recommendations: [], escalate: false, language: locale };
  }

  if (HUMAN_REQUEST.test(lastUser)) {
    return { reply: `${texts.escalate}\n${texts.human}`, quickReplies, recommendations: [], escalate: true, language: locale };
  }

  if (/(order|طلب|pedido|commande|bestellung|ordine|sipariş|заказ|订单|注文|ऑर्डर)/i.test(lastUser) && /([A-Z]{2,4}-\d{4,}|\d{5,})/.test(lastUser)) {
    return { reply: texts.orderHelp, quickReplies, recommendations: [], escalate: true, language: locale };
  }

  if (/(pay|payment|دفع|payer|pago|zahlung|pagamento|öde|оплат|支付|支払|भुगतान)/i.test(lastUser)) {
    return { reply: `${texts.payment}\n${texts.delivery}`, quickReplies, recommendations: [], escalate: false, language: locale };
  }

  if (/(download|تحميل|télécharg|descarg|herunterlad|scarica|baixar|indir|скач|下载|ダウンロード|डाउनलोड)/i.test(lastUser)) {
    return { reply: `${texts.delivery}\n${texts.postPurchase}`, quickReplies, recommendations: [], escalate: false, language: locale };
  }

  if (/(thanks|thank you|شكرا|شكرًا|merci|gracias|danke|grazie|obrigad|teşekkür|спасибо|谢谢|ありがとう|धन्यवाद)/i.test(lastUser)) {
    return { reply: texts.thanks, quickReplies, recommendations: [], escalate: false, language: locale };
  }

  const budget = extractBudget(fullUserText);
  const userTurns = messages.filter((m) => m.role === "user").length;
  const matches = recommend(catalog, fullUserText, budget);
  const isPostPurchase = /(متابعة|follow|post|retention)/i.test(agent.specialty) || agent.slug.includes("follow");

  if (isPostPurchase && userTurns <= 1) {
    return {
      reply: texts.postPurchase,
      quickReplies,
      recommendations: matches.slice(0, 2).map((item) => ({
        slug: item.slug,
        title: item.title,
        priceCents: item.priceCents,
        category: item.category,
        coverStyle: item.coverStyle,
        coverGlyph: item.coverGlyph,
      })),
      escalate: false,
      language: locale,
    };
  }

  if (matches.length > 0 && (budget !== null || userTurns >= 2 || CATEGORY_HINTS.some((h) => h.words.some((w) => fullUserText.toLowerCase().includes(w.toLowerCase()))))) {
    const list = matches
      .map((item) => `• ${locale === "ar" ? item.title : item.titleEn || item.title} — ${(item.priceCents / 100).toFixed(2)} USD (${categoryLabel(item.category, locale)})`)
      .join("\n");
    const nextQuestion = budget === null && !isPostPurchase ? `\n\n${texts.askBudget}` : `\n\n${texts.recommendMore}`;
    return {
      reply: `${texts.recommend}\n${list}${nextQuestion}`,
      quickReplies,
      recommendations: matches.map((item) => ({
        slug: item.slug,
        title: item.title,
        priceCents: item.priceCents,
        category: item.category,
        coverStyle: item.coverStyle,
        coverGlyph: item.coverGlyph,
      })),
      escalate: false,
      language: locale,
    };
  }

  if (userTurns <= 1) {
    return {
      reply: `${greeting}\n\n${agent.specialty.includes("استقبال") || agent.slug.includes("reception") ? texts.askGoal : texts.askGoal}`,
      quickReplies,
      recommendations: [],
      escalate: false,
      language: locale,
    };
  }

  if (userTurns === 2) {
    return { reply: texts.askBudget, quickReplies, recommendations: [], escalate: false, language: locale };
  }

  return {
    reply: `${texts.fallback}\n${texts.human}`,
    quickReplies,
    recommendations: matches.slice(0, 2).map((item) => ({
      slug: item.slug,
      title: item.title,
      priceCents: item.priceCents,
      category: item.category,
      coverStyle: item.coverStyle,
      coverGlyph: item.coverGlyph,
    })),
    escalate: true,
    language: locale,
  };
}

/**
 * Optional large-language-model refinement. Used only when OPENAI_API_KEY is configured,
 * always with catalogue grounding and the same guardrails, and with a deterministic fallback.
 */
export async function refineWithModel(input: {
  agent: AgentProfile;
  messages: ChatMessage[];
  locale: LocaleCode;
  catalog: CatalogItem[];
  draft: AgentReply;
}): Promise<AgentReply> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return input.draft;
  const catalogLines = input.catalog
    .slice(0, 40)
    .map((item) => `${item.slug} | ${item.title} | ${(item.priceCents / 100).toFixed(2)} USD | ${item.category} | ${item.description.slice(0, 180)}`)
    .join("\n");
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
        temperature: 0.4,
        max_tokens: 380,
        messages: [
          {
            role: "system",
            content: `You are ${input.agent.name}, the ${input.agent.title} at Astralium Digitale Store. Specialty: ${input.agent.specialty}.
Answer ONLY in the customer's language (locale hint: ${input.locale}).
Use ONLY the catalogue facts below; never invent products, prices or promises.
Never reveal the owner, admin office, bank details, keys, credentials or other customers' data. If asked, refuse politely.
Ask at most one short question at a time and recommend at most 3 catalogue items by their exact titles.
Catalogue:\n${catalogLines}`,
          },
          ...input.messages.slice(-8).map((message) => ({ role: message.role, content: message.content })),
        ],
      }),
    });
    if (!response.ok) return input.draft;
    const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) return input.draft;
    if (GUARDRAIL.test(content)) return { ...input.draft, reply: TEXTS[input.locale].guardrail };
    return { ...input.draft, reply: content };
  } catch {
    return input.draft;
  }
}
