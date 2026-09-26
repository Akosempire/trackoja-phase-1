// Multi-product platform invariants.
//
// These tests read the actual seed and function migrations as text, so they fail
// if the agreed pricing ladder, the plan retirements, or the cross-product
// isolation rule drift. They are deliberately about the SQL that ships, not
// about a re-implementation of it.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations');

const seed = readFileSync(join(MIGRATIONS, '20260926000068_platform_products_seed.sql'), 'utf8');
const ladder = readFileSync(join(MIGRATIONS, '20260926000074_platform_products_plan_ladder.sql'), 'utf8');
const productsSchema = readFileSync(join(MIGRATIONS, '20260926000063_platform_products_schema.sql'), 'utf8');
const productsFunctions = readFileSync(
  join(MIGRATIONS, '20260926000069_platform_products_functions.sql'),
  'utf8'
);

/** Pull `monthly::numeric, annual::numeric, seats` out of a seeded plan tuple. */
function paidTier(planKey: string): { monthly: number; annual: number; seats: number } {
  const pattern = new RegExp(
    `'${planKey}',\\s*'[^']*',\\s*'[^']*',\\s*(\\d+)::numeric,\\s*(\\d+)::numeric,\\s*(\\d+),`
  );
  const match = seed.match(pattern);
  if (!match) throw new Error(`seeded tier not found: ${planKey}`);
  return { monthly: Number(match[1]), annual: Number(match[2]), seats: Number(match[3]) };
}

describe('TrackOja pricing ladder (068 seed, as restructured by 074)', () => {
  it('publishes Starter, Standard, and the tier that becomes Premium', () => {
    expect(paidTier('starter')).toMatchObject({ monthly: 5000, annual: 50000, seats: 2 });
    expect(paidTier('standard')).toMatchObject({ monthly: 22500, annual: 225000, seats: 5 });
    // 068 seeds this row as 'professional'; 074 renames it to Premium in place,
    // so its own price, seat limit, and features carry over unchanged.
    expect(paidTier('professional')).toMatchObject({ monthly: 45000, annual: 450000, seats: 10 });
  });

  it('gives every paid tier exactly two months free on annual billing', () => {
    for (const key of ['starter', 'standard', 'professional']) {
      const tier = paidTier(key);
      expect(tier.annual).toBe(tier.monthly * 10);
    }
  });

  it('keeps the custom tier on custom pricing rather than a number', () => {
    // Seeded as 'enterprise', renamed to Custom by 074.
    expect(seed).toMatch(/'enterprise',\s*'Enterprise',\s*'[^']*',\s*NULL,\s*NULL,\s*NULL,/);
  });

  it('sells no free tier', () => {
    for (const key of ['starter', 'standard', 'professional']) {
      expect(paidTier(key).monthly).toBeGreaterThan(0);
    }
  });
});

describe('Final ladder restructure (074)', () => {
  it('renames Professional to Premium in place', () => {
    expect(ladder).toMatch(/SET key = 'premium',\s*\n\s*name = 'Premium',/);
    expect(ladder).toMatch(/AND pp\.key = 'professional'/);
  });

  it('renames Enterprise to Custom', () => {
    expect(ladder).toMatch(/SET key = 'custom',\s*\n\s*name = 'Custom',/);
    expect(ladder).toMatch(/AND pp\.key = 'enterprise'/);
  });

  it('retires the 90,000 tier and frees its key first', () => {
    expect(ladder).toMatch(/SET key = 'premium_90k',\s*\n\s*status = 'retired',/);
    // The rename to 'premium' must not collide, so 90k is re-keyed first.
    expect(ladder.indexOf("key = 'premium_90k'")).toBeLessThan(ladder.indexOf("key = 'premium',"));
  });

  it('does not carry the 90,000 price into any published tier', () => {
    expect(ladder).not.toMatch(/90000::numeric|900000::numeric/);
  });

  it('removes the features that left the ladder from the catalogue', () => {
    for (const dropped of [
      '"key":"branches"',
      '"key":"multi_location_stock"',
      '"key":"approvals"',
      '"key":"budgeting"',
      '"key":"financial_analysis"',
    ]) {
      expect(ladder).not.toContain(dropped);
    }
    // The features the published tiers do offer remain.
    expect(ladder).toContain('"key":"dedicated_support"');
    expect(ladder).toContain('"key":"performance_reports"');
  });

  it('publishes exactly the four agreed tiers', () => {
    expect(ladder).toContain('"starter","standard","premium","custom"');
    expect(ladder).toMatch(/expected exactly 4 active public tiers/);
  });

  it('fails loudly if the ladder does not match the agreed figures', () => {
    expect(ladder).toMatch(/RAISE EXCEPTION 'Ladder check failed for %: expected one active public tier/);
    expect(ladder).toMatch(/\('premium',\s*45000::numeric,\s*450000::numeric,\s*10\)/);
  });
});

describe('Legacy plan retirement', () => {
  it('retires Free and the old 15,000 Pro plan', () => {
    expect(seed).toMatch(/SET status = 'inactive'\s*\nWHERE name IN \('Free', 'Pro'\)/);
  });

  it('corrects the Starter seat limit to the agreed two', () => {
    expect(seed).toMatch(/team_members', 2/);
  });

  it('starts new businesses on the paid entry tier, not a free plan', () => {
    const trigger = seed.slice(seed.indexOf('handle_new_organization_subscription'));
    expect(trigger).toMatch(/WHERE name = 'Starter' AND status = 'active'/);
    expect(trigger).not.toMatch(/WHERE name = 'Free'/);
  });
});

describe('Cross-product isolation', () => {
  it('seeds TrackOja as public and TrackOja Works as not yet sellable', () => {
    expect(seed).toMatch(/'trackoja',\s*\n?\s*'TrackOja',/);
    expect(seed).toMatch(/'trackoja_works',\s*\n?\s*'TrackOja Works',/);
    // TrackOja Works is inactive + private, and carries no invented features.
    const worksBlock = seed.slice(seed.indexOf("'trackoja_works'"));
    expect(worksBlock).toMatch(/'inactive',\s*\n\s*'private',\s*\n\s*'\[\]'::jsonb,/);
  });

  it('attaches seeded plans to TrackOja only', () => {
    expect(seed).toMatch(/WHERE p\.key = 'trackoja'\s*\nON CONFLICT \(product_id, key\) DO NOTHING/);
  });

  it('gives a new business an entitlement for TrackOja only', () => {
    const fn = seed.slice(
      seed.indexOf('handle_new_organization_product_entitlement'),
      seed.indexOf('DROP TRIGGER IF EXISTS on_organization_created_product_entitlement')
    );
    expect(fn).toMatch(/WHERE tp\.key = 'trackoja'/);
    expect(fn).not.toMatch(/trackoja_works/);
  });

  it('creates exactly one entitlement per business per product', () => {
    expect(productsSchema).toMatch(/UNIQUE \(org_id, product_id\)/);
  });

  it('snapshots the agreed price so later plan edits cannot change an existing deal', () => {
    expect(productsSchema).toMatch(/agreed_monthly_price NUMERIC\(14,2\)/);
    expect(productsSchema).toMatch(/agreed_user_limit INTEGER/);
  });
});

describe('Server-side enforcement', () => {
  it('gates platform functions on an explicit permission', () => {
    expect(productsFunctions).toMatch(
      /CREATE OR REPLACE FUNCTION public\.require_platform_permission\(p_permission TEXT\)/
    );
    // A null actor is rejected before any permission is consulted.
    expect(productsFunctions).toMatch(/RAISE EXCEPTION 'Authentication required'/);
    expect(productsFunctions).toMatch(/RAISE EXCEPTION 'Permission denied: % required'/);
  });

  it('enforces the seat limit and subscription state on store_members', () => {
    expect(productsFunctions).toMatch(
      /CREATE TRIGGER enforce_seat_limit_on_store_members\s*\n\s*BEFORE INSERT ON public\.store_members/
    );
    expect(productsFunctions).toMatch(/Seat limit reached for this plan/);
    expect(productsFunctions).toMatch(/has no active subscription/);
  });

  it('exempts only sandbox businesses from seat enforcement', () => {
    const fn = productsFunctions.slice(productsFunctions.indexOf('CREATE OR REPLACE FUNCTION public.enforce_seat_limit'));
    expect(fn).toMatch(/IF v_org_id IS NULL OR v_is_sandbox THEN\s*\n\s*RETURN NEW;/);
  });

  it('journals every plan change', () => {
    expect(productsFunctions).toMatch(/INSERT INTO public\.product_plan_revisions/);
    expect(productsFunctions).toMatch(/CREATE OR REPLACE FUNCTION public\.list_plan_revisions/);
  });

  it('excludes sandbox records from production revenue', () => {
    expect(productsFunctions).toMatch(/st\.is_sandbox = FALSE/);
    expect(productsFunctions).toMatch(/o\.is_sandbox = FALSE/);
  });

  it('super admins hold every permission while legacy admins do not', () => {
    const rbac = readFileSync(join(MIGRATIONS, '20260926000067_platform_admin_rbac_seed.sql'), 'utf8');
    expect(rbac).toMatch(/IF v_level = 'super_admin' THEN\s*\n\s*RETURN TRUE;/);
    expect(rbac).toMatch(
      /RETURN p_permission_key IN \('platform:view', 'platform:support', 'platform:manage_businesses'\)/
    );
  });
});
