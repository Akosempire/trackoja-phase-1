// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { BottomNav } from '../src/components/BottomNav';
import { Pagination } from '../src/components/ui/Pagination';
import { DataTable } from '../src/components/ui/DataTable';
import { CATEGORY_CONFIGS, type BusinessCategory } from '../src/config/businessModules';
import { platformUsesWideLayout } from '../src/utils/navigation-layout';

const access = vi.hoisted(() => ({ category: 'general_retail', permissions: [] as string[], loading: false }));
// Icon rendering is covered by browser checks; these tests exercise route policy.
vi.mock('../src/components/icons', () => Object.fromEntries([
  'HomeIcon', 'SalesIcon', 'ScanIcon', 'ReportsIcon', 'MoreIcon', 'ProductsIcon',
  'CustomersIcon', 'StaffIcon', 'PaymentsIcon', 'SettingsIcon', 'KitchenIcon', 'ExpiryIcon', 'DevicesIcon',
].map((name) => [name, () => null])));
vi.mock('../src/hooks/usePermissions', () => ({ usePermissions: () => ({
  hasPermission: (permission: string) => access.permissions.includes('*') || access.permissions.includes(permission),
  loading: access.loading,
}) }));
vi.mock('../src/contexts/BusinessContext', () => ({ useBusinessContext: () => ({ category: access.category }) }));
vi.mock('../src/utils/cart-count', () => ({ useCartCount: () => 3 }));
let root: Root | null = null;
let host: HTMLDivElement | null = null;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => { act(() => root?.unmount()); host?.remove(); access.loading = false; });
async function mount(node: ReturnType<typeof createElement>) {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(createElement(MemoryRouter, {}, node)));
  return host;
}

describe('permission-filtered mobile navigation', () => {
  for (const category of Object.keys(CATEGORY_CONFIGS) as BusinessCategory[]) {
    for (const permissions of [['*'], ['sales:view', 'sales:create'], ['inventory:view'], []]) {
      it(`${category}: ${permissions.join(',') || 'no permissions'} has unique bounded destinations`, async () => {
        access.category = category; access.permissions = permissions;
        const screen = await mount(createElement(BottomNav));
        const links = Array.from(screen.querySelectorAll('a'));
        const paths = links.map((link) => link.getAttribute('href'));
        expect(paths.length).toBeLessThanOrEqual(4);
        expect(new Set(paths).size).toBe(paths.length);
        expect(paths).not.toContain('/more');
        if (permissions.includes('*') || permissions.includes('sales:view')) expect(paths).toContain('/payments');
        else expect(paths).not.toContain('/payments');
        expect(screen.querySelector('.bottom-nav-scan')).not.toBeNull();
        for (const link of links.filter((link) => link.getAttribute('href') !== '/sales/checkout')) {
          expect(link.querySelector('.bottom-nav-badge')).toBeNull();
        }
      });
    }
  }
  it('does not flash restricted destinations while permissions load', async () => {
    access.loading = true; access.permissions = ['*'];
    const screen = await mount(createElement(BottomNav));
    expect(screen.querySelector('a[href="/payments"]')).toBeNull();
    expect(screen.querySelector('button')?.disabled).toBe(true);
  });
});

describe('truthful shared data states', () => {
  it('does not invent a row range when the backend supplies no total', async () => {
    const screen = await mount(createElement(Pagination, { page: 2, pageSize: 50, total: null, hasNext: false, onPageChange: vi.fn() }));
    expect(screen.textContent).toContain('Page 2');
    expect(screen.textContent).not.toContain('100');
    expect(screen.textContent).not.toContain('Showing');
  });
  it('announces table loading and offers a keyboard-focusable scroll region', async () => {
    const screen = await mount(createElement(DataTable<{ id: string }>, {
      caption: 'Transactions', rows: [], columns: [{ key: 'id', header: 'Reference', render: (row) => row.id }],
      rowKey: (row) => row.id, loading: true,
    }));
    const region = screen.querySelector('[role="region"]');
    expect(region?.getAttribute('aria-label')).toBe('Transactions');
    expect(region?.getAttribute('aria-busy')).toBe('true');
    expect(region?.getAttribute('tabindex')).toBe('0');
    expect(screen.textContent).toContain('Loading records');
    expect(screen.textContent).not.toContain('No records');
  });
  it('chooses platform width by route, independent of loaded content', () => {
    expect(platformUsesWideLayout('/platform/billing')).toBe(true);
    expect(platformUsesWideLayout('/platform/businesses/123')).toBe(true);
    expect(platformUsesWideLayout('/platform/settings')).toBe(false);
    expect(platformUsesWideLayout('/platform/developer')).toBe(false);
  });
});
