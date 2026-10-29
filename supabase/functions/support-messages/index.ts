// Edge Function: support-messages ("Message the team" in Support).
// The signed-in user's list / get / start / reply, forwarded to Usetally's
// shared inbox. The shared secret never reaches the browser, and Usetally only
// ever sees this user's own conversations.
//
// Secrets: USETALLY_SUPPORT_SECRET (same value as TRACKOJA_SUPPORT_SECRET on
// Usetally's Vercel), USETALLY_URL (optional, default https://usetally.cc).
// Deploy with JWT verification on (the default).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { fetchWithTimeout, json, usetallyBaseUrl } from '../_shared/usetally.ts';
import { displayName, parseSupportRequest } from '../_shared/support.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Sign in to continue' }, 401);

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const secret = Deno.env.get('USETALLY_SUPPORT_SECRET') ?? '';
  if (!url || !anonKey || !serviceKey) return json({ error: 'Messages are unavailable right now' }, 503);
  if (secret.length < 32) return json({ error: "Messaging the team isn't switched on yet. Email us instead.", notConfigured: true }, 503);

  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: auth, error: authError } = await userClient.auth.getUser();
  if (authError || !auth.user) return json({ error: 'Invalid session' }, 401);

  let raw: Record<string, unknown> | null = null;
  try { raw = await req.json(); } catch { raw = null; }
  const parsed = parseSupportRequest(raw);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const request = parsed.value;

  const admin = createClient(url, serviceKey);
  const email = auth.user.email ?? '';
  const { data: profile } = await admin.from('users').select('first_name, last_name').eq('id', auth.user.id).maybeSingle();
  const user = { id: auth.user.id, email, name: displayName(profile?.first_name, profile?.last_name, email) };

  // the store the message is about: only one this user belongs to
  let store: { name: string } | undefined;
  if (request.action === 'start' && request.storeId) {
    const { data: member } = await admin.from('store_members').select('store_id, stores(name)').eq('store_id', request.storeId).eq('user_id', auth.user.id).eq('status', 'active').maybeSingle();
    const name = (member as { stores?: { name?: string } } | null)?.stores?.name;
    if (name) store = { name };
  }

  const { storeId: _ignored, ...forward } = request as Record<string, unknown>;
  let response: Response;
  try {
    response = await fetchWithTimeout(`${usetallyBaseUrl(Deno.env.get('USETALLY_URL'))}/api/support/trackoja`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...forward, user, store }),
    }, 12000);
  } catch {
    return json({ error: "Couldn't reach the support inbox. Try again." }, 502);
  }
  let data: Record<string, unknown> = {};
  try { data = await response.json(); } catch { data = {}; }
  if (response.status === 401) return json({ error: 'Messaging the team is misconfigured. Email us instead.' }, 502);
  return json(data, response.status);
});
