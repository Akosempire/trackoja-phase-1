# Daily email, Privacy & data, and Usage

Migration: `supabase/migrations/20261030004001_account_usage_digest.sql`.

## Email (through Usetally)
TrackOja has no email provider of its own. Edge Functions post to Usetally's
`POST /api/notify/trackoja` with `Authorization: Bearer USETALLY_SUPPORT_SECRET`
(the same value as `TRACKOJA_SUPPORT_SECRET` on Usetally's Vercel). Usetally sends
with its own email setup, branded TrackOja, one recipient per call, rate limited.

## Daily email (`daily-digest`)
Each morning (07:00 Lagos) owners and managers get yesterday's sales, how they
were paid, and products at or below their reorder level. Off per store in
Settings → Daily email. At most one a day per store (`digest_log`).

Setup:
1. Edge Function secrets: `DIGEST_TOKEN` (random, 32+ characters), `USETALLY_SUPPORT_SECRET`,
   optional `APP_URL` (default https://trackoja.cv), optional `USETALLY_URL`.
2. Deploy: `npx supabase functions deploy daily-digest delete-account` (daily-digest has verify_jwt = false).
3. SQL editor, once: `select vault.create_secret('<DIGEST_TOKEN value>', 'digest_token');`
   (`usetally_project_url` is already set for the Usetally sync; if not:
   `select vault.create_secret('https://<project-ref>.supabase.co', 'usetally_project_url');`).
   The migration schedules `daily_jobs_tick()` with pg_cron (also purges businesses due for deletion).

## Privacy & data (Settings)
- Download this store's data: `export_store_data` (owner/manager) → Excel, one sheet per record type.
- Delete business (owner, typed name): deleted 30 days later by `purge_due_businesses()`; cancel any time before.
- Delete my account (`delete-account`): refused while you own a business; removes memberships,
  scrubs name/email/phone, bans the login. Sales they rang up stay with the business.

## Usage (Platform → Usage)
`usage_daily` counts active time per person, store, day and screen (tab visible,
active in the last 2 minutes; 5 min per call, 16 h a day max; platform staff not counted).
