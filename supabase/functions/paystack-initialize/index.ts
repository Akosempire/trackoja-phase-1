// Edge Function: paystack-initialize
//
// Starts a payment for a pending subscription_transactions row and returns the
// gateway's hosted checkout URL.
//
// WHAT CHANGED IN 095, AND WHY. This function used to treat a missing
// PAYSTACK_SECRET_KEY as a reason to simulate success: no gateway session, no
// charge, and an immediate activation. A production deployment with no payment
// configuration therefore handed out paid access for free. It now resolves its
// mode from secrets (`_shared/payments.ts`) and, when it cannot take money, it
// refuses and says so. Payments unavailable is a state the customer can see; a
// free subscription is not an acceptable fallback for a typo.
//
// The order of operations matters and is deliberate:
//
//   1. resolve the mode            (server secrets only, never the request)
//   2. refuse if unavailable       (before anything is written, except the
//                                   abandonment that stops the row lying)
//   3. stamp the attempt           (mode, environment, expected amount, currency)
//   4. talk to the gateway
//
// The stamp in step 3 happens BEFORE the gateway is called, so the amount the
// customer is about to be charged is on record before the charge exists. If the
// gateway is then compromised, or a callback is forged, settlement verification
// has something to check against that the attacker never controlled.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { redactSecrets, resolvePaymentConfig, PAYMENTS_UNAVAILABLE } from '../_shared/payments.ts';

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
  let callbackUrl: string | undefined;

  try {
    const body = await req.json();
    reference = typeof body?.reference === 'string' ? body.reference : undefined;
    callbackUrl = typeof body?.callbackUrl === 'string' && body.callbackUrl !== '' ? body.callbackUrl : undefined;
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

  // Platform availability is authoritative even when a stale client calls us.
  const { data: billing, error: billingError } = await userClient.rpc('get_billing_availability');
  if (billingError || !billing || !['TEST', 'LIVE'].includes(billing.payment_system)) {
    console.error('Subscription payment initialization disabled', { code: billingError?.code, mode: billing?.payment_system });
    return json({ error: 'Online subscription payments are not available yet. Start your free trial to continue.', code: 'PAYMENTS_UNAVAILABLE' }, 503);
  }

  // ----------------------------------------------------------
  // 1. What this deployment is allowed to do about money.
  // ----------------------------------------------------------
  const config = resolvePaymentConfig();

  // ----------------------------------------------------------
  // 2. The attempt, and who it belongs to.
  // ----------------------------------------------------------
  // Only the caller's own pending attempt may be initialized. This is checked
  // before the configuration is acted on, so an unauthenticated or foreign
  // reference cannot even cause a row to be abandoned.
  const { data: txn, error: txnError } = await adminClient
    .from('subscription_transactions')
    .select('id, reference, org_id, amount, amount_minor, recurring_amount_minor, setup_fee_amount_minor, currency, status, created_by, product_plan_id, plan_version_id, billing_cycle, payment_mode, environment')
    .eq('reference', reference)
    .eq('created_by', userData.user.id)
    .single();

  if (txnError || !txn) {
    return json({ error: 'Transaction not found' }, 404);
  }

  if (billing.payment_system === 'TEST') {
    const { data: access } = await userClient.rpc('get_my_developer_status');
    const { data: org } = await adminClient.from('organizations').select('is_sandbox').eq('id', txn.org_id).single();
    if (!access?.[0]?.developer_mode || !org?.is_sandbox || config.mode !== 'test') {
      return json({ error: 'Test checkout is restricted to authorised sandbox testing.' }, 403);
    }
  } else if (config.mode !== 'live') {
    console.error('Billing LIVE setting does not match provider configuration');
    return json({ error: 'Online subscription payments are temporarily unavailable.', code: 'PAYMENTS_UNAVAILABLE' }, 503);
  }

  if (txn.status === 'success') {
    return json({ error: 'This payment has already been completed', status: 'success' }, 409);
  }

  if (txn.status !== 'pending') {
    return json({ error: `This payment is ${txn.status} and cannot be started again`, status: txn.status }, 409);
  }

  // New commercial checkouts are always tied to immutable terms. A row created
  // through the old checkout RPC may still be verified by its legacy path, but it
  // cannot masquerade as a versioned purchase.
  if (txn.amount_minor != null && !txn.plan_version_id) {
    await adminClient.rpc('abandon_payment_attempt', {
      p_reference: reference,
      p_reason: 'The checkout has a minor-unit amount but no plan version.',
    });
    return json({ error: 'This checkout is incomplete. Choose the plan again.' }, 409);
  }

  if (txn.payment_mode && config.available && txn.payment_mode !== config.mode) {
    // The mode changed between two attempts on the same row, which can only happen
    // if an operator reconfigured the deployment mid-checkout. Refusing is safer
    // than charging under a mode the customer was not quoted.
    return json({
      error: `This payment was started in ${txn.payment_mode} mode and this deployment now takes ${config.mode} payments. Start a new checkout.`,
    }, 409);
  }

  // ----------------------------------------------------------
  // 3. Payments unavailable. Refuse, and stop the row implying otherwise.
  // ----------------------------------------------------------
  if (!config.available) {
    // The row is abandoned rather than left pending. A pending row is a row a
    // customer, a webhook and an operator all read as "money may still arrive".
    await adminClient.rpc('abandon_payment_attempt', {
      p_reference: reference,
      p_reason: config.reason,
    });

    // The customer sees one short sentence; the reason is kept for the operator
    // surface, where it is the difference between "we cannot take payments" and
    // "somebody has to set one variable".
    return json({
      error: 'Payments are unavailable on this deployment.',
      code: PAYMENTS_UNAVAILABLE,

      environment: config.environment,
    }, 503);
  }

  // ----------------------------------------------------------
  // 4. Stamp the attempt before the gateway is asked for anything.
  // ----------------------------------------------------------
  // expected_amount is the amount recorded when the checkout was opened, which
  // plan_checkout_amount priced - so it already includes a one-off setup fee when
  // this is the business's first payment. Settlement verification compares the
  // gateway's answer against this number and nothing else.
  const { error: stampError } = await adminClient.rpc('record_payment_attempt', {
    p_reference: reference,
    p_payment_mode: config.mode,
    p_environment: config.environment,
    p_expected_amount: txn.amount,
    p_expected_currency: txn.currency,
  });

  if (stampError) {
    return json({ error: redactSecrets(stampError.message) }, 500);
  }

  // The gate RETURNS its verdict rather than raising on a refusal. That is not a
  // style choice: a raised exception aborts the transaction, so the failed-status
  // record the gate writes on its way out would be rolled back and the attempt
  // would sit at 'pending' with no reason. A refusal here is a business outcome and
  // has to be able to persist, so the caller reads the result instead of catching
  // an error. An actual `error` still means an integrity failure and is thrown.
  const settle = async (settledBy: 'webhook' | 'callback' | 'mock', gatewayAmount: number, gatewayData: unknown) => {
    const { data, error } = await adminClient.rpc('settle_verified_payment', {
      p_reference: reference,
      p_gateway_data: { ...(gatewayData as Record<string, unknown> ?? {}), org_id: txn.org_id },
      p_paid_at: new Date().toISOString(),
      p_payment_mode: config.mode,
      p_environment: config.environment,
      p_gateway_amount: gatewayAmount,
      p_gateway_currency: txn.currency,
      p_gateway_reference: null,
      p_settled_by: settledBy,
    });
    if (error) throw new Error(redactSecrets(error.message));
    if (data && typeof data === 'object' && (data as { refused?: boolean }).refused) {
      throw new Error(redactSecrets((data as { reason?: string }).reason ?? 'The payment did not match this checkout.'));
    }
    return data;
  };

  // ----------------------------------------------------------
  // 5. Mock: settle without a gateway, and only where that is allowed.
  // ----------------------------------------------------------
  // config.mode is 'mock' only when PAYMENTS_MOCK_ENABLED is exactly 'true' AND
  // the deployment declares staging or development. Both conditions live in
  // secrets, so no request can reach this branch on a production deployment.
  if (config.mode === 'mock') {
    try {
      // The mock gateway reports exactly the amount it was asked for, which is the
      // only honest simulation: it proves the wiring, and it proves nothing about
      // whether a real card would have been charged.
      await settle('mock', Number(txn.amount), {
        mock: true,
        reference,
        metadata: { org_id: txn.org_id, product_plan_id: txn.product_plan_id, plan_version_id: txn.plan_version_id },
      });

      return json({
        authorizationUrl: callbackUrl ?? '',
        accessCode: `MOCK-${reference}`,
        reference,
        mode: 'mock',
        testMode: true,
        notice: 'Mock checkout: no gateway session was created and nothing was charged.',
      });
    } catch (error) {
      return json({ error: (error as Error).message }, 502);
    }
  }

  // ----------------------------------------------------------
  // 6. A real gateway session.
  // ----------------------------------------------------------
  try {
    const { data: organization } = await adminClient
      .from('organizations')
      .select('billing_email')
      .eq('id', txn.org_id)
      .single();
    const checkoutEmail = organization?.billing_email || userData.user.email;
    if (!checkoutEmail) {
      await adminClient.rpc('abandon_payment_attempt', { p_reference: reference, p_reason: 'No billing email is available.' });
      return json({ error: 'Add a billing email before starting checkout.' }, 409);
    }

    const paystackResponse = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: checkoutEmail,
        // Paystack takes the smallest currency unit. NGN is quoted in naira here,
        // so the kobo conversion happens in exactly one place.
        amount: txn.amount_minor == null ? Math.round(Number(txn.amount) * 100) : Number(txn.amount_minor),
        currency: txn.currency,
        reference,
        callback_url: callbackUrl,
        metadata: {
          // Carried so that a webhook or a verify response can be matched back to
          // the business even when the reference alone is ambiguous.
          org_id: txn.org_id,
          product_plan_id: txn.product_plan_id,
          plan_version_id: txn.plan_version_id,
          billing_cycle: txn.billing_cycle,
          recurring_amount_minor: txn.recurring_amount_minor,
          setup_fee_amount_minor: txn.setup_fee_amount_minor,
          payment_mode: config.mode,
          environment: config.environment,
        },
      }),
    });

    const paystackResult = await paystackResponse.json();

    if (!paystackResponse.ok || !paystackResult?.status) {
      const reason = redactSecrets(paystackResult?.message ?? 'The payment provider refused to start this checkout.');

      // Definitive refusal. The attempt is abandoned so it does not sit pending,
      // and the reason is kept where the Platform Owner Transactions view reads
      // it rather than being shown only to the one customer who was watching.
      await adminClient.rpc('abandon_payment_attempt', { p_reference: reference, p_reason: reason });

      return json({ error: reason, code: 'GATEWAY_REFUSED' }, 502);
    }

    const accessCode = paystackResult.data?.access_code ?? null;
    if (accessCode) {
      await adminClient
        .from('subscription_transactions')
        .update({ gateway_reference: accessCode })
        .eq('reference', reference);
    }

    return json({
      authorizationUrl: paystackResult.data.authorization_url,
      accessCode,
      reference: paystackResult.data.reference ?? reference,
      mode: config.mode,
      testMode: config.testMode,
      // The notices name variables, never values, and are included so the console
      // can show an operator that a legacy variable is being ignored.
      notices: config.notices,
    });
  } catch (error) {
    const reason = redactSecrets((error as Error).message);

    await adminClient.rpc('abandon_payment_attempt', {
      p_reference: reference,
      p_reason: `Could not reach the payment provider: ${reason}`,
    });

    // No secret is echoed. redactSecrets exists because the one realistic way a key
    // escapes is a provider or network error quoted straight back.
    return json({ error: `Could not reach the payment provider: ${reason}`, code: 'GATEWAY_UNREACHABLE' }, 502);
  }
});
