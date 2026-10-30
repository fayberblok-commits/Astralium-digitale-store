# WhatsApp template — `astralium_delivery`

Submit this template for approval in **Meta Business Suite → WhatsApp
Manager → Message templates → Create template**:

- **Name:** `astralium_delivery` (must match `WHATSAPP_TEMPLATE_NAME`)
- **Category:** Utility (order/delivery notification — NOT marketing)
- **Languages to submit:** English (`en_US`) and Arabic (`ar`) at minimum;
  add more from the list below as you expand. The store requests the
  customer's locale when it is one of: en_US, ar, fr, es, de, pt_BR, it,
  nl, tr, hi, id, ur — otherwise it falls back to `en_US`.

## Parameters (sent by the store, in order)

| Param | Meaning |
|---|---|
| `{{1}}` | Order reference (e.g. `AST-M3KZ8Q2`) |
| `{{2}}` | The store's signed download link (short-lived, limited use) |

## English (en_US)

**Body:**
```
Your Astralium order {{1}} is ready ✦
Download your product here: {{2}}
The link is personal, works a limited number of times and expires in 7 days. Reply STOP to opt out of WhatsApp delivery.
```

## العربية (ar)

**نص الرسالة:**
```
طلبك {{1}} من متجر أستراليوم جاهز ✦
حمّل منتجك من هنا: {{2}}
الرابط شخصي، يعمل لعدد محدود من المرات وينتهي بعد 7 أيام. ردّ بـ STOP لإيقاف رسائل واتساب.
```

## Other languages (submit as needed)

**Français (fr):**
```
Votre commande Astralium {{1}} est prête ✦
Téléchargez votre produit ici : {{2}}
Le lien est personnel, utilisable un nombre limité de fois et expire dans 7 jours. Répondez STOP pour vous désinscrire.
```

**Español (es):**
```
Tu pedido de Astralium {{1}} está listo ✦
Descarga tu producto aquí: {{2}}
El enlace es personal, funciona un número limitado de veces y caduca en 7 días. Responde STOP para cancelar.
```

**Deutsch (de):**
```
Ihre Astralium-Bestellung {{1}} ist bereit ✦
Laden Sie Ihr Produkt hier herunter: {{2}}
Der Link ist persönlich, begrenzt nutzbar und läuft in 7 Tagen ab. Antworten Sie STOP zum Abmelden.
```

## Notes

- Utility templates are charged per delivered message at WhatsApp's
  utility rate for the recipient's country (see docs/META_WHATSAPP_SETUP.md).
- Keep the wording transactional: adding promotional language can get the
  template reclassified as Marketing or rejected in review.
- After approval, the template name stays `astralium_delivery` in every
  language — language is a separate dimension in WhatsApp Manager.
