import { describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    gte: vi.fn(),
    lt: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.gte.mockReturnValue(query);
  return { query, from: vi.fn().mockReturnValue(query) };
});

vi.mock('../src/config/supabase', () => ({ supabase: { from: db.from } }));

import { SaleService } from '../src/services/sale.service';

describe('dashboard refund count', () => {
  it('counts the complete period instead of the capped recent-refunds list', async () => {
    db.query.lt.mockResolvedValueOnce({ count: 57, error: null });

    const count = await SaleService.getRefundCount('store-1', '2026-09-28T00:00:00Z', '2026-09-29T00:00:00Z');

    expect(count).toBe(57);
    expect(db.from).toHaveBeenCalledWith('refunds');
    expect(db.query.select).toHaveBeenCalledWith('id', { count: 'exact', head: true });
    expect(db.query.eq).toHaveBeenCalledWith('store_id', 'store-1');
    expect(db.query.gte).toHaveBeenCalledWith('created_at', '2026-09-28T00:00:00Z');
    expect(db.query.lt).toHaveBeenCalledWith('created_at', '2026-09-29T00:00:00Z');
  });
});
