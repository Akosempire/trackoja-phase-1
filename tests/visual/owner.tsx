import { AppLayout } from '../../src/components/AppLayout';
import { Routes, Route } from 'react-router-dom';
import MorePage from '../../src/pages/MorePage';
import { ToastProvider } from '../../src/components/ui/Toast';
import { JobService } from '../../src/services/job.service';
﻿import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import DashboardPage from '../../src/pages/DashboardPage';
import OverviewArea from '../../src/pages/platform/areas/OverviewArea';
import { PlatformProvider } from '../../src/components/platform/PlatformContext';
import { StoreService } from '../../src/services/store.service';
import { ReportService } from '../../src/services/report.service';
import { ProductService } from '../../src/services/product.service';
import { AuditService } from '../../src/services/audit.service';
import { SaleService } from '../../src/services/sale.service';
import { CustomerService } from '../../src/services/customer.service';
import { PlatformAdminService } from '../../src/services/platformAdmin.service';
import { PlatformService } from '../../src/services/platform.service';
import '../../src/styles/theme.css';
import '../../src/styles/app.css';
import '@fontsource-variable/inter';
import '@fontsource/forum/latin-400.css';
import '../../src/styles/tokens.css';
import '../../src/styles/waya.css';
import '../../src/styles/waya-components.css';
import '../../src/styles/command-search.css';
import '../../src/styles/bottom-nav.css';
import '../../src/styles/form-controls.css';
import '../../src/styles/mobile.css';
const params = new URLSearchParams(location.search);
const populated = params.get('state') === 'populated';
const methods = populated ? [{ method: 'cash', amount: 22500, transactionCount: 3 }, { method: 'transfer', amount: 45000, transactionCount: 5 }] : [];
// All service calls are replaced before rendering either actual dashboard page.
for (const service of [JobService, StoreService, ReportService, ProductService, AuditService, SaleService, CustomerService, PlatformAdminService, PlatformService]) {
  for (const key of Object.getOwnPropertyNames(service)) if (typeof (service as unknown as Record<string, unknown>)[key] === 'function') {
    Object.defineProperty(service, key, { configurable: true, value: async () => [] });
  }
}
const mock = (service: object, key: string, value: unknown) => Object.defineProperty(service, key, { configurable: true, value: async () => value });
mock(JobService, 'summary', { jobsDueSoon: 2, jobsOverdue: 1, upcomingFittings: 3, awaitingPickup: 4, outstandingBalances: 12000, openJobs: 5 });
mock(StoreService, 'getUserStores', [{ id: 'fixture-store', name: 'Main branch', status: 'active' }]);
mock(StoreService, 'getStore', { name: 'Ada’s store', id: 'fixture-store' });
mock(ReportService, 'getSalesSummary', { totalRevenue: populated ? 67500 : 0, transactionCount: populated ? 8 : 0, averageSale: populated ? 8437.5 : 0, taxTotal: 0, discountTotal: 0, voidedCount: 0 });
mock(ReportService, 'getSalesByPaymentMethod', methods);
mock(ProductService, 'getProducts', populated ? [{ id: 'product', name: 'Stock item', stockQty: 2, reorderLevel: 5, trackInventory: true, unit: 'units' }] : []);
mock(SaleService, 'getRefundCount', 0);
mock(PlatformAdminService, 'getMyAccess', { isSuperAdmin: true, permissions: [], level: 'owner' });
mock(PlatformAdminService, 'getOverview', {});
mock(PlatformAdminService, 'getDeveloperStatus', { developerMode: false });
mock(PlatformAdminService, 'getActiveImpersonation', null);
mock(PlatformAdminService, 'listAuditLogs', { entries: [] });
mock(PlatformService, 'getOverview', {});
mock(PlatformService, 'getRevenueSummary', { totalRevenue: populated ? 67500 : 0, transactionCount: populated ? 3 : 0, successfulCount: populated ? 3 : 0, failedCount: 0 });
mock(PlatformService, 'getRevenueByPlan', populated ? [{ planId: 'standard', planName: 'Standard', revenue: 67500, transactionCount: 3 }] : []);
const activity = populated ? [{ id: 'event', resourceType: 'sale', action: 'SALE_COMPLETED', status: 'success', resourceName: 'Sale recorded', createdAt: new Date().toISOString() }] : [];
mock(AuditService, 'getStoreAuditLogs', activity);
mock(PlatformAdminService, 'listAuditLogs', { entries: activity });
document.documentElement.dataset.theme = params.get('theme') ?? 'light';
function MerchantShell() {
 return <ToastProvider><Routes><Route element={<AppLayout />}><Route path="/more" element={<MorePage />} /><Route path="*" element={<DashboardPage />} /></Route></Routes></ToastProvider>;
}
createRoot(document.getElementById('root')!).render(<MemoryRouter>{params.get('role') === 'platform' ? <PlatformProvider><main className="page plat-page is-wide"><OverviewArea /></main></PlatformProvider> : params.get('shell') === 'true' ? <MerchantShell /> : <DashboardPage />}</MemoryRouter>);
