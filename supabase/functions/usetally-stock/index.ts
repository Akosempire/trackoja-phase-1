// Edge Function: usetally-stock (docs/USETALLY_CONNECT.md section 4)
// POST <callback_base>/usetally-stock   Authorization: Bearer utpos_...
// { document_id, number, lines: [{ product_id, quantity }] }
// -> 200 { applied: true, skipped: [...] } | { applied: false, reason: "already applied" }
// Deducts stock for a Usetally invoice that became fully paid. Idempotent on
// document_id. Each line becomes a 'sale' inventory movement with reason
// "Usetally invoice <number>" through public.usetally_apply_stock(), which uses
// the same movement core as create_sale; stock may go negative. Lines naming a
// product outside the linked store, or one that does not track stock, are skipped
// and listed in `skipped`. Deploy with --no-verify-jwt (config.toml).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { authenticateLink, json, parseStockRequest } from '../_shared/usetally.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return json({ error: 'Stock service is unavailable' }, 503);
  const admin = createClient(url, serviceKey);

  const link = await authenticateLink(admin, req);
  if (!link) return json({ error: 'Unauthorized' }, 401);

  let body: unknown;
  try { body = await req.json(); } catch { return json({ error: 'A JSON body is required' }, 400); }
  const parsed = parseStockRequest(body);
  if (!parsed.ok) return json({ error: parsed.error }, 422);

  const { data, error } = await admin.rpc('usetally_apply_stock', {
    p_store_id: link.store_id,
    p_document_id: parsed.value.document_id,
    p_number: parsed.value.number,
    p_lines: parsed.value.lines,
  });
  if (error) return json({ error: 'Stock could not be updated' }, 500);
  return json(data);
});
