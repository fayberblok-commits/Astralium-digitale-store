import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { products } from "@/db/schema";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const slugs = (url.searchParams.get("slugs") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 30);
  if (slugs.length === 0) return NextResponse.json({ products: [] });
  const rows = await db
    .select()
    .from(products)
    .where(and(inArray(products.slug, slugs), eq(products.status, "active")));
  return NextResponse.json({
    products: rows.map((row) => ({
      slug: row.slug,
      title: row.title,
      titleEn: row.titleEn,
      subtitle: row.subtitle,
      subtitleEn: row.subtitleEn,
      category: row.category,
      priceCents: row.priceCents,
      coverStyle: row.coverStyle,
      coverGlyph: row.coverGlyph,
    })),
  });
}
