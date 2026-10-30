#!/usr/bin/env node
/**
 * Upsert the 12 file-catalog products (src/data/products.ts) into the
 * Product table so admin file bindings, orders and grants can reference
 * them. Catalog fields only — fileKey/previewKey/version managed in admin
 * are never overwritten.
 *
 * Usage: DATABASE_URL=postgres://… node scripts/sync-catalog-to-db.mjs
 * Exits 2 with a clear message when DATABASE_URL is unset.
 */
import { PrismaClient } from "@prisma/client";
import { PRODUCTS } from "../src/data/products.ts";

if (!process.env.DATABASE_URL) {
  console.error("[sync-catalog] DATABASE_URL is not set — nothing to sync into. The store keeps running on the file catalog.");
  process.exit(2);
}

const prisma = new PrismaClient();
try {
  let count = 0;
  for (const p of PRODUCTS) {
    await prisma.product.upsert({
      where: { id: p.id },
      create: { id: p.id, slug: p.slug, title: p.title, priceUSD: p.priceUSD },
      update: { slug: p.slug, title: p.title, priceUSD: p.priceUSD },
    });
    count++;
  }
  console.log(`[sync-catalog] upserted ${count} products`);
} finally {
  await prisma.$disconnect();
}
