// POS upgrade stream C: count correction, movement labels, catalogue search,
// catalogue cache freshness and clearing, instant-start cache safety, offline text.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { countCorrection, countSummary } from '../src/utils/stock-count';
import { movementLabel } from '../src/utils/movement-labels';
import { findByCode, searchCatalog } from '../src/utils/catalog-search';
import { offlineBannerText } from '../src/utils/offline-status';
import { memoryKv } from '../src/utils/kv-store';
import { clearStartup, MAX_AGE_MS, readStartup, saveStartup, STARTUP_KEY, storedSessionUserId } from '../src/utils/startup-cache';
import type { Product, ProductVariant } from '../src/types';

vi.mock('../src/config/supabase', () => ({ supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: { user: { id: currentUser } } } })) } } }));
let currentUser = 'user-a';
const fetched: string[] = [];
vi.mock('../src/services/product.service', () => ({ ProductService: { getProducts: vi.fn(async (storeId: string) => { fetched.push(storeId); return [prod('p1', 'Peak Milk', 'FD-1', '5000001', 10)]; }) } }));
vi.mock('../src/services/category.service', () => ({ CategoryService: { getCategories: vi.fn(async () => []) } }));
vi.mock('../src/services/variant.service', () => ({ VariantService: { forStore: vi.fn(async () => []) } }));

function prod(id: string, name: string, sku: string, barcode: string | undefined, stock: number, extra: Partial<Product> = {}): Product {
  return { id, storeId: 's1', name, sku, barcode, unit: 'pcs', costPrice: 1, sellingPrice: 100, taxRate: 0, trackInventory: true, stockQty: stock, reorderLevel: 0, status: 'active', createdBy: 'u', createdAt: '', updatedAt: '', ...extra };
}

describe('count correction', () => {
  it('works out the change from what was counted', () => {
    expect(countCorrection(5, '3')).toEqual({ ok: true, system: 5, counted: 3, difference: -2 });
    expect(countCorrection(5, '8')).toMatchObject({ ok: true, difference: 3 });
    expect(countCorrection(2.5, '2.125')).toMatchObject({ ok: true, difference: -0.375 });
    expect(countSummary(5, 3)).toBe('System: 5 → Counted: 3 = −2');
    expect(countSummary(5, 8)).toBe('System: 5 → Counted: 8 = +3');
  });
  it('refuses empty, negative and no-change counts', () => {
    expect(countCorrection(5, '')).toMatchObject({ ok: false });
    expect(countCorrection(5, '-1')).toMatchObject({ ok: false });
    expect(countCorrection(5, 'abc')).toMatchObject({ ok: false });
    expect(countCorrection(5, '5')).toMatchObject({ ok: false });
  });
});

describe('movement labels', () => {
  it('reads the same everywhere, capitalised', () => {
    expect(movementLabel('return')).toBe('Return');
    expect(movementLabel('adjustment')).toBe('Count correction');
    expect(movementLabel('transfer_out')).toBe('Transfer out');
    expect(movementLabel('stock_take_fix')).toBe('Stock take fix');
    expect(movementLabel('')).toBe('Movement');
  });
});

describe('catalogue search', () => {
  const products = [
    prod('p1', 'Peak Milk Tin 400g', 'FD-012', '5000112', 10),
    prod('p2', 'Peak Milk Sachet', 'FD-013', undefined, 0),
    prod('p3', 'Milo Refill 500g', 'BV-001', '6001', 4),
    prod('p4', 'Ankara shirt', 'AK-1', undefined, 6),
    prod('p5', 'Old item', 'OLD', '999', 3, { status: 'inactive' }),
  ];
  const variants: ProductVariant[] = [{ id: 'v1', productId: 'p4', size: 'M', colour: 'Red', sku: 'AK-1-M-RED', barcode: '200000001', sellingPrice: null, stockQty: 2 }];

  it('finds an exact code, ignoring case, products and variants', () => {
    expect(findByCode(products, 'fd-012')?.product.id).toBe('p1');
    expect(findByCode(products, ' 5000112 ')?.product.id).toBe('p1');
    expect(findByCode(products, '200000001', variants)).toMatchObject({ product: { id: 'p4' }, variant: { id: 'v1' } });
    expect(findByCode(products, 'ak-1-m-red', variants)?.variant?.id).toBe('v1');
    expect(findByCode(products, '999')).toBeNull(); // inactive
    expect(findByCode(products, 'nope')).toBeNull();
  });
  it('ranks search results and puts in-stock items first', () => {
    expect(searchCatalog(products, 'peak').map((h) => h.product.id)).toEqual(['p1', 'p2']);
    expect(searchCatalog(products, 'peak 400').map((h) => h.product.id)).toEqual(['p1']);
    expect(searchCatalog(products, 'milk')[0].product.id).toBe('p1');
    expect(searchCatalog(products, 'FD-01').map((h) => h.product.id)).toEqual(['p1', 'p2']);
    expect(searchCatalog(products, '200000001', { variants })[0].variant?.id).toBe('v1');
    expect(searchCatalog(products, '')).toEqual([]);
    expect(searchCatalog(products, 'm', { limit: 1 })).toHaveLength(1);
  });
});

describe('catalogue cache', () => {
  beforeEach(async () => {
    const mod = await import('../src/services/catalog.service');
    mod.__setCatalogStore(memoryKv());
    fetched.length = 0;
    currentUser = 'user-a';
  });

  it('decides when a cached copy is used, refreshed or skipped', async () => {
    const { cachePolicy, REFRESH_AFTER_MS, MAX_CACHE_AGE_MS } = await import('../src/services/catalog.service');
    const now = 1_000_000_000;
    expect(cachePolicy(undefined, now, false)).toBe('skip');
    expect(cachePolicy(now - 1000, now, false)).toBe('use');
    expect(cachePolicy(now - 1000, now, true)).toBe('use-and-refresh');
    expect(cachePolicy(now - REFRESH_AFTER_MS - 1, now, false)).toBe('use-and-refresh');
    expect(cachePolicy(now - MAX_CACHE_AGE_MS - 1, now, false)).toBe('skip');
  });

  it('shows the cached copy first, then the fresh one; lowers stock after a sale', async () => {
    const { CatalogService } = await import('../src/services/catalog.service');
    const first: boolean[] = [];
    await CatalogService.load('s1', (_c, m) => first.push(m.fromCache));
    expect(first).toEqual([false]);
    const seen: Array<[boolean, number]> = [];
    await CatalogService.applySale('s1', [{ productId: 'p1', quantity: 3 }]);
    await CatalogService.load('s1', (c, m) => seen.push([m.fromCache, c.products[0].stockQty]));
    expect(seen[0]).toEqual([true, 7]); // cached, already lowered by the sale
    expect(seen[1]).toEqual([false, 10]); // then the server's copy
  });

  it('never shows one user the catalogue cached by another, and clears on sign-out', async () => {
    const { CatalogService } = await import('../src/services/catalog.service');
    await CatalogService.load('s1', () => undefined);
    currentUser = 'user-b';
    expect(await CatalogService.cached('s1')).toBeNull();
    currentUser = 'user-a';
    expect(await CatalogService.cached('s1')).not.toBeNull();
    await CatalogService.clearAll();
    expect(await CatalogService.cached('s1')).toBeNull();
  });
});

describe('instant start cache', () => {
  function storage(entries: Record<string, string> = {}) {
    const m = new Map(Object.entries(entries));
    return {
      getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k),
      key: (i: number) => [...m.keys()][i] ?? null, get length() { return m.size; },
    };
  }
  const user = { id: 'u1' } as never;
  const profile = { id: 'u1', email: 'a@b.c' } as never;
  const entry = { kind: 'existing_user', destination: '/dashboard', hasAccess: true } as never;

  it('is used only for the user whose session is stored on this device', () => {
    const s = storage({ 'sb-abc-auth-token': JSON.stringify({ user: { id: 'u1' } }) });
    expect(storedSessionUserId(s)).toBe('u1');
    saveStartup(user, profile, entry, s, 1000);
    expect(readStartup(s, 2000)?.profile).toMatchObject({ id: 'u1' });
    // someone else signed in on this device
    const other = storage({ 'sb-abc-auth-token': JSON.stringify({ user: { id: 'u2' } }), [STARTUP_KEY]: s.getItem(STARTUP_KEY)! });
    expect(readStartup(other, 2000)).toBeNull();
    // signed out (no stored session)
    const out = storage({ [STARTUP_KEY]: s.getItem(STARTUP_KEY)! });
    expect(readStartup(out, 2000)).toBeNull();
  });
  it('expires, and is cleared on sign-out', () => {
    const s = storage({ 'sb-abc-auth-token': JSON.stringify({ user: { id: 'u1' } }) });
    saveStartup(user, profile, entry, s, 1000);
    expect(readStartup(s, 1000 + MAX_AGE_MS + 1)).toBeNull();
    clearStartup(s);
    expect(s.getItem(STARTUP_KEY)).toBeNull();
  });
  it('refuses a profile that belongs to someone else', () => {
    const s = storage({ 'sb-abc-auth-token': JSON.stringify({ user: { id: 'u1' } }) });
    saveStartup(user, { id: 'u9' } as never, entry, s, 1000);
    expect(s.getItem(STARTUP_KEY)).toBeNull();
  });
});

describe('offline banner text', () => {
  it('says what is happening', () => {
    expect(offlineBannerText(false, 2)).toBe('Offline – 2 sales waiting to sync');
    expect(offlineBannerText(false, 1)).toBe('Offline – 1 sale waiting to sync');
    expect(offlineBannerText(false, 0)).toMatch(/^Offline – /);
    expect(offlineBannerText(true, 3)).toBe('3 sales waiting to sync');
    expect(offlineBannerText(true, 0)).toBeNull();
  });
});
