/**
 * Download my data: the export_store_data result → one sheet per kind of
 * record, flat rows only (nested values become JSON text). Sheet names stay
 * within Excel's 31-character limit.
 */
const LABELS: Record<string, string> = {
  store: 'Store', categories: 'Categories', products: 'Products', variants: 'Variants', customers: 'Customers', suppliers: 'Suppliers',
  sales: 'Sales', sale_items: 'Sale items', sale_payments: 'Sale payments', refunds: 'Refunds', expenses: 'Expenses',
  purchases: 'Purchases', stock_movements: 'Stock movements',
};

const flat = (row: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v !== null && typeof v === 'object' ? JSON.stringify(v) : v ?? '']));

export function exportSheets(data: Record<string, unknown>): { name: string; rows: Record<string, unknown>[] }[] {
  const out: { name: string; rows: Record<string, unknown>[] }[] = [];
  for (const [key, label] of Object.entries(LABELS)) {
    const v = data[key];
    const rows = Array.isArray(v) ? v : v && typeof v === 'object' ? [v] : [];
    out.push({ name: label.slice(0, 31), rows: rows.map((r) => flat(r as Record<string, unknown>)) });
  }
  return out;
}

export function exportFileName(storeName: string, date = new Date()): string {
  const slug = storeName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'store';
  return `trackoja-${slug}-${date.toISOString().slice(0, 10)}.xlsx`;
}
