"use client";
import { useEffect, useId, useRef, useState } from "react";

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
 */

interface PaypalButtonsInstance {
  render: (selector: string | HTMLElement) => Promise<void>;
  close: () => void;
}
interface PaypalCardFieldComponent {
  render: (selector: string | HTMLElement) => Promise<void>;
}
interface PaypalCardFieldsInstance {
  isEligible: () => boolean;
  NameField: (opts?: { placeholder?: string }) => PaypalCardFieldComponent;
  NumberField: (opts?: { placeholder?: string }) => PaypalCardFieldComponent;
  ExpiryField: (opts?: { placeholder?: string }) => PaypalCardFieldComponent;
  CVVField: (opts?: { placeholder?: string }) => PaypalCardFieldComponent;
  submit: () => Promise<void>;
}
interface PaypalNamespace {
  Buttons: (config: Record<string, unknown>) => PaypalButtonsInstance;
  CardFields?: (config: Record<string, unknown>) => PaypalCardFieldsInstance;
}
declare global {
  interface Window {
    paypal?: PaypalNamespace;
  }
}

const sdkLoads = new Map<string, Promise<PaypalNamespace>>();

function loadPaypalSdk(clientId: string, clientToken?: string | null): Promise<PaypalNamespace> {
  // Card Fields need the server-minted client token ON the script tag
  // (data-client-token); without it paypal.CardFields stays undefined.
  // The token is part of the cache key so a tokenised load never
  // reuses a token-less one (or vice versa).
  const cacheKey = clientToken ? `${clientId}#${clientToken}` : clientId;
  const existing = sdkLoads.get(cacheKey);
  if (existing) return existing;
  const promise = new Promise<PaypalNamespace>((resolve, reject) => {
    if (window.paypal?.Buttons) {
      resolve(window.paypal);
      return;
    }
    const script = document.createElement("script");
    script.src =
      `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}` +
      `&components=buttons,card-fields&currency=USD&intent=capture`;
    if (clientToken) script.setAttribute("data-client-token", clientToken);
    script.async = true;
    script.onload = () => {
      if (window.paypal?.Buttons) resolve(window.paypal);
      else reject(new Error("paypal-sdk-incomplete"));
    };
    script.onerror = () => reject(new Error("paypal-sdk-load-failed"));
    document.head.appendChild(script);
  });
  // A failed load must not poison later attempts (e.g. transient network).
  promise.catch(() => sdkLoads.delete(cacheKey));
  sdkLoads.set(cacheKey, promise);
  return promise;
}

export interface PayPalSdkLabels {
  orCard: string;
  cardName: string;
  payByCard: string;
  processing: string;
  error: string;
}

export default function PayPalSdk({
  clientId,
  clientToken,
  labels,
  createOrder,
  captureOrder,
  onError,
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
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const buttonsId = `pp-buttons-${uid}`;
  const nameId = `pp-name-${uid}`;
  const numberId = `pp-number-${uid}`;
  const expiryId = `pp-expiry-${uid}`;
  const cvvId = `pp-cvv-${uid}`;
  const [failed, setFailed] = useState(false);
  const [cardEligible, setCardEligible] = useState(false);
  const [cardBusy, setCardBusy] = useState(false);
  const cardFieldsRef = useRef<PaypalCardFieldsInstance | null>(null);

  // Always invoke the LATEST checkout state (email, coupon, gifts…)
  // without re-rendering the SDK widgets on every keystroke. The ref
  // is updated in an effect (never during render).
  const callbacks = useRef({ createOrder, captureOrder, onError });
  useEffect(() => {
    callbacks.current = { createOrder, captureOrder, onError };
  });
  const errorLabel = labels.error;

  useEffect(() => {
    let cancelled = false;
    let buttons: PaypalButtonsInstance | null = null;
    loadPaypalSdk(clientId, clientToken)
      .then(async (paypal) => {
        if (cancelled) return;
        const shared = {
          createOrder: async () => callbacks.current.createOrder(),
          onApprove: async (data: { orderID?: string }) => {
            if (!data.orderID) throw new Error("missing-order-id");
            await callbacks.current.captureOrder(data.orderID);
          },
          onError: () => callbacks.current.onError(errorLabel),
          onCancel: () => { /* buyer closed the flow — nothing to report */ },
        };
        buttons = paypal.Buttons({
          ...shared,
          style: { layout: "vertical", color: "gold", shape: "pill", label: "paypal" },
        });
        await buttons.render(`#${buttonsId}`);
        if (cancelled) return;
        // Hosted Card Fields: rendered ONLY when PayPal reports this
        // merchant/buyer eligible. Any doubt → section stays hidden.
        if (paypal.CardFields) {
          try {
            const cardFields = paypal.CardFields({ ...shared });
            if (cardFields.isEligible()) {
              cardFieldsRef.current = cardFields;
              setCardEligible(true);
              await cardFields.NameField({ placeholder: "" }).render(`#${nameId}`);
              await cardFields.NumberField({ placeholder: "1234 1234 1234 1234" }).render(`#${numberId}`);
              await cardFields.ExpiryField({ placeholder: "MM/YY" }).render(`#${expiryId}`);
              await cardFields.CVVField({ placeholder: "CVC" }).render(`#${cvvId}`);
            }
          } catch {
            setCardEligible(false);
            cardFieldsRef.current = null;
          }
        }
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
    if (!cardFields || cardBusy) return;
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

  return (
    <div className="paypal-sdk">
      <div id={buttonsId} className="paypal-sdk-buttons" />
      {cardEligible && (
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
            disabled={cardBusy}
          >
            {cardBusy ? labels.processing : labels.payByCard}
          </button>
        </div>
      )}
    </div>
  );
}
