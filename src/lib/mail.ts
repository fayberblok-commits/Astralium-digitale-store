import { db } from "@/db";
import { emailOutbox } from "@/db/schema";

type MailInput = {
  to: string;
  subject: string;
  body: string;
  kind?: "transactional" | "marketing" | "support";
  orderNumber?: string | null;
};

/**
 * Transactional mail dispatcher.
 * When RESEND_API_KEY is configured the message is sent through Resend; otherwise it is
 * persisted in the outbox so that nothing is ever lost and the owner can resend later.
 */
export async function sendEmail(input: MailInput): Promise<{ sent: boolean }> {
  let status = "queued";
  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey) {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: process.env.MAIL_FROM ?? "Astralium Digitale Store <care@astralium.store>",
          to: [input.to],
          subject: input.subject,
          text: input.body,
        }),
      });
      if (response.ok) status = "sent";
    } catch {
      status = "queued";
    }
  }
  await db.insert(emailOutbox).values({
    toEmail: input.to,
    subject: input.subject,
    body: input.body,
    kind: input.kind ?? "transactional",
    status,
    orderNumber: input.orderNumber ?? null,
  });
  return { sent: status === "sent" };
}

export function orderReceiptEmail(input: {
  name: string;
  orderNumber: string;
  items: { title: string; url: string }[];
  total: string;
  provider: string;
  supportEmail: string;
}) {
  const lines = input.items.map((item) => `• ${item.title}\n  ${item.url}`).join("\n\n");
  return `مرحبًا ${input.name},\n\nتم تأكيد دفعك بنجاح في Astralium Digitale Store.\nرقم الطلب: ${input.orderNumber}\nطريقة الدفع: ${input.provider}\nالإجمالي: ${input.total}\n\nروابط التحميل الآمنة (صالحة 72 ساعة، ومتاحة دائمًا من صفحة حسابي):\n\n${lines}\n\nللاستفسار: ${input.supportEmail}\n\nشكرًا لثقتك,\nAstralium Digitale Store`;
}
