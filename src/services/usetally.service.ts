import { supabase } from '../config/supabase';

/**
 * TrackOja <-> Usetally connection (docs/USETALLY_CONNECT.md).
 *
 * Linking is OAuth-style: Settings sends the owner to Usetally's /connect/pos
 * page with a random `state` kept in sessionStorage; Usetally redirects back to
 * /settings/usetally/callback with a one-time `code`, which the usetally-connect
 * Edge Function exchanges server-to-server. The link key never reaches the browser.
 */

export const DEFAULT_USETALLY_URL = 'https://usetally.cc';
export const USETALLY_CALLBACK_PATH = '/settings/usetally/callback';
export const CONNECT_STATE_KEY = 'trackoja.usetally.connect';
/** Usetally codes live 10 minutes; a pending state older than this is stale. */
export const CONNECT_STATE_TTL_MS = 15 * 60_000;

export function usetallyUrl(raw: string | undefined = import.meta.env.VITE_USETALLY_URL): string {
  return ((raw ?? '').trim() || DEFAULT_USETALLY_URL).replace(/\/+$/, '');
}

export interface ConnectState {
  state: string;
  storeId: string;
  createdAt: number;
}

type StateStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Creates and remembers the `state` for one connect attempt. */
export function createConnectState(storeId: string, storage: StateStorage = sessionStorage, now = Date.now()): ConnectState {
  const value: ConnectState = { state: randomState(), storeId, createdAt: now };
  storage.setItem(CONNECT_STATE_KEY, JSON.stringify(value));
  return value;
}

export type ConsumedState =
  | { ok: true; storeId: string }
  | { ok: false; reason: 'missing' | 'mismatch' | 'expired' };

/**
 * Checks the `state` Usetally sent back against the one stored before leaving,
 * and forgets it either way so a callback URL cannot be replayed.
 */
export function consumeConnectState(returned: string | null, storage: StateStorage = sessionStorage, now = Date.now()): ConsumedState {
  const raw = storage.getItem(CONNECT_STATE_KEY);
  storage.removeItem(CONNECT_STATE_KEY);
  if (!raw) return { ok: false, reason: 'missing' };
  let saved: Partial<ConnectState>;
  try { saved = JSON.parse(raw); } catch { return { ok: false, reason: 'missing' }; }
  if (!saved.state || !saved.storeId || typeof saved.createdAt !== 'number') return { ok: false, reason: 'missing' };
  if (!returned || returned !== saved.state) return { ok: false, reason: 'mismatch' };
  if (now - saved.createdAt > CONNECT_STATE_TTL_MS) return { ok: false, reason: 'expired' };
  return { ok: true, storeId: saved.storeId };
}

/** `https://usetally.cc/connect/pos?return_to=…&state=…&store=…` (contract section 1). */
export function buildConnectUrl({ base = usetallyUrl(), origin, state, storeName }: {
  base?: string; origin: string; state: string; storeName: string;
}): string {
  const returnTo = `${origin.replace(/\/+$/, '')}${USETALLY_CALLBACK_PATH}`;
  return `${base.replace(/\/+$/, '')}/connect/pos?return_to=${encodeURIComponent(returnTo)}`
    + `&state=${encodeURIComponent(state)}&store=${encodeURIComponent(storeName)}`;
}

export interface CallbackParams { code: string | null; state: string | null; error: string | null }

export function readCallbackParams(search: string): CallbackParams {
  const params = new URLSearchParams(search);
  return { code: params.get('code'), state: params.get('state'), error: params.get('error') };
}

export function describeCallbackProblem(problem: 'missing' | 'mismatch' | 'expired' | 'access_denied' | 'no_code' | string): string {
  switch (problem) {
    case 'access_denied': return 'The connection was cancelled in Usetally. Nothing was shared.';
    case 'missing': return 'This connection was not started from this browser tab. Start again from Settings.';
    case 'mismatch': return 'The reply from Usetally did not match this connection request. Start again from Settings.';
    case 'expired': return 'This connection request expired. Start again from Settings.';
    case 'no_code': return 'Usetally did not send a connection code. Start again from Settings.';
    default: return 'Usetally could not complete the connection. Start again from Settings.';
  }
}

export interface UsetallyLinkStatus {
  status: 'none' | 'active' | 'revoked';
  businessName: string | null;
  businessCurrency: string | null;
  storeCurrency: string;
  keyHint: string | null;
  connectedAt: string | null;
  revokedAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  pending: number;
  failed: number;
  sent: number;
}

export function mapLinkStatus(row: Record<string, any> | null | undefined): UsetallyLinkStatus {
  const status = row?.status === 'active' || row?.status === 'revoked' ? row.status : 'none';
  return {
    status,
    businessName: row?.business_name ?? null,
    businessCurrency: row?.business_currency ?? null,
    storeCurrency: row?.store_currency ?? 'NGN',
    keyHint: row?.key_hint ?? null,
    connectedAt: row?.connected_at ?? null,
    revokedAt: row?.revoked_at ?? null,
    lastSyncAt: row?.last_sync_at ?? null,
    lastError: row?.last_error ?? null,
    pending: Number(row?.pending ?? 0),
    failed: Number(row?.failed ?? 0),
    sent: Number(row?.sent ?? 0),
  };
}

export interface SyncResult { processed: number; sent: number; failed: number; retry: number; revoked: number; requeued: number }

async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    const context = (error as { context?: Response }).context;
    if (context?.json) {
      let payload: { error?: unknown } | null = null;
      try { payload = await context.json(); } catch { payload = null; }
      if (typeof payload?.error === 'string') throw new Error(payload.error);
    }
    throw error;
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}

export class UsetallyService {
  /** Link status and outbox counts for Settings (needs store:update). */
  static async getStatus(storeId: string): Promise<UsetallyLinkStatus> {
    const { data, error } = await supabase.rpc('get_usetally_link_status', { p_store_id: storeId });
    if (error) throw error;
    return mapLinkStatus(data as Record<string, any>);
  }

  /** Remembers a fresh state and returns the Usetally URL to send the browser to. */
  static startConnect(storeId: string, storeName: string): string {
    const { state } = createConnectState(storeId);
    return buildConnectUrl({ origin: window.location.origin, state, storeName });
  }

  static async connect(storeId: string, code: string): Promise<{ businessName: string; currency: string; warning: string | null }> {
    const result = await invoke<{ business: { name: string; currency: string }; warning?: string | null }>('usetally-connect', { storeId, code });
    return { businessName: result.business.name, currency: result.business.currency, warning: result.warning ?? null };
  }

  static async disconnect(storeId: string): Promise<void> {
    await invoke('usetally-disconnect', { storeId });
  }

  static async syncNow(storeId: string): Promise<SyncResult> {
    return invoke<SyncResult>('usetally-sync', { storeId, action: 'sync' });
  }

  static async retryFailed(storeId: string): Promise<SyncResult> {
    return invoke<SyncResult>('usetally-sync', { storeId, action: 'retry_failed' });
  }

  /**
   * Fire-and-forget nudge after checkout so a sale reaches Usetally in seconds
   * rather than at the next cron minute. Never throws and never delays checkout;
   * for a store with no link the function finds nothing to send.
   */
  static nudgeSync(storeId: string): void {
    try {
      void supabase.functions.invoke('usetally-sync', { body: { storeId, action: 'sync' } }).catch(() => undefined);
    } catch { /* ignore: delivery is retried by the scheduled run */ }
  }
}
