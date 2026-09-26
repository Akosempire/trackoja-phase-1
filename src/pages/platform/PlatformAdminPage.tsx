import { useEffect, useMemo, useState } from 'react';
import { PageLoader } from '../../components/ui/PageLoader';
import { PlatformAdminService, type MyPlatformAccess } from '../../services/platformAdmin.service';
import {
  OverviewSection,
  ProductsSection,
  PlansSection,
  BusinessesSection,
  UsersSection,
  PaymentsSection,
  ActivationSection,
  SupportSection,
  SettingsSection,
  DeveloperSection,
} from './adminSections';
import '../../styles/platform-admin.css';

type AdminTabId =
  | 'overview'
  | 'products'
  | 'plans'
  | 'businesses'
  | 'users'
  | 'payments'
  | 'activation'
  | 'support'
  | 'settings'
  | 'developer';

interface AdminTab {
  id: AdminTabId;
  label: string;
  /** Permission the server enforces for this area. Null = any platform admin. */
  permission: string | null;
  /** Only offered while developer mode is active. */
  developerOnly?: boolean;
}

const TABS: AdminTab[] = [
  { id: 'overview', label: 'Overview', permission: 'platform:view' },
  { id: 'products', label: 'Products', permission: 'platform:manage_products' },
  { id: 'plans', label: 'Plans & pricing', permission: 'platform:manage_plans' },
  { id: 'businesses', label: 'Businesses', permission: 'platform:manage_businesses' },
  { id: 'users', label: 'Users & roles', permission: 'platform:manage_users' },
  { id: 'payments', label: 'Payments', permission: 'platform:manage_payments' },
  { id: 'activation', label: 'Activation', permission: 'platform:manage_activation' },
  { id: 'support', label: 'Support & audit', permission: 'platform:support' },
  { id: 'settings', label: 'Settings', permission: 'platform:manage_settings' },
  { id: 'developer', label: 'Developer', permission: 'developer:access', developerOnly: true },
];

export default function PlatformAdminPage() {
  const [access, setAccess] = useState<MyPlatformAccess | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<AdminTabId>('overview');

  useEffect(() => {
    PlatformAdminService.getMyAccess()
      .then(setAccess)
      .catch((err) => setError(err.message ?? 'Failed to load platform access'))
      .finally(() => setLoading(false));
  }, []);

  // The visible tab list mirrors the server rules. Hiding a tab is convenience
  // only: each area's data and actions are re-authorised in the database.
  const visibleTabs = useMemo(() => {
    if (!access) return [];
    return TABS.filter((tab) => {
      if (tab.developerOnly && !access.developerMode) return false;
      if (tab.permission === null) return true;
      return access.permissions.includes(tab.permission);
    });
  }, [access]);

  // Keep the selection valid when permissions narrow the list.
  useEffect(() => {
    if (visibleTabs.length === 0) return;
    if (!visibleTabs.some((tab) => tab.id === active)) {
      setActive(visibleTabs[0].id);
    }
  }, [visibleTabs, active]);

  if (loading) return <PageLoader />;

  if (error) {
    return (
      <div className="page">
        <div className="alert alert-error">{error}</div>
      </div>
    );
  }

  if (!access?.isPlatformAdmin || visibleTabs.length === 0) {
    return (
      <div className="page">
        <div className="empty-state">
          This area is for platform administrators. Your account does not have platform access.
        </div>
      </div>
    );
  }

  return (
    <div className="page plat-admin">
      <div className="page-header">
        <div>
          <h1 className="page-title">Platform administration</h1>
          <p className="page-subtitle">
            Products, businesses, plans, payments, and support across the platform
            {access.isSuperAdmin ? ' · signed in as super admin' : ''}
          </p>
        </div>
      </div>

      <nav className="plat-admin-tabs" aria-label="Admin areas">
        {visibleTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`plat-admin-tab${tab.id === active ? ' is-active' : ''}`}
            aria-current={tab.id === active ? 'page' : undefined}
            onClick={() => setActive(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="plat-admin-panel" role="region" aria-label={active}>
        {active === 'overview' && <OverviewSection />}
        {active === 'products' && <ProductsSection />}
        {active === 'plans' && <PlansSection />}
        {active === 'businesses' && <BusinessesSection />}
        {active === 'users' && <UsersSection access={access} />}
        {active === 'payments' && <PaymentsSection />}
        {active === 'activation' && <ActivationSection />}
        {active === 'support' && <SupportSection />}
        {active === 'settings' && <SettingsSection />}
        {active === 'developer' && <DeveloperSection access={access} />}
      </div>
    </div>
  );
}
