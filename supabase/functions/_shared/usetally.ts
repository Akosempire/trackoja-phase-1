// Shared helpers for the TrackOja <-> Usetally connection (docs/USETALLY_CONNECT.md).
// Pure functions plus Web Crypto only, so they run in Deno Edge Functions and in
// the vitest suite alike. Never log a link key, its hash or its ciphertext.
import { corsHeaders } from './cors.ts';

export const DEFAULT_USETALLY_URL = 'https://usetally.cc';
export const MAX_ATTEMPTS = 24;
/** Minutes to wait after the 1st, 2nd, 3rd, 4th failed attempt; hourly after that. */
export const BACKOFF_MINUTES = [1, 5, 15, 60] as const;
const LINK_KEY = /^utpos_[A-Za-z0-9]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
export const isLinkKey = (value: unknown): value is string => typeof value === 'string' && LINK_KEY.test(value);
export const keyHint = (key: string): string => key.slice(-4);

export function json(body: unknown, status = 200): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/** Base URL of Usetally without a trailing slash (env USETALLY_URL, default https://usetally.cc). */
export function usetallyBaseUrl(raw: string | undefined | null): string {
  const value = (raw ?? '').trim() || DEFAULT_USETALLY_URL;
  return value.replace(/\/+$/, '');
}

/** Where Usetally calls TrackOja back: `${SUPABASE_URL}/functions/v1`. */
export function callbackBase(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, '')}/functions/v1`;
}

/** The bearer token of a request, or '' when absent. */
export function bearerToken(req: Request): string {
  const header = req.headers.get('Authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : '';
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time comparison of two strings (compares their SHA-256 digests). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [left, right] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function aesKey(secret: string, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  if (!secret || secret.length < 32) throw new Error('USETALLY_LINK_SECRET must be at least 32 characters');
  // The secret is a high-entropy string; SHA-256 turns it into a 256-bit AES key.
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, [usage]);
}

/** AES-GCM encrypt a link key: "v1:<iv base64>:<ciphertext base64>". */
export async function encryptLinkKey(plain: string, secret: string): Promise<string> {
  const key = await aesKey(secret, 'encrypt');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain)));
  return `v1:${toBase64(iv)}:${toBase64(cipher)}`;
}

export async function decryptLinkKey(stored: string, secret: string): Promise<string> {
  const [version, iv, cipher] = stored.split(':');
  if (version !== 'v1' || !iv || !cipher) throw new Error('Stored Usetally key is not readable');
  const key = await aesKey(secret, 'decrypt');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv) }, key, fromBase64(cipher));
  return new TextDecoder().decode(plain);
}

/**
 * When to try again after a failed attempt (contract section 5): 1, 5, 15, 60
 * minutes, then hourly; null once `attemptsMade` reaches MAX_ATTEMPTS.
 */
export function nextRetryAt(attemptsMade: number, now: Date = new Date()): Date | null {
  if (attemptsMade >= MAX_ATTEMPTS) return null;
  const minutes = BACKOFF_MINUTES[Math.max(0, attemptsMade - 1)] ?? 60;
  return new Date(now.getTime() + minutes * 60_000);
}

export type DeliveryOutcome = 'sent' | 'revoked' | 'failed' | 'retry';

/**
 * Maps a Usetally response to what happens to the outbox row: 2xx sent, 401 the
 * link is revoked, 422 failed without retry, anything else retried. A void that
 * Usetally never imported (404) has nothing to undo, so it counts as delivered.
 */
export function classifyDelivery(kind: 'sale' | 'void', status: number | null): DeliveryOutcome {
  if (status !== null && status >= 200 && status < 300) return 'sent';
  if (status === 401) return 'revoked';
  if (status === 422) return 'failed';
  if (kind === 'void' && status === 404) return 'sent';
  return 'retry';
}

/** Where a row is sent: POST /api/pos/sales or /api/pos/sales/<id>/void. */
export function deliveryPath(kind: 'sale' | 'void', saleId: string): string {
  return kind === 'sale' ? '/api/pos/sales' : `/api/pos/sales/${encodeURIComponent(saleId)}/void`;
}

const isInt = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value);
const PAYMENT_METHODS = ['cash', 'card', 'transfer', 'credit', 'other'];

/** Sanity checks on a queued sale payload before it leaves TrackOja; returns problems. */
export function salePayloadProblems(payload: unknown): string[] {
  const problems: string[] = [];
  const p = payload as Record<string, any> | null;
  if (!p || typeof p !== 'object') return ['payload is not an object'];
  if (!isUuid(p.id)) problems.push('id must be a uuid');
  if (typeof p.number !== 'string' || !p.number) problems.push('number is required');
  if (typeof p.created_at !== 'string' || Number.isNaN(Date.parse(p.created_at))) problems.push('created_at must be ISO');
  if (typeof p.currency !== 'string' || !/^[A-Z]{3}$/.test(p.currency)) problems.push('currency must be a 3-letter code');
  if (!p.store || !isUuid(p.store.id) || typeof p.store.name !== 'string') problems.push('store is invalid');
  if (p.customer !== null && (typeof p.customer !== 'object' || typeof p.customer?.name !== 'string')) problems.push('customer is invalid');
  if (!Array.isArray(p.items) || p.items.length === 0) problems.push('items are required');
  else p.items.forEach((item: Record<string, unknown>, index: number) => {
    if (typeof item.name !== 'string' || typeof item.quantity !== 'number' || !(item.quantity > 0)) problems.push(`items[${index}] is invalid`);
    for (const field of ['unit_price_minor', 'discount_minor', 'tax_minor', 'line_total_minor']) {
      if (!isInt(item[field])) problems.push(`items[${index}].${field} must be an integer`);
    }
  });
  for (const field of ['subtotal_minor', 'discount_minor', 'tax_minor', 'total_minor', 'change_minor']) {
    if (!isInt(p[field]) || p[field] < 0) problems.push(`${field} must be a non-negative integer`);
  }
  if (!Array.isArray(p.payments)) problems.push('payments must be an array');
  else p.payments.forEach((payment: Record<string, unknown>, index: number) => {
    if (!PAYMENT_METHODS.includes(String(payment.method))) problems.push(`payments[${index}].method is invalid`);
    if (!isInt(payment.amount_minor) || (payment.amount_minor as number) <= 0) problems.push(`payments[${index}].amount_minor is invalid`);
  });
  return problems;
}

export interface StockRequest {
  document_id: string;
  number: string;
  lines: Array<{ product_id: string; quantity: number }>;
}

/** Validates the body of POST usetally-stock (contract section 4). */
export function parseStockRequest(body: unknown): { ok: true; value: StockRequest } | { ok: false; error: string } {
  const b = body as Record<string, any> | null;
  if (!b || typeof b !== 'object') return { ok: false, error: 'A JSON body is required' };
  if (!isUuid(b.document_id)) return { ok: false, error: 'document_id must be a uuid' };
  if (b.number !== undefined && b.number !== null && typeof b.number !== 'string') return { ok: false, error: 'number must be a string' };
  if (!Array.isArray(b.lines)) return { ok: false, error: 'lines must be an array' };
  if (b.lines.length > 500) return { ok: false, error: 'Too many lines' };
  const lines: StockRequest['lines'] = [];
  for (const [index, line] of b.lines.entries()) {
    if (!line || !isUuid(line.product_id)) return { ok: false, error: `lines[${index}].product_id must be a uuid` };
    const quantity = Number(line.quantity);
    if (typeof line.quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1e9) {
      return { ok: false, error: `lines[${index}].quantity must be a positive number` };
    }
    lines.push({ product_id: line.product_id.toLowerCase(), quantity });
  }
  return { ok: true, value: { document_id: b.document_id.toLowerCase(), number: String(b.number ?? '').slice(0, 80), lines } };
}

/** q and limit for GET usetally-catalog: limit defaults to 50, at most 200. */
export function parseCatalogQuery(url: URL): { q: string; limit: number } {
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 80);
  const raw = Number.parseInt(url.searchParams.get('limit') ?? '', 10);
  const limit = Number.isFinite(raw) ? Math.min(200, Math.max(1, raw)) : 50;
  return { q, limit };
}

/** Escapes % _ and \ so a search term matches literally inside ILIKE. */
export const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export const toMinor = (amount: unknown) => Math.round(Number(amount ?? 0) * 100);

export interface CatalogProductRow {
  id: string; name: string; sku: string | null; barcode: string | null; unit: string | null;
  selling_price: number | string; stock_qty: number | string; track_inventory: boolean;
}

export function catalogProduct(row: CatalogProductRow) {
  return {
    id: row.id, name: row.name, sku: row.sku ?? '', barcode: row.barcode ?? '', unit: row.unit ?? 'pcs',
    price_minor: toMinor(row.selling_price), stock_qty: Number(row.stock_qty ?? 0), track_inventory: !!row.track_inventory,
  };
}

/** Validates Usetally's POST /api/pos/link response. */
export function parseLinkResponse(body: unknown): { key: string; business: { id: string; name: string; currency: string } } | null {
  const b = body as Record<string, any> | null;
  if (!b || !isLinkKey(b.key)) return null;
  const business = b.business;
  if (!business || (typeof business.id !== 'string' && typeof business.id !== 'number') || typeof business.name !== 'string'
      || typeof business.currency !== 'string' || !/^[A-Za-z]{3}$/.test(business.currency)) return null;
  return { key: b.key, business: { id: String(business.id), name: business.name.slice(0, 200), currency: business.currency.toUpperCase() } };
}

// deno-lint-ignore no-explicit-any
type AdminClient = { from: (table: string) => any };

/**
 * Inbound auth (contract section 2): the bearer must be a link key whose SHA-256
 * matches an active link. Returns that link's store, or null (answer 401).
 */
export async function authenticateLink(admin: AdminClient, req: Request): Promise<{ id: string; store_id: string } | null> {
  const token = bearerToken(req);
  if (!isLinkKey(token)) return null;
  const hash = await sha256Hex(token);
  const { data, error } = await admin.from('usetally_links').select('id, store_id, status')
    .eq('key_hash', hash).maybeSingle();
  if (error || !data || data.status !== 'active') return null;
  return { id: data.id, store_id: data.store_id };
}

export async function fetchWithTimeout(url: string, init: RequestInit, ms = 15000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/** Reads `{ error }` from a response body without throwing. */
export async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json();
    if (typeof body?.error === 'string' && body.error) return body.error.slice(0, 300);
  } catch { /* not JSON */ }
  return fallback;
}
