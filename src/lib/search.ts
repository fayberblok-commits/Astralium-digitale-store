/**
 * Smart search (Phase 3, feature 6) — pure in-memory fuzzy search.
 *
 * Always available (no DB needed) and used by the catalog UI + the
 * /api/search endpoint. When a database IS configured, the API first
 * tries the pg_trgm SQL path (src/lib/search-db.ts) and falls back here.
 *
 * Matching: normalize (lowercase, strip diacritics), tokenize, then score
 * per query token — exact word hit > word prefix > substring > bounded
 * Levenshtein (typo tolerance: distance ≤1 for 4–6-letter tokens, ≤2 for
 * longer). Every query token must match something for a result to rank.
 * Product fields are searched in whatever languages the catalog carries
 * (titles/subtitles/descriptions are language-agnostic strings here).
 */
import { PRODUCTS, productLanguage, type Product } from "../data/products.ts";

export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokensOf(s: string): string[] {
  return normalizeText(s).split(" ").filter(Boolean);
}

/** Bounded Levenshtein distance (bails out early above `max`). */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

function allowedDistance(token: string): number {
  if (token.length < 4) return 0;
  if (token.length <= 6) return 1;
  return 2;
}

/** Score one query token against one product word. 0 = no match. */
function tokenWordScore(token: string, word: string): number {
  if (word === token) return 10;
  if (word.startsWith(token)) return 7;
  if (word.includes(token)) return 5;
  const max = allowedDistance(token);
  if (max > 0 && editDistance(token, word, max) <= max) return 3;
  return 0;
}

export interface SearchFilters {
  category?: string;
  format?: string;
  maxPriceUSD?: number;
  minRating?: number;
  language?: string;
}

export interface SearchHit {
  product: Product;
  score: number;
}

interface Indexed {
  product: Product;
  words: string[];
  titleWords: string[];
}

function indexProduct(p: Product): Indexed {
  const fields = [p.title, p.subtitle, p.description, p.category, productLanguage(p)];
  return {
    product: p,
    words: tokensOf(fields.join(" ")),
    titleWords: tokensOf(`${p.title} ${p.subtitle}`),
  };
}

export function passesFilters(p: Product, f: SearchFilters): boolean {
  if (f.category && f.category !== "all" && p.category !== f.category) return false;
  if (f.format && f.format !== "all" && !p.formats.some((x) => x.format === f.format)) return false;
  if (f.maxPriceUSD !== undefined && p.priceUSD > f.maxPriceUSD) return false;
  if (f.minRating !== undefined && p.rating < f.minRating) return false;
  if (f.language && f.language !== "all" && productLanguage(p) !== f.language) return false;
  return true;
}

export function searchProducts(
  query: string,
  opts: { filters?: SearchFilters; catalog?: Product[]; limit?: number } = {},
): SearchHit[] {
  const catalog = opts.catalog ?? PRODUCTS;
  const filters = opts.filters ?? {};
  const pool = catalog.filter((p) => passesFilters(p, filters));
  const qTokens = tokensOf(query);
  if (qTokens.length === 0) {
    return pool.map((product) => ({ product, score: 0 }));
  }
  const hits: SearchHit[] = [];
  for (const p of pool) {
    const idx = indexProduct(p);
    let score = 0;
    let matchedAll = true;
    for (const qt of qTokens) {
      let best = 0;
      for (const w of idx.words) best = Math.max(best, tokenWordScore(qt, w));
      if (best === 0) { matchedAll = false; break; }
      // Title/subtitle hits weigh more than description hits.
      let titleBest = 0;
      for (const w of idx.titleWords) titleBest = Math.max(titleBest, tokenWordScore(qt, w));
      score += best + titleBest;
    }
    if (matchedAll) hits.push({ product: p, score });
  }
  return hits
    .sort((a, b) => b.score - a.score || b.product.rating - a.product.rating)
    .slice(0, opts.limit ?? 48);
}

/** Instant suggestions: title-led matches for the dropdown. */
export function suggestProducts(query: string, limit = 6, catalog: Product[] = PRODUCTS): Product[] {
  if (!normalizeText(query)) return [];
  return searchProducts(query, { catalog, limit }).map((h) => h.product);
}
