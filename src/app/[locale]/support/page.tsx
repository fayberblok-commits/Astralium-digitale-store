import type { Metadata } from "next";
import { getDictionary } from "../../../i18n/dictionaries";
import SupportTicketForm from "../../../components/SupportTicketForm";

export const metadata: Metadata = { title: "Support" };
export const dynamic = "force-dynamic";

/**
 * Customer support page (Phase 4 upgrade): the human-handoff surface
 * behind the office's ticket center. The AI assistant points here;
 * submissions land in the Manager's Office as tickets.
 */
export default async function SupportPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const dict = getDictionary(locale);
  return (
    <>
      <h1 style={{ marginTop: 28 }}>{dict.support_t}</h1>
      <p className="muted">{dict.support_d}</p>
      <SupportTicketForm
        locale={locale}
        dict={{
          email: dict.support_email,
          subject: dict.support_subject,
          message: dict.support_message,
          order: dict.support_order,
          send: dict.support_send,
          sent: dict.support_sent,
        }}
      />
    </>
  );
}
