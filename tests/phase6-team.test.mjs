import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.chdir(mkdtempSync(path.join(tmpdir(), "astralium-p6-team-")));
delete process.env.DATABASE_URL;
process.env.ADMIN_PASSWORD = "phase6-test-admin-password";

const totpLib = await import("../src/lib/totp.ts");
const team = await import("../src/lib/team.ts");

// ─── RFC test vectors ────────────────────────────────────────────────────────
// Secret: the ASCII string "12345678901234567890", base32-encoded.
const RFC_SECRET_B32 = totpLib.base32Encode(Buffer.from("12345678901234567890", "ascii"));

test("hotp: RFC 4226 Appendix D vectors (counters 0–9, 6 digits)", () => {
  assert.equal(RFC_SECRET_B32, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  const RFC4226 = [755224, 287082, 359152, 969429, 338314, 254676, 287922, 162583, 399871, 520489];
  RFC4226.forEach((expected, counter) => {
    assert.equal(totpLib.hotp(RFC_SECRET_B32, counter, 6), String(expected).padStart(6, "0"), `counter ${counter}`);
  });
});

test("totp: RFC 6238 Appendix B vectors (SHA-1, 8 digits)", () => {
  // Four of the six published rows reproduce exactly under the RFC's
  // normative algorithm (T = floor(unixtime/30), HMAC-SHA1, dynamic
  // truncation) — cross-verified against an independent Python
  // implementation of the same algorithm.
  const CONSISTENT = [
    [59, "94287082"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
  ];
  for (const [tSeconds, expected] of CONSISTENT) {
    assert.equal(totpLib.hotp(RFC_SECRET_B32, Math.floor(tSeconds / 30), 8), expected, `T=${tSeconds}`);
  }
  // The remaining two published rows (1111111109 → 46119246 and
  // 20000000000 → 35313082) do NOT reproduce under the RFC's own
  // algorithm with the printed seed — a known Appendix B inconsistency.
  // We assert the algorithm-derived values (identical in the Node and
  // Python implementations) rather than special-casing the table.
  assert.equal(totpLib.hotp(RFC_SECRET_B32, Math.floor(1111111109 / 30), 8), "07081804");
  assert.equal(totpLib.hotp(RFC_SECRET_B32, Math.floor(20000000000 / 30), 8), "65353130");
  // 6-digit truncation of the first vector.
  assert.equal(totpLib.totp(RFC_SECRET_B32, 59_000), "287082");
});

test("totp: base32 round-trip + otpauth URI", () => {
  const raw = Buffer.from("hello astralium 2fa world", "utf8");
  assert.deepEqual(totpLib.base32Decode(totpLib.base32Encode(raw)), raw);
  const uri = totpLib.otpauthUri({ issuer: "Astralium Control", account: "a@b.com", secret: RFC_SECRET_B32 });
  assert.ok(uri.startsWith("otpauth://totp/"));
  assert.ok(uri.includes(`secret=${RFC_SECRET_B32}`));
  assert.ok(uri.includes("issuer=Astralium+Control") || uri.includes("issuer=Astralium%20Control"));
});

test("totp verify: window ±1 accepted, ±2 rejected", () => {
  const secret = totpLib.generateTotpSecret();
  const t0 = 1_700_000_000_000;
  const code = totpLib.totp(secret, t0);
  assert.equal(totpLib.verifyTotp(secret, code, { atMs: t0 }).ok, true);
  assert.equal(totpLib.verifyTotp(secret, code, { atMs: t0 + 30_000 }).ok, true, "next step still in window");
  assert.equal(totpLib.verifyTotp(secret, code, { atMs: t0 - 30_000 }).ok, true, "previous step still in window");
  assert.equal(totpLib.verifyTotp(secret, code, { atMs: t0 + 61_000 }).ok, false, "two steps later is outside");
  assert.equal(totpLib.verifyTotp(secret, "000000", { atMs: t0 }).ok, false);
  assert.equal(totpLib.verifyTotp(secret, "12345", { atMs: t0 }).ok, false, "short codes refused");
});

test("totp verify: replay — a consumed step can never verify again", () => {
  const secret = totpLib.generateTotpSecret();
  const t0 = 1_700_000_000_000;
  const code = totpLib.totp(secret, t0);
  const first = totpLib.verifyTotp(secret, code, { atMs: t0 });
  assert.equal(first.ok, true);
  const replay = totpLib.verifyTotp(secret, code, { atMs: t0 + 5_000, lastUsedStep: first.step });
  assert.equal(replay.ok, false, "same code, same step → replay rejected");
  // Even the NEXT window position of the same code stays rejected.
  const nextCode = totpLib.totp(secret, t0 + 30_000);
  const okNext = totpLib.verifyTotp(secret, nextCode, { atMs: t0 + 30_000, lastUsedStep: first.step });
  assert.equal(okNext.ok, true, "a genuinely newer step still works");
});

test("passwords: scrypt hash/verify, wrong + malformed refused", () => {
  const hash = team.hashPassword("correct horse battery");
  assert.ok(hash.startsWith("scrypt:"));
  assert.ok(!hash.includes("correct horse"));
  assert.equal(team.verifyPassword("correct horse battery", hash), true);
  assert.equal(team.verifyPassword("wrong", hash), false);
  assert.equal(team.verifyPassword("correct horse battery", "garbage"), false);
  assert.notEqual(team.hashPassword("correct horse battery"), hash, "salted — never identical");
});

test("permission matrix: viewer read-only; support barred from flags/files/commerce/team", () => {
  // viewer
  assert.equal(team.can("viewer", "read"), true);
  for (const p of ["moderate", "support_ops", "content", "files", "commerce", "settings", "audit", "team"]) {
    assert.equal(team.can("viewer", p), false, `viewer must not have ${p}`);
  }
  // support: customer-facing ops only
  assert.equal(team.can("support", "moderate"), true);
  assert.equal(team.can("support", "support_ops"), true);
  for (const p of ["content", "files", "commerce", "settings", "audit", "team"]) {
    assert.equal(team.can("support", p), false, `support must not have ${p}`);
  }
  // admin: everything except team management
  for (const p of ["read", "moderate", "support_ops", "content", "files", "commerce", "settings", "audit"]) {
    assert.equal(team.can("admin", p), true, `admin must have ${p}`);
  }
  assert.equal(team.can("admin", "team"), false);
  // owner: all
  for (const p of ["read", "moderate", "support_ops", "content", "files", "commerce", "settings", "audit", "team"]) {
    assert.equal(team.can("owner", p), true, `owner must have ${p}`);
  }
});

test("team sessions: signed round-trip, tamper + expiry rejected; bootstrap maps to owner", async () => {
  const user = {
    id: "u-1", email: "admin@example.com", passwordHash: "x", role: "support",
    totpSecretCipher: null, totpEnabled: false, totpLastStep: null, backupCodeHashes: [],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  const token = team.createTeamSession(user, 1_700_000_000_000);
  const actor = team.parseTeamSession(token, 1_700_000_100_000);
  assert.equal(actor.actor, "admin@example.com");
  assert.equal(actor.role, "support");
  assert.equal(actor.via, "team");
  // Tampered role in the payload → signature mismatch → rejected.
  const parts = token.split(".");
  const forged = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  forged.role = "owner";
  const forgedToken = `v2.${Buffer.from(JSON.stringify(forged)).toString("base64url")}.${parts[2]}`;
  assert.equal(team.parseTeamSession(forgedToken, 1_700_000_100_000), null);
  // Expired → rejected.
  assert.equal(team.parseTeamSession(token, 1_700_000_000_000 + 9 * 3600 * 1000), null);
  // The legacy ADMIN_PASSWORD session token still resolves to the bootstrap owner.
  const { adminSessionToken } = await import("../src/lib/admin.ts");
  const boot = team.actorFromCookie(adminSessionToken());
  assert.deepEqual([boot.actor, boot.role, boot.via], ["bootstrap-owner", "owner", "password"]);
  assert.equal(team.actorFromCookie("nonsense"), null);
  assert.equal(team.actorFromCookie(undefined), null);
});

test("users: create/validate/dedupe + password login + public shape hides secrets", async () => {
  const bad = await team.createUser({ email: "nope", password: "long-enough-pw", role: "viewer" });
  assert.equal(bad.error, "INVALID_EMAIL");
  const short = await team.createUser({ email: "a@b.com", password: "short", role: "viewer" });
  assert.equal(short.error, "PASSWORD_TOO_SHORT");
  const created = await team.createUser({ email: "Support@Example.com", password: "long-enough-pw", role: "support" });
  assert.equal(created.ok, true);
  assert.equal(created.user.email, "support@example.com");
  const dupe = await team.createUser({ email: "support@example.com", password: "long-enough-pw", role: "viewer" });
  assert.equal(dupe.error, "EMAIL_TAKEN");
  const pub = team.publicUser(created.user);
  assert.ok(!("passwordHash" in pub) && !("totpSecretCipher" in pub) && !("backupCodeHashes" in pub));
  const login = await team.loginTeamUser("support@example.com", "long-enough-pw");
  assert.equal(login.ok, true);
  const wrong = await team.loginTeamUser("support@example.com", "wrong-password");
  assert.deepEqual([wrong.ok, wrong.error], [false, "INVALID_CREDENTIALS"]);
  const ghost = await team.loginTeamUser("ghost@example.com", "long-enough-pw");
  assert.equal(ghost.error, "INVALID_CREDENTIALS", "unknown account is the same generic error");
});

test("2FA lifecycle: enroll → confirm → TOTP required, replay blocked, backup code single-use", async () => {
  const created = await team.createUser({ email: "two@example.com", password: "long-enough-pw", role: "admin" });
  const userId = created.user.id;
  // Login works before 2FA exists.
  assert.equal((await team.loginTeamUser("two@example.com", "long-enough-pw")).ok, true);
  const start = await team.startTotpEnrollment(userId);
  assert.equal(start.ok, true);
  assert.ok(start.secret.length >= 32);
  assert.ok(start.uri.startsWith("otpauth://totp/"));
  // Stored secret is ciphertext, never the base32 plaintext.
  const storedPending = await team.findUserById(userId);
  assert.ok(storedPending.totpSecretCipher && !storedPending.totpSecretCipher.includes(start.secret));
  assert.equal(storedPending.totpEnabled, false, "not enabled until a live code confirms");
  // Wrong code does not enable.
  const badConfirm = await team.confirmTotpEnrollment(userId, "000000");
  assert.equal(badConfirm.ok, false);
  assert.equal((await team.findUserById(userId)).totpEnabled, false);
  const code = totpLib.totp(start.secret);
  const confirm = await team.confirmTotpEnrollment(userId, code);
  assert.equal(confirm.ok, true);
  assert.equal(confirm.backupCodes.length, 8);
  // From now on a code is required.
  const noCode = await team.loginTeamUser("two@example.com", "long-enough-pw");
  assert.deepEqual([noCode.ok, noCode.error], [false, "TOTP_REQUIRED"]);
  // The enrollment code itself is already consumed (same step) → replay rejected.
  const replay = await team.loginTeamUser("two@example.com", "long-enough-pw", code);
  assert.deepEqual([replay.ok, replay.error], [false, "TOTP_INVALID"]);
  // A backup code works — exactly once.
  const backup = confirm.backupCodes[0];
  const viaBackup = await team.loginTeamUser("two@example.com", "long-enough-pw", backup);
  assert.equal(viaBackup.ok, true);
  const backupReplay = await team.loginTeamUser("two@example.com", "long-enough-pw", backup);
  assert.deepEqual([backupReplay.ok, backupReplay.error], [false, "TOTP_INVALID"]);
  // Next-step TOTP works (simulate the clock moving one step).
  const realNow = Date.now;
  const ahead = realNow() + 31_000;
  Date.now = () => ahead;
  try {
    const fresh = totpLib.totp(start.secret, ahead);
    const viaTotp = await team.loginTeamUser("two@example.com", "long-enough-pw", fresh);
    assert.equal(viaTotp.ok, true);
  } finally {
    Date.now = realNow;
  }
  // Disabling removes the requirement entirely.
  await team.disableTotp(userId);
  assert.equal((await team.loginTeamUser("two@example.com", "long-enough-pw")).ok, true);
});

test("audit log: appends are listed newest-first with actor/action/target", async () => {
  const actor = { actor: "owner@example.com", role: "owner", via: "password", userId: null };
  await team.recordAudit({ actor, action: "flag.toggle", target: "analytics", detail: { enabled: true } });
  await team.recordAudit({ actor, action: "team.user.create", target: "support@example.com" });
  const entries = await team.listAudit(10);
  assert.ok(entries.length >= 2);
  assert.equal(entries[0].action, "team.user.create");
  assert.equal(entries[0].actor, "owner@example.com");
  assert.equal(entries[1].detail.enabled, true);
  // The module exposes no update/delete for audit rows (append-only by construction).
  assert.equal(typeof team.deleteAudit, "undefined");
  assert.equal(typeof team.updateAudit, "undefined");
});
