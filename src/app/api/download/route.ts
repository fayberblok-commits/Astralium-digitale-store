import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { readDownloadToken, resolveDownload, licenseDocument } from "@/lib/downloads";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const payload = readDownloadToken(token);
  if (!payload) {
    return NextResponse.json({ error: "رابط التحميل غير صالح أو منتهي الصلاحية." }, { status: 401 });
  }

  const result = await resolveDownload(payload.orderNumber, payload.productId);
  if (!result.ok) {
    const message =
      result.reason === "not_paid"
        ? "لم يتم تأكيد الدفع لهذا الطلب بعد."
        : result.reason === "limit_reached"
          ? "تم استهلاك حد التحميل لهذا الترخيص. تواصل مع الدعم لإعادة التفعيل."
          : "الملف غير متاح.";
    return NextResponse.json({ error: message }, { status: 403 });
  }

  const { product, order } = result;
  const settings = await getSettings();
  const safeName = `${product.slug}-${order.orderNumber}.${product.fileKey?.split(".").pop() ?? "txt"}`;

  if (product.fileKey) {
    try {
      const filePath = path.join(process.cwd(), "storage", "uploads", product.fileKey);
      const file = await readFile(filePath);
      return new NextResponse(new Uint8Array(file), {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${safeName}"`,
          "Cache-Control": "no-store, max-age=0",
          "X-Robots-Tag": "noindex, nofollow",
        },
      });
    } catch {
      /* fall through to licence certificate */
    }
  }

  const document = licenseDocument({
    orderNumber: order.orderNumber,
    productTitle: product.title,
    buyerEmail: order.email,
    licenseScope: product.features.join(" · ") || "Personal use licence.",
    supportEmail: settings.supportEmail,
  });
  return new NextResponse(document, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${product.slug}-license.txt"`,
      "Cache-Control": "no-store, max-age=0",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
