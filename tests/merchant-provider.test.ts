import { afterEach, describe, expect, it, vi } from 'vitest';
import { approvalForStatus, parseMoniepointStatus, providerAmount } from '../supabase/functions/_shared/merchant-provider';
import { decryptCredentials, encryptCredentials, MoniepointProvider } from '../supabase/functions/_shared/moniepoint';
import { webcrypto } from 'node:crypto';

const pending = {
  merchantReference: 'TRKOJA-abc', terminalSerial: 'P2608291', requestAmount: 22500,
  actualAmount: null, transactionReference: '', processingStatus: 'PENDING',
  responseCode: null, actualPaymentMethod: null,
};

afterEach(() => vi.unstubAllGlobals());

describe('merchant payment verification', () => {
  it('refuses a provider amount until the unit is explicitly configured', () => {
    expect(() => providerAmount(22500, undefined)).toThrow(/unit has not been confirmed/);
    expect(providerAmount(22500, 'naira')).toBe(22500);
    expect(providerAmount(22500.5, 'kobo')).toBe(2250050);
    expect(() => providerAmount(22500.5, 'naira')).toThrow(/cannot be represented/);
  });

  it('never treats pending or an unknown approval code as success', () => {
    const status = parseMoniepointStatus(pending);
    expect(approvalForStatus(status, '20000')).toBeNull();
    const processed = { ...status, processingStatus: 'PROCESSED', responseCode: '20000' };
    expect(approvalForStatus(processed, undefined)).toBeNull();
    expect(approvalForStatus(processed, '00')).toBeNull();
    expect(approvalForStatus(processed, '00', '20000')).toBe(false);
    expect(approvalForStatus(processed, '20000')).toBe(true);
  });

  it('rejects incomplete provider evidence', () => {
    expect(parseMoniepointStatus({ ...pending, actualAmount: 0 }).actualAmount).toBe(0);
    expect(() => parseMoniepointStatus({ ...pending, requestAmount: undefined })).toThrow();
    expect(() => parseMoniepointStatus({ ...pending, actualAmount: -1 })).toThrow();
    expect(() => parseMoniepointStatus({ ...pending, terminalSerial: null })).toThrow();
  });

  it('accepts only HTTP 202 for a push and sends the documented payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new MoniepointProvider({ mode: 'api_key', apiKey: 'test-key' }, 'live');
    await expect(provider.initializePayment({ merchantReference: 'ref', terminalSerial: 'P2608291',
      amount: 22500, paymentMethod: 'ANY' })).resolves.toBe('accepted');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ terminalSerial: 'P2608291', amount: 22500,
      merchantReference: 'ref', transactionType: 'PURCHASE', paymentMethod: 'ANY' });
    fetchMock.mockResolvedValueOnce(new Response('', { status: 200 }));
    await expect(provider.initializePayment({ merchantReference: 'ref2', terminalSerial: 'P2608291',
      amount: 22500, paymentMethod: 'ANY' })).rejects.toThrow(/did not confirm/);
  });

  it('does not invent a sandbox endpoint for API keys', () => {
    expect(() => new MoniepointProvider({ mode: 'api_key', apiKey: 'test-key' }, 'sandbox'))
      .toThrow(/no documented sandbox endpoint/);
  });

  it('encrypts merchant credentials and refuses the wrong key', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const key = Buffer.alloc(32, 7).toString('base64');
    const wrongKey = Buffer.alloc(32, 8).toString('base64');
    const credentials = { mode: 'client_credentials' as const, clientId: 'merchant-id', clientSecret: 'never-log-this' };
    const encrypted = await encryptCredentials(credentials, key);
    expect(encrypted.ciphertext).not.toContain(credentials.clientSecret);
    await expect(decryptCredentials(encrypted.ciphertext, encrypted.iv, key)).resolves.toEqual(credentials);
    await expect(decryptCredentials(encrypted.ciphertext, encrypted.iv, wrongKey)).rejects.toThrow();
  });
});
