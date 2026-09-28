// Edge Function: opay-webhook
// Public endpoint configured as the OPay merchant webhook URL. Verifies the
// x-opay-signature header (HMAC-SHA512 of the raw body using
// OPAY_SECRET_KEY, same scheme as paystack-webhook), maps OPay's status
// vocabulary to device_transactions.status, and calls
// handle_opay_webhook(reference, status, payload).
//
// Without the secret, no event can be authenticated and no payment is settled.
//
// Authentication and sandbox isolation failures are rejected before settlement.

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

// Maps OPay's webhook status vocabulary to device_transactions.status.
// PENDING/INITIAL/anything else is acknowledged with no database call - the
// transaction stays 'pending' until a terminal status arrives.
function mapOpayStatus(opayStatus: string | undefined): 'success' | 'failed' | 'cancelled' | null {
  switch ((opayStatus ?? '').toUpperCase()) {
    case 'SUCCESS':
      return 'success';
    case 'FAIL':
      return 'failed';
    case 'CLOSE':
      return 'cancelled';
    default:
      return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const opaySecretKey = Deno.env.get('OPAY_SECRET_KEY');
  if (!opaySecretKey) {
    return new Response(JSON.stringify({ error: 'OPay webhook verification is unavailable' }), {
      status: 503,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const rawBody = await req.text();

  const signature = req.headers.get('x-opay-signature');
  if (!signature || !(await verifySignature(rawBody, signature, opaySecretKey))) {
    return new Response(JSON.stringify({ error: 'Invalid signature' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let payload: { reference?: string; status?: string };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const reference = payload.reference;
  const mappedStatus = mapOpayStatus(payload.status);

  if (!reference || !mappedStatus) {
    // Acknowledge events we don't act on (e.g. PENDING/INITIAL, or missing
    // reference) so OPay stops retrying.
    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  try {
    const transaction = await adminClient.from('device_transactions').select('store_id')
      .eq('external_ref', reference).maybeSingle();
    if (transaction.error || !transaction.data) {
      return new Response(JSON.stringify({ received: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const store = await adminClient.from('stores').select('org_id')
      .eq('id', transaction.data.store_id).single();
    const org = store.data ? await adminClient.from('organizations').select('is_sandbox')
      .eq('id', store.data.org_id).single() : null;
    if (!org?.data?.is_sandbox) {
      return new Response(JSON.stringify({ error: 'Legacy OPay sandbox events cannot settle live sales' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const { error } = await adminClient.rpc('handle_opay_webhook', {
      p_external_ref: reference,
      p_status: mappedStatus,
      p_payload: payload,
    });
    if (error) throw error;

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch {
    // A database failure is not a verified payment. Return a retryable error
    // without leaking SQL details or falsely acknowledging settlement.
    return new Response(JSON.stringify({ error: 'Payment event could not be processed' }), {
      status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
