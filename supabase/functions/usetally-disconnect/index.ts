// Edge Function: usetally-disconnect (docs/USETALLY_CONNECT.md section 3)
// Called from Settings with { storeId } by an owner or manager (store:update).
// Asks Usetally to revoke the key (POST /api/pos/disconnect), then marks the link
// revoked here whatever Usetally answered: a revoked link is refused by
// usetally-catalog / usetally-stock, so TrackOja stops trusting the key even when
// Usetally is unreachable. Rows still waiting in the outbox are marked failed.
// Deploy with JWT verification on (the default).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { decryptLinkKey, fetchWithTimeout, isUuid, json, usetallyBaseUrl } from '../_shared/usetally.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Sign in to continue' }, 401);

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceKey) return json({ error: 'Connection service is unavailable' }, 503);

  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const admin = createClient(url, serviceKey);
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return json({ error: 'Invalid session' }, 401);
  const actorId = authData.user.id;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'A JSON body is required' }, 400); }
  if (!isUuid(body.storeId)) return json({ error: 'Choose a business branch' }, 400);
  const storeId = body.storeId;

  const access = await userClient.rpc('user_has_permission', {
    p_user_id: actorId, p_store_id: storeId, p_permission_name: 'store:update',
  });
  if (access.error || access.data !== true) {
    return json({ error: 'Only an owner or manager of this branch can disconnect Usetally' }, 403);
  }

  const link = await admin.from('usetally_links').select('id, status, key_enc').eq('store_id', storeId).maybeSingle();
  if (link.error) return json({ error: 'Could not load the Usetally connection' }, 500);
  if (!link.data || link.data.status !== 'active') return json({ disconnected: true, remote: 'not_connected' });

  let remote: 'revoked' | 'unreachable' = 'unreachable';
  const secret = Deno.env.get('USETALLY_LINK_SECRET');
  if (secret) {
    try {
      const key = await decryptLinkKey(link.data.key_enc, secret);
      const response = await fetchWithTimeout(`${usetallyBaseUrl(Deno.env.get('USETALLY_URL'))}/api/pos/disconnect`, {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: '{}',
      }, 10000);
      // 401 means Usetally already considers the key revoked.
      if (response.ok || response.status === 401) remote = 'revoked';
    } catch { /* Usetally unreachable: the local revoke below still stops all use of the key */ }
  }

  const revoked = await admin.rpc('usetally_revoke_link', {
    p_store_id: storeId, p_actor: actorId, p_reason: 'Disconnected in TrackOja Settings', p_fail_pending: true,
  });
  if (revoked.error) return json({ error: 'Could not disconnect. Try again.' }, 500);
  return json({ disconnected: true, remote });
});
