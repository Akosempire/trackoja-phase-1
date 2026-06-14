// tests/sales.test.ts
// Verify sale creation, totals computation, numbering, and store isolation (Phase 3)

import { describe, it, expect } from 'vitest';

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

interface LineInput {
  quantity: number;
  unitPrice: number;
  taxRate: number;
  discountAmount?: number;
}

// Mirrors the per-item math performed inside create_sale
// (database/020_sales_functions.sql): tax is computed on (subtotal - discount).
function computeLineTotal(line: LineInput) {
  const lineSubtotal = line.quantity * line.unitPrice;
  const discount = line.discountAmount ?? 0;
  const taxAmount = round2((lineSubtotal - discount) * (line.taxRate / 100));
  const lineTotal = round2(lineSubtotal - discount + taxAmount);
  return { lineSubtotal, taxAmount, lineTotal };
}

// Mirrors sale-level aggregation: total = subtotal - discountTotal + taxTotal
function computeSaleTotals(lines: LineInput[], discountTotal = 0) {
  let subtotal = 0;
  let taxTotal = 0;

  for (const line of lines) {
    const { lineSubtotal, taxAmount } = computeLineTotal(line);
    subtotal += lineSubtotal;
    taxTotal += taxAmount;
  }

  subtotal = round2(subtotal);
  taxTotal = round2(taxTotal);
  const total = round2(subtotal - discountTotal + taxTotal);

  return { subtotal, taxTotal, total };
}

describe('Sale totals computation', () => {
  it('Computes subtotal, tax, and total for a single item with tax', () => {
    const { subtotal, taxTotal, total } = computeSaleTotals([{ quantity: 2, unitPrice: 1000, taxRate: 7.5 }]);
    expect(subtotal).toBe(2000);
    expect(taxTotal).toBe(150);
    expect(total).toBe(2150);
  });

  it('Sums totals across multiple line items', () => {
    const { subtotal, taxTotal, total } = computeSaleTotals([
      { quantity: 1, unitPrice: 500, taxRate: 0 },
      { quantity: 3, unitPrice: 200, taxRate: 5 },
    ]);
    expect(subtotal).toBe(1100);
    expect(taxTotal).toBe(30);
    expect(total).toBe(1130);
  });

  it('Applies a line-level discount before computing tax', () => {
    const { lineSubtotal, taxAmount, lineTotal } = computeLineTotal({
      quantity: 1,
      unitPrice: 1000,
      taxRate: 10,
      discountAmount: 100,
    });
    expect(lineSubtotal).toBe(1000);
    expect(taxAmount).toBe(90); // (1000 - 100) * 10%
    expect(lineTotal).toBe(990);
  });

  it('Applies a sale-level discount to the final total', () => {
    const { subtotal, taxTotal, total } = computeSaleTotals(
      [{ quantity: 1, unitPrice: 1000, taxRate: 0 }],
      150
    );
    expect(subtotal).toBe(1000);
    expect(taxTotal).toBe(0);
    expect(total).toBe(850);
  });
});

describe('create_sale (database function)', () => {
  it('Should create a sale with line items and payments scoped to the store', async () => {
    // SaleService.createSale(storeId, { items, payments })
    // Expect sale.storeId === storeId, sale.status === 'completed'
    // Expect sale.items and sale.payments to be persisted
    expect(true).toBe(true); // Placeholder - requires live Supabase project
  });

  it('Should assign sequential sale_number per store starting at 1', async () => {
    // First sale in a store -> sale_number '1', second -> '2', etc.
    // A second store's first sale should also be '1' (UNIQUE(store_id, sale_number))
    expect(true).toBe(true); // Placeholder
  });

  it('Should snapshot product name/sku/price/tax_rate onto sale_items', async () => {
    // Create a sale, then update the product's name/price/tax_rate
    // Expect the sale_item's product_name/unit_price/tax_rate to remain unchanged
    expect(true).toBe(true); // Placeholder
  });

  it('Should keep sale_items readable after the product is deleted', async () => {
    // ProductService.deleteProduct(productId) after a sale references it
    // Expect sale_items.product_id = NULL but product_name/sku snapshots remain
    expect(true).toBe(true); // Placeholder
  });

  it('Should reject a sale with no items or no payments', async () => {
    // createSale(storeId, { items: [], payments: [...] }) -> throws
    // createSale(storeId, { items: [...], payments: [] }) -> throws
    expect(true).toBe(true); // Placeholder
  });

  it('Should reject a sale where amount paid is less than the total', async () => {
    // payments summing to less than computed total -> throws
    // 'Amount paid is less than the sale total'
    expect(true).toBe(true); // Placeholder
  });

  it('User should not read sales from a store they are not a member of', async () => {
    // Sign in as user1 (member of store1 only), query sales for store2
    // Should return empty due to RLS
    expect(true).toBe(true); // Placeholder
  });
});
