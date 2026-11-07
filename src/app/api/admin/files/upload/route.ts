import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../../lib/team";
import { listAdminProducts } from "../../../../../lib/catalog";
import { ALLOWED_EXTENSIONS, sanitizeFilename } from "../../../../../lib/uploads";
import {
  headObject,
  isStorageConfigured,
  previewFileKey,
  productFileKey,
  putObject,
} from "../../../../../services/storage";
import { SNIFF_BYTES, verifyFileMagic } from "../../../../../lib/file-sniff";
import { recordSecurityEvent } from "../../../../../lib/security-log";
import { setBinding } from "../../../../../lib/bindings";
import { isDbConfigured } from "../../../../../lib/db";

export const runtime = "nodejs";

/** App-level guard for the server-proxied upload (the hosting platform may
 *  enforce a lower request-body limit of its own in production). */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Server-proxied admin upload: the browser sends the file to THIS route
 * (same origin), and the server PUTs it to S3 with a signed request, then
 * persists the binding exactly like the confirm step of the presigned
 * flow. This path exists because direct browser → S3 uploads depend on
 * bucket CORS rules that the storage provider's web console cannot fully
 * express; the proxied path needs no CORS at all.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, "files");
  if ("error" in auth) return auth.error;
  if (!isStorageConfigured()) {
    return NextResponse.json({ error: "STORAGE_NOT_CONFIGURED" }, { status: 503 });
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }
  const productId = form.get("productId");
  const kind = form.get("kind");
  const versionRaw = form.get("version");
  const version = typeof versionRaw === "string" && versionRaw ? versionRaw : undefined;
  const file = form.get("file");
  if (
    typeof productId !== "string" ||
    !productId ||
    (kind !== "product" && kind !== "preview") ||
    !(file instanceof File)
  ) {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }
  // Resolve through the real catalog (DB source of truth, incl. inactive
  // products) — the seed list alone misses office-created products.
  const { products } = await listAdminProducts();
  const product = products.find((p) => p.id === productId);
  if (!product) {
    return NextResponse.json({ error: "PRODUCT_NOT_FOUND" }, { status: 404 });
  }
  const filename = sanitizeFilename(file.name);
  if (!filename) {
    return NextResponse.json(
      { error: "INVALID_FILENAME", allowedExtensions: ALLOWED_EXTENSIONS },
      { status: 400 },
    );
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "FILE_TOO_LARGE", maxBytes: MAX_UPLOAD_BYTES },
      { status: 413 },
    );
  }
  // §9 magic-byte verification BEFORE anything reaches storage: the bytes
  // must match the format the filename claims (same rule as confirm).
  const extension = filename.split(".").pop() ?? "";
  const verdict = verifyFileMagic(extension, bytes.subarray(0, SNIFF_BYTES));
  if (!verdict.ok) {
    await recordSecurityEvent({
      kind: "upload_magic_rejected",
      actor: auth.actor.actor,
      detail: { productId: product.id, reason: verdict.reason },
    });
    return NextResponse.json(
      { error: "FILE_CONTENT_MISMATCH", reason: verdict.reason },
      { status: 422 },
    );
  }
  const fileKey =
    kind === "preview"
      ? previewFileKey(product.id, filename)
      : productFileKey(product.id, filename);
  const stored = await putObject(fileKey, bytes, file.type || "application/octet-stream");
  if (!stored) {
    return NextResponse.json({ error: "STORAGE_PUT_FAILED" }, { status: 502 });
  }
  const head = await headObject(fileKey);
  if (!head.exists) {
    return NextResponse.json({ error: "STORAGE_VERIFY_FAILED" }, { status: 502 });
  }
  // When a DB is configured the product row must exist (same rule as confirm).
  if (isDbConfigured()) {
    const { getDb } = await import("../../../../../lib/db");
    const db = await getDb();
    if (db) {
      const row = await db.product.findUnique({ where: { id: product.id } });
      if (!row) {
        return NextResponse.json(
          { error: "PRODUCT_NOT_IN_DB", hint: "Run: npm run sync-catalog" },
          { status: 409 },
        );
      }
    }
  }
  const { persisted, binding } = await setBinding(product.id, {
    ...(kind === "preview" ? { previewKey: fileKey } : { fileKey }),
    ...(kind === "product" && version ? { version } : {}),
  });
  return NextResponse.json({
    ok: true,
    persisted,
    binding,
    object: { contentLength: head.contentLength, contentType: head.contentType },
  });
}
