# Free trial rollout

The current default is **payments DISABLED, free trials enabled, 14 days**. Published plan prices remain unchanged. The default applies only when these settings do not already exist.

## Deployment

1. Apply all earlier project migrations through `20260928000102_platform_moniepoint_health.sql`.
2. Apply migrations `20260929000001` through `20260929000004` in order. For a database maintained manually in SQL Editor, run **the entire `supabase/manual/free_trial_onboarding.sql` file instead**. It includes the onboarding pgcrypto fix and all three trial migrations in one transaction. Do not use the verification script as the rollout.
3. Deploy `supabase/functions/paystack-initialize`. With a linked CLI session: `supabase functions deploy paystack-initialize`.
4. Deploy the matching frontend build in `dist`. A Git push alone does not prove that the running website or Edge Function has updated.
5. As a new owner, create a business, select a plan, confirm the free trial, then open the dashboard. Reload and sign in again to confirm that access persists. Test with a disposable business.

If SQL Editor reports an error, the transaction rolls back. Capture the exact database error before continuing. The rollout has **not** been applied to the hosted database by this code change.

### Onboarding: plan availability could not be loaded

The frontend requires the public `get_billing_availability()` RPC. A read-only
probe of the production configuration on 30 September 2026 returned HTTP 404,
code `PGRST202`: PostgREST could not find this function in its schema cache.
This is a database rollout/schema-cache issue, not missing user plan selection.

Run the entire `supabase/manual/free_trial_onboarding.sql` file in the matching
Supabase project's SQL Editor. The file now explicitly reloads the API schema
cache and finishes by returning `billing_availability`. Do not install just the
availability function: trial activation and access enforcement need the rest of
the rollout too. Existing billing settings are preserved.

If the rollout was already successfully applied, the SQL check
`SELECT public.get_billing_availability();` should work; run
`NOTIFY pgrst, 'reload schema';` to refresh the REST API's cache. If the function
is absent in SQL too, apply the full rollout. After the API cache refreshes,
click Retry on onboarding. Do not replace this failure with assumed trial or
payment availability in the browser.

## Administration

Platform **Settings → Operational configuration → Billing and payments** contains:

- `billing.payment_system`: `DISABLED`, `TEST`, or `LIVE`.
- `billing.trial_enabled`: whether eligible owners may start trials.
- `billing.default_trial_days`: integer from 1 to 365. Changing it does not change existing end dates.

These edits require `platform:manage_settings` and use the existing audited settings endpoint. The Integrations page shows availability without claiming a verified provider connection. No credentials are stored in these settings.

The business detail page offers **Extend this trial** to operators with `platform:manage_payments`. Duration and reason are required; the database records the actor, old/new end dates and reason.

Trials use `organization_products.status = 'trialing'`, with a selected plan version, user limit, feature snapshot and dates. They create no payment or invoice. Repeat activation returns the existing trial without resetting its end. Existing paid entitlements cannot be replaced by trials. Product access remains separate.

Expired explicit trials retain access in DISABLED and TEST modes. In LIVE mode, expiry is enforced by entry routing, store-scoped RLS reads and write permissions. Switching to LIVE therefore affects expired trials immediately: review and extend eligible trials before switching. Billing/workspace access remains available. No periodic expiry job is required.

TEST requires an authorised developer grant and a sandbox business at both the database and Edge Function. Merchant checkout remains unavailable in TEST. Test/sandbox transactions are excluded from overview revenue. Existing verification/webhook processing is retained for payments already in flight.

Before LIVE, configure and validate Paystack server secrets and webhooks separately. LIVE is an availability setting, not proof that credentials work; initialization also checks the provider mode and configuration.

## Verification performed

- TypeScript production build and ESLint.
- UI/service tests for DISABLED/TEST trial activation without a payment call, LIVE price review, availability retry, activation failures and safe payment errors.
- Existing unit regression suite and desktop/tablet/mobile layout fixtures in both themes.
- All non-storage project migrations applied in a disposable PGlite PostgreSQL runtime with pgcrypto, Supabase-like roles/default grants, and an auth schema fixture. The manual rollout was also rerun successfully.
- `supabase/verification/free_trial_verification.sql` executed against that runtime: onboarding, explicit activation, idempotency, seat cap, product isolation, disabled checkout, expiry, tenant restrictions, admin extension/audit, admin reporting and paid-access preservation. Its transaction rolls back test data.

The local database harness does not emulate Supabase Auth, Storage, PostgREST or hosted Edge Functions. Hosted migration application, authenticated browser journeys on the public website and real gateway requests still require deployment verification. No real payment was attempted.

## Related interface changes

The same update standardises product/customer searches with the existing field tokens, aligns inventory actions, adds searchable payment tables with advanced filters, simplifies the platform billing navigation and clarifies developer access wording. These reuse the existing design system. The responsive layout fixtures cover 320–1440px; this is not a claim that every live role and business account was inspected.
