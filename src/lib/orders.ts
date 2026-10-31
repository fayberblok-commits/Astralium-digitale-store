/**
 * Order ledger (Phase 1 upgrade, foundation F1 + security §8).
 *
 * Before this module NO code created Order rows — fulfilment was
 * webhook/log-only, so the library, verified-purchase reviews and
 * social proof all read zero real sales. Now:
 *
 *  - checkout initiation creates a PENDING order (items, totals,
 *    currency, buyer email, provider + provider session id);
 *  - the payment webhook transitions it (markPaidAndGrant) and creates
 *    DownloadGrants (token stored hash-only);
 *  - refunds/disputes transition it onward and revoke the grants.
 *
 * State machine (security §8) — enforced in ONE place:
 *
 *     pending ──► paid ──► fulfilled
 *       │         │  ▲        │
 *       ▼         ▼  │        ▼
 *     failed    disputed ──► refunded (terminal)
 *
 * PAID is reachable ONLY from PENDING (via markPaidAndGrant). REFUNDED
 * and FAILED are terminal: a refunded order can never return to PAID,
 * even if a duplicate/late "paid" webhook arrives — such events are
 * refused and logged. Dispute resolution back to PAID is a manual
 * owner action (restoreAfterDispute), never a webhook side effect.
 *
 * Dual-mode storage, following the repo's adapter pattern: Prisma when
 * DATABASE_URL is set, else the .data/orders.json file store. Every
 * write is idempotent on the provider reference (Order.providerRef is
 * @unique) so webhook replays are no-ops.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { getDb } from "./db.ts";
import { createDownloadToken } from "./tokens.ts";
import { getProductById } from "../data/products.ts";

export type OrderStatus = "pending" | "paid" | "fulfilled" | "refunded" | "failed" | "disputed";

export interface OrderItemRecord {
  productId: string;
  priceUSD: number;
}

export interface OrderRecord {
  id: string; // store order id (AST-…)
  email: string;
  status: OrderStatus;
  totalUSD: number;
  currency: string;
  provider: string; // stripe | paypal
  providerRef: string; // provider session/order id — idempotency anchor
  deliveryChannel: string | null;
  deliverySubjectHash: string | null;
  // Manager's Office (Phase 4 upgrade): refunded amount so far (a full
  // refund sets refundUSD = totalUSD and moves status to refunded; a
  // partial refund records the amount and keeps the status), the
  // owner's private note, and checkout-captured country/locale for
  // sales reporting (null = not captured → reported as "unknown").
  refundUSD: number;
  note: string;
  country: string | null;
  locale: string | null;
  items: OrderItemRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface GrantRecord {
  id: string;
  orderId: string;
  productId: string;
  tokenHash: string;
  maxDownloads: number;
  downloadsCount: number;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
}

// ─── State machine (pure) ────────────────────────────────────────────────────

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ["paid", "failed"],
  paid: ["fulfilled", "refunded", "disputed"],
  fulfilled: ["refunded", "disputed"],
  disputed: ["refunded", "paid"], // "paid" from disputed = dispute WON, owner-confirmed only
  refunded: [],
  failed: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

export function isTerminal(status: OrderStatus): boolean {
  return status === "refunded" || status === "failed";
}

// ─── File store (.data/orders.json) ──────────────────────────────────────────

interface FileStoreShape {
  orders: OrderRecord[];
  grants: GrantRecord[];
}

const FILE_PATH = path.join(process.cwd(), ".data", "orders.json");

async function readFileStore(): Promise<FileStoreShape> {
  try {
    const raw = JSON.parse(await fs.readFile(FILE_PATH, "utf8")) as Partial<FileStoreShape>;
    return {
      orders: Array.isArray(raw.orders) ? raw.orders.map((o) => normalizeFileOrder(o as Partial<OrderRecord> & { id: string })) : [],
      grants: Array.isArray(raw.grants) ? raw.grants : [],
    };
  } catch {
    return { orders: [], grants: [] };
  }
}

async function writeFileStore(store: FileStoreShape): Promise<void> {
  await fs.mkdir(path.dirname(FILE_PATH), { recursive: true });
  await fs.writeFile(FILE_PATH, JSON.stringify(store, null, 2), "utf8");
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// ─── DB row mapping ──────────────────────────────────────────────────────────

type DbOrder = {
  id: string; email: string; status: string; totalUSD: number; currency: string;
  provider: string; providerRef: string; deliveryChannel: string | null;
  deliverySubjectHash: string | null;
  refundUSD?: number; note?: string; country?: string | null; locale?: string | null;
  createdAt: Date; updatedAt: Date;
  items?: { productId: string; priceUSD: number }[];
};

function fromDbOrder(row: DbOrder): OrderRecord {
  return {
    id: row.id,
    email: row.email,
    status: (row.status as OrderStatus) ?? "pending",
    totalUSD: row.totalUSD,
    currency: row.currency,
    provider: row.provider,
    providerRef: row.providerRef,
    deliveryChannel: row.deliveryChannel,
    deliverySubjectHash: row.deliverySubjectHash,
    refundUSD: row.refundUSD ?? 0,
    note: row.note ?? "",
    country: row.country ?? null,
    locale: row.locale ?? null,
    items: (row.items ?? []).map((i) => ({ productId: i.productId, priceUSD: i.priceUSD })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** File-mode rows written before the office fields existed get defaults. */
function normalizeFileOrder(o: Partial<OrderRecord> & { id: string }): OrderRecord {
  return {
    refundUSD: 0, note: "", country: null, locale: null,
    deliveryChannel: null, deliverySubjectHash: null, items: [],
    ...o,
  } as OrderRecord;
}

// ─── Creation (checkout initiation) ──────────────────────────────────────────

export interface CreateOrderInput {
  orderId: string;
  email: string;
  provider: "stripe" | "paypal";
  providerRef: string;
  items: OrderItemRecord[];
  totalUSD: number;
  currency?: string;
  deliveryChannel?: string | null;
  deliverySubjectHash?: string | null;
  /** Office reporting dimensions captured at checkout (optional). */
  country?: string | null;
  locale?: string | null;
}

/** Create the PENDING order. Idempotent on providerRef: a retry returns the existing order untouched. */
export async function createPendingOrder(input: CreateOrderInput): Promise<OrderRecord> {
  const existing = await getOrderByRef(input.providerRef);
  if (existing) return existing;

  const now = new Date().toISOString();
  const record: OrderRecord = {
    id: input.orderId,
    email: input.email,
    status: "pending",
    totalUSD: input.totalUSD,
    currency: input.currency ?? "USD",
    provider: input.provider,
    providerRef: input.providerRef,
    deliveryChannel: input.deliveryChannel ?? null,
    deliverySubjectHash: input.deliverySubjectHash ?? null,
    refundUSD: 0,
    note: "",
    country: input.country ?? null,
    locale: input.locale ?? null,
    items: input.items,
    createdAt: now,
    updatedAt: now,
  };

  const db = await getDb().catch(() => null);
  if (db) {
    try {
      // OrderItem.productId is an FK — make sure catalog rows exist
      // (stub upserts that never overwrite owner data).
      for (const item of input.items) {
        const seed = getProductById(item.productId);
        await db.product.upsert({
          where: { id: item.productId },
          create: {
            id: item.productId,
            slug: seed?.slug ?? item.productId,
            title: seed?.title ?? item.productId,
            priceUSD: seed?.priceUSD ?? item.priceUSD,
          },
          update: {},
        });
      }
      const row = await db.order.create({
        data: {
          id: record.id,
          email: record.email,
          status: "pending",
          totalUSD: record.totalUSD,
          currency: record.currency,
          provider: record.provider,
          providerRef: record.providerRef,
          deliveryChannel: record.deliveryChannel,
          deliverySubjectHash: record.deliverySubjectHash,
          country: record.country,
          locale: record.locale,
          items: { create: input.items.map((i) => ({ productId: i.productId, priceUSD: i.priceUSD })) },
        },
        include: { items: true },
      });
      return fromDbOrder(row as DbOrder);
    } catch {
      // Unique-race or transient DB failure: if the order now exists,
      // return it; otherwise fall through to the file store so a ledger
      // write failure can never break checkout.
      const raced = await getOrderByRef(input.providerRef).catch(() => null);
      if (raced) return raced;
    }
  }
  const store = await readFileStore();
  if (!store.orders.some((o) => o.providerRef === record.providerRef)) {
    store.orders.push(record);
    await writeFileStore(store);
  }
  return record;
}

// ─── Reads ───────────────────────────────────────────────────────────────────

export async function getOrderByRef(providerRef: string): Promise<OrderRecord | null> {
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const row = await db.order.findUnique({ where: { providerRef }, include: { items: true } });
      if (row) return fromDbOrder(row as DbOrder);
    } catch { /* fall through */ }
  }
  const store = await readFileStore();
  return store.orders.find((o) => o.providerRef === providerRef) ?? null;
}

export async function getOrderById(orderId: string): Promise<OrderRecord | null> {
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const row = await db.order.findUnique({ where: { id: orderId }, include: { items: true } });
      if (row) return fromDbOrder(row as DbOrder);
    } catch { /* fall through */ }
  }
  const store = await readFileStore();
  return store.orders.find((o) => o.id === orderId) ?? null;
}

/** Resolve by store id OR provider ref (webhooks carry either). */
export async function findOrder(idOrRef: string): Promise<OrderRecord | null> {
  return (await getOrderById(idOrRef)) ?? (await getOrderByRef(idOrRef));
}

export async function listOrdersByEmail(email: string): Promise<OrderRecord[]> {
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const rows = await db.order.findMany({
        where: { email }, include: { items: true }, orderBy: { createdAt: "desc" },
      });
      if (rows.length > 0) return rows.map((r) => fromDbOrder(r as DbOrder));
    } catch { /* fall through */ }
  }
  const store = await readFileStore();
  return store.orders.filter((o) => o.email === email);
}

// ─── Transitions ─────────────────────────────────────────────────────────────

export type TransitionResult =
  | { ok: true; order: OrderRecord }
  | { ok: false; reason: "NOT_FOUND" | "ILLEGAL_TRANSITION" | "ALREADY"; order?: OrderRecord };

async function persistStatus(order: OrderRecord, to: OrderStatus): Promise<OrderRecord> {
  const updated: OrderRecord = { ...order, status: to, updatedAt: new Date().toISOString() };
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      // Guarded update: the status we read is part of the WHERE, so a
      // concurrent transition cannot be overwritten silently.
      const res = await db.order.updateMany({
        where: { id: order.id, status: order.status },
        data: { status: to },
      });
      if (res.count > 0) return updated;
    } catch { /* fall through to file/none */ }
  }
  const store = await readFileStore();
  const idx = store.orders.findIndex((o) => o.id === order.id);
  if (idx >= 0) {
    store.orders[idx] = updated;
    await writeFileStore(store);
  }
  return updated;
}

export async function transitionOrder(idOrRef: string, to: OrderStatus): Promise<TransitionResult> {
  const order = await findOrder(idOrRef);
  if (!order) return { ok: false, reason: "NOT_FOUND" };
  if (order.status === to) return { ok: false, reason: "ALREADY", order };
  if (!canTransition(order.status, to)) return { ok: false, reason: "ILLEGAL_TRANSITION", order };
  const updated = await persistStatus(order, to);
  return { ok: true, order: updated };
}

// ─── Grants ──────────────────────────────────────────────────────────────────

export interface IssuedGrant {
  productId: string;
  token: string; // plaintext — returned ONCE for the delivery email/links
  grant: GrantRecord;
}

async function existingGrants(orderId: string): Promise<GrantRecord[]> {
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const rows = await db.downloadGrant.findMany({ where: { orderId } });
      if (rows.length > 0) {
        return rows.map((r) => ({
          id: r.id, orderId: r.orderId, productId: r.productId, tokenHash: r.tokenHash,
          maxDownloads: r.maxDownloads, downloadsCount: r.downloadsCount,
          expiresAt: r.expiresAt.toISOString(), revokedAt: r.revokedAt?.toISOString() ?? null,
          createdAt: r.createdAt.toISOString(),
        }));
      }
    } catch { /* fall through */ }
  }
  const store = await readFileStore();
  return store.grants.filter((g) => g.orderId === orderId);
}

/** Office view of an order's grants (hashes never leave the server). */
export async function listGrantsForOrder(orderId: string): Promise<GrantRecord[]> {
  return existingGrants(orderId);
}

/**
 * Create grants for an order's items (idempotent per product: existing
 * grants are returned WITHOUT their token — plaintext exists only at
 * first issuance; re-delivery mints fresh tokens via reissueGrant).
 */
export async function issueGrantsForOrder(
  order: OrderRecord,
  opts: { ttlSeconds?: number; maxDownloads?: number } = {},
): Promise<{ issued: IssuedGrant[]; existing: GrantRecord[] }> {
  const prior = await existingGrants(order.id);
  const issued: IssuedGrant[] = [];
  const db = await getDb().catch(() => null);
  const store = db ? null : await readFileStore();
  for (const item of order.items) {
    if (prior.some((g) => g.productId === item.productId && !g.revokedAt)) continue;
    const token = createDownloadToken(item.productId, order.id, {
      ttlSeconds: opts.ttlSeconds, maxDownloads: opts.maxDownloads,
    });
    const grant: GrantRecord = {
      id: randomUUID(),
      orderId: order.id,
      productId: item.productId,
      tokenHash: sha256Hex(token),
      maxDownloads: opts.maxDownloads ?? 5,
      downloadsCount: 0,
      expiresAt: new Date(Date.now() + (opts.ttlSeconds ?? 7 * 24 * 3600) * 1000).toISOString(),
      revokedAt: null,
      createdAt: new Date().toISOString(),
    };
    if (db) {
      try {
        await db.downloadGrant.create({
          data: {
            id: grant.id, orderId: grant.orderId, productId: grant.productId,
            tokenHash: grant.tokenHash, maxDownloads: grant.maxDownloads,
            expiresAt: new Date(grant.expiresAt),
          },
        });
      } catch { /* unique tokenHash race — treat as existing */ continue; }
    } else if (store) {
      store.grants.push(grant);
    }
    issued.push({ productId: item.productId, token, grant });
    prior.push(grant);
  }
  if (store) await writeFileStore(store);
  return { issued, existing: prior };
}

export async function revokeGrantsForOrder(orderId: string, reason: string): Promise<number> {
  let count = 0;
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const res = await db.downloadGrant.updateMany({
        where: { orderId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      count = res.count;
    } catch { /* fall through */ }
  }
  const store = await readFileStore();
  let dirty = false;
  for (const g of store.grants) {
    if (g.orderId === orderId && !g.revokedAt) {
      g.revokedAt = new Date().toISOString();
      dirty = true;
      count = Math.max(count, 1);
    }
  }
  if (dirty) await writeFileStore(store);
  void reason;
  return count;
}

/** Grant lookup for the download route: by the raw token's hash. */
export async function getGrantByToken(token: string): Promise<GrantRecord | null> {
  const tokenHash = sha256Hex(token);
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const row = await db.downloadGrant.findUnique({ where: { tokenHash } });
      if (row) {
        return {
          id: row.id, orderId: row.orderId, productId: row.productId, tokenHash: row.tokenHash,
          maxDownloads: row.maxDownloads, downloadsCount: row.downloadsCount,
          expiresAt: row.expiresAt.toISOString(), revokedAt: row.revokedAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
        };
      }
    } catch { /* fall through */ }
  }
  const store = await readFileStore();
  return store.grants.find((g) => g.tokenHash === tokenHash) ?? null;
}

/**
 * Count one download against a grant. Returns false when the grant is
 * revoked or the cap is reached (the download route refuses then).
 * Grants are the enforcement layer ON TOP of the signed token's own
 * expiry: a token with no grant row (issued before this upgrade) is
 * not blocked here — the token's embedded max/expiry still applies.
 */
export async function consumeGrantDownload(grant: GrantRecord): Promise<boolean> {
  if (grant.revokedAt) return false;
  if (grant.downloadsCount >= grant.maxDownloads) return false;
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const res = await db.downloadGrant.updateMany({
        where: { id: grant.id, revokedAt: null, downloadsCount: { lt: grant.maxDownloads } },
        data: { downloadsCount: { increment: 1 } },
      });
      return res.count > 0;
    } catch { /* fall through */ }
  }
  const store = await readFileStore();
  const row = store.grants.find((g) => g.id === grant.id);
  if (row) {
    if (row.revokedAt || row.downloadsCount >= row.maxDownloads) return false;
    row.downloadsCount += 1;
    await writeFileStore(store);
    return true;
  }
  return true; // grant lived only in DB read above; do not block delivery on bookkeeping
}

// ─── Webhook entry points ────────────────────────────────────────────────────

export interface MarkPaidInput {
  providerRef: string;
  provider: "stripe" | "paypal";
  email: string;
  items: OrderItemRecord[];
  totalUSD: number;
  currency?: string;
  /** Store order id when known (from provider metadata); else derived. */
  orderId?: string;
  deliveryChannel?: string | null;
  deliverySubjectHash?: string | null;
  country?: string | null;
  locale?: string | null;
}

export type MarkPaidResult =
  | { ok: true; order: OrderRecord; grants: IssuedGrant[]; duplicate: boolean }
  | { ok: false; reason: "TERMINAL_STATE" | "ILLEGAL_TRANSITION"; order: OrderRecord };

/**
 * The ONLY path to PAID. Creates the order first when the webhook
 * references a session minted before the ledger existed. Idempotent:
 * an already-paid order returns duplicate:true with no new grants.
 * A refunded/failed order REFUSES — PAID can never be resurrected.
 */
export async function markPaidAndGrant(input: MarkPaidInput): Promise<MarkPaidResult> {
  let order = await getOrderByRef(input.providerRef);
  if (!order) {
    order = await createPendingOrder({
      orderId: input.orderId ?? `AST-${input.providerRef.slice(-12).toUpperCase()}`,
      email: input.email,
      provider: input.provider,
      providerRef: input.providerRef,
      items: input.items,
      totalUSD: input.totalUSD,
      currency: input.currency,
      deliveryChannel: input.deliveryChannel,
      deliverySubjectHash: input.deliverySubjectHash,
      country: input.country,
      locale: input.locale,
    });
  }
  if (order.status === "paid" || order.status === "fulfilled") {
    const { existing } = await issueGrantsForOrder(order); // no-op when grants exist
    void existing;
    return { ok: true, order, grants: [], duplicate: true };
  }
  if (order.status !== "pending") {
    return { ok: false, reason: isTerminal(order.status) ? "TERMINAL_STATE" : "ILLEGAL_TRANSITION", order };
  }
  const transitioned = await transitionOrder(order.id, "paid");
  if (!transitioned.ok || !transitioned.order) {
    return { ok: false, reason: "ILLEGAL_TRANSITION", order };
  }
  const { issued } = await issueGrantsForOrder(transitioned.order);
  return { ok: true, order: transitioned.order, grants: issued, duplicate: false };
}

/** Refund: transition (paid/fulfilled/disputed → refunded) + revoke all grants. */
export async function applyRefund(idOrRef: string): Promise<TransitionResult & { revoked: number }> {
  const order = await findOrder(idOrRef);
  if (!order) return { ok: false, reason: "NOT_FOUND", revoked: 0 };
  if (order.status === "refunded") {
    return { ok: false, reason: "ALREADY", order, revoked: 0 };
  }
  const t = await transitionOrder(order.id, "refunded");
  if (!t.ok) return { ...t, revoked: 0 };
  // A full refund always accounts for the whole order total.
  if (t.order) await persistOrderFields(t.order, { refundUSD: t.order.totalUSD });
  const revoked = await revokeGrantsForOrder(order.id, "refund");
  return { ...t, revoked };
}

// ─── Manager's Office operations (Phase 4 upgrade) ───────────────────────────

/** List every order (newest first) for the office — dual-mode. */
export async function listAllOrders(limit = 5000): Promise<OrderRecord[]> {
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const rows = await db.order.findMany({
        include: { items: true }, orderBy: { createdAt: "desc" }, take: limit,
      });
      if (rows.length > 0) return rows.map((r) => fromDbOrder(r as DbOrder));
    } catch { /* fall through */ }
  }
  const store = await readFileStore();
  return [...store.orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}

/** Persist non-status fields (note / refundUSD) in the active store. */
export async function persistOrderFields(
  order: OrderRecord,
  fields: Partial<Pick<OrderRecord, "note" | "refundUSD">>,
): Promise<OrderRecord> {
  const updated: OrderRecord = { ...order, ...fields, updatedAt: new Date().toISOString() };
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      await db.order.update({
        where: { id: order.id },
        data: {
          ...(fields.note !== undefined ? { note: fields.note } : {}),
          ...(fields.refundUSD !== undefined ? { refundUSD: fields.refundUSD } : {}),
        },
      });
      return updated;
    } catch { /* fall through to file */ }
  }
  const store = await readFileStore();
  const idx = store.orders.findIndex((o) => o.id === order.id);
  if (idx >= 0) {
    store.orders[idx] = updated;
    await writeFileStore(store);
  }
  return updated;
}

export async function setOrderNote(idOrRef: string, note: string): Promise<{ ok: boolean; order?: OrderRecord }> {
  const order = await findOrder(idOrRef);
  if (!order) return { ok: false };
  const updated = await persistOrderFields(order, { note: note.slice(0, 2000) });
  return { ok: true, order: updated };
}

/**
 * Pure refund arithmetic: given an order and a NEW refund amount, what
 * should the ledger hold? Full coverage (refunded so far + amount ≥
 * total) closes the order as refunded; anything less is a partial
 * refund that keeps the status (and the customer's access). Amounts
 * are clamped to the remaining refundable balance.
 */
export function refundStateAfter(
  order: Pick<OrderRecord, "totalUSD" | "refundUSD" | "status">,
  amountUSD: number,
): { amount: number; refundUSD: number; full: boolean } | { error: "NOT_REFUNDABLE" | "INVALID_AMOUNT" | "NOTHING_LEFT" } {
  if (order.status !== "paid" && order.status !== "fulfilled" && order.status !== "disputed") {
    return { error: "NOT_REFUNDABLE" };
  }
  if (!Number.isFinite(amountUSD) || amountUSD <= 0) return { error: "INVALID_AMOUNT" };
  const remaining = Math.round((order.totalUSD - order.refundUSD) * 100) / 100;
  if (remaining <= 0) return { error: "NOTHING_LEFT" };
  const amount = Math.min(Math.round(amountUSD * 100) / 100, remaining);
  const refundUSD = Math.round((order.refundUSD + amount) * 100) / 100;
  return { amount, refundUSD, full: refundUSD >= order.totalUSD };
}

/**
 * Record a refund that the provider has already executed (the office
 * refund route calls this AFTER the provider confirms). Full → status
 * refunded + grants revoked; partial → refundUSD grows, status and
 * grants untouched.
 */
export async function recordRefund(
  idOrRef: string,
  amountUSD: number,
): Promise<{ ok: true; order: OrderRecord; full: boolean; amount: number } | { ok: false; reason: string; order?: OrderRecord }> {
  const order = await findOrder(idOrRef);
  if (!order) return { ok: false, reason: "NOT_FOUND" };
  const state = refundStateAfter(order, amountUSD);
  if ("error" in state) return { ok: false, reason: state.error, order };
  if (state.full) {
    const t = await transitionOrder(order.id, "refunded");
    if (!t.ok || !t.order) return { ok: false, reason: t.ok ? "TRANSITION_FAILED" : t.reason, order };
    await persistOrderFields(t.order, { refundUSD: state.refundUSD });
    await revokeGrantsForOrder(order.id, "refund");
    return { ok: true, order: { ...t.order, refundUSD: state.refundUSD }, full: true, amount: state.amount };
  }
  const updated = await persistOrderFields(order, { refundUSD: state.refundUSD });
  return { ok: true, order: updated, full: false, amount: state.amount };
}

/** Dispute/chargeback opened: hold the order (→ disputed) + revoke grants pending the outcome. */
export async function applyDispute(idOrRef: string): Promise<TransitionResult & { revoked: number }> {
  const order = await findOrder(idOrRef);
  if (!order) return { ok: false, reason: "NOT_FOUND", revoked: 0 };
  const t = await transitionOrder(order.id, "disputed");
  if (!t.ok) return { ...t, revoked: 0 };
  const revoked = await revokeGrantsForOrder(order.id, "dispute");
  return { ...t, revoked };
}
