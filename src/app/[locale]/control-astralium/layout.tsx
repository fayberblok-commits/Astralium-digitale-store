import type { Metadata } from "next";

/**
 * Admin area metadata (Phase 1 upgrade, §6): every admin page is
 * noindex/nofollow. The middleware additionally sends X-Robots-Tag for
 * these paths. Protection is the authentication itself — this only
 * keeps the area out of search indexes.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
