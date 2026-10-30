// Daily email and sending through Usetally (supabase/functions/_shared/notify.ts).
import { describe, expect, it } from 'vitest';
import { digestEmail, money, sendViaUsetally, type DigestStore } from '../supabase/functions/_shared/notify';

const store: DigestStore = {
  store_id: 's1', store: 'Ada Stores', currency: 'NGN', day: '2026-10-29',
  sales: { count: 12, total: 84500, voided: 1 },
  payments: [{ method: 'cash', amount: 40000 }, { method: 'transfer', amount: 44500 }, { method: 'card', amount: 0 }],
  low_stock: [{ name: 'Rice 5kg', stock: 2, reorder: 5, unit: 'bag' }],
  recipients: [{ email: 'ada@shop.ng', name: 'Ada Obi' }],
};

describe('digestEmail', () => {
  it('summarises the day, payments and low stock', () => {
    const m = digestEmail(store, store.recipients[0], 'https://trackoja.cv/');
    expect(m.to).toBe('ada@shop.ng');
    expect(m.subject).toBe('Ada Stores: 12 sales, 1 low on stock');
    expect(m.lines[0]).toContain('Hi Ada, Ada Stores made 12 sales');
    expect(m.lines[0]).toContain('₦84,500');
    expect(m.lines.join('\n')).toContain('Rice 5kg: 2 bag left (reorder at 5)');
    expect(m.details).toEqual([['Cash', '₦40,000'], ['Transfer', '₦44,500']]);
    expect(m.button?.url).toBe('https://trackoja.cv/inventory/products');
  });
  it('still reads well with no sales and nothing low', () => {
    const m = digestEmail({ ...store, sales: { count: 0, total: 0 }, low_stock: [], payments: [] }, { email: 'x@y.ng' }, 'https://trackoja.cv');
    expect(m.lines).toEqual(['Ada Stores had no sales on Thursday 29 Oct.', 'Nothing is running low.']);
    expect(m.button?.url).toBe('https://trackoja.cv/dashboard');
  });
  it('formats money', () => {
    expect(money(1500.5, 'NGN')).toBe('₦1,500.50');
    expect(money(20, 'GBP')).toBe('£20');
  });
});

describe('sendViaUsetally', () => {
  const secret = 'x'.repeat(40);
  it('posts to Usetally with the shared secret', async () => {
    let seen: { url: string; auth: string; body: Record<string, unknown> } | null = null;
    const fetcher = (async (url: string, init: RequestInit) => {
      seen = { url, auth: String((init.headers as Record<string, string>).Authorization), body: JSON.parse(String(init.body)) };
      return new Response(JSON.stringify({ sent: true }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await sendViaUsetally(digestEmail(store, store.recipients[0], 'https://trackoja.cv'), { base: 'https://usetally.cc/', secret, fetcher });
    expect(r.sent).toBe(true);
    expect(seen!.url).toBe('https://usetally.cc/api/notify/trackoja');
    expect(seen!.auth).toBe(`Bearer ${secret}`);
    expect(seen!.body.to).toBe('ada@shop.ng');
  });
  it('does nothing without a secret, and reports refusals', async () => {
    expect((await sendViaUsetally({ to: 'a@b.ng', subject: 'Hi', heading: 'Hi', lines: ['x'] }, { base: 'https://u', secret: '' })).sent).toBe(false);
    const refuse = (async () => new Response(JSON.stringify({ error: 'Too many emails' }), { status: 429 })) as unknown as typeof fetch;
    expect(await sendViaUsetally({ to: 'a@b.ng', subject: 'Hi', heading: 'Hi', lines: ['x'] }, { base: 'https://u', secret, fetcher: refuse })).toEqual({ sent: false, status: 429, error: 'Too many emails' });
  });
});
