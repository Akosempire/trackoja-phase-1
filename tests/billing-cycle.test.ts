// tests/billing-cycle.test.ts
//
// Guards the annual-payment defect that migration 094 fixes, because the code
// that carries the fix is SQL and cannot be exercised by a unit test here.
//
// The defect: activate_subscription derived the subscription period from the
// LEGACY mirror row's billing_interval. subscription_plans.name is UNIQUE, so one
// plan name holds one interval, and an annual purchase of Starter charged
// NGN 225,000 and then activated a ONE MONTH period.
//
// These are source-level contract tests. They do not prove the database behaves
// correctly - `supabase/verification/checkout_cycle_verification.sql` measures
// that against the live database, including a real annual purchase - but they do
// fail loudly if the ordering that makes it correct is ever reversed, which is the
// kind of edit that looks harmless in review.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');
const MIGRATION_PATH = join(ROOT, 'supabase/migrations/20260927000094_checkout_records_its_cycle.sql');
const VERIFICATION_PATH = join(ROOT, 'supabase/verification/checkout_cycle_verification.sql');
const SERVICE_PATH = join(ROOT, 'src/services/subscription.service.ts');
const BILLING_PAGE_PATH = join(ROOT, 'src/pages/billing/BillingPage.tsx');

const migration = readFileSync(MIGRATION_PATH, 'utf8');
const verification = readFileSync(VERIFICATION_PATH, 'utf8');
const service = readFileSync(SERVICE_PATH, 'utf8');
const billingPage = readFileSync(BILLING_PAGE_PATH, 'utf8');

describe('the transaction is the record of what was bought', () => {
  it('adds a billing_cycle column with a CHECK that admits only the two real cycles', () => {
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS billing_cycle TEXT/);
    expect(migration).toMatch(/CHECK \(billing_cycle IS NULL OR billing_cycle IN \('monthly', 'annual'\)\)/);
  });

  it('adds product_plan_id, because name matching cannot tell a published plan from a retired one', () => {
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS product_plan_id UUID/);
    expect(migration).toMatch(
      /FOREIGN KEY \(product_plan_id\) REFERENCES public\.product_plans\(id\) ON DELETE SET NULL/,
    );
  });

  it('lets NULL through, so a pre-094 row is not forced to carry a guess', () => {
    // A NOT NULL column would have to invent a value for rows that predate the
    // question, and a wrong cycle is worse than an absent one.
    expect(migration).not.toMatch(/billing_cycle TEXT NOT NULL/);
    expect(migration).not.toMatch(/product_plan_id UUID NOT NULL/);
  });

  it('writes both columns on the pending transaction the checkout creates', () => {
    expect(migration).toMatch(
      /product_id, is_sandbox, billing_cycle, product_plan_id\s*\n\s*\) VALUES \(/,
    );
    expect(migration).toMatch(/v_cycle, v_plan\.id\s*\n\s*\)\s*\n\s*RETURNING \* INTO v_txn/);
  });
});

describe('activate_subscription reads the transaction before the legacy mirror', () => {
  it('prefers the transaction\'s own cycle, falling back to the legacy interval', () => {
    expect(migration).toMatch(
      /v_cycle := COALESCE\(\s*\n\s*v_txn\.billing_cycle,\s*\n\s*CASE v_plan\.billing_interval/,
    );
  });

  it('derives the period from that cycle and never from the mirror directly', () => {
    expect(migration).toMatch(/v_period_end := CASE v_cycle\s*\n\s*WHEN 'annual' THEN now\(\) \+ INTERVAL '1 year'/);
    // The 092 defect in one line: reading the mirror's interval first. If this
    // ever comes back, an annual purchase buys a month again.
    expect(migration).not.toMatch(/v_period_end := CASE v_plan\.billing_interval/);
  });

  it('resolves the entitlement plan from the transaction before falling back to name matching', () => {
    const planLookup = migration.indexOf('IF v_txn.product_plan_id IS NOT NULL THEN');
    const nameMatch = migration.indexOf('AND (lower(pp.key) = lower(v_plan.name) OR lower(pp.name) = lower(v_plan.name))');
    expect(planLookup).toBeGreaterThan(-1);
    expect(nameMatch).toBeGreaterThan(-1);
    expect(planLookup).toBeLessThan(nameMatch);
  });

  it('keeps the signature and return type the Paystack webhook calls', () => {
    // Changing either breaks settlement for every customer rather than failing
    // loudly, so both are asserted inside the migration itself as well.
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.activate_subscription\(/);
    expect(migration).toMatch(/RETURNS public\.subscriptions/);
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.activate_subscription\(TEXT, JSONB, TIMESTAMP WITH TIME ZONE\) FROM PUBLIC, anon, authenticated/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.activate_subscription\(TEXT, JSONB, TIMESTAMP WITH TIME ZONE\) TO service_role/);
  });

  it('keeps start_plan_checkout callable by a signed-in customer and by nobody else', () => {
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.start_plan_checkout\(UUID, TEXT\) FROM PUBLIC, anon, authenticated/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.start_plan_checkout\(UUID, TEXT\) TO authenticated/);
  });
});

describe('the verification measures the defect rather than describing it', () => {
  it('buys annually and asserts a year comes back', () => {
    expect(verification).toMatch(/an ANNUAL purchase activates an annual period/);
    expect(verification).toMatch(/v_sub\.current_period_end >= now\(\) \+ INTERVAL '360 days'/);
  });

  it('asserts the monthly path is unchanged', () => {
    expect(verification).toMatch(/a monthly purchase still activates a monthly period/);
    expect(verification).toMatch(/the cycle argument defaults to monthly/);
  });

  it('proves the fallback for rows that carry no cycle', () => {
    expect(verification).toMatch(/a NULL-cycle row \(pre-094 and legacy\) still uses the legacy interval/);
  });

  it('buffers its results outside the rolled-back fixture block', () => {
    // A savepoint rollback erases temporary-table rows too, so results written
    // from inside the fixture block would be erased with it - and the check would
    // report nothing while appearing to pass.
    expect(verification).toMatch(/v_measured := v_measured \|\| jsonb_build_object/);
    expect(verification).toMatch(/RAISE EXCEPTION 'ROLLBACK:VERIFY094'/);
    const rollbackAt = verification.indexOf("RAISE EXCEPTION 'ROLLBACK:VERIFY094'");
    const writeOutAt = verification.indexOf('INSERT INTO zz_cycle_results (step, check_name, passed, detail)');
    expect(writeOutAt).toBeGreaterThan(rollbackAt);
  });

  it('checks that it left nothing behind', () => {
    expect(verification).toMatch(/no verification transaction survived the rollback/);
    expect(verification).toMatch(/no fake settled payment survived the rollback/);
    expect(verification).toMatch(/no verification mirror row survived the rollback/);
  });
});

describe('the customer page offers the cycle it can now bill', () => {
  it('passes the chosen cycle to the checkout', () => {
    expect(billingPage).toMatch(/SubscriptionService\.startPlanCheckout\(\s*\n\s*plan\.id,\s*\n\s*cycle,/);
  });

  it('does not disable annual with an apology instead of charging it', () => {
    // This is the control 092 added to stop an annual charge activating a monthly
    // period. It must not come back unless the payment path regresses with it, and
    // then only together with the reason.
    expect(billingPage).not.toMatch(/Annual coming soon/);
    expect(billingPage).not.toMatch(/annualNotYetBillable/);
  });

  it('still lets a customer compare the two cycles', () => {
    expect(billingPage).toMatch(/onClick=\{\(\) => setCycle\('annual'\)\}/);
    expect(billingPage).toMatch(/onClick=\{\(\) => setCycle\('monthly'\)\}/);
  });

  it('sends the cycle the user chose to the RPC that records it', () => {
    expect(service).toMatch(/supabase\.rpc\('start_plan_checkout'/);
    expect(service).toMatch(/p_billing_cycle: billingCycle/);
  });
});
