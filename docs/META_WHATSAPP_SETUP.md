# Meta + WhatsApp setup — دليل إعداد ميتا وواتساب

*Owner-only setup for Phase 2 social delivery (WhatsApp / Messenger /
Instagram). Everything below is done by the store owner in Meta's own
dashboards — the store never sees your Meta password, and no key is ever
typed into the store's code. Keys go into environment variables only
(Vercel → Project → Settings → Environment Variables, or `.env.local`).*

*هذا الدليل خاص بمالك المتجر: كل الخطوات تتم في لوحات ميتا نفسها، والمفاتيح
تُدخل في متغيرات البيئة فقط — لا تُكتب في الكود أبداً.*

---

## 1. Business verification — توثيق النشاط التجاري

1. Go to **business.facebook.com** → create/select your Business account.
2. **Business Settings → Business Info** → start **Business Verification**
   (legal business name, address, tax/registration document, phone/email
   confirmation). Approval can take from hours to a few days.
3. في **إعدادات النشاط التجاري → معلومات النشاط** ابدأ **توثيق النشاط**
   بالمستندات الرسمية (الاسم القانوني، العنوان، مستند التسجيل). الموافقة
   قد تستغرق من ساعات إلى أيام.

## 2. Meta App — إنشاء التطبيق

1. **developers.facebook.com → My Apps → Create App** → type **Business**.
2. Add products: **WhatsApp**, **Messenger**, **Instagram** (Instagram
   Graph API / Instagram messaging).
3. **App Settings → Basic**: copy the **App Secret** →
   `META_APP_SECRET` (used to verify every webhook signature).
4. If the app will message customers beyond test users, it must pass
   **App Review** for: `whatsapp_business_messaging`,
   `pages_messaging`, `instagram_manage_messages`, plus Advanced Access
   for the business permissions. Submit with a screencast showing the
   claim-code flow (checkout → success page → customer sends code →
   receives link).

## 3. WhatsApp Business number — رقم واتساب للأعمال

1. In the app: **WhatsApp → API Setup** → add a **dedicated phone number**
   (it becomes a WhatsApp Business number; a number already used by the
   personal WhatsApp app must be migrated or replaced — use a fresh SIM/
   eSIM number to avoid losing a personal account).
2. Copy from API Setup:
   - **Phone number ID** → `WHATSAPP_PHONE_NUMBER_ID`
   - **Temporary/permanent access token** → `WHATSAPP_ACCESS_TOKEN`
     (create a **permanent** token via Business Settings → System Users →
     generate token with `whatsapp_business_messaging` +
     `whatsapp_business_management`).
   - The number itself in international format → `WHATSAPP_BUSINESS_NUMBER`
3. Invent any long random string → `WHATSAPP_VERIFY_TOKEN`, and enter the
   same value in **WhatsApp → Configuration → Webhook**:
   - Callback URL: `https://<your-domain>/api/webhooks/whatsapp`
   - Verify token: the same string
   - Subscribe to the **`messages`** field.
4. **Templates:** WhatsApp Manager → Message templates → submit
   `astralium_delivery` exactly as written in `docs/whatsapp-template.md`
   (Utility category, en_US + ar). It must be **Approved** before
   proactive sends work.

## 4. Facebook Page + Instagram — صفحة فيسبوك وإنستغرام

1. The store needs a **Facebook Page** (create one for the store if none).
   Page ID is in Page Settings → About → `META_PAGE_ID`.
2. **Instagram:** switch the store's account to a **Professional**
   (Business/Creator) account and link it to the Page (Page Settings →
   Linked Accounts → Instagram). Username (without @) →
   `INSTAGRAM_USERNAME`.
3. In the app: **Messenger → Settings** → link the Page → generate a
   **Page Access Token** → `META_PAGE_ACCESS_TOKEN`.
   **Instagram → API Setup** → generate the Instagram token →
   `INSTAGRAM_ACCESS_TOKEN`.
4. Webhooks (App → Webhooks):
   - **Page** object → callback `https://<your-domain>/api/webhooks/meta`,
     verify token = `META_WEBHOOK_VERIFY_TOKEN` (invented by you),
     subscribe: `messages`, `messaging_postbacks`, `messaging_referrals`.
   - **Instagram** object → same callback + token, subscribe: `messages`.

## 5. Environment variables — متغيرات البيئة

| Variable | Where it comes from |
|---|---|
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp → API Setup |
| `WHATSAPP_ACCESS_TOKEN` | System User permanent token |
| `WHATSAPP_BUSINESS_NUMBER` | Your WhatsApp Business number, e.g. +2126… |
| `WHATSAPP_VERIFY_TOKEN` | Invented by you (step 3.3) |
| `WHATSAPP_TEMPLATE_NAME` | `astralium_delivery` (default) |
| `META_APP_SECRET` | App Settings → Basic |
| `META_WEBHOOK_VERIFY_TOKEN` | Invented by you (step 4.4) |
| `META_PAGE_ID` | Page Settings → About |
| `META_PAGE_ACCESS_TOKEN` | Messenger → Settings (Page token) |
| `INSTAGRAM_USERNAME` | The store's IG username |
| `INSTAGRAM_ACCESS_TOKEN` | Instagram → API Setup |
| `PII_ENCRYPTION_KEY` | Invented by you — long random string; encrypts stored phone numbers |

Then, in the store admin (**Feature flags**), turn ON
`delivery_whatsapp` / `delivery_messenger` / `delivery_instagram` one at a
time and test each with a real order of your own before announcing it.

## 6. Costs — التكاليف

- **Replies inside the 24h window are free** (the claim-code flow lives
  entirely in that window: the customer messages first).
- **Proactive template messages** (the store messages first, e.g. right
  after checkout) are billed by WhatsApp **per delivered message** at the
  Utility rate for the *recipient's* country — typically a few US cents
  or less; rates are published by Meta ("WhatsApp pricing") and change
  per country. Budget accordingly; there is no charge from the store
  software itself.
- Messenger/Instagram claim replies have no per-message fee.

## 7. What the store does with all this — كيف يعمل النظام

- Checkout: the customer may pick WhatsApp and enter a number with an
  explicit opt-in. The number is stored **encrypted + hashed** only.
- Success page: buttons for WhatsApp (`wa.me`), Messenger (`m.me`),
  Instagram (`ig.me`) with a one-time delivery code.
- Customer sends the code → webhook verifies → store replies with signed,
  expiring download links. Email is always the automatic fallback.
- `STOP` on WhatsApp opts the number out immediately.
- Admin → **Delivery channels**: readiness, template name, stats, the
  delivery log, and manual resend.
