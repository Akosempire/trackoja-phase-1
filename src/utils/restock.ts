/**
 * Restocking maths shared by the screens and the tests. The database does the
 * real work (20261030002001_restock_counts_transfers.sql); these mirror it so
 * the screens can show the result before saving.
 */

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Cost price after a delivery: a weighted average of what's on the shelf and
 * what arrived. Negative stock counts as none. Same formula as weighted_cost().
 */
export function weightedCost(onHand: number, oldCost: number, qty: number, unitCost: number): number {
  const shelf = Math.max(onHand || 0, 0);
  if (shelf + qty <= 0) return r2(unitCost);
  return r2((shelf * (oldCost || 0) + qty * unitCost) / (shelf + qty));
}

export interface DeliveryLine { productId: string; quantity: number; unitCost: number }

export function deliveryTotal(lines: DeliveryLine[]): number {
  return r2(lines.reduce((sum, l) => sum + r2((Number(l.quantity) || 0) * (Number(l.unitCost) || 0)), 0));
}

/** Problems that stop a delivery being saved, in plain words. */
export function deliveryProblems(lines: DeliveryLine[]): string[] {
  const out: string[] = [];
  if (!lines.length) out.push('Add at least one product');
  if (lines.some((l) => !(Number(l.quantity) > 0))) out.push('Every line needs a quantity above zero');
  if (lines.some((l) => Number(l.unitCost) < 0 || Number.isNaN(Number(l.unitCost)))) out.push('A cost cannot be negative');
  return out;
}

/** What's paid now: everything unless on credit, never more than the total. */
export function amountPaidNow(total: number, method: string, entered: string | number | null | undefined): number {
  if (entered === '' || entered === null || entered === undefined) return method === 'credit' ? 0 : total;
  return Math.min(Math.max(Number(entered) || 0, 0), total);
}

export interface CountLine { expected: number; counted: number | null; unitCost: number }

/** Difference and its value at cost; uncounted lines don't change anything. */
export function countDifference(line: CountLine): { qty: number; value: number } {
  if (line.counted === null || line.counted === undefined) return { qty: 0, value: 0 };
  const qty = Math.round((line.counted - line.expected) * 1000) / 1000;
  return { qty, value: r2(qty * line.unitCost) };
}

export function countSummary(lines: CountLine[]) {
  let counted = 0, changed = 0, missing = 0, extra = 0;
  for (const l of lines) {
    if (l.counted === null || l.counted === undefined) continue;
    counted++;
    const d = countDifference(l);
    if (d.qty !== 0) changed++;
    if (d.value < 0) missing += -d.value; else extra += d.value;
  }
  return { total: lines.length, counted, changed, missingValue: r2(missing), extraValue: r2(extra), net: r2(extra - missing) };
}

/** Back up to twice the reorder level (same as list_low_stock), at least 1. */
export function suggestedOrder(stock: number, reorderLevel: number): number {
  return Math.max(Math.ceil(reorderLevel * 2 - stock), 1);
}

/** How urgent a low item is: out, low. */
export function lowStockState(stock: number, reorderLevel: number): 'out' | 'low' | 'ok' {
  if (stock <= 0) return 'out';
  return stock <= reorderLevel ? 'low' : 'ok';
}

/** Finds a product by scanned or typed barcode / SKU, exact first. */
export function findByCode<T extends { sku: string; barcode?: string | null }>(products: T[], code: string): T | undefined {
  const c = code.trim().toLowerCase();
  if (!c) return undefined;
  return products.find((p) => (p.barcode ?? '').toLowerCase() === c) ?? products.find((p) => p.sku.toLowerCase() === c);
}
