// Landing page content rules.
//
// These are the assertions that keep the marketing page honest: the money
// formatting, the "two months free" annual discount, the mapping from the
// published plan catalogue onto a pricing card, and the rule that anything the
// product does not ship yet is marked upcoming.
//
// The price ladder itself is deliberately NOT asserted here. It lives in the
// published catalogue (`product_plans`, read through `list_published_plans`), and
// a second copy of it in this repo — including in a test — is exactly the
// duplicate that drifted from what customers were charged. What is asserted is
// the contract: the helpers, the mapping, and the absence of a price literal in
// the landing source. The last one is the test that stops the duplicate coming
// back.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  BUSINESS_TYPES,
  CAPABILITIES,
  CONTACT_EMAIL,
  STEPS,
  billingNote,
  ctaFor,
  formatNaira,
  isCustomPriced,
  monthsFree,
  priceFor,
  recommendedPlanId,
  seatLabel,
  toPricingPlan,
  toPricingPlans,
} from '../src/pages/landing/landingContent';
import type { PublishedPlan } from '../src/services/subscription.service';
import { CATEGORY_CONFIGS } from '../src/config/businessModules';

const LANDING_DIR = join(process.cwd(), 'src', 'pages', 'landing');

const contentSource = readFileSync(join(LANDING_DIR, 'landingContent.ts'), 'utf8');
const pageSource = readFileSync(join(LANDING_DIR, 'LandingPage.tsx'), 'utf8');

/** A field-complete `PublishedPlan`, so a fixture only states what it is about. */
function published(overrides: Partial<PublishedPlan> = {}): PublishedPlan {
  return {
    id: 'plan-id',
    productKey: 'trackoja',
    productName: 'TrackOja',
    key: 'plan-key',
    name: 'Plan',
    description: 'Description supplied by the catalogue.',
    monthlyPrice: 1000,
    annualPrice: 10000,
    currency: 'NGN',
    billingCycle: 'monthly',
    userLimit: 2,
    storeLimit: 1,
    features: [],
    onboardingNote: null,
    setupFee: null,
    trialDays: 14,
    isDefault: false,
    sortOrder: 1,
    publishedAt: '2026-01-01T00:00:00.000Z',
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * A stand-in catalogue. The figures are deliberately arbitrary: these tests
 * assert fidelity to whatever the catalogue published, not any particular
 * ladder, so that no agreed price is frozen here a second time.
 */
const CATALOGUE: PublishedPlan[] = [
  published({
    id: 'p-starter',
    key: 'starter',
    name: 'Starter',
    monthlyPrice: 4000,
    annualPrice: 40000,
    userLimit: 2,
    sortOrder: 1,
    features: [
      { key: 'sales', label: 'Sales recording and checkout' },
      { key: 'expenses', label: 'Expenses and supplier records', upcoming: true },
    ],
    onboardingNote: 'No setup fee when you add and manage your products yourself.',
  }),
  published({
    id: 'p-standard',
    key: 'standard',
    name: 'Standard',
    monthlyPrice: 12000,
    annualPrice: 120000,
    userLimit: 5,
    sortOrder: 2,
    features: [
      { key: 'sales', label: 'Sales recording and checkout' },
      { key: 'reports', label: 'Sales and inventory reports' },
    ],
  }),
  published({
    id: 'p-premium',
    key: 'premium',
    name: 'Premium',
    description: null,
    monthlyPrice: 30000,
    annualPrice: 300000,
    userLimit: 10,
    sortOrder: 3,
    features: [{ key: 'staff', label: 'Staff management' }],
  }),
  published({
    id: 'p-custom',
    key: 'custom',
    name: 'Custom',
    monthlyPrice: null,
    annualPrice: null,
    userLimit: null,
    sortOrder: 4,
    features: [{ key: 'integrations', label: 'Integrations' }],
    onboardingNote: null,
  }),
];

const displayed = () => toPricingPlans(CATALOGUE);

const one = (id: string) => {
  const plan = displayed().find((p) => p.id === id);
  if (!plan) throw new Error(`missing mapped plan: ${id}`);
  return plan;
};

const fromCatalogue = (id: string) => {
  const plan = CATALOGUE.find((p) => p.id === id);
  if (!plan) throw new Error(`missing catalogue plan: ${id}`);
  return plan;
};

describe('Landing pricing money formatting', () => {
  it('groups thousands with commas and a naira sign', () => {
    expect(formatNaira(22500)).toBe('₦22,500');
    expect(formatNaira(225000)).toBe('₦225,000');
    expect(formatNaira(900000)).toBe('₦900,000');
    expect(formatNaira(700)).toBe('₦700');
  });

  it('rounds to whole naira rather than printing fractions', () => {
    expect(formatNaira(1234.4)).toBe('₦1,234');
    expect(formatNaira(1234.6)).toBe('₦1,235');
  });

  it('shows a zero price as zero instead of hiding it', () => {
    expect(formatNaira(0)).toBe('₦0');
  });
});

describe('Landing pricing derivations', () => {
  it('gives exactly two months free when annual is ten monthly payments', () => {
    expect(monthsFree(4000, 40000)).toBe(2);
    expect(monthsFree(12000, 120000)).toBe(2);
    expect(monthsFree(30000, 300000)).toBe(2);
  });

  it('reports no saving when the annual price is no discount at all', () => {
    expect(monthsFree(5000, 60000)).toBe(0);
    expect(monthsFree(5000, 70000)).toBe(-2);
  });

  it('reports no saving for custom pricing', () => {
    expect(monthsFree(null, null)).toBe(0);
    expect(monthsFree(null, 100000)).toBe(0);
    expect(monthsFree(5000, null)).toBe(0);
  });

  it('reports no saving on a zero monthly price rather than dividing by it', () => {
    expect(monthsFree(0, 0)).toBe(0);
    expect(monthsFree(0, 50000)).toBe(0);
  });

  it('treats a plan missing either price as custom-priced', () => {
    expect(isCustomPriced({ monthlyPrice: 5000, annualPrice: 50000 })).toBe(false);
    expect(isCustomPriced({ monthlyPrice: null, annualPrice: null })).toBe(true);
    expect(isCustomPriced({ monthlyPrice: null, annualPrice: 50000 })).toBe(true);
    expect(isCustomPriced({ monthlyPrice: 5000, annualPrice: null })).toBe(true);
  });

  it('turns a published seat limit into a seat label', () => {
    expect(seatLabel(2)).toBe('Up to 2 users');
    expect(seatLabel(5)).toBe('Up to 5 users');
    expect(seatLabel(10)).toBe('Up to 10 users');
  });

  it('writes a one-seat limit in the singular', () => {
    expect(seatLabel(1)).toBe('Up to 1 user');
  });

  it('says the seats are negotiated when the catalogue publishes no limit', () => {
    expect(seatLabel(null)).toBe('Custom users');
    expect(seatLabel(0)).toBe('Custom users');
  });

  it('labels the billing cycle in plain language', () => {
    expect(billingNote('annual')).toContain('2 months free');
    expect(billingNote('monthly')).toBe('Billed every month');
  });
});

describe('Landing billing toggle display', () => {
  it('shows a monthly price and label when monthly is selected', () => {
    const price = priceFor({ monthlyPrice: 12000, annualPrice: 120000 }, 'monthly');
    expect(price.amount).toBe('₦12,000');
    expect(price.suffix).toBe('/month');
  });

  it('shows an annual price and label when annual is selected', () => {
    const price = priceFor({ monthlyPrice: 12000, annualPrice: 120000 }, 'annual');
    expect(price.amount).toBe('₦120,000');
    expect(price.suffix).toBe('/year');
  });

  it('keeps a plan without prices as custom pricing in both periods', () => {
    const custom = { monthlyPrice: null, annualPrice: null };
    expect(priceFor(custom, 'monthly')).toEqual({ amount: 'Custom pricing', suffix: '' });
    expect(priceFor(custom, 'annual')).toEqual({ amount: 'Custom pricing', suffix: '' });
  });

  it('shows a price the catalogue publishes even when it is zero', () => {
    expect(priceFor({ monthlyPrice: 0, annualPrice: 0 }, 'monthly')).toEqual({
      amount: '₦0',
      suffix: '/month',
    });
  });
});

describe('Mapping the published catalogue onto pricing cards', () => {
  it('shows exactly the plans the catalogue returned, in catalogue order', () => {
    expect(displayed().map((p) => p.id)).toEqual(CATALOGUE.map((p) => p.id));
    expect(displayed().map((p) => p.name)).toEqual(['Starter', 'Standard', 'Premium', 'Custom']);
    expect(displayed()).toHaveLength(CATALOGUE.length);
  });

  it('carries each published monthly and annual price through untouched', () => {
    for (const source of CATALOGUE) {
      const card = one(source.id);
      expect(card.monthlyPrice).toBe(source.monthlyPrice);
      expect(card.annualPrice).toBe(source.annualPrice);
    }
  });

  it('formats the card price from the catalogue figures, not from copy', () => {
    for (const source of CATALOGUE) {
      const card = one(source.id);
      if (source.monthlyPrice === null) continue;
      expect(priceFor(card, 'monthly').amount).toBe(formatNaira(source.monthlyPrice));
      expect(priceFor(card, 'annual').amount).toBe(formatNaira(source.annualPrice ?? 0));
      expect(monthsFree(card.monthlyPrice, card.annualPrice)).toBe(2);
    }
  });

  it('writes the seat label from the published seat limit', () => {
    expect(one('p-starter').userLimit).toBe('Up to 2 users');
    expect(one('p-standard').userLimit).toBe('Up to 5 users');
    expect(one('p-premium').userLimit).toBe('Up to 10 users');
    expect(one('p-custom').userLimit).toBe('Custom users');
  });

  it('keeps a plan with no published price as an enquiry, never as a number', () => {
    const custom = one('p-custom');
    expect(custom.monthlyPrice).toBeNull();
    expect(custom.annualPrice).toBeNull();
    expect(priceFor(custom, 'monthly').amount).toBe('Custom pricing');
    expect(priceFor(custom, 'annual').amount).toBe('Custom pricing');
    expect(monthsFree(custom.monthlyPrice, custom.annualPrice)).toBe(0);
  });

  it('passes every published feature through, including its upcoming flag', () => {
    for (const source of CATALOGUE) {
      const card = one(source.id);
      expect(card.features.map((f) => f.label)).toEqual(source.features.map((f) => f.label));
    }

    const starter = one('p-starter');
    expect(starter.features.find((f) => f.label === 'Expenses and supplier records')?.upcoming).toBe(
      true
    );
    expect(
      starter.features.find((f) => f.label === 'Sales recording and checkout')?.upcoming
    ).toBe(false);
  });

  it('does not mark a catalogue feature upcoming that the catalogue did not', () => {
    const standard = one('p-standard');
    expect(standard.features.every((f) => f.upcoming === false)).toBe(true);
  });

  it('carries the catalogue feature keys through, so a list keys by identity', () => {
    for (const source of CATALOGUE) {
      const card = one(source.id);
      expect(card.features.map((f) => f.key)).toEqual(source.features.map((f) => f.key));
      expect(new Set(card.features.map((f) => f.key)).size).toBe(card.features.length);
    }
  });

  it('carries the description and onboarding note through, and invents neither', () => {
    expect(one('p-starter').description).toBe(fromCatalogue('p-starter').description);
    expect(one('p-starter').onboardingNote).toBe(
      'No setup fee when you add and manage your products yourself.'
    );
    // A plan the catalogue gives no description or note keeps none.
    expect(one('p-premium').description).toBe('');
    expect(one('p-custom').onboardingNote).toBeNull();
  });

  it('sends a priced plan to signup and an unpriced plan to sales', () => {
    expect(one('p-standard').ctaLabel).toBe('Choose Standard');
    expect(one('p-standard').ctaHref).toBe('/signup?plan=standard');

    const custom = one('p-custom');
    expect(custom.ctaLabel).toBe('Talk to Sales');
    expect(custom.ctaHref.startsWith('mailto:')).toBe(true);
    expect(custom.ctaHref).toContain(CONTACT_EMAIL);
  });

  it('gives every card a call to action', () => {
    for (const plan of displayed()) {
      expect(plan.ctaLabel.length).toBeGreaterThan(0);
      expect(plan.ctaHref.length).toBeGreaterThan(0);
    }
  });

  it('builds the contact link from the published contact address', () => {
    const cta = ctaFor({ name: 'Custom', key: 'custom', monthlyPrice: null, annualPrice: null });
    expect(cta.label).toBe('Talk to Sales');
    expect(cta.href).toContain(CONTACT_EMAIL);
  });

  it('emphasises exactly one card, and never the negotiated tier', () => {
    const featured = displayed().filter((p) => p.featured);
    expect(featured).toHaveLength(1);
    expect(featured[0].id).toBe('p-premium');
    expect(one('p-custom').featured).toBe(false);
  });

  it('has nothing to emphasise when no published plan carries a price', () => {
    const allCustom = [published({ id: 'p-a', monthlyPrice: null, annualPrice: null })];
    expect(recommendedPlanId(allCustom)).toBeNull();
    expect(toPricingPlans(allCustom).every((p) => !p.featured)).toBe(true);
  });

  it('maps an empty catalogue to an empty list rather than to plans', () => {
    expect(toPricingPlans([])).toEqual([]);
    expect(recommendedPlanId([])).toBeNull();
  });

  it('does not drop or pad a map of a single plan', () => {
    const single = toPricingPlan(fromCatalogue('p-standard'));
    expect(single.id).toBe('p-standard');
    expect(single.featured).toBe(false);
    expect(single.features).toHaveLength(fromCatalogue('p-standard').features.length);
  });
});

describe('Landing pricing has one source of truth', () => {
  // The duplicate that drifted: figures typed into the landing files, reachable
  // by no admin edit. If any of these reappears, the public page is advertising
  // a price list again instead of reading the published one.
  const PRICE_LITERALS = ['5000', '50000', '22500', '225000', '45000', '450000'];

  it('keeps no price literal in the landing content module', () => {
    for (const literal of PRICE_LITERALS) {
      expect(contentSource).not.toContain(literal);
    }
  });

  it('keeps no price literal in the landing page component', () => {
    for (const literal of PRICE_LITERALS) {
      expect(pageSource).not.toContain(literal);
    }
  });

  it('exports no plan ladder of its own', () => {
    expect(contentSource).not.toMatch(/export const PLANS/);
    expect(contentSource).not.toMatch(/\bLandingPlan\b/);
    expect(pageSource).not.toMatch(/\bPLANS\b/);
  });

  it('reads the published catalogue in the page', () => {
    expect(pageSource).toContain('SubscriptionService.getPublishedPlans()');
    expect(pageSource).toContain('toPricingPlans');
  });

  it('no longer advertises the retired 90,000 tier', () => {
    for (const source of [contentSource, pageSource]) {
      expect(source).not.toContain('90,000');
      expect(source).not.toContain('90000');
      expect(source).not.toContain('900000');
      expect(source).not.toMatch(/Up to 15 users/);
    }
  });

  it('no longer advertises features that left the ladder', () => {
    for (const dropped of [
      'Branches',
      'Multi-location stock',
      'Approvals',
      'Budgeting',
      'Deeper financial analysis',
    ]) {
      expect(contentSource).not.toContain(dropped);
      expect(pageSource).not.toContain(dropped);
    }
  });

  it('does not mention the withdrawn Standard setup charge', () => {
    for (const source of [contentSource, pageSource]) {
      expect(source).not.toContain('150,000');
      expect(source).not.toContain('150000');
      expect(source.toLowerCase()).not.toContain('setup fee of');
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
