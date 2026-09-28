// Merchant customer payments only. Paystack platform subscriptions are separate.
// Deploy with JWT verification enabled. All secret-bearing provider calls stay here.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { approvalForStatus, providerAmount } from '../_shared/merchant-provider.ts';
import { decryptCredentials, encryptCredentials, MoniepointProvider, type MoniepointCredentials } from '../_shared/moniepoint.ts';

const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
const isUuid = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const safeAttempt = (row: Record<string, unknown>) => ({
  id: row.id, saleId: row.sale_id, storeId: row.store_id,
  terminalId: row.terminal_id, terminalLastFour: String(row.terminal_serial ?? '').slice(-4),
  expectedAmount: row.expected_amount, actualAmount: row.actual_amount,
  merchantReference: row.merchant_reference, providerReference: row.provider_reference,
  status: row.status, providerStatus: row.provider_processing_status,
  failureCode: row.failure_code, initiatedAt: row.initiated_at, completedAt: row.completed_at,
  environment: row.environment, paymentMethod: row.payment_method,
  actualPaymentMethod: row.actual_payment_method,
  initiatedBy: row.initiated_by,
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Sign in to continue' }, 401);
  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceKey) return json({ error: 'Payment service is unavailable' }, 503);
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const admin = createClient(url, serviceKey);
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return json({ error: 'Invalid session' }, 401);
  const actorId = authData.user.id;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'A JSON body is required' }, 400); }
  const action = body.action;
  if (!['connection', 'save_connection', 'test_connection', 'disconnect', 'initiate', 'check'].includes(String(action))) {
    return json({ error: 'Unknown payment action' }, 400);
  }

  try {
    // A status check starts with a row read under the caller's own RLS policy.
    // This prevents a service-role lookup from leaking another tenant's payment.
    let attempt: Record<string, unknown> | null = null;
    let storeId = body.storeId;
    if (action === 'check') {
      if (!isUuid(body.attemptId)) return json({ error: 'Invalid payment attempt' }, 400);
      const visible = await userClient.from('merchant_payment_attempts').select('*').eq('id', body.attemptId).maybeSingle();
      if (visible.error || !visible.data) return json({ error: 'Payment attempt not found' }, 404);
      attempt = visible.data;
      storeId = visible.data.store_id;
    }
    if (!isUuid(storeId)) return json({ error: 'Choose a business branch' }, 400);
    const storeResult = await admin.from('stores').select('id, org_id, status, currency').eq('id', storeId).single();
    if (storeResult.error || !storeResult.data) return json({ error: 'Business branch not found' }, 404);
    const store = storeResult.data;
    const orgResult = await admin.from('organizations').select('id, owner_id, is_sandbox').eq('id', store.org_id).single();
    if (orgResult.error || !orgResult.data) return json({ error: 'Business not found' }, 404);
    const org = orgResult.data;
    const environment = org.is_sandbox ? 'sandbox' : 'live';
    const isOwner = org.owner_id === actorId;

    if (action !== 'check') {
      const permission = action === 'initiate' || action === 'connection' ? 'sales:create' : 'store:update';
      const access = await userClient.rpc('user_has_permission', {
        p_user_id: actorId, p_store_id: store.id, p_permission_name: permission,
      });
      if (access.error || !access.data || (action !== 'initiate' && action !== 'connection' && !isOwner)) {
        return json({ error: 'You do not have permission for this payment action' }, 403);
      }
    }
    const connectionResult = await admin.from('merchant_provider_connections').select('*')
      .eq('org_id', org.id).eq('provider', 'moniepoint').eq('environment', environment).maybeSingle();
    if (connectionResult.error) throw new Error('Could not load Moniepoint configuration');
    const connection = connectionResult.data;
    const encryptionKey = Deno.env.get('MONIEPOINT_CREDENTIAL_ENCRYPTION_KEY');

    if (action === 'connection') {
      return json({ connection: connection ? {
        status: connection.status, authMode: connection.auth_mode,
        environment, erpEnabled: !!connection.erp_enabled_confirmed_at,
        lastVerifiedAt: connection.last_verified_at,
        amountUnitConfirmed: ['naira', 'kobo'].includes(Deno.env.get('MONIEPOINT_AMOUNT_UNIT') ?? ''),
        approvalCodesConfirmed: !!Deno.env.get('MONIEPOINT_APPROVED_CODES')?.trim(),
      } : { status: 'disconnected', environment, erpEnabled: false } });
    }

    if (action === 'save_connection') {
      if (!encryptionKey) return json({ error: 'Credential encryption is not configured on the server' }, 503);
      const mode = body.authMode;
      if (mode !== 'api_key' && mode !== 'client_credentials') return json({ error: 'Choose a documented credential type' }, 400);
      if (environment === 'sandbox' && mode === 'api_key') {
        return json({ error: 'Moniepoint does not document an API-key sandbox endpoint' }, 400);
      }
      let credentials: MoniepointCredentials;
      if (mode === 'api_key') {
        if (typeof body.apiKey !== 'string' || body.apiKey.trim().length < 8) return json({ error: 'Enter a valid API key' }, 400);
        credentials = { mode, apiKey: body.apiKey.trim() };
      } else {
        if (typeof body.clientId !== 'string' || !body.clientId.trim()
            || typeof body.clientSecret !== 'string' || !body.clientSecret.trim()) {
          return json({ error: 'Client ID and client secret are required' }, 400);
        }
        credentials = { mode, clientId: body.clientId.trim(), clientSecret: body.clientSecret.trim() };
      }
      const provider = new MoniepointProvider(credentials, environment);
      const verified = await provider.verifyConnection();
      const encrypted = await encryptCredentials(credentials, encryptionKey);
      const record = {
        org_id: org.id, provider: 'moniepoint', environment, auth_mode: mode,
        credential_ciphertext: encrypted.ciphertext, credential_iv: encrypted.iv,
        status: 'configured',
        last_verified_at: verified === 'verified' ? new Date().toISOString() : null,
        erp_enabled_confirmed_at: body.erpEnabled === true ? new Date().toISOString() : null,
        updated_by: actorId, created_by: connection?.created_by ?? actorId,
      };
      const write = await admin.from('merchant_provider_connections').upsert(record, { onConflict: 'org_id,provider,environment' });
      if (write.error) throw new Error('Could not save Moniepoint connection');
      return json({ status: record.status, environment, erpEnabled: !!record.erp_enabled_confirmed_at });
    }

    if (action === 'disconnect') {
      if (!connection) return json({ status: 'disconnected' });
      const write = await admin.from('merchant_provider_connections').update({
        status: 'disconnected', updated_by: actorId, updated_at: new Date().toISOString(),
      }).eq('id', connection.id);
      if (write.error) throw new Error('Could not disconnect Moniepoint');
      return json({ status: 'disconnected' });
    }

    if (!connection || !encryptionKey) return json({ error: 'Moniepoint is not configured for this business' }, 503);
    const credentials = await decryptCredentials(connection.credential_ciphertext, connection.credential_iv, encryptionKey);
    const provider = new MoniepointProvider(credentials, environment);

    if (action === 'test_connection') {
      let verified: 'verified' | 'unverifiable';
      try { verified = await provider.verifyConnection(); }
      catch {
        await admin.from('merchant_provider_connections').update({
          status: 'error', last_error_code: 'AUTH_UNAVAILABLE', updated_by: actorId,
        }).eq('id', connection.id);
        return json({ error: 'Moniepoint credential test failed. Check the credential and provider availability.' }, 503);
      }
      if (verified === 'unverifiable') {
        return json({ status: 'configured', message: 'The API key is stored, but Moniepoint provides no standalone API-key test endpoint. The first transaction must be tested on an enabled terminal.' });
      }
      const write = await admin.from('merchant_provider_connections').update({
        status: 'configured', last_verified_at: new Date().toISOString(), updated_by: actorId,
      }).eq('id', connection.id);
      if (write.error) throw new Error('Could not record connection test');
      return json({ status: 'configured', message: 'Credentials verified. Complete a terminal test payment before Moniepoint is shown as connected.' });
    }

    if (action === 'initiate') {
      if (!Deno.env.get('MONIEPOINT_APPROVED_CODES')?.trim()) {
        return json({ error: 'Moniepoint approval codes have not been confirmed on the server' }, 503);
      }
      if (!['naira', 'kobo'].includes(Deno.env.get('MONIEPOINT_AMOUNT_UNIT') ?? '')) {
        return json({ error: 'Moniepoint amount unit has not been confirmed by the provider' }, 503);
      }
      if (store.status !== 'active' || store.currency !== 'NGN' || !['configured', 'connected'].includes(connection.status)
          || !connection.erp_enabled_confirmed_at) {
        return json({ error: 'Moniepoint and ERP integration must be enabled for this business' }, 409);
      }
      if (!isUuid(body.checkoutKey) || !isUuid(body.requestKey) || !isUuid(body.terminalId)
          || !Array.isArray(body.items) || body.items.length < 1 || body.items.length > 100
          || (body.customerId != null && !isUuid(body.customerId))) {
        return json({ error: 'Checkout information is incomplete' }, 400);
      }
      const saleResult = await userClient.rpc('create_pending_pos_sale', {
        p_store_id: store.id, p_items: body.items, p_checkout_key: body.checkoutKey,
        p_customer_id: body.customerId ?? null, p_discount_total: body.discountTotal ?? 0,
        p_order_type: body.orderType ?? 'standard', p_table_number: body.tableNumber ?? null,
      });
      if (saleResult.error || !saleResult.data) throw new Error(saleResult.error?.message ?? 'Could not prepare the sale');
      const sale = saleResult.data;
      const amount = providerAmount(Number(sale.total), Deno.env.get('MONIEPOINT_AMOUNT_UNIT'));
      const attemptResult = await userClient.rpc('create_pos_payment_attempt', {
        p_sale_id: sale.id, p_terminal_id: body.terminalId, p_request_key: body.requestKey,
        p_payment_method: 'any', p_environment: environment,
      });
      if (attemptResult.error || !attemptResult.data) throw new Error(attemptResult.error?.message ?? 'Could not prepare POS payment');
      const prepared = attemptResult.data;
      if (prepared.status !== 'created') return json({ attempt: safeAttempt(prepared) });
      const claim = await admin.rpc('claim_pos_payment_send', { p_attempt_id: prepared.id, p_provider_amount: amount });
      if (claim.error) throw new Error('Could not lock the POS request');
      if (!claim.data) {
        const latest = await admin.from('merchant_payment_attempts').select('*').eq('id', prepared.id).single();
        return json({ attempt: safeAttempt(latest.data ?? prepared) });
      }
      const claimed = claim.data;
      const pushStarted = Date.now();
      try {
        await provider.initializePayment({
          merchantReference: claimed.merchant_reference, terminalSerial: claimed.terminal_serial,
          amount, paymentMethod: 'ANY',
        });
        await admin.from('merchant_provider_events').insert({
          org_id: org.id, store_id: store.id, attempt_id: claimed.id,
          provider: 'moniepoint', operation: 'push', outcome: 'accepted',
          latency_ms: Math.min(Date.now() - pushStarted, 120000),
        });
        const sent = await admin.rpc('record_pos_send_result', { p_attempt_id: claimed.id, p_status: 'pending' });
        if (sent.error || !sent.data) throw new Error('Request was accepted but its state could not be saved');
        return json({ attempt: safeAttempt(sent.data) });
      } catch (cause) {
        const status = (cause as { status?: number }).status;
        const definitiveFailure = status === 401 || status === 403;
        if (definitiveFailure) {
          await admin.from('merchant_provider_connections').update({
            status: 'error', last_error_code: 'PUSH_AUTH_REJECTED', updated_by: actorId,
          }).eq('id', connection.id);
        }
        await admin.from('merchant_provider_events').insert({
          org_id: org.id, store_id: store.id, attempt_id: claimed.id,
          provider: 'moniepoint', operation: 'push',
          outcome: definitiveFailure ? 'failed' : 'unavailable',
          error_code: definitiveFailure ? 'PROVIDER_REJECTED' : 'SEND_OUTCOME_UNKNOWN',
          latency_ms: Math.min(Date.now() - pushStarted, 120000),
        });
        const recorded = await admin.rpc('record_pos_send_result', {
          p_attempt_id: claimed.id, p_status: definitiveFailure ? 'failed' : 'unresolved',
          p_failure_code: definitiveFailure ? 'PROVIDER_REJECTED' : 'SEND_OUTCOME_UNKNOWN',
        });
        // A request may have reached the terminal even if the response was lost.
        // Never send it again automatically; use the status lookup and reconciliation.
        if (recorded.error) throw new Error('POS request state is unknown. Check payment status before retrying');
        return json({ attempt: safeAttempt(recorded.data ?? claimed) });
      }
    }

    if (!attempt) return json({ error: 'Payment attempt not found' }, 404);
    if (attempt.status === 'successful') return json({ attempt: safeAttempt(attempt) });
    if (attempt.status === 'created') return json({ attempt: safeAttempt(attempt) });
    const statusClaim = await admin.rpc('claim_pos_status_check', { p_attempt_id: attempt.id });
    if (statusClaim.error) throw new Error('Could not start a safe status check');
    if (!statusClaim.data) return json({ attempt: safeAttempt(attempt) });
    const statusStarted = Date.now();
    let status;
    try {
      status = await provider.getPaymentStatus(String(attempt.merchant_reference));
    } catch {
      await admin.from('merchant_provider_events').insert({
        org_id: org.id, store_id: store.id, attempt_id: attempt.id,
        provider: 'moniepoint', operation: 'status', outcome: 'unavailable',
        error_code: 'STATUS_UNAVAILABLE', latency_ms: Math.min(Date.now() - statusStarted, 120000),
      });
      const unresolved = await admin.rpc('record_pos_status_unavailable', { p_attempt_id: attempt.id });
      return json({ attempt: safeAttempt(unresolved.data ?? attempt),
        message: 'Payment status is unavailable. Do not collect another payment until it is verified.' });
    }
    await admin.from('merchant_provider_events').insert({
      org_id: org.id, store_id: store.id, attempt_id: attempt.id,
      provider: 'moniepoint', operation: 'status',
      outcome: status.processingStatus === 'PENDING' ? 'pending' : 'responded',
      latency_ms: Math.min(Date.now() - statusStarted, 120000),
    });
    const approval = approvalForStatus(status, Deno.env.get('MONIEPOINT_APPROVED_CODES'),
      Deno.env.get('MONIEPOINT_DECLINED_CODES'));
    const settled = await admin.rpc('settle_pos_payment_attempt', {
      p_attempt_id: attempt.id, p_merchant_reference: status.merchantReference,
      p_terminal_serial: status.terminalSerial, p_request_amount: status.requestAmount,
      p_actual_amount: status.actualAmount, p_processing_status: status.processingStatus,
      p_response_code: status.responseCode, p_provider_reference: status.transactionReference,
      p_actual_payment_method: status.actualPaymentMethod, p_approved: approval,
    });
    if (settled.error || !settled.data) {
      const review = await admin.rpc('record_pos_reconciliation_error', { p_attempt_id: attempt.id });
      return json({ attempt: safeAttempt(review.data ?? attempt),
        message: 'Moniepoint responded, but TrackOja could not reconcile the sale. Do not collect another payment.' });
    }
    if (settled.data.status === 'successful') {
      await admin.from('devices').update({ provider_verified_at: new Date().toISOString() }).eq('id', attempt.terminal_id);
      await admin.from('merchant_provider_connections').update({
        status: 'connected', last_verified_at: new Date().toISOString(), last_error_code: null,
      }).eq('id', connection.id).in('status', ['configured', 'connected']);
    }
    return json({ attempt: safeAttempt(settled.data) });
  } catch (cause) {
    // Do not echo provider bodies, secrets or database details to the browser.
    const message = cause instanceof Error ? cause.message : 'Payment service unavailable';
    const safe = /^(Could not prepare|Checkout key|A checkout|An item|Invalid|Insufficient stock|Sale total|Discount|Item discount|Moniepoint amount unit|The amount cannot|This Moniepoint credential mode|Moniepoint rejected|Moniepoint authentication)/.test(message)
      ? message : 'Payment service unavailable. Check the transaction before trying again.';
    return json({ error: safe }, 503);
  }
});
