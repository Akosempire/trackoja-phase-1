// Edge Function: usetally-sync (docs/USETALLY_CONNECT.md section 5)
// Delivers due usetally_outbox rows to Usetally, oldest first:
//   2xx -> sent; 401 -> link revoked, stop; 422 -> failed (no retry);
//   anything else -> retry after 1, 5, 15, 60 minutes, then hourly, max 24 attempts.
//
// Callers:
//   * pg_cron (usetally_cron_tick) or any scheduler, every minute, with
//     `Authorization: Bearer <USETALLY_SYNC_TOKEN>` (or the service role key):
//     processes every store. Body: {}.
//   * a signed-in member of a store, after checkout or from Settings:
//     { storeId, action?: 'sync' | 'retry_failed' }. 'sync' needs sales:create or
//     store:update on that store; 'retry_failed' needs store:update.
// Deploy with --no-verify-jwt (config.toml) because the cron token is not a JWT;
// the function authenticates every caller itself.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import {
  bearerToken, classifyDelivery, decryptLinkKey, deliveryPath, errorMessage, fetchWithTimeout, isUuid, json,
  nextRetryAt, safeEqual, salePayloadProblems, usetallyBaseUrl, MAX_ATTEMPTS,
} from '../_shared/usetally.ts';

interface ClaimedRow {
  id: string; store_id: string; sale_id: string; kind: 'sale' | 'void';
  payload: Record<string, unknown>; attempts: number; key_enc: string;
}

const TIME_BUDGET_MS = 45_000;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const linkSecret = Deno.env.get('USETALLY_LINK_SECRET');
  if (!url || !anonKey || !serviceKey || !linkSecret) return json({ error: 'Usetally sync is not configured' }, 503);
  const admin = createClient(url, serviceKey);

  const token = bearerToken(req);
  if (!token) return json({ error: 'Unauthorized' }, 401);
  const syncToken = Deno.env.get('USETALLY_SYNC_TOKEN');
  const isSystem = (!!syncToken && await safeEqual(token, syncToken)) || await safeEqual(token, serviceKey);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { body = {}; }
  const action = body.action === 'retry_failed' ? 'retry_failed' : 'sync';
  let storeId: string | null = null;

  if (!isSystem) {
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return json({ error: 'Unauthorized' }, 401);
    if (!isUuid(body.storeId)) return json({ error: 'Choose a business branch' }, 400);
    storeId = body.storeId;
    const can = async (permission: string) => {
      const result = await userClient.rpc('user_has_permission', {
        p_user_id: authData.user.id, p_store_id: storeId, p_permission_name: permission,
      });
      return !result.error && result.data === true;
    };
    const allowed = action === 'retry_failed'
      ? await can('store:update')
      : (await can('store:update')) || (await can('sales:create'));
    if (!allowed) return json({ error: 'You do not have permission to sync this branch' }, 403);
  } else if (isUuid(body.storeId)) {
    storeId = body.storeId;
  }

  let requeued = 0;
  if (action === 'retry_failed') {
    if (!storeId) return json({ error: 'Choose a business branch' }, 400);
    const retried = await admin.rpc('usetally_retry_failed', { p_store_id: storeId });
    if (retried.error) return json({ error: 'Could not retry failed sales' }, 500);
    requeued = Number(retried.data ?? 0);
  }

  const claimed = await admin.rpc('usetally_claim_outbox', { p_store_id: storeId, p_limit: 50 });
  if (claimed.error) return json({ error: 'Could not read the outbox' }, 500);
  const rows = (claimed.data ?? []) as ClaimedRow[];

  const base = usetallyBaseUrl(Deno.env.get('USETALLY_URL'));
  const started = Date.now();
  const keys = new Map<string, string | null>();
  const stopped = new Set<string>();
  const counts = { sent: 0, failed: 0, retry: 0, revoked: 0, skipped: 0 };

  const record = (row: ClaimedRow, outcome: string, error: string | null, retryAt: Date | null = null, documentId: string | null = null) =>
    admin.rpc('usetally_record_outbox_result', {
      p_id: row.id, p_outcome: outcome, p_error: error,
      p_retry_at: retryAt ? retryAt.toISOString() : null, p_remote_document_id: documentId,
    });

  for (const row of rows) {
    // Rows left unprocessed keep their two-minute lease and are picked up next run.
    if (stopped.has(row.store_id) || Date.now() - started > TIME_BUDGET_MS) { counts.skipped++; continue; }

    if (!keys.has(row.store_id)) {
      try { keys.set(row.store_id, await decryptLinkKey(row.key_enc, linkSecret)); } catch { keys.set(row.store_id, null); }
    }
    const key = keys.get(row.store_id);
    if (!key) {
      // The secret changed or the ciphertext is damaged: nothing can be sent until
      // the owner connects again. Retry later rather than losing the sale.
      await record(row, 'retry', 'Stored Usetally key cannot be decrypted. Connect Usetally again.', nextRetryAt(row.attempts + 1) ?? new Date(Date.now() + 3_600_000));
      stopped.add(row.store_id);
      counts.retry++;
      continue;
    }

    if (row.kind === 'sale') {
      const problems = salePayloadProblems(row.payload);
      if (problems.length) {
        await record(row, 'failed', `Not sent, invalid sale: ${problems.slice(0, 3).join('; ')}`);
        counts.failed++;
        continue;
      }
    }

    let status: number | null = null;
    let error = 'Usetally could not be reached';
    let documentId: string | null = null;
    try {
      const response = await fetchWithTimeout(`${base}${deliveryPath(row.kind, row.sale_id)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(row.payload),
      });
      status = response.status;
      if (response.ok) {
        try {
          const parsed = await response.json();
          if (parsed && (typeof parsed.document_id === 'string' || typeof parsed.document_id === 'number')) documentId = String(parsed.document_id);
        } catch { /* 2xx without a JSON body is still delivered */ }
      } else {
        error = `HTTP ${status}: ${await errorMessage(response, response.statusText || 'request failed')}`;
      }
    } catch { /* network error or timeout: retried below */ }

    const outcome = classifyDelivery(row.kind, status);
    if (outcome === 'sent') {
      await record(row, 'sent', null, null, documentId);
      counts.sent++;
    } else if (outcome === 'revoked') {
      await record(row, 'revoked', 'Usetally rejected the link key');
      stopped.add(row.store_id);
      counts.revoked++;
    } else if (outcome === 'failed') {
      await record(row, 'failed', error);
      counts.failed++;
    } else {
      const retryAt = nextRetryAt(row.attempts + 1);
      if (retryAt) {
        await record(row, 'retry', error, retryAt);
        counts.retry++;
      } else {
        await record(row, 'failed', `Gave up after ${MAX_ATTEMPTS} attempts. ${error}`);
        counts.failed++;
      }
    }
  }

  return json({ processed: rows.length - counts.skipped, requeued, ...counts });
});
