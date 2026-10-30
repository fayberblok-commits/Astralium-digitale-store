/**
 * Product versions (Phase 3, feature 1).
 *
 * Publishing a new version NEVER changes a buyer's download link: tokens
 * and grants resolve through the product binding, and publishVersion()
 * repoints that binding at the new version's file. The version history
 * itself persists to the DB ProductVersion table when configured, else
 * to .data/product-versions.json (same honesty pattern as bindings.ts).
 *
 * On publish, buyers (from DB orders containing the product) are queued
 * a "product update" email via the email service. Without a DB there is
 * no buyer list to email — the publish result says so instead of
 * pretending messages were sent. The in-account "updated" marker needs
 * no email at all: the library computes it from this history.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { getDb } from "./db.ts";
import { setBinding } from "./bindings.ts";
import { getProductById } from "../data/products.ts";
import { sendEmail } from "../services/email.ts";

export interface ProductVersionRecord {
  productId: string;
  version: string;
  fileKey: string;
  notes?: string;
  createdAt: string; // ISO
}

const STORE_PATH = path.join(process.cwd(), ".data", "product-versions.json");
type StoreShape = Record<string, ProductVersionRecord[]>;

async function readStore(): Promise<StoreShape> {
  try {
    return JSON.parse(await fs.readFile(STORE_PATH, "utf8")) as StoreShape;
  } catch {
    return {};
  }
}

async function writeStore(store: StoreShape): Promise<void> {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

/** Numeric dotted-version compare: -1 / 0 / 1 ("1.10.0" > "1.9.0"). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((x) => parseInt(x, 10) || 0);
  const pb = b.split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}

/** The version a buyer owned at `atISO`: latest record not after it, else the base version. */
export function versionAt(records: ProductVersionRecord[], atISO: string, baseVersion = "1.0.0"): string {
  const at = new Date(atISO).getTime();
  const eligible = records
    .filter((r) => new Date(r.createdAt).getTime() <= at)
    .sort((x, y) => new Date(y.createdAt).getTime() - new Date(x.createdAt).getTime());
  return eligible[0]?.version ?? baseVersion;
}

export function latestVersionOf(records: ProductVersionRecord[]): ProductVersionRecord | null {
  if (records.length === 0) return null;
  return [...records].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
}

export async function listVersions(productId: string): Promise<ProductVersionRecord[]> {
  try {
    const db = await getDb();
    if (db) {
      const rows = await db.productVersion.findMany({
        where: { productId },
        orderBy: { createdAt: "desc" },
      });
      if (rows.length > 0) {
        return rows.map((r) => ({
          productId: r.productId,
          version: r.version,
          fileKey: r.fileKey,
          notes: r.notes ?? undefined,
          createdAt: r.createdAt.toISOString(),
        }));
      }
    }
  } catch {
    // fall through to the JSON store
  }
  const store = await readStore();
  return (store[productId] ?? []).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export interface PublishResult {
  persisted: "db" | "file";
  record: ProductVersionRecord;
  emailsQueued: number;
  emailNote: "sent-via-email-service" | "no-db-no-buyer-list" | "no-buyers";
}

export async function publishVersion(input: {
  productId: string;
  version: string;
  fileKey: string;
  notes?: string;
}): Promise<PublishResult> {
  const record: ProductVersionRecord = {
    productId: input.productId,
    version: input.version,
    fileKey: input.fileKey,
    notes: input.notes,
    createdAt: new Date().toISOString(),
  };
  let persisted: "db" | "file" = "file";
  const buyerEmails: string[] = [];
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      await db.productVersion.upsert({
        where: { productId_version: { productId: input.productId, version: input.version } },
        create: { productId: input.productId, version: input.version, fileKey: input.fileKey, notes: input.notes },
        update: { fileKey: input.fileKey, notes: input.notes },
      });
      persisted = "db";
      const orders = await db.order.findMany({
        where: { status: { in: ["paid", "fulfilled"] }, items: { some: { productId: input.productId } } },
        select: { email: true },
      });
      for (const o of orders) if (o.email && !buyerEmails.includes(o.email)) buyerEmails.push(o.email);
    } catch {
      persisted = "file"; // e.g. catalog not synced into the DB yet — file store stays truthful
    }
  }
  if (persisted === "file") {
    const store = await readStore();
    const list = (store[input.productId] ?? []).filter((r) => r.version !== input.version);
    list.push(record);
    store[input.productId] = list;
    await writeStore(store);
  }
  // Repoint the deliverable binding — existing download links keep working.
  await setBinding(input.productId, { fileKey: input.fileKey, version: input.version });

  const product = getProductById(input.productId);
  let emailsQueued = 0;
  for (const to of buyerEmails) {
    await sendEmail({
      to,
      kind: "product-update",
      subject: `Updated: ${product?.title ?? input.productId} — version ${input.version} is in your library`,
      html: `<div style="font-family:Georgia,serif;color:#10131f"><h1>Astralium Digitale Store</h1><p>Good news — <strong>${product?.title ?? input.productId}</strong> was updated to version ${input.version}${input.notes ? `: ${input.notes}` : ""}. Your existing download link and library entry now serve the new version; nothing to re-buy.</p></div>`,
    });
    emailsQueued++;
  }
  return {
    persisted,
    record,
    emailsQueued,
    emailNote: !db ? "no-db-no-buyer-list" : buyerEmails.length === 0 ? "no-buyers" : "sent-via-email-service",
  };
}
