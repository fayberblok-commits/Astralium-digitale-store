"use client";
/**
 * Admin "Product files" manager: for each catalog product, presign → PUT
 * directly to S3 from the browser → confirm (server verifies the object
 * exists, then persists the binding). No file bytes pass through Next.js.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export interface FilesDict {
  product: string;
  status: string;
  action: string;
  bound: string;
  unbound: string;
  kindProduct: string;
  kindPreview: string;
  version: string;
  upload: string;
  uploading: string;
  done: string;
  error: string;
}

interface BindingInfo {
  fileKey?: string;
  previewKey?: string;
  version?: string;
}

interface RowState {
  binding: BindingInfo | null;
  loading: boolean;
  busy: boolean;
  message?: string;
  isError?: boolean;
}

export default function ProductFilesManager({
  products,
  dict,
  storageConfigured,
}: {
  products: { id: string; title: string }[];
  dict: FilesDict;
  storageConfigured: boolean;
}) {
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const kindSelects = useRef<Record<string, HTMLSelectElement | null>>({});
  const versionInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const loadBinding = useCallback(async (productId: string) => {
    try {
      const res = await fetch(`/api/admin/files?productId=${encodeURIComponent(productId)}`);
      if (!res.ok) throw new Error("load failed");
      const data = (await res.json()) as { binding: BindingInfo | null };
      setRows((r) => ({ ...r, [productId]: { ...(r[productId] ?? { loading: false, busy: false }), binding: data.binding, loading: false } }));
    } catch {
      setRows((r) => ({ ...r, [productId]: { ...(r[productId] ?? { busy: false }), binding: null, loading: false } }));
    }
  }, []);

  useEffect(() => {
    for (const p of products) {
      setRows((r) => (r[p.id] ? r : { ...r, [p.id]: { binding: null, loading: true, busy: false } }));
      void loadBinding(p.id);
    }
  }, [products, loadBinding]);

  async function upload(productId: string) {
    const input = fileInputs.current[productId];
    const file = input?.files?.[0];
    if (!file) return;
    const kind = (kindSelects.current[productId]?.value ?? "product") as "product" | "preview";
    const version = versionInputs.current[productId]?.value || undefined;
    setRows((r) => ({ ...r, [productId]: { ...r[productId], busy: true, message: undefined, isError: false } }));
    try {
      // 1) presign
      const pre = await fetch("/api/admin/files/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, filename: file.name, contentType: file.type, kind, sizeBytes: file.size }),
      });
      if (!pre.ok) {
        const e = (await pre.json().catch(() => ({}))) as { error?: string };
        throw new Error(e.error ?? `presign ${pre.status}`);
      }
      const { uploadUrl, fileKey } = (await pre.json()) as { uploadUrl: string; fileKey: string };
      // 2) PUT straight to storage
      const put = await fetch(uploadUrl, { method: "PUT", body: file });
      if (!put.ok) throw new Error(`storage PUT ${put.status}`);
      // 3) confirm + bind
      const conf = await fetch("/api/admin/files/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, fileKey, kind, version }),
      });
      if (!conf.ok) {
        const e = (await conf.json().catch(() => ({}))) as { error?: string };
        throw new Error(e.error ?? `confirm ${conf.status}`);
      }
      await loadBinding(productId);
      setRows((r) => ({ ...r, [productId]: { ...r[productId], busy: false, message: dict.done, isError: false } }));
      if (input) input.value = "";
    } catch (err) {
      setRows((r) => ({
        ...r,
        [productId]: {
          ...r[productId],
          busy: false,
          message: `${dict.error}: ${err instanceof Error ? err.message : "unknown"}`,
          isError: true,
        },
      }));
    }
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table className="admin-table">
        <thead>
          <tr>
            <th>{dict.product}</th>
            <th>{dict.status}</th>
            <th>{dict.action}</th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => {
            const row = rows[p.id] ?? { binding: null, loading: true, busy: false };
            const bound = Boolean(row.binding?.fileKey);
            return (
              <tr key={p.id}>
                <td>{p.title}</td>
                <td>
                  {row.loading ? (
                    <span className="muted">…</span>
                  ) : bound ? (
                    <>
                      <span className="pill pill-ok">{dict.bound}</span>{" "}
                      <code>{row.binding!.fileKey}</code>
                      {row.binding!.version ? <span className="muted"> · v{row.binding!.version}</span> : null}
                      {row.binding!.previewKey ? <div className="muted">{row.binding!.previewKey}</div> : null}
                    </>
                  ) : (
                    <span className="pill pill-bad">{dict.unbound}</span>
                  )}
                  {row.message ? (
                    <div className={row.isError ? "pill pill-bad" : "pill pill-ok"} style={{ marginTop: 6 }}>{row.message}</div>
                  ) : null}
                </td>
                <td>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    <select
                      ref={(el) => { kindSelects.current[p.id] = el; }}
                      defaultValue="product"
                      aria-label="kind"
                    >
                      <option value="product">{dict.kindProduct}</option>
                      <option value="preview">{dict.kindPreview}</option>
                    </select>
                    <input
                      ref={(el) => { fileInputs.current[p.id] = el; }}
                      type="file"
                      aria-label={dict.action}
                      style={{ maxWidth: 180 }}
                    />
                    <input
                      ref={(el) => { versionInputs.current[p.id] = el; }}
                      type="text"
                      placeholder={dict.version}
                      defaultValue={row.binding?.version ?? "1.0.0"}
                      style={{ width: 76 }}
                      aria-label={dict.version}
                    />
                    <button
                      type="button"
                      className="btn"
                      disabled={!storageConfigured || row.busy}
                      onClick={() => void upload(p.id)}
                    >
                      {row.busy ? dict.uploading : dict.upload}
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
