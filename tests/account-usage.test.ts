// Time in the app (areas, summaries) and Download my data (sheets).
import { describe, expect, it } from 'vitest';
import { areaName, duration, summarizeUsage, usageArea } from '../src/utils/usageArea';
import { exportFileName, exportSheets } from '../src/utils/exportSheets';

describe('usageArea', () => {
  it('replaces ids and skips pages that are not counted', () => {
    expect(usageArea('/sales/6f1c2e7a-0000-4000-8000-000000000001')).toBe('/sales/:id');
    expect(usageArea('/inventory/products/new?x=1')).toBe('/inventory/products/new');
    expect(usageArea('/Dashboard/')).toBe('/dashboard');
    expect(usageArea('/support/messages/t1')).toBe('/support/messages/:id');
    for (const p of ['/', '/login', '/privacy', '/platform/usage', '/auth/callback']) expect(usageArea(p)).toBeNull();
    expect(areaName('/sales/checkout')).toBe('Checkout');
    expect(areaName('/inventory/products/:id')).toBe('Editing products');
    expect(duration(3900)).toBe('1h 05m');
  });
  it('adds time up by screen, store and day', () => {
    const s = summarizeUsage([
      { user_id: 'u1', store_id: 's1', store: 'Ikeja', business: 'Ada', day: '2026-10-29', area: '/sales/checkout', seconds: 600 },
      { user_id: 'u1', store_id: 's1', store: 'Ikeja', business: 'Ada', day: '2026-10-29', area: '/dashboard', seconds: 200 },
      { user_id: 'u2', store_id: 's2', store: 'Yaba', business: 'Bo', day: '2026-10-30', area: '/sales/checkout', seconds: 200 },
    ]);
    expect(s.totalSeconds).toBe(1000);
    expect(s.people).toBe(2);
    expect(s.avgPerPersonDay).toBe(500);
    expect(s.areas[0]).toMatchObject({ name: 'Checkout', seconds: 800 });
    expect(s.stores[0]).toMatchObject({ name: 'Ikeja', people: 1 });
    expect(s.days.map((d) => d.day)).toEqual(['2026-10-29', '2026-10-30']);
  });
});

describe('exportSheets', () => {
  it('makes one flat sheet per kind of record', () => {
    const sheets = exportSheets({ store: { id: 's', name: 'Ikeja' }, products: [{ id: 'p', name: 'Rice', attributes: { size: 'L' } }], sales: [] });
    expect(sheets.find((x) => x.name === 'Store')?.rows).toEqual([{ id: 's', name: 'Ikeja' }]);
    expect(sheets.find((x) => x.name === 'Products')?.rows[0].attributes).toBe('{"size":"L"}');
    expect(sheets.find((x) => x.name === 'Sales')?.rows).toEqual([]);
    expect(sheets.every((x) => x.name.length <= 31)).toBe(true);
    expect(exportFileName('Ada Stores & Co', new Date('2026-10-30T10:00:00Z'))).toBe('trackoja-ada-stores-co-2026-10-30.xlsx');
  });
});
