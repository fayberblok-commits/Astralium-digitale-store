/**
 * Durable security state (Phase 1 upgrade, security §4).
 *
 * One JSON document (Setting row `security_state_v1`, else
 * .data/security-state.json — the config-store pattern used across the
 * app) holding the security facts that must survive restarts and be
 * shared coherently:
 *
 *  - sessionEpoch: bump it and EVERY admin session (bootstrap + team)
 *    dies at once — the "terminate all sessions" switch. Tokens carry
 *    the epoch they were minted under; validation compares.
 *  - loginGuards: per-account failed-login counters + lockout deadline.
 *    Keyed by account (email / "bootstrap-owner"), never by IP alone,
 *    and persisted — restarting the server is not a lockout bypass.
 *  - ownerTotp: the bootstrap owner's TOTP enrollment (secret stored
 *    AES-256-GCM via team.ts encryptSecret; backup codes hash-only,
 *    single-use; lastStep is the replay guard).
 *  - knownDevices: per-actor device fingerprints (SHA-256 of UA + IP
 *    class) seen at successful logins; an unseen fingerprint triggers
 *    the new-device alert.
 *
 * The guard arithmetic is exported as pure functions over the state
 * object so the penetration/unit suites can exercise it without IO.
 */
import { createHash } from "node:crypto";
import { getJsonConfig, setJsonConfig } from "./config-store.ts";

export interface LoginGuard {
  failures: number[]; // ms timestamps inside the counting window
  lockedUntil: number; // ms epoch; 0 = not locked
}

export interface OwnerTotpState {
  secretCipher: string;
  enabled: boolean;
  lastStep: number | null;
  backupCodeHashes: string[];
}

export interface SecurityState {
  version: 1;
  sessionEpoch: number;
  loginGuards: Record<string, LoginGuard>;
  ownerTotp: OwnerTotpState | null;
  knownDevices: Record<string, string[]>;
}

export const EMPTY_SECURITY_STATE: SecurityState = {
  version: 1,
  sessionEpoch: 0,
  loginGuards: {},
  ownerTotp: null,
  knownDevices: {},
};

export function sanitizeSecurityState(raw: unknown): SecurityState {
  if (!raw || typeof raw !== "object") return structuredClone(EMPTY_SECURITY_STATE);
  const r = raw as Partial<SecurityState>;
  const guards: Record<string, LoginGuard> = {};
  if (r.loginGuards && typeof r.loginGuards === "object") {
    for (const [k, v] of Object.entries(r.loginGuards as Record<string, unknown>)) {
      const g = v as Partial<LoginGuard>;
      guards[k] = {
        failures: Array.isArray(g.failures) ? g.failures.filter((n): n is number => typeof n === "number").slice(-50) : [],
        lockedUntil: typeof g.lockedUntil === "number" ? g.lockedUntil : 0,
      };
    }
  }
  const devices: Record<string, string[]> = {};
  if (r.knownDevices && typeof r.knownDevices === "object") {
    for (const [k, v] of Object.entries(r.knownDevices as Record<string, unknown>)) {
      devices[k] = Array.isArray(v) ? v.filter((s): s is string => typeof s === "string").slice(-20) : [];
    }
  }
  let ownerTotp: OwnerTotpState | null = null;
  if (r.ownerTotp && typeof r.ownerTotp === "object") {
    const t = r.ownerTotp as Partial<OwnerTotpState>;
    if (typeof t.secretCipher === "string" && t.secretCipher) {
      ownerTotp = {
        secretCipher: t.secretCipher,
        enabled: t.enabled === true,
        lastStep: typeof t.lastStep === "number" ? t.lastStep : null,
        backupCodeHashes: Array.isArray(t.backupCodeHashes) ? t.backupCodeHashes.filter((s): s is string => typeof s === "string") : [],
      };
    }
  }
  return {
    version: 1,
    sessionEpoch: typeof r.sessionEpoch === "number" && r.sessionEpoch >= 0 ? Math.floor(r.sessionEpoch) : 0,
    loginGuards: guards,
    ownerTotp,
    knownDevices: devices,
  };
}

export async function loadSecurityState(): Promise<SecurityState> {
  return getJsonConfig<SecurityState>("security_state_v1", "security-state.json", sanitizeSecurityState, structuredClone(EMPTY_SECURITY_STATE));
}

export async function saveSecurityState(state: SecurityState): Promise<void> {
  await setJsonConfig("security_state_v1", "security-state.json", state, sanitizeSecurityState);
}

export async function updateSecurityState<T>(fn: (state: SecurityState) => T): Promise<T> {
  const state = await loadSecurityState();
  const out = fn(state);
  await saveSecurityState(state);
  return out;
}

// ─── Login guard arithmetic (pure) ───────────────────────────────────────────

export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;

export function guardLocked(state: SecurityState, accountKey: string, nowMs: number): boolean {
  const g = state.loginGuards[accountKey];
  return Boolean(g && g.lockedUntil > nowMs);
}

/** Record a failed login; returns true when this failure trips the lockout. */
export function guardRecordFailure(state: SecurityState, accountKey: string, nowMs: number): boolean {
  const g = state.loginGuards[accountKey] ?? { failures: [], lockedUntil: 0 };
  g.failures = g.failures.filter((t) => t > nowMs - LOGIN_WINDOW_MS);
  g.failures.push(nowMs);
  let tripped = false;
  if (g.failures.length >= LOGIN_MAX_FAILURES) {
    g.lockedUntil = nowMs + LOGIN_LOCKOUT_MS;
    g.failures = [];
    tripped = true;
  }
  state.loginGuards[accountKey] = g;
  return tripped;
}

export function guardRecordSuccess(state: SecurityState, accountKey: string): void {
  delete state.loginGuards[accountKey];
}

// ─── Session epoch ───────────────────────────────────────────────────────────

export async function currentSessionEpoch(): Promise<number> {
  const state = await loadSecurityState();
  return state.sessionEpoch;
}

/** Terminate ALL admin sessions (bootstrap + team) by bumping the epoch. */
export async function terminateAllSessions(): Promise<number> {
  return updateSecurityState((state) => {
    state.sessionEpoch += 1;
    return state.sessionEpoch;
  });
}

// ─── Device fingerprints (new-device alert) ──────────────────────────────────

export function deviceFingerprint(userAgent: string, ip: string): string {
  // IP class only (/24 for v4) so a DHCP refresh is not a "new device".
  const ipClass = ip.includes(".") ? ip.split(".").slice(0, 3).join(".") : ip.slice(0, 24);
  return createHash("sha256").update(`${userAgent}|${ipClass}`).digest("hex").slice(0, 32);
}

/** Returns true when this fingerprint is NEW for the actor (and records it). */
export function noteDevice(state: SecurityState, actorKey: string, fingerprint: string): boolean {
  const list = state.knownDevices[actorKey] ?? [];
  if (list.includes(fingerprint)) return false;
  list.push(fingerprint);
  state.knownDevices[actorKey] = list.slice(-20);
  return true;
}
