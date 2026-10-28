// Edge Function: usetally-catalog (docs/USETALLY_CONNECT.md section 4)
// GET <callback_base>/usetally-catalog?q=<search>&limit=50
// Authorization: Bearer utpos_... (the link key; matched by SHA-256, revoked -> 401)
// -> { products: [{ id, name, sku, barcode, unit, price_minor, stock_qty, track_inventory }] }
// Active products of the linked store, in name order. Called by Usetally, never
// by a browser session, so deploy with --no-verify-jwt (config.toml).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { authenticateLink, catalogProduct, json, likePattern, parseCatalogQuery } from '../_shared/usetally.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return json({ error: 'Catalog is unavailable' }, 503);
  const admin = createClient(url, serviceKey);

  const link = await authenticateLink(admin, req);
  if (!link) return json({ error: 'Unauthorized' }, 401);

  const { q, limit } = parseCatalogQuery(new URL(req.url));
  let query = admin.from('products')
    .select('id, name, sku, barcode, unit, selling_price, stock_qty, track_inventory')
    .eq('store_id', link.store_id)
    .eq('status', 'active')
    .order('name', { ascending: true })
    .limit(limit);
  if (q) {
    const pattern = likePattern(q).replace(/[,()]/g, ' ');
    query = query.or(`name.ilike.${pattern},sku.ilike.${pattern},barcode.ilike.${pattern}`);
  }
  const { data, error } = await query;
  if (error) return json({ error: 'Could not load products' }, 500);
  return json({ products: (data ?? []).map(catalogProduct) });
});
