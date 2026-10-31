/**
 * Instant, offline product search for the register: name, SKU, barcode and
 * variant SKU/barcode, case-insensitive, all in memory.
 *
 *   searchCatalog(products, query, { limit, variants })  -> CatalogHit[] (best first)
 *   findByCode(products, code, variants)                 -> CatalogHit | null (exact SKU/barcode, for scanners)
 */
import type { Product, ProductVariant } from '../types';

export interface CatalogHit {
  product: Product;
  /** set when the code or search matched one size/colour */
  variant: ProductVariant | null;
}

const norm = (v: unknown) => String(v ?? '').trim().toLowerCase();
const sellable = (p: Product) => p.status === 'active' || p.status === undefined;

/** Exact (case-insensitive) SKU or barcode match: a variant's code first, then a product's. */
export function findByCode(products: Product[], code: string, variants: ProductVariant[] = []): CatalogHit | null {
  const c = norm(code);
  if (!c) return null;
  const byId = new Map(products.map((p) => [p.id, p]));
  for (const v of variants) {
    if (norm(v.barcode) === c || norm(v.sku) === c) {
      const product = byId.get(v.productId);
      if (product && sellable(product)) return { product, variant: v };
    }
  }
  for (const p of products) {
    if (sellable(p) && (norm(p.barcode) === c || norm(p.sku) === c)) return { product: p, variant: null };
  }
  return null;
}

/**
 * Ranked search. Score: exact code 100, code starts-with 60, name starts-with 50,
 * a word in the name starts-with 40, name contains 25, code contains 15.
 * Every word typed must match somewhere (e.g. "peak 400" finds "Peak Milk Tin 400g").
 * Products with stock come before out-of-stock ones at the same score.
 */
export function searchCatalog(products: Product[], query: string, opts: { limit?: number; variants?: ProductVariant[] } = {}): CatalogHit[] {
  const q = norm(query);
  const limit = opts.limit ?? 50;
  if (!q) return [];
  const words = q.split(/\s+/).filter(Boolean);
  const variantsByProduct = new Map<string, ProductVariant[]>();
  for (const v of opts.variants ?? []) {
    const list = variantsByProduct.get(v.productId) ?? [];
    list.push(v); variantsByProduct.set(v.productId, list);
  }
  const scored: Array<{ hit: CatalogHit; score: number; inStock: boolean; name: string }> = [];
  for (const p of products) {
    if (!sellable(p)) continue;
    const name = norm(p.name), sku = norm(p.sku), bar = norm(p.barcode);
    const vs = variantsByProduct.get(p.id) ?? [];
    const exactVariant = vs.find((v) => norm(v.barcode) === q || norm(v.sku) === q) ?? null;
    let score = 0;
    if (exactVariant || sku === q || bar === q) score = 100;
    else if ((sku && sku.startsWith(q)) || (bar && bar.startsWith(q))) score = 60;
    else if (name.startsWith(q)) score = 50;
    else if (name.split(/[\s\-/,]+/).some((w) => w.startsWith(words[0])) && words.every((w) => name.includes(w))) score = 40;
    else if (words.every((w) => name.includes(w))) score = 25;
    else if ((sku && sku.includes(q)) || (bar && bar.includes(q))) score = 15;
    if (!score) continue;
    const inStock = !p.trackInventory || p.stockQty > 0;
    scored.push({ hit: { product: p, variant: exactVariant }, score, inStock, name });
  }
  scored.sort((a, b) => b.score - a.score || Number(b.inStock) - Number(a.inStock) || a.name.localeCompare(b.name));
  return scored.slice(0, limit).map((s) => s.hit);
}
