// Invoke from a trusted scheduler with MONIEPOINT_RECONCILE_TOKEN. This job
// rechecks provider state even when the cashier closes the browser. It never
// retries a push request; an ambiguous send can only be resolved by status.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { approvalForStatus } from '../_shared/merchant-provider.ts';
import { decryptCredentials, MoniepointProvider } from '../_shared/moniepoint.ts';

const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

async function equalTokens(received: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(received)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  const left = new Uint8Array(a); const right = new Uint8Array(b);
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
  return difference === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const token = Deno.env.get('MONIEPOINT_RECONCILE_TOKEN');
  const received = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!token || !received || !(await equalTokens(received, token))) return json({ error: 'Unauthorized' }, 401);
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const encryptionKey = Deno.env.get('MONIEPOINT_CREDENTIAL_ENCRYPTION_KEY');
  const approvedCodes = Deno.env.get('MONIEPOINT_APPROVED_CODES');
  if (!url || !key || !encryptionKey || !approvedCodes?.trim()) return json({ error: 'Reconciliation is not configured' }, 503);
  const admin = createClient(url, key);
  const pending = await admin.from('merchant_payment_attempts').select('*')
    .in('status', ['sending', 'pending', 'unresolved', 'reconciliation_required'])
    .order('initiated_at', { ascending: true }).limit(50);
  if (pending.error) return json({ error: 'Could not load pending attempts' }, 503);
  let checked = 0; let reconciled = 0; let unavailable = 0;
  for (const attempt of pending.data ?? []) {
    const statusStarted = Date.now();
    try {
      const claim = await admin.rpc('claim_pos_status_check', { p_attempt_id: attempt.id });
      if (claim.error || !claim.data) continue;
      const connection = await admin.from('merchant_provider_connections').select('*')
        .eq('org_id', attempt.org_id).eq('provider', 'moniepoint')
        .eq('environment', attempt.environment).single();
      if (connection.error || !connection.data) { unavailable++; continue; }
      const credentials = await decryptCredentials(connection.data.credential_ciphertext,
        connection.data.credential_iv, encryptionKey);
      const provider = new MoniepointProvider(credentials, attempt.environment);
      const status = await provider.getPaymentStatus(attempt.merchant_reference);
      checked++;
      await admin.from('merchant_provider_events').insert({
        org_id: attempt.org_id, store_id: attempt.store_id, attempt_id: attempt.id,
        provider: 'moniepoint', operation: 'status',
        outcome: status.processingStatus === 'PENDING' ? 'pending' : 'responded',
        latency_ms: Math.min(Date.now() - statusStarted, 120000),
      });
      const result = await admin.rpc('settle_pos_payment_attempt', {
        p_attempt_id: attempt.id, p_merchant_reference: status.merchantReference,
        p_terminal_serial: status.terminalSerial, p_request_amount: status.requestAmount,
        p_actual_amount: status.actualAmount, p_processing_status: status.processingStatus,
        p_response_code: status.responseCode, p_provider_reference: status.transactionReference,
        p_actual_payment_method: status.actualPaymentMethod,
        p_approved: approvalForStatus(status, approvedCodes, Deno.env.get('MONIEPOINT_DECLINED_CODES')),
      });
      if (result.error || !result.data) {
        unavailable++;
        await admin.rpc('record_pos_reconciliation_error', { p_attempt_id: attempt.id });
        continue;
      }
      if (result.data.status === 'successful') {
        reconciled++;
        await admin.from('devices').update({ provider_verified_at: new Date().toISOString() }).eq('id', attempt.terminal_id);
        await admin.from('merchant_provider_connections').update({
          status: 'connected', last_verified_at: new Date().toISOString(), last_error_code: null,
        }).eq('id', connection.data.id).in('status', ['configured', 'connected']);
      }
    } catch {
      unavailable++;
      await admin.rpc('record_pos_status_unavailable', { p_attempt_id: attempt.id });
      await admin.from('merchant_provider_events').insert({
        org_id: attempt.org_id, store_id: attempt.store_id, attempt_id: attempt.id,
        provider: 'moniepoint', operation: 'status', outcome: 'unavailable',
        error_code: 'STATUS_UNAVAILABLE', latency_ms: Math.min(Date.now() - statusStarted, 120000),
      });
      // Provider/network errors are not proof that a customer did not pay.
    }
  }
  return json({ checked, reconciled, unavailable });
});
