// Business experience model rules.
//
// The important test here is the route check: a nav item marked implemented must
// point at a route that actually exists in App.tsx. That is what stops a merchant
// being sent to a screen that does not work, and it is the failure mode a purely
// visual review would miss.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  ALL_EXPERIENCES,
  BUSINESS_EXPERIENCES,
  addableModules,
  getBusinessExperience,
  missingCapabilities,
  visibleNav,
  type BusinessExperience,
} from '../src/config/businessExperience';
import { CATEGORY_CONFIGS } from '../src/config/businessModules';

// Routes that exist in the router.
const appSource = readFileSync(join(process.cwd(), 'src', 'App.tsx'), 'utf8');
const ROUTES = new Set(
  Array.from(appSource.matchAll(/path="([^"]+)"/g)).map((m) => m[1])
);

const CATEGORY_KEYS = Object.keys(CATEGORY_CONFIGS);

describe('Experience coverage', () => {
  it('defines an experience for every supported business type', () => {
    expect(Object.keys(BUSINESS_EXPERIENCES).sort()).toEqual([...CATEGORY_KEYS].sort());
    expect(ALL_EXPERIENCES).toHaveLength(CATEGORY_KEYS.length);
    expect(CATEGORY_KEYS).toHaveLength(12);
  });

  it('keys each experience by its own category, so stored records stay addressable', () => {
    for (const experience of ALL_EXPERIENCES) {
      expect(BUSINESS_EXPERIENCES[experience.category]).toBe(experience);
    }
  });

  it('resolves an unknown category to a working default rather than throwing', () => {
    expect(getBusinessExperience('not_a_real_type').category).toBe('general_retail');
  });
});

describe('Navigation never points at a missing workflow', () => {
  it('gives every implemented nav item a route that exists in the router', () => {
    const broken: string[] = [];
    for (const experience of ALL_EXPERIENCES) {
      for (const item of visibleNav(experience)) {
        if (!ROUTES.has(item.route)) {
          broken.push(`${experience.category} → ${item.label} (${item.route})`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it('gives every unimplemented nav item a stated gap', () => {
    for (const experience of ALL_EXPERIENCES) {
      for (const item of experience.nav.filter((i) => !i.implemented)) {
        expect(item.gap, `${experience.category}/${item.key} needs a gap note`).toBeTruthy();
      }
    }
  });

  it('only points implemented actions at real routes', () => {
    for (const experience of ALL_EXPERIENCES) {
      const actions = [experience.primaryAction, ...experience.secondaryActions];
      for (const action of actions) {
        if (action.implemented) {
          expect(ROUTES.has(action.route), `${experience.category} → ${action.label} (${action.route})`).toBe(true);
        } else {
          expect(action.gap, `${experience.category}/${action.label} needs a gap note`).toBeTruthy();
        }
      }
    }
  });

  it('references only nav keys that exist for that business type', () => {
    for (const experience of ALL_EXPERIENCES) {
      const keys = new Set(experience.nav.map((i) => i.key));
      for (const key of experience.bottomNav) {
        expect(keys.has(key), `${experience.category} bottomNav references unknown key "${key}"`).toBe(true);
      }
      expect(experience.bottomNav.length).toBeGreaterThan(0);
      // The bottom bar is small; more than three items does not fit on a phone.
      expect(experience.bottomNav.length, `${experience.category} bottom bar too long`).toBeLessThanOrEqual(3);
    }
  });

  it('keeps bottom-bar keys pointing at implemented areas', () => {
    for (const experience of ALL_EXPERIENCES) {
      for (const key of experience.bottomNav) {
        const item = experience.nav.find((i) => i.key === key);
        expect(item?.implemented, `${experience.category} bottom bar exposes unimplemented "${key}"`).toBe(true);
      }
    }
  });
});

describe('Dashboard metrics are defined, not decorative', () => {
  it('states a source, calculation and period for every metric', () => {
    for (const experience of ALL_EXPERIENCES) {
      expect(experience.dashboard.length, `${experience.category} has no metrics`).toBeGreaterThan(0);
      for (const metric of experience.dashboard) {
        const where = `${experience.category}/${metric.key}`;
        expect(metric.source.length, `${where} source`).toBeGreaterThan(0);
        expect(metric.calculation.length, `${where} calculation`).toBeGreaterThan(0);
        expect(metric.period.length, `${where} period`).toBeGreaterThan(0);
      }
    }
  });

  it('only links cards to routes that exist', () => {
    // An unimplemented metric naturally points at a screen that does not exist
    // yet - that is what its gap note records. Only implemented cards must link.
    for (const experience of ALL_EXPERIENCES) {
      for (const metric of experience.dashboard) {
        if (metric.implemented && metric.linkTo) {
          expect(ROUTES.has(metric.linkTo), `${experience.category}/${metric.key} → ${metric.linkTo}`).toBe(true);
        }
      }
    }
  });

  it('does not give every business type the same dashboard', () => {
    // A tailor, a restaurant and a fabric seller must not share one card set.
    const signatures = ALL_EXPERIENCES.map((e) => e.dashboard.map((m) => m.key).join(','));
    expect(new Set(signatures).size).toBeGreaterThan(6);
  });
});

describe('Statuses and transitions are coherent', () => {
  it('only references declared statuses in transitions', () => {
    for (const experience of ALL_EXPERIENCES) {
      const declared = new Set(experience.statuses);
      for (const [from, targets] of Object.entries(experience.allowedTransitions)) {
        expect(declared.has(from), `${experience.category}: transition from undeclared "${from}"`).toBe(true);
        for (const to of targets) {
          expect(declared.has(to), `${experience.category}: transition to undeclared "${to}"`).toBe(true);
        }
      }
    }
  });

  it('describes an end state for at least one status', () => {
    for (const experience of ALL_EXPERIENCES) {
      const terminal = experience.statuses.filter((s) => (experience.allowedTransitions[s] ?? []).length === 0);
      expect(terminal.length, `${experience.category} has no terminal status`).toBeGreaterThan(0);
    }
  });
});

describe('Business type is separate from subscription plan', () => {
  it('never mentions plan, subscription or entitlement in an experience', () => {
    // "price" is deliberately NOT banned: agreeing a job price is ordinary business
    // language. What must never appear is plan/entitlement vocabulary, because a
    // business type must not imply or infer a subscription plan.
    const forbidden = ['subscription', 'entitlement', 'plan_id', 'planid', 'upgrade', 'seat_limit'];
    for (const experience of ALL_EXPERIENCES) {
      const serialised = JSON.stringify(experience).toLowerCase();
      for (const word of forbidden) {
        expect(serialised.includes(word), `${experience.category} mentions "${word}"`).toBe(false);
      }
    }
  });
});

describe('Terminology and stock rules are business-specific', () => {
  it('names records in the words the business uses', () => {
    expect(getBusinessExperience('restaurant').terminology.record).toBe('Order');
    expect(getBusinessExperience('restaurant').terminology.lineItem).toBe('Menu item');
    expect(getBusinessExperience('tailor').terminology.record).toBe('Job');
    expect(getBusinessExperience('tailor').terminology.customer).toBe('Client');
    expect(getBusinessExperience('fabric_textile').terminology.stock).toBe('Remaining length');
    expect(getBusinessExperience('pharmacy').terminology.lineItem).toBe('Medicine');
    expect(getBusinessExperience('building_materials').terminology.record).toBe('Quote');
  });

  it('uses the right stock model per business type', () => {
    expect(getBusinessExperience('fabric_textile').stock.model).toBe('roll');
    expect(getBusinessExperience('fabric_textile').stock.fractional).toBe(true);
    expect(getBusinessExperience('pharmacy').stock.model).toBe('batch');
    expect(getBusinessExperience('pharmacy').stock.expiryTracked).toBe(true);
    expect(getBusinessExperience('electronics_gadget').stock.model).toBe('serial');
    expect(getBusinessExperience('fashion_store').stock.model).toBe('variant');
    expect(getBusinessExperience('general_retail').stock.model).toBe('simple');
    // A serialized unit is never fractional and never expiring.
    expect(getBusinessExperience('electronics_gadget').stock.fractional).toBe(false);
  });

  it('explains the state of any non-trivial stock model', () => {
    for (const experience of ALL_EXPERIENCES) {
      if (experience.stock.model !== 'simple') {
        expect(experience.stock.note, `${experience.category} non-simple stock needs a note`).toBeTruthy();
      }
    }
  });

  it('does not imply ingredient deduction for restaurants', () => {
    const note = getBusinessExperience('restaurant').stock.note ?? '';
    expect(note).toMatch(/does not deduct|does NOT deduct/i);
  });
});

describe('Gaps are reported honestly', () => {
  it('lists the missing work for a business type that needs new records', () => {
    const tailorGaps = missingCapabilities(getBusinessExperience('tailor'));
    expect(tailorGaps.length).toBeGreaterThan(0);
    expect(tailorGaps.join(' ')).toMatch(/job/i);
  });

  it('reports gaps for building materials and electronics', () => {
    expect(missingCapabilities(getBusinessExperience('building_materials')).join(' ')).toMatch(/quote/i);
    expect(missingCapabilities(getBusinessExperience('electronics_gadget')).join(' ')).toMatch(/warrant/i);
  });

  it('reports no gap for a business type whose core workflow exists', () => {
    const gaps = missingCapabilities(getBusinessExperience('general_retail'));
    // Expenses and suppliers are genuinely absent everywhere.
    expect(gaps.join(' ')).toMatch(/expense/i);
    // But the core sale flow must not be flagged.
    expect(gaps.join(' ')).not.toMatch(/New sale/);
  });
});

describe('Modules can be added later without disturbing records', () => {
  it('offers modules beyond the defaults', () => {
    const tailor = getBusinessExperience('tailor');
    const addable = addableModules(tailor, ['inventory', 'sales', 'customers', 'variants', 'pharmacy', 'fabric']);
    expect(addable).toContain('variants');
    expect(addable).not.toContain('tailoring');
  });

  it('keeps the declared default modules free of duplicates', () => {
    for (const experience of ALL_EXPERIENCES) {
      expect(new Set(experience.defaultModules).size).toBe(experience.defaultModules.length);
    }
  });
});

describe('Every experience is fully populated', () => {
  it('has the fields the UI depends on', () => {
    for (const experience of ALL_EXPERIENCES as BusinessExperience[]) {
      const where = experience.category;
      expect(experience.displayName.length, where).toBeGreaterThan(0);
      expect(experience.onboardingDescription.length, where).toBeGreaterThan(0);
      expect(experience.primaryQuestion.length, where).toBeGreaterThan(0);
      expect(experience.nav.length, where).toBeGreaterThan(2);
      expect(experience.statuses.length, where).toBeGreaterThan(0);
      expect(experience.paymentOptions.length, where).toBeGreaterThan(0);
      expect(experience.staffRoles.length, where).toBeGreaterThan(0);
      expect(experience.reports.length, where).toBeGreaterThan(0);
      expect(experience.emptyStates.dashboard.length, where).toBeGreaterThan(0);
      expect(experience.emptyStates.primaryList.length, where).toBeGreaterThan(0);
      expect(experience.terminology.record.length, where).toBeGreaterThan(0);
    }
  });
});
