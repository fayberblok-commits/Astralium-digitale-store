import { test } from "node:test";
import assert from "node:assert/strict";
import { validateEnv } from "../src/lib/env.ts";

test("empty env: no errors (zero-config store must boot)", () => {
  const { errors } = validateEnv({});
  assert.deepEqual(errors, []);
});

test("bad DATABASE_URL scheme is an error", () => {
  const { errors } = validateEnv({ DATABASE_URL: "mysql://localhost/db" });
  assert.ok(errors.some((e) => e.startsWith("DATABASE_URL")));
  const ok = validateEnv({ DATABASE_URL: "postgresql://u:p@host:5432/db" });
  assert.ok(!ok.errors.some((e) => e.startsWith("DATABASE_URL")));
});

test("partial S3 group is an error naming the missing keys", () => {
  const { errors } = validateEnv({ S3_BUCKET: "b" });
  assert.ok(errors.some((e) => e.includes("S3_ACCESS_KEY_ID") && e.includes("S3_SECRET_ACCESS_KEY")));
});

test("complete S3 group passes; bad endpoint URL is an error", () => {
  const full = { S3_BUCKET: "b", S3_ACCESS_KEY_ID: "k", S3_SECRET_ACCESS_KEY: "s" };
  assert.deepEqual(validateEnv(full).errors, []);
  const bad = validateEnv({ ...full, S3_ENDPOINT: "not a url" });
  assert.ok(bad.errors.some((e) => e.includes("S3_ENDPOINT")));
});

test("format hints are warnings, not errors", () => {
  const { errors, warnings } = validateEnv({ STRIPE_SECRET_KEY: "pk_live_wrong", ADMIN_PASSWORD: "short" });
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((w) => w.includes("STRIPE_SECRET_KEY")));
  assert.ok(warnings.some((w) => w.includes("ADMIN_PASSWORD")));
});
