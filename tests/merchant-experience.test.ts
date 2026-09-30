import { describe, expect, it } from 'vitest';
import { ALL_EXPERIENCES, getBusinessExperience } from '../src/config/businessExperience';
import { merchantPrimaryAction, routeModule } from '../src/utils/merchant-experience';
import { mobileDestinations } from '../src/utils/navigation-layout';
import { businessActivity, stockState, stockQuantity } from '../src/utils/business-activity';
import type { AuditLog } from '../src/types';
describe('merchant operations', () => {
  for (const experience of ALL_EXPERIENCES) it(`${experience.category}: permitted central action and persistent More`, () => {
    const action = merchantPrimaryAction(experience.category, experience.defaultModules, () => true, '/dashboard');
    expect(action.label).toBe(experience.category === 'restaurant' ? 'New order' : experience.category === 'tailor' ? 'New job' : 'Scan');
    expect(merchantPrimaryAction(experience.category, [], () => false, '/dashboard').route).toBeNull();
    const permitted = [{ to: '/dashboard' }, ...experience.nav.filter(item => item.implemented).map(item => ({ to: item.route })), { to: '/more' }];
    const destinations = mobileDestinations(permitted, permitted);
    expect(destinations[0].to).toBe('/dashboard'); expect(destinations.at(-1)?.to).toBe('/more');
    expect(new Set(destinations.map(item => item.to)).size).toBe(destinations.length);
  });
  it('uses stock lookup in inventory, even for a cashier', () => {
    expect(merchantPrimaryAction('general_retail', ['sales', 'inventory'], () => true, '/inventory/stock').route).toBe('/inventory/products?scan=1');
    expect(routeModule('/inventory/products/new')).toBe('inventory');
  });
  it('configures Other around enabled work', () => {
    expect(getBusinessExperience('other', ['tailoring']).primaryAction.label).toBe('New job');
    expect(merchantPrimaryAction('other', ['sales'], () => true, '/dashboard').label).toBe('New sale');
  });
  it('separates stock states and preserves fractional units', () => {
    expect(stockState({ stockQty: -1, reorderLevel: 300 })).toBe('Stock discrepancy');
    expect(stockState({ stockQty: 0, reorderLevel: 300 })).toBe('Out of stock');
    expect(stockState({ stockQty: 300, reorderLevel: 300 })).toBe('Low stock');
    expect(stockState({ stockQty: 301, reorderLevel: 300 })).toBeNull();
    expect(stockQuantity(0, 'Pack')).toBe('0 packs'); expect(stockQuantity(1.25, 'yard')).toBe('1.25 yards');
  });
  it('filters security events and deduplicates only identical event IDs', () => {
    const first = { id: 'a', resourceType: 'product', action: 'PRODUCT_UPDATED' } as AuditLog;
    expect(businessActivity([first, first, { ...first, id: 'b' }, { ...first, id: 'c', resourceType: 'auth_session' }], ['product']).map(item => item.id)).toEqual(['a', 'b']);
  });
});
