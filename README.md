# Astralium Digitale Store

متجر رقمي فاخر كامل (Next.js App Router + PostgreSQL + Drizzle ORM) مع مكتب مدير محمي، فريقين من الموظفين الاصطناعيين، ونظام دفع متعدد البوابات مع تسليم فوري آمن.

A complete luxury digital storefront and owner's office built with Next.js 16 (App Router), PostgreSQL and Drizzle ORM — AI employees, multi-gateway checkout, signed instant delivery, and a hard-protected admin office.

---

## 1) ما تم تسليمه / What is included

### واجهة المتجر (للمشترين)
| المسار | الوصف |
| --- | --- |
| `/` | الرئيسية: واجهة أصلية، مختارات، تصنيفات، فريق العملاء الاصطناعي، العروض، المدونة |
| `/catalog` | كل ما هو رقمي: بحث، تصنيفات، فلتر سعر، ترتيب (5 طرق)، ترقيم صفحات |
| `/product/[slug]` | صفحة المنتج: وصف كامل، سعر بعملتك، تقييمات، ترخيص، شراء مباشر، منتجات مشابهة، JSON-LD |
| `/agents` | الموظفون الاصطناعيون للعملاء: استقبال، مبيعات، دعم، متابعة ما بعد الشراء + دردشة فورية |
| `/support` | مركز دعم: أسئلة شائعة، تذاكر، دردشة دعم اصطناعية |
| `/account` | حسابي: المشتريات، التحميلات، الفواتير، الإعدادات (تسجيل/دخول/خروج) |
| `/checkout`, `/checkout/pay/[n]`, `/checkout/success/[n]` | دفع بخطوة واحدة، بوابة اختبار، تأكيد وتسليم |
| `/invoice/[n]` | فاتورة إلكترونية قابلة للطباعة (محمية برابط أو جلسة) |
| `/wishlist` | قائمة أمنيات محلية |
| `/offers` | كوبونات نشطة + إصدارات مخفّضة |
| `/blog`, `/blog/[slug]` | مدونة/أخبار مع SEO |
| `/referral` | برنامج إحالة برمز شخصي |
| `/about`, `/privacy`, `/terms`, `/refunds`, `/contact` | صفحات قانونية وتواصل بمحتوى كامل |

### مكتب المدير (المالك فقط) — `/admin`
لوحة القيادة (إيرادات، رسم شهري، أكثر مبيعًا، سجل عمليات) · الطلبات (بحث/فلترة/استرجاع/فاتورة) · المنتجات (إنشاء وتعديل ورفع ملف حتى 30MB وأرشفة) · العملاء · الكوبونات · الموظفون الاصطناعيون (فريق العملاء + فريقي الخاص) · فريق المدير الذكي (أوامر تنفيذية) · الدعم والتذاكر ورسائل الاتصال · التصميم والمحتوى والضرائب · اللغات · الدفع والحساب البنكي (خزنة مشفّرة) · الأمان والنسخ الاحتياطي (2FA، جلسات، سجل، تنزيل نسخة).

---

## 2) التشغيل المحلي / Local setup

```bash
npm install
# 1) تأكد أن PostgreSQL يعمل ثم:
npx drizzle-kit push          # إنشاء الجداول
node scripts/seed.mjs         # تهيئة أولية: المالك + كتالوج بداية + الأسئلة + المقالات
npm run dev                   # أو: npm run build && npm run start
```

المتغيرات موجودة في `.env` (قابلة للتغيير):

```
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db
APP_ENCRYPTION_KEY=...        # مفتاح تشفير خزنة بيانات البنك
ADMIN_EMAIL=owner@astralium.store
ADMIN_PASSWORD=Astralium!Owner2026
ADMIN_TOTP_SECRET=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

### بيانات دخول مكتب المدير (تُغيّر فورًا بعد أول دخول)

- الرابط: `/admin/login`
- البريد: `owner@astralium.store`
- كلمة المرور: `Astralium!Owner2026`
- التحقق الثنائي: أضف المفتاح `JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP` في Google Authenticator / 1Password (TOTP، 30 ثانية، 6 أرقام). يمكنك أيضًا مسح رمز QR الظاهر في `/admin/security`.

> بعد الدخول: `/admin/security` ← غيّر كلمة المرور، ثم «توليد مفتاح جديد» لـ2FA حتى يصبح المفتاح خاصًا بك وحدك.

---

## 3) الدفع / Payments

- **Stripe** (بطاقات، Apple Pay، Google Pay) و**PayPal**، مع بوابة اختبار حتمية (Sandbox) لاختبار المسار كاملًا.
- المفاتيح تُقرأ من متغيرات بيئة الخادم فقط ولا تُخزَّن في قاعدة البيانات ولا تُرسل للواجهة:

```
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
PAYPAL_WEBHOOK_ID=
PAYPAL_ENV=sandbox            # أو live
RESEND_API_KEY=               # اختياري: بريد المعاملات (بدونه يُحفظ في صندوق صادر)
MAIL_FROM="Astralium Digitale Store <care@astralium.store>"
OPENAI_API_KEY=               # اختياري: تحسين ردود الموظفين (بدونه محرك محلي حتمي)
```

**Webhooks:**
- Stripe: `https://YOUR_DOMAIN/api/webhooks/stripe` (حدث: `checkout.session.completed`، والتحقق من توقيع `stripe-signature`).
- PayPal: `https://YOUR_DOMAIN/api/webhooks/paypal` (حدث: `PAYMENT.CAPTURE.COMPLETED`، مع تحقق عبر PayPal API).

**الحماية المطبّقة:** منع تكرار الدفع لنفس البريد/المنتج، منع معالجة الطلب مرتين (قفل المعاملة + بادئة حدث فريد)، عدم تسليم أي ملف قبل `paid`، استرجاع يُلغي الوصول، روابط تحميل موقّعة تنتهي بعد 72 ساعة مع حد تحميل لكل ترخيص.

**اختبار المسار كاملًا (كما تم فحصه قبل التسليم):**

```bash
# 1) أنشئ طلبًا من /checkout واختر «بوابة الاختبار الآمنة»
# 2) في صفحة الدفع اضغط «محاكاة دفع ناجح» → ستظهر صفحة نجاح + رابط تحميل + فاتورة
# 3) اختبر «محاكاة دفع فاشل» → لا ملف، والطلب يصبح failed
# 4) كرر الشراء بنفس البريد/المنتج → يُرفض ويُعاد توجيهك إلى نسختك (منع التكرار)
```

---

## 4) الموظفون الاصطناعيون / AI employees

- **فريق العملاء** (`/agents`): استقبال، مبيعات، دعم، متابعة ما بعد الشراء. يسألون سؤالًا قصيرًا واحدًا، يرشّحون حتى 3 منتجات من الكتالوج الفعلي، يكتشفون لغة الرسالة ويجيبون بها (12 لغة)، ويحوّلون للدعم عند الحاجة.
- **فريقي الخاص** (`/admin/ai`): أوامر تنفيذية (منتجات وأسعار، كوبونات، تحليل مبيعات، مراقبة مدفوعات، تذاكر، محتوى وإعلانات، تصميم). لا تظهر تعريفتهم في أي صفحة عامة، و`/api/ai/chat` يرفض أي وكيل `team=manager`.
- **الحواجز (Guardrails):** رفض أي سؤال عن المالك/المدير/البنك/المفاتيح/كلمات المرور، عدم اختراع أسعار أو منتجات، ولا تُطبع الأسرار في محادثة المدير. تُسجَّل المحاولات في سجل الأمان.

---

## 5) الأمان / Security

- كلمة مرور المالك: scrypt (salt عشوائي). جلسات: رمز عشوائي 256-bit، مخزّن مُجزَّأ، كوكي HttpOnly + SameSite، انتهاء 8 ساعات.
- 2FA إلزامي (TOTP) مع نافذة انجراف ±30 ثانية وخطوة تحقق مؤقتة 5 دقائق.
- تحديد محاولات: 6 محاولات فاشلة لكل بريد/IP خلال 15 دقيقة → إيقاف مؤقت.
- ترويسات أمان (HSTS في الإنتاج، X-Frame-Options DENY، nosniff، Referrer-Policy، Permissions-Policy)، حماية `/admin` في middleware على مستوى الحافة + تحقق كامل في الخادم.
- خزنة بيانات البنك: AES-256-GCM بمفتاح مشتق من `APP_ENCRYPTION_KEY`، ولا تُعرض كاملة بعد الحفظ.
- سجل عمليات كامل (`audit_logs`) لكل دخول/تعديل/استرجاع/أمر ذكاء اصطناعي.
- نسخة احتياطية JSON من `/api/admin/backup` (بصلاحية المالك، بدون أسرار أو هاشات أو خزنة البنك).

---

## 6) اللغات / Languages

- 12 لغة: العربية (افتراضية، RTL تلقائي)، الإنجليزية، الفرنسية، الإسبانية، الألمانية، الإيطالية، البرتغالية، التركية، الروسية، الصينية، اليابانية، الهندية.
- مبدّل واضح في الرأس والتذييل، تخزين في كوكي، اكتشاف تلقائي من `Accept-Language` عبر middleware، وتبديل اتجاه الواجهة.
- العربية والإنجليزية مترجمتان بالكامل في الواجهة؛ العشر لغات الأخرى تغطي التنقل والواجهة الأساسية والدفع وتُكمل بالإنجليزية عند غياب الترجمة. محتوى المنتجات/المقالات/الصفحات القانونية بالعربية والإنجليزية (حقول EN في كل منتج).
- الأسعار تُعرض وتُحصَّل بـ14 عملة مع تحويل تلقائي وحساب ضريبة اختياري.

---

## 7) النشر / Deployment

### Vercel + قاعدة بيانات مُدارة
1. ارفع المستودع إلى GitHub ثم «Import Project» في Vercel.
2. أضف قاعدة PostgreSQL (Neon/Supabase/RDS) وانسخ سلسلة الاتصال إلى `DATABASE_URL`.
3. أضف متغيرات البيئة: `APP_ENCRYPTION_KEY` (64 hex) + مفاتيح Stripe/PayPal + `NEXT_PUBLIC_SITE_URL=https://YOUR_DOMAIN`. أضف `RESEND_API_KEY` لبريد المعاملات.
4. بعد أول نشر: `npx drizzle-kit push` ثم `node scripts/seed.mjs` (من جهازك مع نفس `DATABASE_URL`).
5. سجّل Webhooks:
   - Stripe → `https://YOUR_DOMAIN/api/webhooks/stripe` ثم انسخ `whsec_...` إلى `STRIPE_WEBHOOK_SECRET`.
   - PayPal → `https://YOUR_DOMAIN/api/webhooks/paypal` ثم انسخ Webhook ID إلى `PAYPAL_WEBHOOK_ID`.
6. ادخل `/admin/login`، أكمل 2FA، غيّر كلمة المرور والمفتاح، أدخل بياناتك البنكية في `/admin/payments`، ثم أوقف وضع الاختبار بعد إنهاء اختبار مسار الدفع.
7. HTTPS يُفعّل تلقائيًا على Vercel. خذ نسخة من `/api/admin/backup` دوريًا، وفعّل `pg_dump` يوميًا لتخزين مشفّر.

### تشغيل على خادم خاص
`npm ci && npm run build && npm run start` خلف Nginx/Cloudflare، مع PostgreSQL محلي أو مُدار، و`APP_ENCRYPTION_KEY` في مدير أسرار (لا يُحفظ في Git).

---

## 8) قائمة ما تحتاج أنت فعله / Owner checklist

1. غيّر كلمة مرور المالك ومفتاح 2FA من `/admin/security` (الأولوية الأولى).
2. أدخل بياناتك البنكية في `/admin/payments` (اسم صاحب الحساب، البنك، IBAN، SWIFT/BIC، الدولة، العملة، الرقم الضريبي). تُخزَّن مشفّرة وتظهر مخفية.
3. أضف مفاتيح Stripe وPayPal في متغيرات بيئة الخادم (Vercel) وسجّل Webhooks.
4. اضبط `RESEND_API_KEY` و`MAIL_FROM` لتفعيل إرسال الفواتير والبريد (بدونهما يُحفظ البريد في صندوق صادر داخل قاعدة البيانات).
5. راجع الكتالوج المبدئي (10 إصدارات كتبتها كبداية تحريرية)، وعدّل/احذف/أضف منتجاتك وملفاتك من `/admin/products` — لا يُضاف أي منتج من طرفنا بعد ذلك.
6. أكمل مفاتيح بوابات إضافية عند الحاجة (أضف مزوّدًا جديدًا في `src/lib/payments.ts`).
7. بعد اختبار الدفع في وضع الاختبار، أوقف وضع الاختبار من `/admin/payments` ليُعرض Stripe/PayPal فقط.
8. راجع الضريبة (افتراضيًا 0%) وسياسة الاسترجاع (14 يومًا) في `/admin/design`، ونصوص الواجهة والتواصل.

---

## 9) البنية / Project structure

```
src/
  app/
    (store)/…            صفحات المتجر العامة (رأس/تذييل مشتركان)
    admin/login          دخول المالك
    admin/(office)/…     مكتب المدير المحمي (14 قسمًا)
    api/                 ai/chat · download · products · webhooks/{stripe,paypal} · admin/backup · health
    actions.ts           Server Actions العامة (شراء، تذاكر، حساب العميل…)
  components/            واجهات المتجر + مكونات المكتب + الدردشة الذكية
  db/                    schema.ts (Drizzle) + index.ts (Pool)
  lib/                   crypto · auth · payments · downloads · mail · ai · settings · store · i18n · money
scripts/seed.mjs         تهيئة أولية قابلة للتكرار (idempotent)
storage/uploads/         ملفات المنتجات المرفوعة (لا تُخزَّن في قاعدة البيانات)
```

## 10) ملاحظات صحة التشغيل / Known operational notes

- بوابة «الاختبار الآمنة» تعمل فقط عندما يكون وضع الاختبار مفعّلًا أو لا توجد مفاتيح حقيقية.
- حفظ الملفات المرفوعة يتم على قرص الخادم (`storage/uploads`). على Vercel (نظام ملفات مؤقت) استخدم تخزين كائنات (S3/R2) — موضع الاستبدال محدد في `saveProduct` و`/api/download`.
- بدون `OPENAI_API_KEY` يعمل الموظفون بمحرك محلي حتمي مبني على الكتالوج (نفس الحواجز واللغات).
- الفحص النهائي المنفذ قبل التسليم: `next typegen` + `tsc --noEmit` + `next build` + `build_and_start` (healthcheck)، واختبار مسار الشراء عبر بوابة الاختبار والتحميل والفاتورة والاسترجاع ومنع التكرار.
