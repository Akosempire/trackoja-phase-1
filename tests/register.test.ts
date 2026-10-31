// Register (POS) logic: quick cash, split payments, scanner bursts, shortcuts.
import { describe, expect, it } from 'vitest';
import { coverage, findByCode, quickCashChips, salePayments, ScanBurst, shortcutFor, sortForRegister, type PaymentLine } from '../src/utils/register';

const amounts = (t: number) => quickCashChips(t).map((c) => (c.label === 'Exact' ? 'Exact' : c.amount));

describe('quick cash', () => {
  it('offers Exact and the next sensible notes', () => {
    expect(amounts(1200)).toEqual(['Exact', 1500, 2000, 5000]);
    expect(amounts(7300)).toEqual(['Exact', 7500, 8000, 10000]);
  });
  it('skips the total itself when it is already a round note', () => {
    expect(amounts(1000)).toEqual(['Exact', 5000, 10000, 20000]);
    expect(amounts(450)).toEqual(['Exact', 500, 1000, 5000]);
  });
  it('nothing for an empty sale', () => {
    expect(quickCashChips(0)).toEqual([]);
  });
});

const line = (method: PaymentLine['method'], amount: string, extra: Partial<PaymentLine> = {}): PaymentLine => ({ id: method + amount, method, amount, ...extra });

describe('split payments', () => {
  it('₦2,000 cash + ₦3,500 transfer covers ₦5,500', () => {
    const c = coverage(5500, [line('cash', '2000'), line('transfer', '3500')]);
    expect(c).toMatchObject({ paid: 5500, remaining: 0, change: 0, covered: true });
  });
  it('shows what is still due', () => {
    const c = coverage(5500, [line('cash', '2000')]);
    expect(c).toMatchObject({ remaining: 3500, covered: false });
  });
  it('change only comes from cash', () => {
    expect(coverage(4600, [line('cash', '5000')]).change).toBe(400);
    expect(coverage(5500, [line('transfer', '3500'), line('cash', '3000')]).change).toBe(1000);
    const over = coverage(5000, [line('transfer', '6000')]);
    expect(over.overpaidNonCash).toBe(true);
    expect(over.covered).toBe(false);
  });
  it('sends each paid line, with "confirm later" as pending', () => {
    expect(salePayments([line('cash', '2000'), line('transfer', '3500', { pending: true, reference: ' TRF1 ' }), line('card', '')]))
      .toEqual([{ method: 'cash', amount: 2000 }, { method: 'transfer', amount: 3500, reference: 'TRF1', pending: true }]);
  });
});

describe('scanner', () => {
  it('a fast burst ending in Enter is a scan', () => {
    const b = new ScanBurst();
    let t = 1000;
    for (const ch of '5012345678900') { b.push(ch, t); t += 8; }
    expect(b.enter(t)).toBe('5012345678900');
  });
  it('ordinary typing is not', () => {
    const b = new ScanBurst();
    let t = 1000;
    for (const ch of 'milk') { b.push(ch, t); t += 180; }
    expect(b.enter(t)).toBeNull();
  });
  it('finds a product by barcode or SKU in any case', () => {
    const items = [{ id: '1', name: 'Milk', sku: 'FD-012', barcode: '5012345678900' }, { id: '2', name: 'Bread', sku: 'bk-1' }];
    expect(findByCode(items, '5012345678900')?.id).toBe('1');
    expect(findByCode(items, 'BK-1')?.id).toBe('2');
    expect(findByCode(items, 'nope')).toBeNull();
  });
  it('out-of-stock items sort to the end', () => {
    const r = sortForRegister([{ name: 'A', trackInventory: true, stockQty: 0 }, { name: 'B', trackInventory: true, stockQty: 3 }]);
    expect(r.map((x) => x.name)).toEqual(['B', 'A']);
  });
});

describe('shortcuts', () => {
  const free = { inSearch: true, searchEmpty: true, inField: false };
  it('maps the F keys anywhere', () => {
    expect(shortcutFor({ key: 'F4' }, { ...free, inField: true })).toBe('pay-cash');
    expect(shortcutFor({ key: 'F10' }, free)).toBe('complete');
    expect(shortcutFor({ key: 'Enter', ctrlKey: true }, free)).toBe('complete');
    expect(shortcutFor({ key: 'F8' }, free)).toBe('hold');
    expect(shortcutFor({ key: 'F9' }, free)).toBe('held');
  });
  it('+ − Delete / only when they would not be typing', () => {
    expect(shortcutFor({ key: '+' }, free)).toBe('qty-up');
    expect(shortcutFor({ key: '-' }, free)).toBe('qty-down');
    expect(shortcutFor({ key: 'Delete' }, free)).toBe('remove-last');
    expect(shortcutFor({ key: '-' }, { ...free, searchEmpty: false })).toBeNull();
    expect(shortcutFor({ key: '/' }, { ...free, inField: true })).toBeNull();
    expect(shortcutFor({ key: 'a' }, free)).toBeNull();
  });
});
