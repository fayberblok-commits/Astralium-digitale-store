import { getDictionary } from "../../../i18n/dictionaries";
import { verifyStripeSession, downloadLinksFor } from "../../../lib/fulfill";
import { createRefToken, issueClaimCode } from "../../../lib/claim-codes";
import { channelAvailability } from "../../../services/delivery";
import DeliveryOptions, { type DeliveryLinks } from "../../../components/DeliveryOptions";
import MarkPaid from "../../../components/MarkPaid";
import AbBeacon from "../../../components/AbBeacon";
import TrackEvent from "../../../components/TrackEvent";
import UpsellOffer from "../../../components/UpsellOffer";
import { currentCurrency } from "../../../lib/server";
import { getFlag } from "../../../lib/flags";

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

  // Phase 2: social delivery options for verified orders — a one-time
  // claim code plus deep links for the channels that are flag-on AND
  // provider-configured. Email remains available in all cases.
  let claimCode: string | undefined;
  const deliveryLinks: DeliveryLinks = {};
  if (verified && verified.productIds.length > 0) {
    const availability = await channelAvailability();
    const avail = new Map(availability.map((c) => [c.key, c.available]));
    const issued = await issueClaimCode({ orderId: verified.orderId, productIds: verified.productIds });
    claimCode = issued.code;
    const waNumber = (process.env.WHATSAPP_BUSINESS_NUMBER ?? "").replace(/\D/g, "");
    if (avail.get("whatsapp") && waNumber) {
      const text = encodeURIComponent(`Hi Astralium! My delivery code is ${claimCode}`);
      deliveryLinks.whatsapp = `https://wa.me/${waNumber}?text=${text}`;
    }
    if (avail.get("messenger") && process.env.META_PAGE_ID) {
      const ref = createRefToken({ oid: verified.orderId, pids: verified.productIds, ch: "messenger" });
      deliveryLinks.messenger = `https://m.me/${process.env.META_PAGE_ID}?ref=${encodeURIComponent(ref)}`;
    }
    if (avail.get("instagram") && process.env.INSTAGRAM_USERNAME) {
      const ref = createRefToken({ oid: verified.orderId, pids: verified.productIds, ch: "instagram" });
      deliveryLinks.instagram = `https://ig.me/m/${process.env.INSTAGRAM_USERNAME}?ref=${encodeURIComponent(ref)}`;
    }
  }

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
          <DeliveryOptions dict={dict} sessionId={sp.session_id} claimCode={claimCode} links={deliveryLinks} />
          {/* Phase 4, feature 16: PDF receipt for the verified order —
              the endpoint re-verifies the Stripe session server-side. */}
          {sp.session_id && (await getFlag("receipts")) && (
            <p style={{ marginTop: 14 }}>
              <a
                href={`/api/receipt/${encodeURIComponent(verified.orderId)}?session_id=${encodeURIComponent(sp.session_id)}`}
                className="btn btn-ghost"
              >
                🧾 {dict.receipt_download}
              </a>
            </p>
          )}
          {verified.email && (
            <UpsellOffer
              locale={locale}
              dict={dict}
              currency={await currentCurrency(locale)}
              orderId={verified.orderId}
              email={verified.email}
              purchasedProductIds={verified.productIds}
            />
          )}
          {sp.session_id && <MarkPaid providerRef={sp.session_id} />}
          {/* Phase 6, feature 27: a purchase event fires ONLY on a server-verified payment. */}
          {verified && <TrackEvent type="purchase" />}
          {/* Phase 5, feature 23: a verified payment is the A/B
              conversion event (anonymous; the server buckets it). */}
          {(await getFlag("ab_tests")) && <AbBeacon mode="conversion" />}
        </>
      ) : (
        <p className="muted">{dict.success_pending}</p>
      )}
    </div>
  );
}
