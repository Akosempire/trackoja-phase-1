// Offline sales queue: survives a reload (it's in storage) and two screens
// syncing at once never send the same sale twice.
import { describe, expect, it, vi } from 'vitest';

const sent: string[] = [];
vi.mock('../src/services/sale.service', () => ({
  SaleService: { createSale: vi.fn(async (_s: string, req: { notes?: string }) => { await new Promise((r) => setTimeout(r, 20)); sent.push(req.notes ?? ''); return {}; }) },
}));

describe('offline sales queue', () => {
  it('keeps queued sales in storage and syncs each exactly once', async () => {
    const { OfflineSalesService } = await import('../src/services/offlineSales.service');
    OfflineSalesService.addPendingSale('s1', { items: [], payments: [], notes: 'a' } as never, 1, 100);
    OfflineSalesService.addPendingSale('s1', { items: [], payments: [], notes: 'b' } as never, 1, 200);
    expect(JSON.parse(localStorage.getItem('tk_pending_sales')!)).toHaveLength(2); // survives a reload
    const [x, y] = await Promise.all([OfflineSalesService.flushPendingSales('s1'), OfflineSalesService.flushPendingSales('s1')]);
    expect(sent).toEqual(['a', 'b']);
    expect(x).toEqual(y);
    expect(OfflineSalesService.getPendingSales('s1')).toHaveLength(0);
  });
});
