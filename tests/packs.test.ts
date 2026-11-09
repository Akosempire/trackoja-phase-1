// Cartons and pieces helpers (src/utils/packs.ts)
import { describe, it, expect } from 'vitest';
import { hasPack, packPriceOf, piecesOf, splitStock, stockText, toPieces } from '../src/utils/packs';

const indomie = { unit: 'pcs', sellingPrice: 250, packName: 'Carton', packSize: 24, packPrice: 5400 };

describe('cartons and pieces', () => {
  it('shows stock in pieces with whole cartons beside it', () => {
    expect(stockText(41, indomie)).toBe('41 pcs · 1 carton + 17 pcs');
    expect(stockText(48, indomie)).toBe('48 pcs · 2 cartons');
    expect(stockText(17, indomie)).toBe('17 pcs');
    expect(stockText(30, { unit: 'piece', packName: 'Crate', packSize: 12 })).toBe('30 pieces · 2 crates + 6 pieces');
    expect(splitStock(0, indomie)).toBe('');
  });
  it('turns cartons and loose pieces into pieces', () => {
    expect(toPieces(3, 0, indomie)).toBe(72);
    expect(toPieces(1, 5, indomie)).toBe(29);
    expect(toPieces(2, 0, { unit: 'pcs' })).toBe(2);
  });
  it('a carton line takes its pieces from stock', () => {
    expect(piecesOf({ quantity: 2, unit: 'pack', packSize: 24 })).toBe(48);
    expect(piecesOf({ quantity: 5 })).toBe(5);
  });
  it('carton price: its own, else pack size × piece price', () => {
    expect(packPriceOf(indomie)).toBe(5400);
    expect(packPriceOf({ ...indomie, packPrice: undefined })).toBe(6000);
    expect(hasPack(indomie)).toBe(true);
    expect(hasPack({ packSize: 1 })).toBe(false);
  });
});
