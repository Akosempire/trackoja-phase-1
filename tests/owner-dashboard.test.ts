// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import DashboardPage from '../src/pages/DashboardPage';
import { CATEGORY_CONFIGS } from '../src/config/businessModules';
const state = vi.hoisted(() => ({ category: 'general_retail', allowed: true, summary: vi.fn(), methods: vi.fn() }));
vi.mock('../src/contexts/AuthContext', () => ({ useAuth: () => ({ profile: { currentStoreId: 'fixture', firstName: 'Ada' } }) }));
vi.mock('../src/contexts/BusinessContext', () => ({ useBusinessContext: () => ({ category: state.category }) }));
vi.mock('../src/hooks/usePermissions', () => ({ usePermissions: () => ({ hasPermission: (key: string) => key === 'inventory:view' || state.allowed, loading: false }) }));
vi.mock('../src/components/TrialStatus', () => ({ TrialStatus: () => null }));
vi.mock('../src/services/store.service', () => ({ StoreService: { getStore: async () => ({ name: 'Ada store' }) } }));
vi.mock('../src/services/product.service', () => ({ ProductService: { getProducts: async () => [] } }));
vi.mock('../src/services/audit.service', () => ({ AuditService: { getStoreAuditLogs: async () => [] } }));
vi.mock('../src/services/sale.service', () => ({ SaleService: { getKitchenOrders: async () => [], getRefundCount: async () => 0 } }));
vi.mock('../src/services/customer.service', () => ({ CustomerService: { getCustomers: async () => [] } }));
vi.mock('../src/services/report.service', () => ({ ReportService: { getSalesSummary: state.summary, getSalesByPaymentMethod: state.methods } }));
let root: Root; let host: HTMLDivElement;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
beforeEach(() => {
  state.summary.mockReset().mockResolvedValue({ totalRevenue: 0, transactionCount: 0, averageSale: 0, taxTotal: 0, discountTotal: 0, voidedCount: 0 });
  state.methods.mockReset().mockResolvedValue([]);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
for (const category of Object.keys(CATEGORY_CONFIGS)) for (const allowed of [true, false]) {
  it(`${category} dashboard preserves reports permission (${allowed}) and empty-state structure`, async () => {
    state.category = category; state.allowed = allowed;
    await act(async () => root.render(createElement(MemoryRouter, {}, createElement(DashboardPage))));
    expect(host.textContent).toContain('Ada store'); expect(host.textContent).toContain('Business overview');
    expect(host.querySelectorAll('.dashboard-revenue').length).toBe(allowed ? 1 : 0);
    expect(state.methods).toHaveBeenCalledTimes(allowed ? 1 : 0);
    expect(state.summary).toHaveBeenCalledTimes(allowed ? 2 : 0);
    if (allowed) expect(host.textContent).toContain('No revenue in this period');
    else expect(host.textContent).not.toMatch(/Record sale|New order|Add client|New job|Add product/);
  });
}
