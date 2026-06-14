// Edge Function: opay-initiate-payment
// Starts an OPay payment request on a registered OPay terminal (a `devices`
// row with provider = 'opay'). The SPA calls this with a deviceId and amount;
// it records a `payment_request` device_transactions row (via
// record_device_transaction) and returns the OPay reference to track.
//
// If the OPAY_SECRET_KEY Edge Function secret is set, this calls the real
// OPay Cashier "create order" endpoint. Otherwise it falls back to a
// deterministic mock reference/checkout URL so the request -> webhook loop
// can be exercised before real credentials exist (see PHASE_10_OPAY.md).

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
    const { deviceId, amount, currency, saleId, salePaymentId, sessionId } = await req.json();
    if (!deviceId || typeof deviceId !== 'string') {
      return new Response(JSON.stringify({ error: 'deviceId is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (typeof amount !== 'number' || amount <= 0) {
      return new Response(JSON.stringify({ error: 'amount must be a positive number' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const opaySecretKey = Deno.env.get('OPAY_SECRET_KEY');

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

    const { data: device, error: deviceError } = await adminClient
      .from('devices')
      .select('id, provider, status')
      .eq('id', deviceId)
      .single();

    if (deviceError || !device) {
      return new Response(JSON.stringify({ error: 'Device not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (device.provider !== 'opay') {
      return new Response(JSON.stringify({ error: 'Device is not an OPay terminal' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (device.status !== 'active') {
      return new Response(JSON.stringify({ error: 'Device is not active' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const txnCurrency = typeof currency === 'string' && currency ? currency : 'NGN';
    let reference: string;
    let checkoutUrl: string | undefined;

    if (opaySecretKey) {
      reference = `OPAY-${crypto.randomUUID()}`;
      const opayResponse = await fetch('https://sandboxapi.opaycheckout.com/api/v1/international/cashier/create', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${opaySecretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reference,
          amount: { total: Math.round(amount * 100), currency: txnCurrency },
        }),
      });
      const opayResult = await opayResponse.json();
      if (!opayResponse.ok) {
        return new Response(JSON.stringify({ error: opayResult.message ?? 'OPay request failed' }), {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      checkoutUrl = opayResult.data?.cashierUrl;
    } else {
      // Mock mode: no OPAY_SECRET_KEY configured yet.
      reference = `MOCK-OPAY-${crypto.randomUUID()}`;
      checkoutUrl = `https://mock.opaycheckout.test/checkout/${reference}`;
      console.warn('opay-initiate-payment: OPAY_SECRET_KEY not set, returning mock reference', reference);
    }

    const { data: transaction, error: rpcError } = await userClient.rpc('record_device_transaction', {
      p_device_id: deviceId,
      p_transaction_type: 'payment_request',
      p_amount: amount,
      p_currency: txnCurrency,
      p_session_id: sessionId ?? null,
      p_sale_id: saleId ?? null,
      p_sale_payment_id: salePaymentId ?? null,
      p_refund_id: null,
      p_external_ref: reference,
      p_metadata: { opay: { mock: !opaySecretKey } },
    });

    if (rpcError) {
      return new Response(JSON.stringify({ error: rpcError.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({ transaction, reference, checkoutUrl }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
