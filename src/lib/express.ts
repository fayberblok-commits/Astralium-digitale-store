/**
 * Express (single-item) checkout intent — owner fix, 2026-11.
 *
 * BUY NOW must never detour through the cart: it routes straight to
 * a checkout that contains ONLY the chosen item, and any existing
 * cart contents stay exactly as they were (untouched, unused, and
 * never cleared by an express purchase). The intent travels in the
 * checkout URL (`?express=<item-id>`) so it survives navigation and
 * is resolvable server-side; these pure helpers are the contract the
 * product buttons, the checkout page and the checkout client share —
 * the tests pin them.
 */

export const EXPRESS_QUERY_PARAM = "express";

/** Item ids are catalog/bundle ids: url-safe slugs. Anything else is not an intent. */
const EXPRESS_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function isExpressId(value: unknown): value is string {
  return typeof value === "string" && EXPRESS_ID_RE.test(value);
}

/** Parse the raw `?express=` search param (Next gives string | string[] | undefined). */
export function parseExpressId(raw: string | string[] | undefined | null): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return isExpressId(value) ? value : null;
}

/** The href BUY NOW navigates to: express checkout for exactly this item. */
export function expressCheckoutHref(locale: string, itemId: string): string {
  return `/${locale}/checkout?${EXPRESS_QUERY_PARAM}=${encodeURIComponent(itemId)}`;
}

/**
 * The item list a checkout operates on: the express item ALONE when
 * an express intent is present, otherwise the cart as-is.
 */
export function checkoutItemsFor<T>(expressItem: T | null | undefined, cart: readonly T[]): readonly T[] {
  return expressItem ? [expressItem] : cart;
}

/**
 * Whether completing this checkout may clear the cart. Express
 * purchases NEVER touch the cart; cart checkouts clear it as before.
 */
export function shouldClearCart(expressItem: unknown): boolean {
  return !expressItem;
}
