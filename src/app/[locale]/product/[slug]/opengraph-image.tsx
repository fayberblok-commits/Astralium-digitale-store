import { ImageResponse } from "next/og";
import { getProductBySlug } from "../../../../data/products";

/**
 * Per-product Open Graph image (Phase 5, SEO engine): the product title
 * and its real catalog price on the luxury-classic brand card. Falls
 * back to the store card for unknown slugs.
 */
export const alt = "Astralium Digitale Store — product";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { slug } = await params;
  const product = getProductBySlug(slug);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", background: "#F6F1E7", color: "#141210",
          padding: 64,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", border: "2px solid #B08D3C", padding: "48px 64px", maxWidth: 1000 }}>
          <div style={{ fontSize: 24, letterSpacing: 6, color: "#B08D3C", marginBottom: 16 }}>✦ ASTRALIUM DIGITALE STORE ✦</div>
          <div style={{ fontSize: 52, fontFamily: "Georgia, serif", textAlign: "center", lineHeight: 1.2 }}>
            {product?.title ?? "Digital products, delivered in seconds"}
          </div>
          {product ? (
            <div style={{ display: "flex", alignItems: "center", marginTop: 26 }}>
              <div style={{ fontSize: 40, color: "#141210" }}>{`$${product.priceUSD.toFixed(2)}`}</div>
              <div style={{ fontSize: 24, color: "#3A352C", marginLeft: 18 }}>· Instant delivery</div>
            </div>
          ) : null}
        </div>
      </div>
    ),
    size,
  );
}
