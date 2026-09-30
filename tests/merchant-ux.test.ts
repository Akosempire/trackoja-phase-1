// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import SalesHistoryPage from '../src/pages/sales/SalesHistoryPage';
import { CATEGORY_CONFIGS } from '../src/config/businessModules';
const state = vi.hoisted(() => ({ category: 'general_retail', allowed: true, sales: vi.fn() }));
vi.mock('../src/contexts/AuthContext', () => ({ useAuth: () => ({ profile: { currentStoreId: 'fixture' } }) }));
vi.mock('../src/contexts/BusinessContext', () => ({ useBusinessContext: () => ({ category: state.category }) }));
vi.mock('../src/hooks/usePermissions', () => ({ usePermissions: () => ({ hasPermission: () => state.allowed, loading: false }) }));
vi.mock('../src/services/sale.service', () => ({ SaleService: { getSales: state.sales } }));
vi.mock('../src/components/icons', () => ({ AlertIcon: () => null }));
let root: Root; let host: HTMLDivElement;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
beforeEach(() => { state.allowed = true; state.sales.mockReset().mockResolvedValue([]); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
async function mount() { await act(async () => root.render(createElement(MemoryRouter, {}, createElement(SalesHistoryPage)))); }
for (const category of Object.keys(CATEGORY_CONFIGS)) for (const allowed of [true, false]) {
  it(`${category}: one permitted checkout action, no empty-state duplicate (${allowed})`, async () => {
    state.category = category; state.allowed = allowed; await mount();
    const actions = host.querySelectorAll('a[href="/sales/checkout"]'); expect(actions.length).toBe(allowed ? 1 : 0);
    if (allowed) expect(actions[0].textContent).toBe(category === 'restaurant' ? 'New order' : 'Record sale');
  });
}
it('errors do not claim an empty sales count', async () => {
  state.sales.mockRejectedValueOnce(new Error('Network failed')); await mount();
  expect(host.textContent).toContain('Records unavailable'); expect(host.textContent).not.toMatch(/0 sales/);
  const retry = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('Try again'))!;
  await act(async () => retry.click()); expect(state.sales).toHaveBeenCalledTimes(2);
});
