// The guided tour: steps are kept when their part is on screen, or when the
// phone fallback (the menu) is; steps without a part always stay.
import { describe, expect, it } from 'vitest';
import { TOUR_STEPS, planTour } from '../src/components/Tour';

describe('planTour', () => {
  it('keeps every step on a desktop owner screen', () => {
    expect(planTour(TOUR_STEPS, () => true)).toHaveLength(TOUR_STEPS.length);
  });
  it('falls back to the menu on phones', () => {
    const phone = new Set(['menu', 'scan', 'nav:/dashboard', 'nav:/inventory/products', 'nav:/more']);
    const plan = planTour(TOUR_STEPS, (k) => phone.has(k));
    expect(plan.map((s) => s.title)).toContain('Open the till');
    expect(plan).toHaveLength(TOUR_STEPS.length);
  });
  it('drops steps this role cannot see', () => {
    const cashier = new Set(['scan', 'nav:/dashboard', 'nav:/till', 'nav:/support']);
    const plan = planTour(TOUR_STEPS, (k) => cashier.has(k));
    expect(plan.map((s) => s.title)).not.toContain('Add your staff');
    expect(plan[0].title).toMatch(/Welcome/);
  });
});
