// Landing page content rules.
//
// These are the assertions that keep the marketing page honest: the pricing
// baseline, the "two months free" annual discount, the absence of a free plan,
// and the rule that anything the product does not ship yet is marked upcoming.

import { describe, it, expect } from 'vitest';
import {
  BUSINESS_TYPES,
  CAPABILITIES,
  PLANS,
  STEPS,
  billingNote,
  formatNaira,
  monthsFree,
  priceFor,
  type LandingPlan,
} from '../src/pages/landing/landingContent';
import { CATEGORY_CONFIGS } from '../src/config/businessModules';

const byId = (id: string): LandingPlan => {
  const plan = PLANS.find((p) => p.id === id);
  if (!plan) throw new Error(`missing plan: ${id}`);
  return plan;
};

describe('Landing pricing money formatting', () => {
  it('groups thousands with commas and a naira sign', () => {
    expect(formatNaira(22500)).toBe('₦22,500');
    expect(formatNaira(225000)).toBe('₦225,000');
    expect(formatNaira(900000)).toBe('₦900,000');
    expect(formatNaira(700)).toBe('₦700');
  });
});

describe('Landing pricing baseline', () => {
  it('publishes exactly four plans in the agreed order', () => {
    expect(PLANS.map((p) => p.id)).toEqual(['starter', 'standard', 'premium', 'custom']);
    expect(PLANS.map((p) => p.name)).toEqual(['Starter', 'Standard', 'Premium', 'Custom']);
  });

  it('matches the agreed monthly prices', () => {
    expect(byId('starter').monthlyPrice).toBe(5000);
    expect(byId('standard').monthlyPrice).toBe(22500);
    expect(byId('premium').monthlyPrice).toBe(45000);
    expect(byId('custom').monthlyPrice).toBeNull();
  });

  it('matches the agreed annual prices', () => {
    expect(byId('starter').annualPrice).toBe(50000);
    expect(byId('standard').annualPrice).toBe(225000);
    expect(byId('premium').annualPrice).toBe(450000);
    expect(byId('custom').annualPrice).toBeNull();
  });

  it('gives exactly two months free on every paid plan', () => {
    for (const id of ['starter', 'standard', 'premium']) {
      const plan = byId(id);
      expect(monthsFree(plan.monthlyPrice, plan.annualPrice)).toBe(2);
    }
  });

  it('reports no saving for custom pricing', () => {
    const plan = byId('custom');
    expect(monthsFree(plan.monthlyPrice, plan.annualPrice)).toBe(0);
  });

  it('publishes the agreed user limits, with Starter at two logins', () => {
    expect(byId('starter').userLimit).toBe('Up to 2 users');
    expect(byId('standard').userLimit).toBe('Up to 5 users');
    expect(byId('premium').userLimit).toBe('Up to 10 users');
    expect(byId('custom').userLimit).toBe('Custom users');
  });

  it('offers no free plan', () => {
    for (const plan of PLANS) {
      if (plan.monthlyPrice !== null) expect(plan.monthlyPrice).toBeGreaterThan(0);
    }
  });

  it('no longer advertises the retired 90,000 tier', () => {
    const serialised = JSON.stringify(PLANS);
    expect(serialised).not.toContain('90,000');
    expect(serialised).not.toContain('90000');
    expect(serialised).not.toContain('900000');
    expect(serialised).not.toMatch(/Up to 15 users/);
  });

  it('no longer advertises features that left the ladder', () => {
    const serialised = JSON.stringify(PLANS);
    for (const dropped of ['Branches', 'Multi-location stock', 'Approvals', 'Budgeting', 'Deeper financial analysis']) {
      expect(serialised).not.toContain(dropped);
    }
  });

  it('does not mention the withdrawn Standard setup charge', () => {
    const serialised = JSON.stringify(PLANS);
    expect(serialised).not.toContain('150,000');
    expect(serialised).not.toContain('150000');
    expect(serialised.toLowerCase()).not.toContain('setup fee of');
  });

  it('states the agreed onboarding terms', () => {
    const selfServe = 'No setup fee when you add and manage your products yourself.';
    const assisted = 'Implementation is scoped and quoted based on the help required.';
    expect(byId('starter').onboardingNote).toBe(selfServe);
    expect(byId('standard').onboardingNote).toBe(selfServe);
    expect(byId('premium').onboardingNote).toBe(assisted);
    expect(byId('custom').onboardingNote).toBe('Custom implementation.');
  });
});

describe('Landing billing toggle display', () => {
  it('shows a monthly price and label when monthly is selected', () => {
    const price = priceFor(byId('standard'), 'monthly');
    expect(price.amount).toBe('₦22,500');
    expect(price.suffix).toBe('/month');
  });

  it('shows an annual price and label when annual is selected', () => {
    const price = priceFor(byId('standard'), 'annual');
    expect(price.amount).toBe('₦225,000');
    expect(price.suffix).toBe('/year');
  });

  it('keeps Custom as custom pricing in both periods', () => {
    expect(priceFor(byId('custom'), 'monthly')).toEqual({
      amount: 'Custom pricing',
      suffix: '',
    });
    expect(priceFor(byId('custom'), 'annual')).toEqual({
      amount: 'Custom pricing',
      suffix: '',
    });
  });

  it('labels the annual saving in plain language', () => {
    expect(billingNote('annual')).toContain('2 months free');
    expect(billingNote('monthly')).toBe('Billed every month');
  });
});

describe('Landing content accuracy', () => {
  it('marks not-yet-shipped plan features as upcoming instead of claiming them', () => {
    const upcoming = PLANS.flatMap((plan) => plan.features.filter((f) => f.upcoming));
    expect(upcoming.length).toBeGreaterThan(0);

    const standard = byId('standard');
    const expenses = standard.features.find((f) => f.label === 'Expenses and supplier records');
    expect(expenses?.upcoming).toBe(true);
  });

  it('does not mark shipped core features as upcoming', () => {
    const standard = byId('standard');
    for (const label of ['Sales recording and checkout', 'Products and stock']) {
      const feature = standard.features.find((f) => f.label === label);
      expect(feature).toBeDefined();
      expect(feature?.upcoming).toBeFalsy();
    }
  });

  it('keeps every plan card within four to six feature highlights', () => {
    for (const plan of PLANS) {
      expect(plan.features.length).toBeGreaterThanOrEqual(4);
      expect(plan.features.length).toBeLessThanOrEqual(6);
    }
  });

  it('gives every plan a call to action', () => {
    for (const plan of PLANS) {
      expect(plan.ctaLabel.length).toBeGreaterThan(0);
      expect(plan.ctaHref.length).toBeGreaterThan(0);
    }
  });
});

describe('Landing business types', () => {
  it('only offers business types the product can actually configure', () => {
    for (const type of BUSINESS_TYPES) {
      expect(Object.keys(CATEGORY_CONFIGS)).toContain(type.id);
    }
  });

  it('covers the four headline business types', () => {
    expect(BUSINESS_TYPES.map((t) => t.id)).toEqual([
      'general_retail',
      'restaurant',
      'fashion_store',
      'pharmacy',
    ]);
  });

  it('gives every business type a workflow description and preview rows', () => {
    for (const type of BUSINESS_TYPES) {
      expect(type.tabLabel.length).toBeGreaterThan(0);
      expect(type.workflow.length).toBeGreaterThan(0);
      expect(type.rows.length).toBeGreaterThan(0);
    }
  });
});

describe('Landing core capabilities and steps', () => {
  it('keeps the four capability headings in the agreed wording', () => {
    expect(CAPABILITIES.map((c) => c.title)).toEqual([
      'Make every sale count',
      "Know what's in stock",
      'Keep customers close',
      'See the full picture',
    ]);
  });

  it('flags customer and expense gaps rather than claiming them', () => {
    const customers = CAPABILITIES.find((c) => c.title === 'Keep customers close');
    const picture = CAPABILITIES.find((c) => c.title === 'See the full picture');
    expect(customers?.note).toMatch(/in development/i);
    expect(picture?.note).toMatch(/in development/i);
  });

  it('describes setup in three steps', () => {
    expect(STEPS).toHaveLength(3);
    expect(STEPS[0].title).toBe('Create your business account');
    expect(STEPS[1].title).toBe('Choose your business type and add your products');
    expect(STEPS[2].title).toBe('Record sales and manage daily activity');
  });
});
