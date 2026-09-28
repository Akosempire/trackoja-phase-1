// Edge Function: payments-config
//
// Tells a signed-in client whether this deployment can take money, and in which
// mode, so the interface can say "Payments unavailable" instead of offering a
// button that fails.
//
// WHAT IT MUST NEVER RETURN: a key, a key fragment, or anything derived from one.
// It answers with the mode, the environment and the operator-facing reason, which
// is exactly what a customer needs to understand the state and no more. The
// `notices` it forwards are written to name variables and never values, which is
// the rule the whole payment surface follows.
//
// WHY THE CLIENT IS TOLD THE MODE AT ALL. A test or mock checkout grants real
// access to whoever is using it, and appears nowhere in revenue. If the interface
// does not say so, somebody will eventually test in production and believe they
// have a customer. The badge is the honest label.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { publicPaymentConfig, resolvePaymentConfig } from '../_shared/payments.ts';

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

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

  // A session is required, but no database access is needed: this answers a
  // question about the deployment, not about a tenant.
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

  return new Response(JSON.stringify(publicPaymentConfig(resolvePaymentConfig())), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
