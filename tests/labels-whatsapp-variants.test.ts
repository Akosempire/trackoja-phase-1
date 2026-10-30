// Code 128 labels, WhatsApp texts and size/colour combinations.
import { describe, expect, it } from 'vitest';
import { code128Bits, code128Svg, code128Values, isCode128B } from '../src/utils/code128';
import { normalisePhone, receiptMessage, reminderMessage, whatsappLink } from '../src/utils/whatsapp';
import { combine, parseValues, variantLabel, variantProblems } from '../src/utils/variants';

describe('Code 128', () => {
  it('computes the check digit (start B + Σ value × position, mod 103)', () => {
    // "AB": 104 + 33×1 + 34×2 = 205 → 205 mod 103 = 102
    expect(code128Values('AB')).toEqual([104, 33, 34, 102]);
    // "123": 104 + 17 + 36 + 57 = 214 → 8 (short numbers stay in set B)
    expect(code128Values('123')).toEqual([104, 17, 18, 19, 8]);
    // "123456" in set C: 105 + 12×1 + 34×2 + 56×3 = 353 → 44
    expect(code128Values('123456')).toEqual([105, 12, 34, 56, 44]);
    // odd length: set C pairs, then Code B (100) and "5" (21): 105+12+68+300+84 = 569 → 54
    expect(code128Values('12345')).toEqual([105, 12, 34, 100, 21, 54]);
    // "Wikipedia": W=55 i=73 k=75 p=80 e=69 d=68 a=65, weighted by position
    const v = code128Values('Wikipedia');
    const expected = [55, 73, 75, 73, 80, 69, 68, 73, 65].reduce((s, x, i) => s + x * (i + 1), 104) % 103;
    expect(v.at(-1)).toBe(expected);
  });
  it('starts with Start B and ends with the stop bar', () => {
    const bits = code128Bits('IND-070');
    expect(bits.startsWith('11010010000')).toBe(true);
    expect(bits.endsWith('1100011101011')).toBe(true);
    // 11 modules per symbol, 13 for the stop
    expect(bits.length).toBe((7 + 2) * 11 + 13);
  });
  it('refuses text it cannot print', () => {
    expect(isCode128B('Ọ̀rẹ́')).toBe(false);
    expect(() => code128Values('')).toThrow();
    expect(code128Svg('BLT-1')).toContain('<svg');
  });
});

describe('WhatsApp', () => {
  it('normalises Nigerian numbers', () => {
    expect(normalisePhone('0803 555 0000')).toBe('2348035550000');
    expect(normalisePhone('+234 803 555 0000')).toBe('2348035550000');
    expect(normalisePhone('8035550000')).toBe('2348035550000');
    expect(normalisePhone('00447700900123')).toBe('447700900123');
    expect(normalisePhone('12')).toBeNull();
    expect(normalisePhone('')).toBeNull();
  });
  it('builds a link that works with or without a number', () => {
    expect(whatsappLink('08035550000', 'Hi there')).toBe('https://wa.me/2348035550000?text=Hi%20there');
    expect(whatsappLink(null, 'x')).toBe('https://wa.me/?text=x');
  });
  it('writes a short receipt and a polite reminder', () => {
    const r = receiptMessage({ storeName: 'Ada Fashion', receiptNumber: '000128', date: '30 Oct 2026', items: [{ name: 'Ankara shirt – M / Red', quantity: 2, lineTotal: 20000 }], total: 20000, paid: 15000, balance: 5000 });
    expect(r).toContain('2 × Ankara shirt – M / Red');
    expect(r).toContain('Balance to pay: ₦5,000');
    expect(r).toContain('Thank you');
    const m = reminderMessage({ customerName: 'Mama Nkechi', storeName: 'Ada Fashion', amount: 15000 });
    expect(m).toMatch(/^Hello Mama,/);
    expect(m).toContain('₦15,000');
  });
});

describe('variants', () => {
  it('parses option values', () => {
    expect(parseValues('S, M,  L,m,')).toEqual(['S', 'M', 'L']);
  });
  it('makes every combination and keeps what was there', () => {
    const list = combine([{ name: 'Size', values: ['M', 'L'] }, { name: 'Colour', values: ['Red', 'Sky blue'] }], 'TS');
    expect(list.map((v) => variantLabel(v.size, v.colour))).toEqual(['M / Red', 'M / Sky blue', 'L / Red', 'L / Sky blue']);
    expect(list[1].sku).toBe('TS-M-SKYBLU');
    const kept = combine([{ name: 'Size', values: ['M', 'XL'] }], 'TS', [{ size: 'M', colour: null, sku: 'OLD', barcode: '1', price: '9', stock: '4' }]);
    expect(kept[0].sku).toBe('OLD');
    expect(kept[1]).toMatchObject({ size: 'XL', sku: 'TS-XL' });
    expect(combine([], 'TS')).toEqual([]);
  });
  it('finds duplicates before saving', () => {
    const p = variantProblems([
      { size: 'M', colour: null, sku: 'A', barcode: '1', price: '', stock: '1' },
      { size: 'L', colour: null, sku: 'a', barcode: '1', price: '-2', stock: '1' },
    ]);
    expect(p).toEqual(expect.arrayContaining(['SKU A is used twice', 'Barcode 1 is used twice', 'Check the price for L']));
  });
});
