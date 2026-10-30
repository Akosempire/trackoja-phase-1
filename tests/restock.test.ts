// Restocking maths the screens show before saving; mirrors the database.
import { describe, expect, it } from 'vitest';
import { amountPaidNow, countDifference, countSummary, deliveryProblems, deliveryTotal, findByCode, lowStockState, suggestedOrder, weightedCost } from '../src/utils/restock';

describe('weightedCost', () => {
  it('averages what is on the shelf with what arrived', () => {
    expect(weightedCost(10, 7000, 10, 8000)).toBe(7500);
    expect(weightedCost(0, 7000, 5, 8000)).toBe(8000);
    expect(weightedCost(-3, 7000, 5, 8000)).toBe(8000);
    expect(weightedCost(3, 100, 1, 101)).toBe(100.25);
  });
});

describe('deliveries', () => {
  const lines = [{ productId: 'a', quantity: 10, unitCost: 8000 }, { productId: 'b', quantity: 24, unitCost: 320 }];
  it('totals and checks lines', () => {
    expect(deliveryTotal(lines)).toBe(87680);
    expect(deliveryProblems(lines)).toEqual([]);
    expect(deliveryProblems([])).toContain('Add at least one product');
    expect(deliveryProblems([{ productId: 'a', quantity: 0, unitCost: 1 }])).toContain('Every line needs a quantity above zero');
  });
  it('pays everything now unless on credit, never more than the total', () => {
    expect(amountPaidNow(1000, 'cash', '')).toBe(1000);
    expect(amountPaidNow(1000, 'credit', '')).toBe(0);
    expect(amountPaidNow(1000, 'transfer', '400')).toBe(400);
    expect(amountPaidNow(1000, 'transfer', 5000)).toBe(1000);
    expect(amountPaidNow(1000, 'transfer', -5)).toBe(0);
  });
});

describe('stock counts', () => {
  it('values differences at cost; uncounted lines change nothing', () => {
    expect(countDifference({ expected: 20, counted: 17, unitCost: 7500 })).toEqual({ qty: -3, value: -22500 });
    expect(countDifference({ expected: 20, counted: null, unitCost: 7500 })).toEqual({ qty: 0, value: 0 });
    const s = countSummary([{ expected: 20, counted: 17, unitCost: 100 }, { expected: 5, counted: 6, unitCost: 50 }, { expected: 1, counted: null, unitCost: 9 }]);
    expect(s).toMatchObject({ total: 3, counted: 2, changed: 2, missingValue: 300, extraValue: 50, net: -250 });
  });
});

describe('low stock', () => {
  it('suggests topping up to twice the reorder level', () => {
    expect(suggestedOrder(1, 10)).toBe(19);
    expect(suggestedOrder(25, 10)).toBe(1);
    expect(lowStockState(0, 5)).toBe('out');
    expect(lowStockState(3, 5)).toBe('low');
  });
  it('finds a product by barcode first, then SKU', () => {
    const items = [{ sku: 'RICE5', barcode: '615000' }, { sku: '615000', barcode: null }];
    expect(findByCode(items, ' 615000 ')).toBe(items[0]);
    expect(findByCode(items, 'rice5')).toBe(items[0]);
    expect(findByCode(items, '')).toBeUndefined();
  });
});
