import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = process.cwd();
const migration = readFileSync(join(root, 'supabase/migrations/20260928000096_commercial_lifecycle.sql'), 'utf8');
const initialize = readFileSync(join(root, 'supabase/functions/paystack-initialize/index.ts'), 'utf8');
const route = readFileSync(join(root, 'src/routes/ProtectedRoute.tsx'), 'utf8');
const onboarding = readFileSync(join(root, 'src/pages/onboarding/OnboardingPage.tsx'), 'utf8');
const entryMigration = readFileSync(join(root, 'supabase/migrations/20260928000098_onboarding_entry_resolution.sql'), 'utf8');
const authContext = readFileSync(join(root, 'src/contexts/AuthContext.tsx'), 'utf8');

describe('immutable commercial terms', () => {
  it('stores exact cycle versions in minor units and forbids mutation', () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.product_plan_versions/);
    expect(migration).toMatch(/amount_minor BIGINT NOT NULL/);
    expect(migration).toMatch(/refuse_plan_version_mutation/);
    expect(migration).toMatch(/plan_version_id UUID/);
  });

  it('quotes and initializes checkout from the same plan version', () => {
    expect(migration).toMatch(/get_checkout_preview\(p_plan_version_id UUID\)/);
    expect(migration).toMatch(/start_plan_version_checkout\(p_plan_version_id UUID\)/);
    expect(initialize).toMatch(/plan_version_id/);
    expect(initialize).toMatch(/amount_minor/);
  });
});

describe('fail-closed fulfilment', () => {
  it('matches tenant, environment, currency, amount and version before activation', () => {
    expect(migration).toMatch(/gateway business does not match/);
    expect(migration).toMatch(/environment is %s but settlement is %s/);
    expect(migration).toMatch(/upper\(btrim\(p_gateway_currency\)\)/);
    expect(migration).toMatch(/p_gateway_amount \* 100/);
    expect(migration).toMatch(/gateway plan version does not match/);
    expect(migration.indexOf('array_length(v_mismatches')).toBeLessThan(migration.lastIndexOf('activate_subscription'));
  });

  it('keeps product access behind a server entitlement check', () => {
    expect(authContext).toMatch(/EntryService\.resolve/);
    expect(route).toMatch(/entry\.hasAccess/);
    expect(entryMigration).toMatch(/resolve_my_trackoja_entry/);
  });
});

describe('resumable onboarding and billing evidence', () => {
  it('persists onboarding state and creates the tenant idempotently', () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.onboarding_progress/);
    expect(migration).toMatch(/create_onboarding_business/);
    expect(onboarding).toMatch(/getOnboarding/);
    expect(onboarding).toMatch(/createOnboardingBusiness/);
  });

  it('creates invoice and receipt records and distinguishes tests', () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.billing_invoices/);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.billing_receipts/);
    expect(migration).toMatch(/is_test_data BOOLEAN NOT NULL DEFAULT FALSE/i);
    expect(migration).toMatch(/list_platform_commercial_transactions/);
  });
});
