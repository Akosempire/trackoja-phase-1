// Edge Function: paystack-webhook
// Public endpoint configured in the Paystack dashboard. Verifies the
// x-paystack-signature header (HMAC-SHA512 of the raw body using
// PAYSTACK_SECRET_KEY), then on:
//   - charge.success -> activate_subscription(reference, data, paid_at)
//   - charge.failed  -> mark_subscription_transaction_failed(reference, data)
//
// Always responds 200 once the signature is verified (Paystack retries on
// non-2xx), and 401/400 if signature verification fails.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function verifySignature(rawBody: string, signature: string, secret: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign']
  );
  const hashBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  return toHex(hashBuffer) === signature;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const paystackSecretKey = Deno.env.get('PAYSTACK_SECRET_KEY');
  if (!paystackSecretKey) {
    return new Response(JSON.stringify({ error: 'Paystack is not configured on this server' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const signature = req.headers.get('x-paystack-signature');
  const rawBody = await req.text();

  if (!signature || !(await verifySignature(rawBody, signature, paystackSecretKey))) {
    return new Response(JSON.stringify({ error: 'Invalid signature' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let payload: { event?: string; data?: Record<string, unknown> };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const event = payload.event;
  const data = payload.data ?? {};
  const reference = data.reference as string | undefined;

  if (!reference) {
    // Acknowledge events we don't care about so Paystack stops retrying.
    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  try {
    if (event === 'charge.success') {
      const paidAt = (data.paid_at as string | undefined) ?? new Date().toISOString();
      const { error } = await adminClient.rpc('activate_subscription', {
        p_reference: reference,
        p_paystack_data: data,
        p_paid_at: paidAt,
      });
      if (error) throw error;
    } else if (event === 'charge.failed') {
      const { error } = await adminClient.rpc('mark_subscription_transaction_failed', {
        p_reference: reference,
        p_paystack_data: data,
      });
      if (error) throw error;
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('paystack-webhook error', error);
    // Still acknowledge with 200 so Paystack doesn't endlessly retry an
    // event whose underlying row may already be in a terminal state.
    return new Response(JSON.stringify({ received: true, error: (error as Error).message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
