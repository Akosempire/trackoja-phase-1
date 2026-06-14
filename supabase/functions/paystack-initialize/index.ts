// Edge Function: paystack-initialize
// Starts a Paystack hosted checkout for a pending subscription_transactions
// row created by initiate_subscription_checkout(). The SPA calls this
// function with the transaction's reference (and a callbackUrl to return to
// after payment); it returns the Paystack authorization_url to redirect to.
//
// Requires the PAYSTACK_SECRET_KEY Edge Function secret
// (supabase secrets set PAYSTACK_SECRET_KEY=sk_test_...). If unset, runs in
// mock mode: the transaction is activated immediately and the caller is
// redirected straight back to callbackUrl.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { reference, callbackUrl } = await req.json();
    if (!reference || typeof reference !== 'string') {
      return new Response(JSON.stringify({ error: 'reference is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const paystackSecretKey = Deno.env.get('PAYSTACK_SECRET_KEY');

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: 'Invalid session' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Only allow initializing the caller's own pending transaction.
    const { data: txn, error: txnError } = await adminClient
      .from('subscription_transactions')
      .select('id, reference, amount, currency, status, created_by')
      .eq('reference', reference)
      .eq('created_by', userData.user.id)
      .eq('status', 'pending')
      .single();

    if (txnError || !txn) {
      return new Response(JSON.stringify({ error: 'Transaction not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!paystackSecretKey) {
      // Mock mode: no PAYSTACK_SECRET_KEY configured yet. Simulate an
      // instant successful payment so the billing/upgrade flow works
      // end-to-end; real credentials switch this to the live Paystack flow
      // automatically.
      const { error: activateError } = await adminClient.rpc('activate_subscription', {
        p_reference: txn.reference,
        p_paystack_data: { mock: true },
        p_paid_at: new Date().toISOString(),
      });
      if (activateError) throw activateError;

      return new Response(
        JSON.stringify({
          authorizationUrl: callbackUrl ?? '',
          accessCode: `MOCK-${txn.reference}`,
          reference: txn.reference,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const paystackResponse = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${paystackSecretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: userData.user.email,
        amount: Math.round(Number(txn.amount) * 100), // kobo
        currency: txn.currency,
        reference: txn.reference,
        callback_url: callbackUrl,
      }),
    });

    const paystackResult = await paystackResponse.json();

    if (!paystackResponse.ok || !paystackResult.status) {
      return new Response(JSON.stringify({ error: paystackResult.message ?? 'Paystack initialization failed' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({
        authorizationUrl: paystackResult.data.authorization_url,
        accessCode: paystackResult.data.access_code,
        reference: paystackResult.data.reference,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
