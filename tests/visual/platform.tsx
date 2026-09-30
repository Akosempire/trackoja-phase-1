import type { ReactNode } from 'react';
import { platformUsesWideLayout } from '../../src/utils/navigation-layout';
import BusinessesArea from '../../src/pages/platform/areas/BusinessesArea';
import AuditArea from '../../src/pages/platform/areas/AuditArea';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { PlatformProvider } from '../../src/components/platform/PlatformContext';
import { ToastProvider } from '../../src/components/ui/Toast';
import { PlatformAdminService } from '../../src/services/platformAdmin.service';
import { PlatformService } from '../../src/services/platform.service';
import BillingArea from '../../src/pages/platform/areas/BillingArea';
import SupportArea from '../../src/pages/platform/areas/SupportArea';
import DeveloperArea from '../../src/pages/platform/areas/DeveloperArea';
import '../../src/styles/theme.css';
import '../../src/styles/app.css';
import '@fontsource-variable/inter';
import '@fontsource/forum/latin-400.css';
import '../../src/styles/tokens.css';
import '../../src/styles/waya.css';
import '../../src/styles/waya-components.css';
import '../../src/styles/bottom-nav.css';
import '../../src/styles/form-controls.css';
import '../../src/styles/mobile.css';
// Isolated presentation fixtures. Every service method is intercepted before rendering.
for (const service of [PlatformAdminService, PlatformService]) {
  for (const key of Object.getOwnPropertyNames(service)) {
    if (typeof (service as unknown as Record<string, unknown>)[key] === 'function' && key !== 'constructor') {
      Object.defineProperty(service, key, { value: async () => key.startsWith('list') || key.includes('ByPlan') ? [] : {}, configurable: true });
    }
  }
}
Object.defineProperty(PlatformAdminService, 'getMyAccess', { value: async () => ({ isSuperAdmin: true, permissions: [], level: 'owner' }) });
Object.defineProperty(PlatformAdminService, 'getActiveImpersonation', { value: async () => null });
Object.defineProperty(PlatformAdminService, 'getDeveloperStatus', { value: async () => ({ developerMode: false, activeSessionId: null }) });
const params = new URLSearchParams(location.search);
if (params.get('data') === 'paged') {
  Object.defineProperty(PlatformAdminService, 'listBusinesses', { value: async ({ limit = 25, offset = 0 } = {}) => Array.from({ length: limit }, (_, i) => ({
    orgId: `business-${offset + i}`, name: `Business ${offset + i + 1}`, slug: 'fixture', ownerEmail: 'fixture@example.test', businessCategory: 'general_retail', billingStatus: 'active', isSandbox: false, productKey: 'trackoja', productName: 'TrackOja', planKey: 'standard', planName: 'Standard', entitlementStatus: 'active', agreedUserLimit: 5, seatUsed: 1, expiresAt: null, trialEndsAt: null, storeCount: 1, createdAt: '2026-09-01T00:00:00Z',
  })) });
  Object.defineProperty(PlatformAdminService, 'listAuditLogs', { value: async ({ offset = 0 } = {}) => ({ total: 100, entries: [{ id: `audit-${offset}`, action: 'LOGIN', status: 'success', createdAt: '2026-09-01T00:00:00Z', actorEmail: 'fixture@example.test', resourceType: 'user', details: {}, changes: null }] }) });
}

if (params.get('data') === 'populated') {
  Object.defineProperty(PlatformAdminService, 'listPlans', { value: async () => [{
    id: 'plan-1', productId: 'product-1', productKey: 'trackoja', productName: 'TrackOja', key: 'standard', name: 'Standard', description: 'Fixture plan',
    monthlyPrice: 22500, annualPrice: 225000, currency: 'NGN', userLimit: 5, setupFee: 0, trialDays: 14, storeLimit: 1, features: [], onboardingNote: null,
    billingCycle: 'monthly', status: 'active', isDefault: true, isPublic: true, sortOrder: 1, subscriberCount: 2, updatedAt: '2026-09-01T00:00:00Z', publishedAt: '2026-09-01T00:00:00Z', effectiveFrom: '2026-09-01T00:00:00Z',
  }] });
}

document.documentElement.dataset.theme = params.get('theme') ?? 'light';
function PageFrame({ children }: { children: ReactNode }) { const { pathname } = useLocation(); return <main className={`page plat-page${platformUsesWideLayout(pathname) ? ' is-wide' : ''}`}>{children}</main>; }
createRoot(document.getElementById('root')!).render(<MemoryRouter initialEntries={[params.get('route') ?? '/platform/billing']}><ToastProvider><PlatformProvider>
  <PageFrame><Routes>
    <Route path="/platform/billing" element={<BillingArea />} />
    <Route path="/platform/businesses" element={<BusinessesArea />} />
    <Route path="/platform/audit" element={params.get('data') === 'paged' ? <AuditArea /> : <h1>Audit destination</h1>} />
    <Route path="/platform/support" element={<SupportArea />} />
    <Route path="/platform/developer" element={<DeveloperArea />} />
    <Route path="/platform/activation" element={<h1>Activation destination</h1>} />
    <Route path="/platform/settings" element={<h1>Settings destination</h1>} />
  </Routes></PageFrame>
</PlatformProvider></ToastProvider></MemoryRouter>);
