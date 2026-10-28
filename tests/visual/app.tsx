// Screen preview harness: renders the real merchant app with sample data.
// Usage: /tests/visual/app.html?path=/inventory/products&theme=light&category=supermarket
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import App from '../../src/App';
import { ToastProvider } from '../../src/components/ui/Toast';
import * as F from './app-fixtures';
import '@fontsource-variable/figtree';
import '../../src/styles/index.css';

const services = import.meta.glob('../../src/services/*.ts', { eager: true }) as Record<string, Record<string, unknown>>;
const byName: Record<string, Record<string, unknown>> = {};
for (const mod of Object.values(services)) for (const [name, value] of Object.entries(mod)) {
  if (typeof value === 'function' && /Service$/.test(name)) {
    byName[name] = value as unknown as Record<string, unknown>;
    for (const key of Object.getOwnPropertyNames(value)) {
      if (['length', 'name', 'prototype'].includes(key)) continue;
      if (typeof (value as unknown as Record<string, unknown>)[key] === 'function') {
        Object.defineProperty(value, key, { configurable: true, value: async () => (/^(get|list)[A-Z].*s$|^list$|^attempts$|^terminals$|^registers$/.test(key) ? [] : null) });
      }
    }
  }
}
const mock = (svc: string, key: string, value: unknown) => { const s = byName[svc]; if (s) Object.defineProperty(s, key, { configurable: true, value: typeof value === 'function' ? value : async () => value }); };
const completed = F.sales.filter(s => s.status === 'completed');
const revenue = completed.reduce((a, s) => a + s.total, 0);
mock('StoreService', 'getUserStores', [{ id: 'fixture-store', name: 'Ikeja branch', status: 'active' }, { id: 'store-2', name: 'Yaba branch', status: 'active' }]);
mock('StoreService', 'getStore', { id: 'fixture-store', name: 'Ada Supermarket', currency: 'NGN', status: 'active' });
mock('StoreService', 'getStoreSettings', { currency: 'NGN', taxRate: 0, receiptFooter: 'Thank you for shopping with us!' });
mock('ProductService', 'getProducts', F.products);
mock('ProductService', 'getProduct', async (id: string) => F.products.find(p => p.id === id) ?? F.products[0]);
mock('CategoryService', 'getCategories', F.categories);
mock('CustomerService', 'getCustomers', F.customers);
mock('CustomerService', 'getCustomer', async (id: string) => F.customers.find(c => c.id === id) ?? F.customers[0]);
mock('SaleService', 'getSales', F.sales);
mock('SaleService', 'getSale', async (id: string) => F.sales.find(s => s.id === id) ?? F.sales[0]);
mock('SaleService', 'getRefundCount', 0);
mock('SaleService', 'getCashierName', 'Ada');
mock('ReportService', 'getSalesSummary', { totalRevenue: revenue, transactionCount: completed.length, averageSale: revenue / completed.length, taxTotal: 0, discountTotal: 0, voidedCount: 1 });
mock('ReportService', 'getSalesByPaymentMethod', [{ method: 'transfer', amount: 14700, transactionCount: 1 }, { method: 'pos', amount: 5000, transactionCount: 1 }, { method: 'cash', amount: 2200, transactionCount: 1 }]);
mock('ReportService', 'getTopProducts', [{ productId: 'p5', productName: 'Indomie Chicken (carton)', quantity: 1, revenue: 11500 }, { productId: 'p3', productName: 'Hollandia Yoghurt 1L', quantity: 2, revenue: 5000 }, { productId: 'p6', productName: 'Peak Milk Tin 400g', quantity: 1, revenue: 3200 }, { productId: 'p1', productName: 'Coca-Cola 50cl', quantity: 3, revenue: 1200 }]);
mock('AuditService', 'getStoreAuditLogs', F.sales.slice(0, 3).map((s, i) => ({ id: `a${i}`, resourceType: 'sale', action: 'SALE_COMPLETED', status: 'success', resourceName: s.receiptNumber, actorName: s.cashierName, createdAt: s.createdAt })));
mock('JobService', 'summary', { jobsDueSoon: 0, jobsOverdue: 0, upcomingFittings: 0, awaitingPickup: 0, outstandingBalances: 0, openJobs: 0 });
mock('OfflineSalesService', 'subscribe', () => () => {});
mock('OfflineSalesService', 'getPendingSales', () => []);
mock('RbacService', 'getUserPermissions', []);

const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get('theme') ?? 'light';
createRoot(document.getElementById('root')!).render(
  <MemoryRouter initialEntries={[params.get('path') ?? '/dashboard']}><ToastProvider><App /></ToastProvider></MemoryRouter>
);
