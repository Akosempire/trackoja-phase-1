// Edge Function: media-upload-url
// Hands the signed-in user a 10-minute upload link for one product photo on
// Cloudflare R2. The R2 keys never leave the server. Needs product:create or
// product:update on the store. Returns 503 { error, fallback: true } when R2
// isn't configured, and the app then uploads to Supabase Storage as before.
//
// Secrets: R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_PUBLIC_URL
// Deploy with JWT verification on (the default).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { checkPhoto, productPhotoUpload, r2Config } from '../_shared/r2.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Sign in to continue' }, 401);

  const cfg = r2Config((n) => Deno.env.get(n));
  if (!cfg) return json({ error: 'Photo storage is not set up', fallback: true }, 503);

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anonKey) return json({ error: 'Upload service is unavailable' }, 503);
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return json({ error: 'Invalid session' }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'A JSON body is required' }, 400); }
  if (typeof body.storeId !== 'string' || !UUID.test(body.storeId)) return json({ error: 'Choose a business branch' }, 400);
  const photo = checkPhoto(body.contentType, body.size);
  if ('error' in photo) return json({ error: photo.error }, 400);

  for (const permission of ['product:update', 'product:create']) {
    const { data } = await userClient.rpc('user_has_permission', { p_user_id: authData.user.id, p_store_id: body.storeId, p_permission_name: permission });
    if (data === true) {
      const out = await productPhotoUpload(cfg, body.storeId, String(body.contentType), photo.ext);
      return json({ uploadUrl: out.uploadUrl, publicUrl: out.publicUrl });
    }
  }
  return json({ error: 'You do not have permission to change products in this branch' }, 403);
});
