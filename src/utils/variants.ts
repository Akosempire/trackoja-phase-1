/** Sizes and colours: up to two options, every combination a variant. */
export interface VariantOption { name: string; values: string[] }
export interface VariantDraft { size: string | null; colour: string | null; sku: string; barcode: string; price: string; stock: string; id?: string }

export const MAX_OPTIONS = 2;
export const MAX_VARIANTS = 200;

/** "S, M,  L,m" → ["S","M","L"] (trimmed, no empties, no case-insensitive repeats). */
export function parseValues(text: string): string[] {
  const seen = new Set<string>();
  return text.split(',').map((v) => v.trim().slice(0, 40)).filter((v) => {
    const k = v.toLowerCase();
    if (!v || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export const variantLabel = (size: string | null | undefined, colour: string | null | undefined) =>
  [size, colour].map((v) => (v ?? '').trim()).filter(Boolean).join(' / ');

const skuPart = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 6);

/**
 * Every combination of the options. Existing variants keep their SKU, barcode,
 * price and stock; new ones get a SKU from the product's ("TS-M-RED").
 */
export function combine(options: VariantOption[], baseSku: string, existing: VariantDraft[] = []): VariantDraft[] {
  const [a, b] = options.filter((o) => o.values.length > 0).slice(0, MAX_OPTIONS);
  if (!a) return [];
  const pairs: [string, string | null][] = b ? a.values.flatMap((x) => b.values.map((y) => [x, y] as [string, string])) : a.values.map((x) => [x, null]);
  const key = (s: string | null, c: string | null) => `${(s ?? '').toLowerCase()}|${(c ?? '').toLowerCase()}`;
  const old = new Map(existing.map((v) => [key(v.size, v.colour), v]));
  return pairs.slice(0, MAX_VARIANTS).map(([s, c]) => old.get(key(s, c)) ?? {
    size: s, colour: c, barcode: '', price: '', stock: '0',
    sku: [baseSku.trim() || 'ITEM', skuPart(s), c ? skuPart(c) : ''].filter(Boolean).join('-'),
  });
}

/** Problems that would stop saving, in plain words. */
export function variantProblems(list: VariantDraft[]): string[] {
  const out: string[] = [];
  const skus = new Map<string, number>();
  const codes = new Map<string, number>();
  for (const v of list) {
    if (v.sku.trim()) skus.set(v.sku.trim().toLowerCase(), (skus.get(v.sku.trim().toLowerCase()) ?? 0) + 1);
    if (v.barcode.trim()) codes.set(v.barcode.trim(), (codes.get(v.barcode.trim()) ?? 0) + 1);
    if (v.price.trim() && !(Number(v.price) >= 0)) out.push(`Check the price for ${variantLabel(v.size, v.colour)}`);
    if (!(Number(v.stock || 0) >= 0)) out.push(`Check the stock for ${variantLabel(v.size, v.colour)}`);
  }
  for (const [k, n] of skus) if (n > 1) out.push(`SKU ${k.toUpperCase()} is used twice`);
  for (const [k, n] of codes) if (n > 1) out.push(`Barcode ${k} is used twice`);
  return out;
}
