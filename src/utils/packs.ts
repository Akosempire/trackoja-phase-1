// Cartons and pieces. Stock always counts in pieces (the product's unit); a
// product can also be sold and restocked by the pack (a carton of 24).
import { stockQuantity } from './business-activity';

export interface PackInfo { unit?: string; sellingPrice?: number; packName?: string; packSize?: number; packPrice?: number; wholesalePrice?: number }

export const hasPack = (p: PackInfo | null | undefined): p is PackInfo & { packSize: number } => Number(p?.packSize) > 1;

/** Price of one pack: its own (wholesale) price, else pack size × piece price */
export const packPriceOf = (p: PackInfo): number =>
  p.packPrice != null ? Number(p.packPrice) : Math.round(Number(p.packSize ?? 1) * Number(p.sellingPrice ?? 0) * 100) / 100;

const plural = (n: number, word: string) => (n === 1 ? word : /[sxz]$|ch$|sh$/i.test(word) ? `${word}es` : `${word}s`);

/** "pcs" → "pc" for one; other units stay as they are */
export const unitWord = (unit: string | undefined, n: number): string => {
  const u = (unit || 'pcs').trim();
  if (/^pcs?$/i.test(u)) return n === 1 ? 'pc' : 'pcs';
  if (/^piece(s)?$/i.test(u)) return n === 1 ? 'piece' : 'pieces';
  return u;
};

export const packWord = (p: PackInfo, n: number): string => plural(n, (p.packName || 'Pack').toLowerCase());

/** 41 pieces with a carton of 24 → "1 carton + 17 pcs"; whole cartons → "2 cartons" */
export function splitStock(pieces: number, p: PackInfo): string {
  if (!hasPack(p) || pieces <= 0) return '';
  const packs = Math.floor(pieces / p.packSize);
  const rest = Math.round((pieces - packs * p.packSize) * 1000) / 1000;
  if (!packs) return '';
  return rest ? `${packs} ${packWord(p, packs)} + ${rest} ${unitWord(p.unit, rest)}` : `${packs} ${packWord(p, packs)}`;
}

/** "41 pcs · 1 carton + 17 pcs" (or just "41 pcs") */
export function stockText(pieces: number, p: PackInfo): string {
  const base = stockQuantity(pieces, p.unit || 'pcs');
  const split = splitStock(pieces, p);
  return split && split !== base ? `${base} · ${split}` : base;
}

/** cartons + loose pieces → pieces */
export const toPieces = (packs: number, loose: number, p: PackInfo): number =>
  Math.round(((Number(packs) || 0) * (hasPack(p) ? p.packSize : 1) + (Number(loose) || 0)) * 1000) / 1000;

/** How many pieces a sale line takes */
export const piecesOf = (line: { quantity: number; unit?: 'pack'; packSize?: number }): number =>
  line.unit === 'pack' ? Math.round(line.quantity * Number(line.packSize || 1) * 1000) / 1000 : line.quantity;

/** "2 × Carton (24)" for a sale line sold by the pack */
export const packLineLabel = (qty: number, name: string, size: number): string => `${qty} × ${name} of ${size}`;

/** A sale line as the customer reads it: cartons as cartons, pieces as pieces */
export const lineQty = (i: { quantity: number; packQty?: number }): number => i.packQty ?? i.quantity;
export const lineName = (i: { productName: string; packQty?: number; packName?: string; packSize?: number; priceTier?: 'wholesale' }): string =>
  i.packQty != null ? `${i.productName} (${i.packName || 'Pack'} of ${i.packSize})` : i.priceTier === 'wholesale' ? `${i.productName} (wholesale)` : i.productName;
export const lineUnitPrice = (i: { unitPrice: number; packQty?: number; packPrice?: number }): number => (i.packQty != null && i.packPrice != null ? i.packPrice : i.unitPrice);

/** Wholesale price per piece: its own, else the pack price shared out per piece; null = none */
export function wholesalePriceOf(p: PackInfo): number | null {
  if (p.wholesalePrice != null) return Number(p.wholesalePrice);
  if (hasPack(p)) return Math.round((packPriceOf(p) / p.packSize) * 100) / 100;
  return null;
}
