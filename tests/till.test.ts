// Till: counting the drawer, held sales on the device, and mapping the report.
import { describe, expect, it } from 'vitest';
import { NGN_DENOMINATIONS, countTotal, differenceTone } from '../src/utils/cash-count';
import { defaultHeldLabel, holdSale, readHeld, takeHeld } from '../src/utils/held-sales';
import { mapTillNumbers } from '../src/services/till.service';
import { isPin } from '../src/services/cashier.service';

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}
const line = { productId: 'p1', name: 'Peak Milk', sku: 'FD', unit: 'pcs', unitPrice: 3200, taxRate: 0, quantity: 2, trackInventory: true, stockQty: 10 };

describe('cash count', () => {
  it('adds notes by denomination and ignores junk', () => {
    expect(countTotal({ 1000: 3, 500: '2', 200: -1, 50: 'x' as unknown as number })).toBe(4000);
    expect(countTotal({})).toBe(0);
    expect(NGN_DENOMINATIONS[0]).toBe(1000);
  });
  it('says exact, over or short', () => {
    expect(differenceTone(0)).toBe('exact');
    expect(differenceTone(0.001)).toBe('exact');
    expect(differenceTone(50)).toBe('over');
    expect(differenceTone(-100)).toBe('short');
  });
});

describe('held sales', () => {
  it('holds per store, resumes once, newest first', () => {
    const s = memory();
    const a = holdSale('store-1', { label: 'Sale 1', lines: [line], customerId: null, customerName: null, discount: '0', total: 6400 }, s, new Date('2026-10-30T08:00:00Z'));
    holdSale('store-1', { label: 'Mrs Bisi', lines: [line], customerId: 'c1', customerName: 'Mrs Bisi', discount: '100', total: 6300 }, s, new Date('2026-10-30T08:05:00Z'));
    holdSale('store-2', { label: 'Other branch', lines: [line], customerId: null, customerName: null, discount: '0', total: 1 }, s);
    expect(readHeld('store-1', s).map((h) => h.label)).toEqual(['Mrs Bisi', 'Sale 1']);
    expect(takeHeld('store-1', a.id, s)?.total).toBe(6400);
    expect(takeHeld('store-1', a.id, s)).toBeNull();
    expect(readHeld('store-1', s)).toHaveLength(1);
    expect(readHeld('store-2', s)).toHaveLength(1);
  });
  it('survives broken storage', () => {
    const s = memory(); s.setItem('trackoja.held.x', '{not json');
    expect(readHeld('x', s)).toEqual([]);
    expect(readHeld('x', null)).toEqual([]);
  });
  it('names a held sale after the customer, else by number', () => {
    expect(defaultHeldLabel(2, 'Mama Nkechi')).toBe('Mama Nkechi');
    expect(defaultHeldLabel(2, null)).toBe('Sale 3');
  });
});

describe('till report mapping and PINs', () => {
  it('maps the database report', () => {
    const t = mapTillNumbers({ session_id: 's', store_id: 'st', status: 'closed', opened_at: 'a', opening_float: '5000', sales_count: 2,
      sales_total: '9600.00', by_method: { cash: '6400', card: 3200 }, expected_cash: '9400', counted_cash: '9300', difference: '-100', movements: [{ kind: 'out', amount: '1500', reason: 'Delivery', at: 'b', by: 'Bayo' }] });
    expect(t.openingFloat).toBe(5000);
    expect(t.byMethod.cash).toBe(6400);
    expect(t.difference).toBe(-100);
    expect(t.movements[0].amount).toBe(1500);
    expect(mapTillNumbers({ status: 'open' }).countedCash).toBeNull();
  });
  it('accepts 4 to 6 digit PINs only', () => {
    expect(isPin('4829')).toBe(true);
    expect(isPin('482913')).toBe(true);
    expect(isPin('482')).toBe(false);
    expect(isPin('48a9')).toBe(false);
  });
});
