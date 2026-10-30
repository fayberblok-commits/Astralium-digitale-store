import { getDictionary } from "../../../i18n/dictionaries";
import { verifyStripeSession, downloadLinksFor } from "../../../lib/fulfill";
import MarkPaid from "../../../components/MarkPaid";

export const dynamic = "force-dynamic";

export default async function SuccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ session_id?: string; order?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const dict = getDictionary(locale);

  // Downloads are issued ONLY after server-side verification with Stripe.
  const verified = sp.session_id ? await verifyStripeSession(sp.session_id) : null;
  const links = verified ? downloadLinksFor(verified) : [];

  return (
    <div className="panel" style={{ marginTop: 32, textAlign: "center" }}>
      <p style={{ fontSize: "2.4rem", margin: 0 }} aria-hidden="true">✦</p>
      <h1>{dict.success_t}</h1>
      {verified ? (
        <>
          <p className="muted">{dict.success_d}</p>
          <p>
            <strong>{verified.orderId}</strong>
            {verified.email ? ` · ${verified.email}` : ""}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 480, margin: "18px auto 0" }}>
            {links.map((l) => (
              <a key={l.productId} href={l.url} className="btn btn-primary btn-lg">
                ⬇ {dict.download_btn} — {l.title}
              </a>
            ))}
          </div>
          {sp.session_id && <MarkPaid providerRef={sp.session_id} />}
        </>
      ) : (
        <p className="muted">{dict.success_pending}</p>
      )}
    </div>
  );
}
