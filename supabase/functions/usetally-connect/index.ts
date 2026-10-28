// Edge Function: usetally-connect (docs/USETALLY_CONNECT.md section 1, step 3)
// Called by the /settings/usetally/callback page with { code, storeId } after
// Usetally redirected back. The signed-in user must hold store:update on the store
// (owner or manager). Exchanges the one-time code server-to-server for a link key,
// then stores only the key's SHA-256 and its AES-GCM ciphertext.
// Deploy with JWT verification on (the default).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import {
  callbackBase, encryptLinkKey, errorMessage, fetchWithTimeout, isUuid, json, keyHint,
  parseLinkResponse, sha256Hex, usetallyBaseUrl,
} from '../_shared/usetally.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Sign in to continue' }, 401);

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const linkSecret = Deno.env.get('USETALLY_LINK_SECRET');
  if (!url || !anonKey || !serviceKey) return json({ error: 'Connection service is unavailable' }, 503);
  if (!linkSecret || linkSecret.length < 32) return json({ error: 'Usetally connection is not configured on the server' }, 503);

  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const admin = createClient(url, serviceKey);
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return json({ error: 'Invalid session' }, 401);
  const actorId = authData.user.id;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'A JSON body is required' }, 400); }
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!code || code.length > 200) return json({ error: 'The connection code is missing' }, 400);
  if (!isUuid(body.storeId)) return json({ error: 'Choose a business branch' }, 400);
  const storeId = body.storeId;

  const access = await userClient.rpc('user_has_permission', {
    p_user_id: actorId, p_store_id: storeId, p_permission_name: 'store:update',
  });
  if (access.error || access.data !== true) {
    return json({ error: 'Only an owner or manager of this branch can connect Usetally' }, 403);
  }

  const store = await admin.from('stores').select('id, name, currency').eq('id', storeId).single();
  if (store.error || !store.data) return json({ error: 'Business branch not found' }, 404);

  let response: Response;
  try {
    response = await fetchWithTimeout(`${usetallyBaseUrl(Deno.env.get('USETALLY_URL'))}/api/pos/link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ code, store_id: store.data.id, store_name: store.data.name, callback_base: callbackBase(url) }),
    });
  } catch {
    return json({ error: 'Usetally could not be reached. Try connecting again.' }, 502);
  }
  if (response.status === 400) {
    return json({ error: await errorMessage(response, 'Code is invalid or expired') }, 400);
  }
  if (!response.ok) {
    return json({ error: await errorMessage(response, `Usetally refused the connection (HTTP ${response.status})`) }, 502);
  }

  let linked: ReturnType<typeof parseLinkResponse> = null;
  try { linked = parseLinkResponse(await response.json()); } catch { linked = null; }
  if (!linked) return json({ error: 'Usetally returned an unexpected response' }, 502);

  const [keyHash, keyEnc] = await Promise.all([sha256Hex(linked.key), encryptLinkKey(linked.key, linkSecret)]);
  const saved = await admin.rpc('usetally_save_link', {
    p_store_id: storeId,
    p_business_id: linked.business.id,
    p_business_name: linked.business.name,
    p_business_currency: linked.business.currency,
    p_key_hash: keyHash,
    p_key_enc: keyEnc,
    p_key_hint: keyHint(linked.key),
    p_actor: actorId,
  });
  if (saved.error) return json({ error: 'The connection could not be saved. Try again.' }, 500);

  const storeCurrency = String(store.data.currency ?? 'NGN').toUpperCase();
  return json({
    connected: true,
    business: { name: linked.business.name, currency: linked.business.currency },
    warning: storeCurrency !== linked.business.currency
      ? `This branch sells in ${storeCurrency} but the Usetally business uses ${linked.business.currency}. Sales will not import until they match.`
      : null,
  });
});
