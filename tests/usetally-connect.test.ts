// TrackOja <-> Usetally connection (docs/USETALLY_CONNECT.md): the browser-side
// state check and the Edge helpers that decide what is sent and retried.
import { describe, expect, it } from 'vitest';
import {
  buildConnectUrl, consumeConnectState, createConnectState, mapLinkStatus, readCallbackParams, usetallyUrl,
  CONNECT_STATE_TTL_MS,
} from '../src/services/usetally.service';
import {
  callbackBase, classifyDelivery, decryptLinkKey, deliveryPath, encryptLinkKey, isLinkKey, likePattern,
  nextRetryAt, parseLinkResponse, parseStockRequest, salePayloadProblems, toMinor, MAX_ATTEMPTS,
} from '../supabase/functions/_shared/usetally';

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

describe('connect state', () => {
  it('accepts the state it saved, once', () => {
    const s = memory();
    const { state } = createConnectState('store-1', s, 1000);
    expect(consumeConnectState(state, s, 2000)).toEqual({ ok: true, storeId: 'store-1' });
    expect(consumeConnectState(state, s, 2000)).toEqual({ ok: false, reason: 'missing' });
  });
  it('refuses a different or late state', () => {
    const s = memory();
    createConnectState('store-1', s, 0);
    expect(consumeConnectState('other', s, 1)).toEqual({ ok: false, reason: 'mismatch' });
    const { state } = createConnectState('store-1', s, 0);
    expect(consumeConnectState(state, s, CONNECT_STATE_TTL_MS + 1)).toEqual({ ok: false, reason: 'expired' });
  });
  it('builds the Usetally approval URL with an encoded return address', () => {
    const url = new URL(buildConnectUrl({ base: 'https://usetally.cc/', origin: 'https://trackoja.cv', state: 'abc', storeName: 'Ikeja & Co' }));
    expect(url.pathname).toBe('/connect/pos');
    expect(url.searchParams.get('return_to')).toBe('https://trackoja.cv/settings/usetally/callback');
    expect(url.searchParams.get('store')).toBe('Ikeja & Co');
    expect(usetallyUrl('')).toBe('https://usetally.cc');
    expect(readCallbackParams('?code=x&state=y')).toEqual({ code: 'x', state: 'y', error: null });
  });
  it('maps a missing link to "none"', () => {
    expect(mapLinkStatus(null).status).toBe('none');
    expect(mapLinkStatus({ status: 'active', pending: '3' }).pending).toBe(3);
  });
});

describe('delivery rules', () => {
  it('sends, revokes, fails or retries by status', () => {
    expect(classifyDelivery('sale', 201)).toBe('sent');
    expect(classifyDelivery('sale', 200)).toBe('sent');
    expect(classifyDelivery('sale', 401)).toBe('revoked');
    expect(classifyDelivery('sale', 422)).toBe('failed');
    expect(classifyDelivery('sale', 500)).toBe('retry');
    expect(classifyDelivery('sale', null)).toBe('retry');
  });
  it('backs off 1, 5, 15, 60 minutes then hourly, and gives up', () => {
    const now = new Date('2026-10-28T12:00:00Z');
    expect(nextRetryAt(1, now)?.toISOString()).toBe('2026-10-28T12:01:00.000Z');
    expect(nextRetryAt(4, now)?.toISOString()).toBe('2026-10-28T13:00:00.000Z');
    expect(nextRetryAt(MAX_ATTEMPTS, now)).toBeNull();
  });
  it('posts sales and voids to the right paths', () => {
    expect(deliveryPath('sale', 'a')).toBe('/api/pos/sales');
    expect(deliveryPath('void', 'a')).toBe('/api/pos/sales/a/void');
  });
  it('money is whole minor units', () => {
    expect(toMinor(3200)).toBe(320000);
    expect(toMinor('19.995')).toBe(2000);
  });
  it('flags a sale payload that would be refused', () => {
    expect(salePayloadProblems({})).not.toHaveLength(0);
  });
});

describe('link key handling', () => {
  it('only accepts well-formed link responses', () => {
    const key = 'utpos_' + 'a'.repeat(40);
    expect(isLinkKey(key)).toBe(true);
    expect(parseLinkResponse({ key, business: { id: 'b', name: 'Shop', currency: 'NGN' } })?.key).toBe(key);
    expect(parseLinkResponse({ key: 'nope', business: {} })).toBeNull();
  });
  it('encrypts the key so it can be read back only with the secret', async () => {
    const key = 'utpos_' + 'b'.repeat(40), secret = 'x'.repeat(40);
    const stored = await encryptLinkKey(key, secret);
    expect(stored).not.toContain(key);
    expect(await decryptLinkKey(stored, secret)).toBe(key);
    await expect(decryptLinkKey(stored, 'y'.repeat(40))).rejects.toBeTruthy();
  });
  it('tells Usetally where to call back', () => {
    expect(callbackBase('https://abc.supabase.co/')).toBe('https://abc.supabase.co/functions/v1');
  });
});

describe('requests from Usetally', () => {
  it('checks stock requests', () => {
    expect(parseStockRequest({ document_id: '6f1c2e7a-0000-4000-8000-000000000001', number: 'INV-1', lines: [{ product_id: '6f1c2e7a-0000-4000-8000-000000000002', quantity: 3 }] }).ok).toBe(true);
    expect(parseStockRequest({ document_id: 'x', lines: [] }).ok).toBe(false);
  });
  it('escapes search wildcards', () => {
    expect(likePattern('50%_off')).toBe('%50\\%\\_off%');
  });
});
