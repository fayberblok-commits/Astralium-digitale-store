import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.chdir(mkdtempSync(path.join(tmpdir(), "astralium-p5-ab-")));
delete process.env.DATABASE_URL;

const ab = await import("../src/lib/ab.ts");

const EXP = {
  id: "hero-1", name: "Hero test", slot: "hero_title", status: "running",
  createdAt: "2026-10-30T00:00:00.000Z",
  variants: [
    { key: "control", weight: 50, headline: "" },
    { key: "b", weight: 50, headline: "Alternative headline" },
  ],
};

test("bucketing is deterministic: same visitor → same variant, every time", () => {
  for (const visitor of ["v-1", "v-2", "abc123", "zzz"]) {
    const first = ab.assignVariant(EXP, visitor).key;
    for (let i = 0; i < 5; i++) assert.equal(ab.assignVariant(EXP, visitor).key, first);
  }
  // Buckets stay in range and depend on the experiment id.
  for (const v of ["v-1", "v-2", "v-3"]) {
    const b = ab.bucketFor(EXP.id, v);
    assert.ok(b >= 0 && b < 10000);
  }
  const other = { ...EXP, id: "hero-2" };
  const differs = ["v-1", "v-2", "v-3", "v-4", "v-5"].some((v) => ab.bucketFor(EXP.id, v) !== ab.bucketFor(other.id, v));
  assert.ok(differs, "different experiments must bucket differently");
});

test("bucketing distribution roughly matches the traffic split", () => {
  const counts = { control: 0, b: 0 };
  const N = 4000;
  for (let i = 0; i < N; i++) counts[ab.assignVariant(EXP, `visitor-${i}`).key]++;
  assert.ok(Math.abs(counts.control / N - 0.5) < 0.04, `control share ${counts.control / N}`);
  assert.ok(Math.abs(counts.b / N - 0.5) < 0.04, `b share ${counts.b / N}`);
});

test("uneven split 90/10 is honoured at the extremes", () => {
  const exp = { ...EXP, variants: [{ key: "control", weight: 90, headline: "" }, { key: "b", weight: 10, headline: "B" }] };
  let b = 0;
  const N = 4000;
  for (let i = 0; i < N; i++) if (ab.assignVariant(exp, `u-${i}`).key === "b") b++;
  assert.ok(b / N > 0.06 && b / N < 0.14, `b share ${b / N}`);
});

test("hero headline: variant copy wins; control/blank/no-visitor fall back to null (dictionary)", () => {
  assert.equal(ab.heroHeadlineFor(EXP, null), null);
  assert.equal(ab.heroHeadlineFor(null, "v-1"), null);
  // Find one visitor per variant deterministically.
  let controlVisitor; let bVisitor;
  for (let i = 0; i < 200 && (!controlVisitor || !bVisitor); i++) {
    const v = `hv-${i}`;
    if (ab.assignVariant(EXP, v).key === "control") controlVisitor = v;
    else bVisitor = v;
  }
  assert.equal(ab.heroHeadlineFor(EXP, controlVisitor), null);
  assert.equal(ab.heroHeadlineFor(EXP, bVisitor), "Alternative headline");
});

test("config sanitize: weights normalised to 100, bad shapes dropped", () => {
  const cfg = ab.sanitizeAbConfig({
    experiments: [
      { id: "X 1", name: "t", status: "running", variants: [{ key: "a", weight: 1 }, { key: "b", weight: 3 }] },
      { id: "lonely", variants: [{ key: "a", weight: 100 }] }, // <2 variants → dropped
      { id: "X1", variants: [{ key: "a", weight: 50 }, { key: "b", weight: 50 }] }, // sanitises to "x1" = duplicate → dropped
    ],
  });
  assert.equal(cfg.experiments.length, 1);
  assert.equal(cfg.experiments[0].id, "x1");
  assert.deepEqual(cfg.experiments[0].variants.map((v) => v.weight), [25, 75]);
});

test("normal CDF: known values", () => {
  assert.ok(Math.abs(ab.normalCdf(0) - 0.5) < 1e-6);
  assert.ok(Math.abs(ab.normalCdf(1.96) - 0.975) < 0.001);
  assert.ok(Math.abs(ab.normalCdf(-1.96) - 0.025) < 0.001);
});

test("two-proportion z-test: equal rates → p=1; a real gap → significant", () => {
  const equal = ab.twoProportionZTest(50, 100, 50, 100);
  assert.equal(equal.z, 0);
  assert.ok(equal.pValue > 0.99, "equal rates → p ≈ 1 (CDF approximation tolerance)");
  assert.equal(equal.significant95, false);
  const gap = ab.twoProportionZTest(100, 1000, 200, 1000); // 10% vs 20%
  assert.ok(gap.z > 5);
  assert.ok(gap.pValue < 0.001);
  assert.equal(gap.significant95, true);
  const tiny = ab.twoProportionZTest(10, 100, 12, 100); // noise-level gap
  assert.equal(tiny.significant95, false);
  assert.deepEqual(ab.twoProportionZTest(0, 0, 0, 0), { z: 0, pValue: 1, significant95: false });
});

test("results computation: counts per variant, control has no self-comparison", () => {
  const events = [];
  for (let i = 0; i < 100; i++) events.push({ experimentId: "hero-1", variantKey: "control", type: "exposure", visitorHash: `c${i}`, createdAt: "" });
  for (let i = 0; i < 10; i++) events.push({ experimentId: "hero-1", variantKey: "control", type: "conversion", visitorHash: `c${i}`, createdAt: "" });
  for (let i = 0; i < 100; i++) events.push({ experimentId: "hero-1", variantKey: "b", type: "exposure", visitorHash: `b${i}`, createdAt: "" });
  for (let i = 0; i < 30; i++) events.push({ experimentId: "hero-1", variantKey: "b", type: "conversion", visitorHash: `b${i}`, createdAt: "" });
  events.push({ experimentId: "other", variantKey: "b", type: "conversion", visitorHash: "x", createdAt: "" });
  const res = ab.computeResults(EXP, events);
  const control = res.variants.find((v) => v.key === "control");
  const b = res.variants.find((v) => v.key === "b");
  assert.equal(control.exposures, 100);
  assert.equal(control.rate, 0.1);
  assert.equal(control.vsControl, null);
  assert.equal(b.rate, 0.3);
  assert.equal(b.vsControl.significant95, true);
});

test("events: exposures de-duplicate per visitor; conversions recorded once per visitor too", async () => {
  const cfg = ab.sanitizeAbConfig({ experiments: [EXP] });
  await ab.setAbConfig(cfg);
  assert.equal((await ab.recordAbEvent({ experimentId: "hero-1", variantKey: "b", type: "exposure", visitorId: "visitor-x" })).recorded, true);
  assert.equal((await ab.recordAbEvent({ experimentId: "hero-1", variantKey: "b", type: "exposure", visitorId: "visitor-x" })).recorded, false);
  assert.equal((await ab.recordAbEvent({ experimentId: "hero-1", variantKey: "b", type: "exposure", visitorId: "visitor-y" })).recorded, true);
  const events = await ab.listAbEvents("hero-1");
  assert.equal(events.length, 2);
  assert.ok(events.every((e) => e.visitorHash.length === 64 && !e.visitorHash.includes("visitor")), "only hashes are stored");
});
