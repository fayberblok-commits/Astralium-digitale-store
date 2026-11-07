import { test } from "node:test";
import assert from "node:assert/strict";

// Speed fix (register item 81): the shared PayPal SDK URL builder
// and the client-token cache freshness rule. The URL builder is the
// single source for BOTH the server-rendered checkout <script> tag
// and the client loader (which adopts tags by this exact src), so
// its shape is pinned here.
const { paypalSdkUrl, cachedTokenFresh, readCachedClientToken, TOKEN_EXPIRY_MARGIN_MS } =
  await import("../src/lib/paypal-sdk.ts");

test("sdk url: exact URL the checkout has always loaded", () => {
  assert.equal(
    paypalSdkUrl("cid-123"),
    "https://www.paypal.com/sdk/js?client-id=cid-123&components=buttons,card-fields&currency=USD&intent=capture",
  );
});

test("sdk url: client id is URL-encoded", () => {
  assert.match(paypalSdkUrl("a b&c=d"), /client-id=a%20b%26c%3Dd&/);
});

test("token cache: fresh strictly before expiry minus the safety margin", () => {
  const now = 1_000_000;
  assert.equal(cachedTokenFresh(now + TOKEN_EXPIRY_MARGIN_MS + 1, now), true);
  assert.equal(cachedTokenFresh(now + TOKEN_EXPIRY_MARGIN_MS, now), false);
  assert.equal(cachedTokenFresh(now - 1, now), false);
  assert.equal(cachedTokenFresh(Number.NaN, now), false);
});

test("token cache: no sessionStorage (server/plain node) reads as empty, never throws", () => {
  assert.equal(readCachedClientToken(), null);
});
