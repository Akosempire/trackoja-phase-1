// Edge Function: paystack-webhook
//
// The reliable asynchronous path: Paystack posts here when a charge reaches a
// terminal state, and this is what settles a payment when the customer closes the
// browser before the callback fires.
//
// WHAT CHANGED IN 095. The function used to call activate_subscription directly
// with whatever the payload said, and it discarded every event it did not act on -
// including signature failures. Two things were wrong with that. Activation is now
// behind `settle_verified_payment`, which refuses unless the settlement agrees with
// the mode, environment, amount and currency recorded before the charge existed.
// And every event is now written to `webhook_events`, because a webhook whose
// signature fails and a gateway that has gone quiet look identical from the
// outside, and only one of them means somebody has the wrong secret.
//
// THE MODE COMES FROM THE SIGNATURE, NOT THE PAYLOAD. Paystack signs with the key
// that created the transaction, so a test-mode payload verifies against the test
// key and a live one against the live key. Both candidate keys are tried, and
// which one matched is the evidence of the mode. A forged body can claim any mode
// it likes in its own JSON; it cannot forge an HMAC without the key. Deriving the
// mode this way is also what makes the check inside settle_verified_payment real
// rather than circular: a test webhook cannot settle a live attempt.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { candidateKeys, redactSecrets, resolvePaymentConfig } from '../_shared/payments.ts';

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
    ['sign'],
  );
  const hashBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expected = toHex(hashBuffer);

  // Constant-time comparison. A timing side channel on a webhook signature is a
  // long way from practical, but the cost of not leaking is zero.
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

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

  const rawBody = await req.text();
  const signature = req.headers.get('x-paystack-signature') ?? '';

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const record = async (fields: Record<string, unknown>) => {
    // Never let bookkeeping failure change the response: the ledger is evidence,
    // not the settlement. A webhook that returned 500 because a log insert failed
    // would make Paystack retry a payment that was already handled.
    try {
      await adminClient.from('webhook_events').insert({ provider: 'paystack', ...fields });
    } catch (error) {
      console.error('webhook_events insert failed', redactSecrets((error as Error).message));
    }
  };

  const config = resolvePaymentConfig();
  const candidates = candidateKeys(config);

  if (candidates.length === 0) {
    await record({
      event: null,
      reference: null,
      signature_valid: false,
      http_status: 500,
      outcome: 'not_configured',
      detail: config.available
        ? 'No signing key is available for this mode.'
        : config.reason,
    });
    return json({ error: 'Payments are not configured on this server' }, 500);
  }

  // ----------------------------------------------------------
  // Which key signed this, and therefore which mode it is.
  // ----------------------------------------------------------
  if (!signature) {
    await record({
      signature_valid: false,
      http_status: 401,
      outcome: 'missing_signature',
      detail: 'The request carried no x-paystack-signature header.',
    });
    return json({ error: 'Invalid signature' }, 401);
  }

  let matchedMode: string | null = null;
  for (const candidate of candidates) {
    if (await verifySignature(rawBody, signature, candidate.key)) {
      matchedMode = candidate.mode;
      break;
    }
  }

  if (!matchedMode) {
    await record({
      signature_valid: false,
      http_status: 401,
      outcome: 'bad_signature',
      detail: 'No configured key produced this signature. Either the wrong secret is set, or this is not from Paystack.',
    });
    return json({ error: 'Invalid signature' }, 401);
  }

  // ----------------------------------------------------------
  // The payload, now that it is known to be authentic.
  // ----------------------------------------------------------
  let payload: { event?: string; data?: Record<string, unknown> };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    await record({
      signature_valid: true,
      http_status: 400,
      outcome: 'invalid_json',
      detail: 'The signature verified but the body was not JSON.',
    });
    return json({ error: 'Invalid JSON' }, 400);
  }

  const event = payload.event ?? null;
  const data = payload.data ?? {};
  const reference = typeof data.reference === 'string' ? data.reference : null;

  const known = event === 'charge.success' || event === 'charge.failed';

  if (!reference || !known) {
    // Acknowledge so Paystack stops retrying, but record it: an unexpected event
    // arriving is worth seeing, and a subscription event with no reference is the
    // shape a misconfigured dashboard subscription takes.
    await record({
      event,
      reference,
      signature_valid: true,
      http_status: 200,
      outcome: 'ignored',
      detail: reference ? 'This event type does not settle a payment.' : 'This event carried no reference.',
      payload: data,
      processed_at: new Date().toISOString(),
    });
    return json({ received: true, ignored: true });
  }

  try {
    if (event === 'charge.success') {
      const paidAt = (data.paid_at as string | undefined) ?? new Date().toISOString();

      // Paystack reports the amount in the smallest unit; the database holds major
      // units. The conversion is done once, here, and the result is what gets
      // compared against the amount recorded before the charge existed.
      const rawAmount = data.amount;
      const gatewayAmount =
        typeof rawAmount === 'number' ? rawAmount / 100 : Number.NaN;
      const gatewayCurrency = typeof data.currency === 'string' ? data.currency : '';

      if (!Number.isFinite(gatewayAmount) || gatewayCurrency === '') {
        await record({
          event,
          reference,
          signature_valid: true,
          http_status: 200,
          outcome: 'unverifiable_payload',
          detail: 'charge.success arrived without a usable amount or currency, so it could not be checked.',
          payload: data,
          processed_at: new Date().toISOString(),
        });
        return json({ received: true, settled: false });
      }

      const { error } = await adminClient.rpc('settle_verified_payment', {
        p_reference: reference,
        p_gateway_data: data,
        p_paid_at: paidAt,
        p_payment_mode: matchedMode,
        p_environment: config.environment,
        p_gateway_amount: gatewayAmount,
        p_gateway_currency: gatewayCurrency,
        p_gateway_reference: (data.id as number | undefined)?.toString() ?? null,
        p_settled_by: 'webhook',
      });

      // A refusal from the gate is a real outcome, not a transport failure: it
      // means the payment did not match what was agreed, and the gate has already
      // marked the attempt failed with the reason. Recorded, acknowledged with 200
      // so Paystack does not retry a settled decision, and never activated.
      await record({
        event,
        reference,
        signature_valid: true,
        http_status: 200,
        outcome: error ? 'refused' : 'settled',
        detail: error ? redactSecrets(error.message) : `Settled in ${matchedMode} mode.`,
        payload: data,
        processed_at: new Date().toISOString(),
      });

      return json({ received: true, settled: !error, mode: matchedMode });
    }

    // charge.failed
    const { error } = await adminClient.rpc('mark_subscription_transaction_failed', {
      p_reference: reference,
      p_paystack_data: data,
    });

    await record({
      event,
      reference,
      signature_valid: true,
      http_status: 200,
      outcome: error ? 'failed_to_record' : 'marked_failed',
      detail: error ? redactSecrets(error.message) : 'The gateway reported this charge as failed.',
      payload: data,
      processed_at: new Date().toISOString(),
    });

    return json({ received: true, failed: true });
  } catch (error) {
    const detail = redactSecrets((error as Error).message);

    await record({
      event,
      reference,
      signature_valid: true,
      http_status: 200,
      outcome: 'error',
      detail,
      payload: data,
      processed_at: new Date().toISOString(),
    });

    console.error('paystack-webhook error', detail);

    // Still acknowledge with 200: Paystack retries on non-2xx, and an error whose
    // underlying row is already terminal would be retried forever. The ledger holds
    // the detail, which is where an operator will look.
    return json({ received: true, error: detail });
  }
});
