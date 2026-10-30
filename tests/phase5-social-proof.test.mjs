import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.chdir(mkdtempSync(path.join(tmpdir(), "astralium-p5-proof-")));
delete process.env.DATABASE_URL;

const proof = await import("../src/lib/social-proof.ts");

test("ZERO real data → the model is null (the component renders nothing)", () => {
  assert.equal(
    proof.buildProofModel({ verifiedDownloads: 0, completedOrders: 0, reviewCount: 0, reviewAverage: 0, recent: [] }),
    null,
  );
});

test("any single real signal is enough to render, with exact counts", () => {
  const m = proof.buildProofModel({ verifiedDownloads: 3, completedOrders: 0, reviewCount: 0, reviewAverage: 0, recent: [] });
  assert.equal(m.verifiedDownloads, 3);
  assert.equal(m.completedOrders, 0);
  const m2 = proof.buildProofModel({ verifiedDownloads: 0, completedOrders: 0, reviewCount: 2, reviewAverage: 4.5, recent: [] });
  assert.equal(m2.reviewCount, 2);
  assert.equal(m2.reviewAverage, 4.5);
});

test("ticker is capped at 5 and keeps only masked, real entries", () => {
  const recent = Array.from({ length: 9 }, (_, i) => ({
    firstName: `Name${i}`, productTitle: `P${i}`, atISO: "2026-10-30T00:00:00.000Z",
  }));
  const m = proof.buildProofModel({ verifiedDownloads: 1, completedOrders: 9, reviewCount: 0, reviewAverage: 0, recent });
  assert.equal(m.recent.length, 5);
});

test("masking: first name derived from the real local part; never the full address or domain", () => {
  assert.equal(proof.maskBuyerName("jane.doe@example.com"), "Jane");
  assert.equal(proof.maskBuyerName("mike1984@gmail.com"), "Mike");
  assert.equal(proof.maskBuyerName("sara_smith@shop.io"), "Sara");
  assert.equal(proof.maskBuyerName("jean-luc.picard@starfleet.example"), "Jean");
  for (const email of ["jane.doe@example.com", "mike1984@gmail.com"]) {
    const name = proof.maskBuyerName(email);
    assert.ok(!name.includes("@"), "no domain leaks");
    assert.ok(!email.startsWith(name) || name.length < email.split("@")[0].length, "not the full local part");
  }
});

test("masking: underivable names return null (generic label) — never invented", () => {
  assert.equal(proof.maskBuyerName("a@example.com"), null);
  assert.equal(proof.maskBuyerName("12345@example.com"), null);
  assert.equal(proof.maskBuyerName("@example.com"), null);
  assert.equal(proof.maskBuyerName(""), null);
});

test("gather: with no DB and no approved reviews the honest answer is null", async () => {
  // Fresh temp cwd → review store empty; no DATABASE_URL → no orders/grants.
  assert.equal(await proof.gatherSocialProof(), null);
});
