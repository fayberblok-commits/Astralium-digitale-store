/**
 * JSON config documents (Phase 4 shared helper).
 *
 * Owner-editable feature configuration lives in ONE JSON document per
 * feature — the DB Setting row when a database is configured, else a
 * file under .data/ (the same pattern Phase 3 introduced for offers and
 * bundles). Every read passes through the feature's sanitizer, so a
 * hand-edited or corrupted document can never inject bad money values:
 * sanitizers clamp/re-validate against the catalog.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { getDb } from "./db.ts";

export async function getJsonConfig<T>(
  settingKey: string,
  fileName: string,
  sanitize: (raw: unknown) => T,
  empty: T,
): Promise<T> {
  try {
    const db = await getDb();
    if (db) {
      const row = await db.setting.findUnique({ where: { key: settingKey } });
      if (row) return sanitize(row.value);
    }
  } catch {
    // fall through to the file store
  }
  try {
    return sanitize(JSON.parse(await fs.readFile(path.join(process.cwd(), ".data", fileName), "utf8")));
  } catch {
    return empty;
  }
}

export async function setJsonConfig<T>(
  settingKey: string,
  fileName: string,
  value: T,
  sanitize: (raw: unknown) => T,
): Promise<{ persisted: "db" | "file"; value: T }> {
  const clean = sanitize(value);
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const jsonValue = JSON.parse(JSON.stringify(clean)) as import("@prisma/client").Prisma.InputJsonValue;
      await db.setting.upsert({
        where: { key: settingKey },
        create: { key: settingKey, value: jsonValue },
        update: { value: jsonValue },
      });
      return { persisted: "db", value: clean };
    } catch {
      // fall through to file
    }
  }
  const filePath = path.join(process.cwd(), ".data", fileName);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(clean, null, 2), "utf8");
  return { persisted: "file", value: clean };
}
