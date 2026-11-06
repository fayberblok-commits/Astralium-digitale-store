/**
 * Checkout contact rules (owner fix, 2026-11).
 *
 * The buyer's email is OPTIONAL at checkout: it exists only so the
 * store can send a receipt and a backup copy of the download links.
 * Delivery itself happens on the success page and never depends on
 * email. These helpers are the single source of truth for that rule —
 * the checkout API route uses them, and the tests pin them.
 *
 *   - absent / blank email  → OK, normalised to "" (no email on file;
 *     for PayPal the payer email returned at capture time is stored
 *     on the order instead — see lib/paypal.ts fulfilPaypalOrder).
 *   - a present email       → must be well-formed, else INVALID_EMAIL.
 */

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type CheckoutEmailResult =
  | { ok: true; email: string; provided: boolean }
  | { ok: false; error: "INVALID_EMAIL" };

export function normalizeCheckoutEmail(raw: unknown): CheckoutEmailResult {
  if (raw === undefined || raw === null) return { ok: true, email: "", provided: false };
  const email = String(raw).trim();
  if (email === "") return { ok: true, email: "", provided: false };
  if (!EMAIL_RE.test(email)) return { ok: false, error: "INVALID_EMAIL" };
  return { ok: true, email, provided: true };
}
