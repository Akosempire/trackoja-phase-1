// Saving a plan must not quietly change which billing cycle it is sold on.
//
// Migration 089 added `product_plans.billing_cycle` and gave
// `upsert_product_plan` a `p_billing_cycle` parameter that DEFAULTS to 'monthly'
// and is written unconditionally. A caller that does not know about the column
// therefore rewrites an annual or custom plan as monthly on any unrelated edit —
// a silent data change to the commercial terms of a live product. These tests
// pin the guard that prevents it.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  calls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  plans: [] as Record<string, unknown>[],
}));

vi.mock('../src/config/supabase', () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      harness.calls.push({ fn, args });
      if (fn === 'list_product_plans') {
        return Promise.resolve({ data: harness.plans, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

import { PlatformAdminService } from '../src/services/platformAdmin.service';

function storedPlan(key: string, billingCycle: string) {
  return {
    id: `plan-${key}`,
    product_id: 'product-1',
    product_key: 'trackoja',
    product_name: 'TrackOja',
    key,
    name: key,
    description: null,
    monthly_price: 5000,
    annual_price: 50000,
    currency: 'NGN',
    user_limit: 2,
    features: [],
    onboarding_note: null,
    status: 'active',
    is_default: true,
    is_public: true,
    sort_order: 1,
    subscriber_count: 0,
    updated_at: null,
    billing_cycle: billingCycle,
  };
}

function upsertCall() {
  return harness.calls.find((call) => call.fn === 'upsert_product_plan');
}

describe('savePlan preserves the billing cycle', () => {
  beforeEach(() => {
    harness.calls.length = 0;
    harness.plans = [];
  });

  it('sends the stored cycle when the caller omits it', async () => {
    harness.plans = [storedPlan('standard', 'annual')];

    await PlatformAdminService.savePlan({
      productKey: 'trackoja',
      planKey: 'standard',
      name: 'Standard',
      monthlyPrice: 22500,
    });

    expect(upsertCall()?.args.p_billing_cycle).toBe('annual');
  });

  it('does not reset a custom cycle on an unrelated edit', async () => {
    harness.plans = [storedPlan('custom', 'custom')];

    await PlatformAdminService.savePlan({
      productKey: 'trackoja',
      planKey: 'custom',
      name: 'Custom',
      description: 'Updated description only',
    });

    expect(upsertCall()?.args.p_billing_cycle).toBe('custom');
  });

  it('honours an explicit change of cycle', async () => {
    harness.plans = [storedPlan('starter', 'monthly')];

    await PlatformAdminService.savePlan({
      productKey: 'trackoja',
      planKey: 'starter',
      name: 'Starter',
      billingCycle: 'annual',
    });

    expect(upsertCall()?.args.p_billing_cycle).toBe('annual');
  });

  it('starts a brand new plan on monthly, which is the documented default', async () => {
    harness.plans = [];

    await PlatformAdminService.savePlan({
      productKey: 'trackoja',
      planKey: 'brand_new',
      name: 'Brand new',
    });

    expect(upsertCall()?.args.p_billing_cycle).toBe('monthly');
  });

  it('reads the stored value before writing, rather than after', async () => {
    harness.plans = [storedPlan('standard', 'annual')];

    await PlatformAdminService.savePlan({ productKey: 'trackoja', planKey: 'standard', name: 'Standard' });

    const order = harness.calls.map((call) => call.fn);
    expect(order).toEqual(['list_product_plans', 'upsert_product_plan']);
  });

  it('exposes the cycle on the plan it returns so a form can show it', async () => {
    harness.plans = [storedPlan('standard', 'annual')];

    const plans = await PlatformAdminService.listPlans('trackoja');

    expect(plans[0].billingCycle).toBe('annual');
  });

  it('falls back to monthly when the column is absent from an older response', async () => {
    const legacy = storedPlan('starter', 'monthly');
    delete legacy.billing_cycle;
    harness.plans = [legacy];

    const plans = await PlatformAdminService.listPlans('trackoja');

    expect(plans[0].billingCycle).toBe('monthly');
  });
});
