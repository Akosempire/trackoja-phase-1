// Edge Function: daily-digest. Once a day (pg_cron → daily_jobs_tick, 07:00
// Lagos) emails each opted-in store's owners and managers: yesterday's sales,
// how they were paid, and what's running low. Sent through Usetally's email
// (see _shared/notify.ts). A store gets at most one digest a day.
//
// Secrets: DIGEST_TOKEN (the caller's Bearer token; also Vault 'digest_token'),
// USETALLY_SUPPORT_SECRET, USETALLY_URL (optional), APP_URL (optional, default https://trackoja.cv).
// verify_jwt = false (config.toml): the function checks DIGEST_TOKEN itself.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { json, safeEqual, usetallyBaseUrl } from '../_shared/usetally.ts';
import { digestEmail, sendViaUsetally, type DigestStore } from '../_shared/notify.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const token = Deno.env.get('DIGEST_TOKEN') ?? '';
  const given = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (token.length < 32 || !(await safeEqual(given, token))) return json({ error: 'Unauthorized' }, 401);

  const url = Deno.env.get('SUPABASE_URL'), serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return json({ error: 'Not configured' }, 503);
  const admin = createClient(url, serviceKey);
  const { data, error } = await admin.rpc('daily_digest_data', { p_day: null });
  if (error) return json({ error: 'Could not read the stores' }, 500);

  const base = usetallyBaseUrl(Deno.env.get('USETALLY_URL'));
  const secret = Deno.env.get('USETALLY_SUPPORT_SECRET') ?? '';
  const appUrl = Deno.env.get('APP_URL') || 'https://trackoja.cv';
  let stores = 0, emails = 0, failed = 0;
  for (const s of (data ?? []) as DigestStore[]) {
    let sent = 0;
    for (const r of s.recipients.slice(0, 10)) {
      const out = await sendViaUsetally(digestEmail(s, r, appUrl), { base, secret });
      if (out.sent) sent++; else failed++;
      if (out.status === 401 || out.status === 503) return json({ error: `Usetally refused: ${out.error ?? out.status}`, stores, emails }, 502);
    }
    if (sent) { await admin.rpc('record_digest_sent', { p_store_id: s.store_id, p_day: s.day, p_sent: sent }); stores++; emails += sent; }
  }
  return json({ stores, emails, failed });
});
