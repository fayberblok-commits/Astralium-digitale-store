/**
 * Product → file bindings (which S3 object is a product's deliverable).
 *
 * Resolution order, per the Phase-1 design:
 *   1. Database Product.fileKey / previewKey (production source of truth)
 *   2. Local JSON store at .data/file-bindings.json (local-dev persistence,
 *      used when no DATABASE_URL is configured — documented as such)
 *   3. Nothing (download falls back to the generated licensed deliverable)
 *
 * Writes go to the DB when configured, otherwise to the JSON store.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { getDb } from "./db.ts";

export interface FileBinding {
  productId: string;
  fileKey?: string;
  previewKey?: string;
  version?: string;
  updatedAt?: string;
}

const STORE_PATH = path.join(process.cwd(), ".data", "file-bindings.json");

type StoreShape = Record<string, FileBinding>;

async function readStore(): Promise<StoreShape> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    return JSON.parse(raw) as StoreShape;
  } catch {
    return {};
  }
}

async function writeStore(store: StoreShape): Promise<void> {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

export async function getBinding(productId: string): Promise<FileBinding | null> {
  // 1) Database first.
  try {
    const db = await getDb();
    if (db) {
      const row = await db.product.findUnique({ where: { id: productId } });
      if (row && (row.fileKey || row.previewKey)) {
        return {
          productId,
          fileKey: row.fileKey ?? undefined,
          previewKey: row.previewKey ?? undefined,
          version: row.version,
        };
      }
    }
  } catch {
    // fall through to the JSON store
  }
  // 2) Local JSON store.
  const store = await readStore();
  return store[productId] ?? null;
}

export async function setBinding(
  productId: string,
  patch: { fileKey?: string; previewKey?: string; version?: string },
): Promise<{ persisted: "db" | "file"; binding: FileBinding }> {
  const db = await getDb().catch(() => null);
  if (db) {
    const row = await db.product.update({
      where: { id: productId },
      data: {
        ...(patch.fileKey !== undefined ? { fileKey: patch.fileKey } : {}),
        ...(patch.previewKey !== undefined ? { previewKey: patch.previewKey } : {}),
        ...(patch.version !== undefined ? { version: patch.version } : {}),
      },
    });
    return {
      persisted: "db",
      binding: {
        productId,
        fileKey: row.fileKey ?? undefined,
        previewKey: row.previewKey ?? undefined,
        version: row.version,
        updatedAt: row.updatedAt.toISOString(),
      },
    };
  }
  const store = await readStore();
  const next: FileBinding = {
    ...(store[productId] ?? { productId }),
    ...patch,
    productId,
    updatedAt: new Date().toISOString(),
  };
  store[productId] = next;
  await writeStore(store);
  return { persisted: "file", binding: next };
}
