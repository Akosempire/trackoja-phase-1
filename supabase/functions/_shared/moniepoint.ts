import { parseMoniepointStatus, type MerchantPaymentProvider, type MerchantPaymentStatus } from './merchant-provider.ts';

export type MoniepointCredentials =
  | { mode: 'api_key'; apiKey: string }
  | { mode: 'client_credentials'; clientId: string; clientSecret: string };

const BASE_URLS = {
  api_key: { live: 'https://api.pos.moniepoint.com' },
  client_credentials: {
    live: 'https://channel.moniepoint.com',
    sandbox: 'https://moniepoint-pos-backend-service.development.moniepoint.com',
  },
} as const;

function baseUrl(credentials: MoniepointCredentials, environment: 'live' | 'sandbox'): string {
  const url = (BASE_URLS[credentials.mode] as Partial<Record<'live' | 'sandbox', string>>)[environment];
  if (!url) throw new Error('This Moniepoint credential mode has no documented sandbox endpoint');
  return url;
}

async function requestWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export class MoniepointProvider implements MerchantPaymentProvider {
  readonly name = 'moniepoint';
  private readonly base: string;

  constructor(private readonly credentials: MoniepointCredentials, environment: 'live' | 'sandbox') {
    this.base = baseUrl(credentials, environment);
  }

  async verifyConnection(): Promise<'verified' | 'unverifiable'> {
    if (this.credentials.mode === 'api_key') return 'unverifiable';
    await this.token();
    return 'verified';
  }

  private async token(): Promise<string> {
    if (this.credentials.mode === 'api_key') return this.credentials.apiKey;
    const response = await requestWithTimeout(`${this.base}/v1/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: this.credentials.clientId, clientSecret: this.credentials.clientSecret }),
    });
    if (!response.ok) throw new Error(response.status === 401 ? 'Moniepoint rejected the credentials' : 'Moniepoint authentication is unavailable');
    const body = await response.json();
    if (typeof body?.accessToken !== 'string' || !body.accessToken) throw new Error('Moniepoint did not return an access token');
    return body.accessToken;
  }

  async initializePayment(request: {
    merchantReference: string;
    terminalSerial: string;
    amount: number;
    paymentMethod: 'CARD_PURCHASE' | 'POS_TRANSFER' | 'ANY';
  }): Promise<'accepted'> {
    const token = await this.token();
    const response = await requestWithTimeout(`${this.base}/v1/transactions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ terminalSerial: request.terminalSerial, amount: request.amount,
        merchantReference: request.merchantReference, transactionType: 'PURCHASE', paymentMethod: request.paymentMethod }),
    });
    // Only 202 means accepted. A timeout, duplicate-reference response or 5xx
    // leaves an unknown outcome and must be reconciled before another send.
    if (response.status !== 202) {
      const error = new Error('Moniepoint did not confirm that the request was accepted');
      (error as Error & { status?: number }).status = response.status;
      throw error;
    }
    return 'accepted';
  }

  async getPaymentStatus(merchantReference: string): Promise<MerchantPaymentStatus> {
    const token = await this.token();
    const response = await requestWithTimeout(
      `${this.base}/v1/transactions/merchants/${encodeURIComponent(merchantReference)}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
    );
    if (!response.ok) throw new Error('Moniepoint payment status is unavailable');
    return parseMoniepointStatus(await response.json());
  }
}

export async function encryptCredentials(credentials: MoniepointCredentials, encodedKey: string): Promise<{ ciphertext: string; iv: string }> {
  const bytes = Uint8Array.from(atob(encodedKey), (c) => c.charCodeAt(0));
  if (bytes.length !== 32) throw new Error('MONIEPOINT_CREDENTIAL_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  const key = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(credentials));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded));
  return { ciphertext: btoa(String.fromCharCode(...cipher)), iv: btoa(String.fromCharCode(...iv)) };
}

export async function decryptCredentials(ciphertext: string, iv: string, encodedKey: string): Promise<MoniepointCredentials> {
  const bytes = Uint8Array.from(atob(encodedKey), (c) => c.charCodeAt(0));
  if (bytes.length !== 32) throw new Error('Moniepoint credential encryption is unavailable');
  const key = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['decrypt']);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: Uint8Array.from(atob(iv), (c) => c.charCodeAt(0)) },
    key,
    Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0)),
  );
  const value = JSON.parse(new TextDecoder().decode(plain));
  if (value?.mode === 'api_key' && typeof value.apiKey === 'string') return value;
  if (value?.mode === 'client_credentials' && typeof value.clientId === 'string' && typeof value.clientSecret === 'string') return value;
  throw new Error('Stored Moniepoint credentials are invalid');
}
