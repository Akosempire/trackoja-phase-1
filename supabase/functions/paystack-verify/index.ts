// Edge Function: paystack-verify
//
// The browser callback path. Paystack redirects the customer back with a
// reference, this function asks the gateway what actually happened to it, and only
// a confirmed success settles the payment.
//
// A REDIRECT IS NOT PROOF OF PAYMENT. Anybody can type a URL containing any
// reference, and anybody can close the tab before the redirect fires. So the
// reference in the URL is treated as a question, never as an answer: this function
// calls Paystack's verify endpoint and settles on the gateway's answer alone.
//
// This path and the signed webhook are deliberately redundant. The webhook is the
// reliable one - it arrives even when the customer never returns - and this exists
// so that a customer who does return sees the result immediately instead of a
// spinner waiting for a webhook. Both go through `settle_verified_payment`, which
// locks the transaction row, so whichever arrives second finds it already settled
// and returns the existing subscription without extending the period twice.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import {
  redactSecrets,
  resolvePaymentConfig,
  secretKeyForMode,
  PAYMENTS_UNAVAILABLE,
} from '../_shared/payments.ts';

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return json({ error: 'Missing authorization header' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  let reference: string | undefined;
  try {
    const body = await req.json();
    reference = typeof body?.reference === 'string' ? body.reference : undefined;
  } catch {
    return json({ error: 'A JSON body is required' }, 400);
  }

  if (!reference) {
    return json({ error: 'reference is required' }, 400);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return json({ error: 'Invalid session' }, 401);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: txn, error: txnError } = await adminClient
    .from('subscription_transactions')
    .select('reference, org_id, amount, currency, status, created_by, payment_mode, environment, is_test_data, failure_reason, verified_at, settled_by')
    .eq('reference', reference)
    .eq('created_by', userData.user.id)
    .single();

  if (txnError || !txn) {
    return json({ error: 'Transaction not found' }, 404);
  }

  // One place builds the row's honest state, so every branch answers with the same
  // shape and the client never has to guess which fields a given path returns.
  const stateData = (extra: Record<string, unknown> = {}) => ({
    reference: txn.reference,
    status: txn.status,
    amount: txn.amount,
    currency: txn.currency,
    paymentMode: txn.payment_mode,
    testData: txn.is_test_data,
    failureReason: txn.failure_reason,
    verifiedAt: txn.verified_at,
    settledBy: txn.settled_by,
    settled: txn.status === 'success',
    ...extra,
  });
  const state = (extra: Record<string, unknown> = {}, status = 200) => json(stateData(extra), status);

  // Already settled, by either path. Answering from the row - rather than asking
  // the gateway again - is what makes this safe to call on every page load.
  if (txn.status === 'success') {
    return state({ alreadySettled: true });
  }

  if (txn.status !== 'pending') {
    return state({ settled: false });
  }

  // Mock checkouts were settled when they were started; there is no gateway
  // session to ask about.
  if (txn.payment_mode === 'mock') {
    return state({ settled: false, detail: 'This was a mock checkout and never reached a gateway.' });
  }

  if (!txn.payment_mode) {
    // A row with no recorded mode was never initialized against a gateway, so
    // there is nothing to verify and nothing that may be activated. This is the
    // shape a pre-095 row has, and refusing it is the whole point of 095.
    return state({
      settled: false,
      detail: 'This payment was never initialized against a gateway, so there is nothing to verify.',
    });
  }

  const config = resolvePaymentConfig();
  const secretKey = secretKeyForMode(txn.payment_mode);

  if (!secretKey) {
    // The mode this attempt was started in is no longer configured. That happens
    // when an operator removes a key while a checkout is open, and the honest
    // answer is that this deployment cannot confirm the payment - not that it
    // failed, and certainly not that it succeeded.
    return state({
      settled: false,
      code: PAYMENTS_UNAVAILABLE,
      detail: `This payment was started in ${txn.payment_mode} mode, which this deployment no longer has a key for. It cannot be confirmed here; the signed webhook will settle it if the charge succeeded.`,
    }, 503);
  }

  try {
    const response = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${secretKey}` } },
    );
    const result = await response.json();

    if (!response.ok || !result?.status) {
      const detail = redactSecrets(result?.message ?? 'The payment provider could not confirm this reference.');
      return state({ settled: false, detail });
    }

    const data = result.data ?? {};
    const gatewayStatus = String(data.status ?? '');

    // The gateway's vocabulary is broader than ours. Only a confirmed success
    // settles; anything else is reported as it is, without inventing a verdict.
    if (gatewayStatus !== 'success') {
      if (gatewayStatus === 'failed' || gatewayStatus === 'reversed') {
        await adminClient.rpc('mark_subscription_transaction_failed', {
          p_reference: reference,
          p_paystack_data: data,
        });
      }
      return state({ settled: false, gatewayStatus, detail: `The payment provider reports this charge as ${gatewayStatus || 'in an unknown state'}.` });
    }

    // Paystack reports in the smallest currency unit; the database holds major
    // units. Converted once, here, and then checked against what was recorded
    // before the charge existed.
    const gatewayAmount = typeof data.amount === 'number' ? data.amount / 100 : Number.NaN;
    const gatewayCurrency = typeof data.currency === 'string' ? data.currency : '';

    if (!Number.isFinite(gatewayAmount) || gatewayCurrency === '') {
      return state({
        settled: false,
        detail: 'The provider confirmed a success without a usable amount or currency, so it could not be checked against this checkout.',
      });
    }

    const { error: settleError } = await adminClient.rpc('settle_verified_payment', {
      p_reference: reference,
      p_gateway_data: { ...data, org_id: txn.org_id },
      p_paid_at: data.paid_at ?? new Date().toISOString(),
      p_payment_mode: txn.payment_mode,
      p_environment: config.environment,
      p_gateway_amount: gatewayAmount,
      p_gateway_currency: gatewayCurrency,
      p_gateway_reference: data.id != null ? String(data.id) : null,
      p_settled_by: 'callback',
    });

    if (settleError) {
      // The gate refused: the charge does not match what was agreed. It has
      // already marked the attempt failed and written the reason, which is passed
      // through so the customer and the operator see the same words.
      const { data: after } = await adminClient
        .from('subscription_transactions')
        .select('status, failure_reason')
        .eq('reference', reference)
        .single();

      return state({
        settled: false,
        status: after?.status ?? txn.status,
        failureReason: after?.failure_reason ?? redactSecrets(settleError.message),
        detail: 'The payment did not match this checkout, so access was not granted.',
      });
    }

    return json({
      reference,
      status: 'success',
      settled: true,
      settledBy: 'callback',
      amount: gatewayAmount,
      currency: gatewayCurrency,
      paymentMode: txn.payment_mode,
      testData: txn.payment_mode !== 'live',
    });
  } catch (error) {
    const detail = redactSecrets((error as Error).message);
    return json({ error: `Could not reach the payment provider: ${detail}`, code: 'GATEWAY_UNREACHABLE' }, 502);
  }
});
