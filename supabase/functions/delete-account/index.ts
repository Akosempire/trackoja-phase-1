// Edge Function: delete-account. Settings → Privacy & data → Delete my account.
// prepare_account_deletion() (as the person) refuses while they own a business,
// removes their memberships and scrubs their profile; then their login is
// closed: email replaced, banned, signed out everywhere. Sales they rang up stay
// with the business that owns those records, without their name.
// Deploy with JWT verification on (the default).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { json } from '../_shared/usetally.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Sign in to continue' }, 401);
  const url = Deno.env.get('SUPABASE_URL'), anonKey = Deno.env.get('SUPABASE_ANON_KEY'), serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceKey) return json({ error: 'Unavailable' }, 503);

  let body: { confirm?: string } = {};
  try { body = await req.json(); } catch { body = {}; }
  if (String(body.confirm ?? '').trim().toUpperCase() !== 'DELETE') return json({ error: 'Type DELETE to confirm' }, 400);

  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: auth } = await userClient.auth.getUser();
  if (!auth?.user) return json({ error: 'Invalid session' }, 401);
  const { error } = await userClient.rpc('prepare_account_deletion');
  if (error) return json({ error: error.message }, 400);

  const admin = createClient(url, serviceKey);
  const id = auth.user.id;
  const { error: upd } = await admin.auth.admin.updateUserById(id, {
    email: `deleted-${id}@deleted.invalid`, phone: '', user_metadata: {}, ban_duration: '876000h',
  } as Record<string, unknown>);
  if (upd) return json({ error: 'Your details were removed, but the login could not be closed. Contact support.' }, 500);
  await admin.auth.admin.signOut(authHeader.replace(/^Bearer\s+/i, ''), 'global').catch(() => undefined);
  return json({ deleted: true });
});
