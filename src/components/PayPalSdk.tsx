"use client";
import { useEffect, useId, useRef, useState } from "react";
import {
  loadPaypalSdk,
  readCachedClientToken,
  type PaypalButtonsInstance,
  type PaypalCardFieldsInstance,
} from "../lib/paypal-sdk";

/**
 * On-page PayPal checkout (owner fix, 2026-11): Smart Buttons AND
 * hosted Card Fields rendered INSIDE our checkout page, so the buyer
 * pays by bank card without leaving the store and without being
 * forced to enter an email first.
 *
 * Money flow (unchanged pipeline, no duplicated logic):
 *   createOrder → POST /api/checkout { mode: "sdk" } builds the order
 *                 server-side and returns the PayPal order id;
 *   onApprove   → POST /api/checkout/capture performs the capture
 *                 server-side and fulfils through the order ledger.
 *   onCancel    → the parent restores its idle state: order creation
 *                 set its busy flag, and cancel is the one outcome
 *                 that neither navigates nor errors (item 84).
 *
 * Graceful degradation is a hard requirement:
 *  - SDK script fails to load / Buttons unavailable → this component
 *    renders nothing; the classic redirect button below stays the
 *    payment path.
 *  - Card Fields missing or `isEligible()` false (PayPal decides
 *    eligibility per merchant account + buyer) → the card section
 *    hides itself; Smart Buttons remain.
 *
 * The SDK is loaded with the store's PUBLIC PayPal client id,
 * rendered into the page by the server — never hard-coded here.
 *
 * Speed (register item 81, 2026-11): the payment area used to sit
 * dead for ~5 s on slow connections — the SDK download only started
 * after hydration, then the Buttons iframe painted, THEN the four
 * card-field iframes rendered one await at a time into host nodes
 * that React had not necessarily mounted yet. Now: the checkout
 * page server-renders the SDK <script> (the loader in
 * lib/paypal-sdk adopts it), Buttons and Card Fields render in
 * PARALLEL, the four fields paint via Promise.all into mounted
 * nodes, and both areas show a branded gold "preparing secure
 * payment" state from the first paint — never dead grey boxes.
 */

/** Resolve after React has committed pending state to the DOM (two
 *  animation frames), so PayPal paints its iframes into host nodes
 *  that actually exist. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    } else {
      setTimeout(resolve, 50);
    }
  });
}

export interface PayPalSdkLabels {
  orCard: string;
  cardName: string;
  payByCard: string;
  processing: string;
  error: string;
  /** Branded loading state shown while the payment area prepares. */
  preparing: string;
}

type CardPhase = "idle" | "checking" | "ready" | "hidden";

export default function PayPalSdk({
  clientId,
  clientToken,
  labels,
  createOrder,
  captureOrder,
  onError,
  onCancel,
}: {
  clientId: string;
  /** Server-minted token enabling Card Fields; absent → Buttons only. */
  clientToken?: string | null;
  labels: PayPalSdkLabels;
  /** Creates the order server-side; resolves to the PayPal order id. */
  createOrder: () => Promise<string>;
  /** Captures server-side; resolves after navigating to the success page. */
  captureOrder: (paypalOrderId: string) => Promise<void>;
  onError: (message: string) => void;
  /** Buyer closed the PayPal flow WITHOUT paying (popup dismissed /
   *  card challenge abandoned). Order creation marked the parent
   *  checkout busy; this callback is the ONLY signal that returns it
   *  to idle on the cancel path — without it the redirect button sat
   *  disabled on "PROCESSING…" forever (register item 84). */
  onCancel?: () => void;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const buttonsId = `pp-buttons-${uid}`;
  const nameId = `pp-name-${uid}`;
  const numberId = `pp-number-${uid}`;
  const expiryId = `pp-expiry-${uid}`;
  const cvvId = `pp-cvv-${uid}`;
  const [failed, setFailed] = useState(false);
  const [buttonsReady, setButtonsReady] = useState(false);
  const [cardPhase, setCardPhase] = useState<CardPhase>("idle");
  const [cardBusy, setCardBusy] = useState(false);
  const cardFieldsRef = useRef<PaypalCardFieldsInstance | null>(null);

  // Always invoke the LATEST checkout state (email, coupon, gifts…)
  // without re-rendering the SDK widgets on every keystroke. The ref
  // is updated in an effect (never during render).
  const callbacks = useRef({ createOrder, captureOrder, onError, onCancel });
  useEffect(() => {
    callbacks.current = { createOrder, captureOrder, onError, onCancel };
  });
  const errorLabel = labels.error;

  useEffect(() => {
    let cancelled = false;
    let buttons: PaypalButtonsInstance | null = null;
    // The page's server-minted token is authoritative; a token an
    // intent warm-up cached in this session is the fallback when the
    // server mint failed (today that case degrades to Buttons only —
    // a cached genuine token can only improve it).
    const token = clientToken ?? readCachedClientToken();
    loadPaypalSdk(clientId, token)
      .then(async (paypal) => {
        if (cancelled) return;
        const shared = {
          createOrder: async () => callbacks.current.createOrder(),
          onApprove: async (data: { orderID?: string }) => {
            if (!data.orderID) throw new Error("missing-order-id");
            await callbacks.current.captureOrder(data.orderID);
          },
          onError: () => callbacks.current.onError(errorLabel),
          // Buyer closed the popup / abandoned the card challenge:
          // no error to show — but order creation set the parent's
          // busy flag, and this is the only signal that clears it on
          // the cancel path. It used to be a deliberate no-op, which
          // stranded the gold redirect button disabled on
          // "PROCESSING…" forever (register item 84).
          onCancel: () => callbacks.current.onCancel?.(),
        };
        // Buttons and Card Fields are independent widgets: paint
        // them in PARALLEL instead of gating the card fields behind
        // the (slow) Buttons iframe render.
        const renderButtons = (async () => {
          const instance = paypal.Buttons({
            ...shared,
            style: { layout: "vertical", color: "gold", shape: "pill", label: "paypal" },
          });
          buttons = instance;
          await instance.render(`#${buttonsId}`);
          if (!cancelled) setButtonsReady(true);
        })().catch(() => {
          // Buttons failing is the component-level failure it has
          // always been: hide the SDK area, the redirect button
          // below remains the payment path.
          if (!cancelled) setFailed(true);
        });
        const renderCard = (async () => {
          // Hosted Card Fields: rendered ONLY when PayPal reports
          // this merchant/buyer eligible. Any doubt → section hides.
          if (!paypal.CardFields) {
            if (!cancelled) setCardPhase("hidden");
            return;
          }
          try {
            const cardFields = paypal.CardFields({ ...shared });
            if (!cardFields.isEligible()) {
              if (!cancelled) setCardPhase("hidden");
              return;
            }
            cardFieldsRef.current = cardFields;
            // Mount the card section (with a branded veil over it)
            // and wait until its host nodes are really in the DOM —
            // only then ask PayPal to paint the four field iframes,
            // all at once.
            setCardPhase("checking");
            await nextPaint();
            if (cancelled) return;
            await Promise.all([
              cardFields.NameField({ placeholder: "" }).render(`#${nameId}`),
              cardFields.NumberField({ placeholder: "1234 1234 1234 1234" }).render(`#${numberId}`),
              cardFields.ExpiryField({ placeholder: "MM/YY" }).render(`#${expiryId}`),
              cardFields.CVVField({ placeholder: "CVC" }).render(`#${cvvId}`),
            ]);
            if (!cancelled) setCardPhase("ready");
          } catch {
            if (!cancelled) {
              setCardPhase("hidden");
              cardFieldsRef.current = null;
            }
          }
        })();
        await Promise.allSettled([renderButtons, renderCard]);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      try {
        buttons?.close();
      } catch { /* already gone */ }
    };
    // The SDK widgets are created once per clientId (+token); later
    // checkout state is always read through the callbacks ref above.
  }, [clientId, clientToken, errorLabel, buttonsId, nameId, numberId, expiryId, cvvId]);

  if (failed) return null;

  const submitCard = async () => {
    const cardFields = cardFieldsRef.current;
    if (!cardFields || cardBusy || cardPhase !== "ready") return;
    setCardBusy(true);
    try {
      // submit() runs createOrder → card confirmation → onApprove.
      await cardFields.submit();
    } catch {
      callbacks.current.onError(labels.error);
    } finally {
      setCardBusy(false);
    }
  };

  const cardShown = cardPhase === "checking" || cardPhase === "ready";

  return (
    <div className="paypal-sdk">
      <div className="paypal-sdk-stage">
        <div id={buttonsId} className="paypal-sdk-buttons" />
        {!buttonsReady && (
          <div className="paypal-sdk-loading" role="status" aria-live="polite">
            <span className="paypal-sdk-loading-gem" aria-hidden="true">✦</span>
            <span>{labels.preparing}</span>
          </div>
        )}
      </div>
      {cardShown && (
        <div className="paypal-sdk-card">
          <p className="checkout-side-label">{labels.orCard}</p>
          <label className="card-field-label">
            <span>{labels.cardName}</span>
            <span id={nameId} className="card-field-host" />
          </label>
          <label className="card-field-label">
            <span id={numberId} className="card-field-host" />
          </label>
          <div className="card-field-row">
            <label className="card-field-label">
              <span id={expiryId} className="card-field-host" />
            </label>
            <label className="card-field-label">
              <span id={cvvId} className="card-field-host" />
            </label>
          </div>
          <button
            type="button"
            className="btn btn-grad btn-lg pay-btn"
            onClick={() => void submitCard()}
            disabled={cardBusy || cardPhase !== "ready"}
          >
            {cardBusy ? labels.processing : labels.payByCard}
          </button>
          {cardPhase === "checking" && (
            <div className="paypal-sdk-card-veil" role="status" aria-live="polite">
              <span className="paypal-sdk-loading-gem" aria-hidden="true">✦</span>
              <span>{labels.preparing}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
