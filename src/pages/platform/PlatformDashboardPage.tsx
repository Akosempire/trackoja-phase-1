import { useEffect, useMemo, useState } from 'react';
import { PlatformService } from '../../services/platform.service';
import { Button } from '../../components/ui/Button';
import { PageLoader } from '../../components/ui/PageLoader';
import { getReportDateRange, REPORT_DATE_RANGE_PRESETS, type ReportDateRangePreset } from '../../utils/report-date-ranges';
import { CATEGORY_CONFIGS } from '../../config/businessModules';
import type {
  PlatformOverview,
  PlatformInventoryOverview,
  PlatformOrganization,
  PlatformRevenueSummary,
  PlatformRevenueByPlan,
  PlatformSystemHealth,
  PlatformRecentError,
} from '../../types';

const BILLING_LABELS: Record<string, string> = {
  trial: 'Trial',
  active: 'Active',
  past_due: 'Past due',
  suspended: 'Suspended',
  cancelled: 'Cancelled',
};

const BILLING_BADGE: Record<string, string> = {
  trial: 'badge-default',
  active: 'badge-success',
  past_due: 'badge-warning',
  suspended: 'badge-error',
  cancelled: 'badge-error',
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatMoney(n: number): string {
  if (n >= 1_000_000) return `₦${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `₦${(n / 1_000).toFixed(0)}K`;
  return `₦${n.toLocaleString()}`;
}

function categoryEmoji(cat: string): string {
  return CATEGORY_CONFIGS[cat as keyof typeof CATEGORY_CONFIGS]?.emoji ?? '🏪';
}

function categoryLabel(cat: string): string {
  return CATEGORY_CONFIGS[cat as keyof typeof CATEGORY_CONFIGS]?.label ?? cat;
}

type BillingFilter = 'all' | 'trial' | 'active' | 'past_due' | 'suspended';

export default function PlatformDashboardPage() {
  const [overview, setOverview] = useState<PlatformOverview | null>(null);
  const [inventoryOverview, setInventoryOverview] = useState<PlatformInventoryOverview | null>(null);
  const [organizations, setOrganizations] = useState<PlatformOrganization[]>([]);
  const [systemHealth, setSystemHealth] = useState<PlatformSystemHealth | null>(null);
  const [recentErrors, setRecentErrors] = useState<PlatformRecentError[]>([]);

  const [preset, setPreset] = useState<ReportDateRangePreset>('last30');
  const [revenueSummary, setRevenueSummary] = useState<PlatformRevenueSummary | null>(null);
  const [revenueByPlan, setRevenueByPlan] = useState<PlatformRevenueByPlan[]>([]);

  const [loading, setLoading] = useState(true);
  const [loadingRevenue, setLoadingRevenue] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState(new Date());

  const [search, setSearch] = useState('');
  const [billingFilter, setBillingFilter] = useState<BillingFilter>('all');

  const load = () => {
    setLoading(true);
    Promise.all([
      PlatformService.getOverview(),
      PlatformService.getInventoryOverview(),
      PlatformService.listOrganizations(),
      PlatformService.getSystemHealth(),
      PlatformService.getRecentErrors(20),
    ])
      .then(([ov, inv, orgs, health, errors]) => {
        setOverview(ov);
        setInventoryOverview(inv);
        setOrganizations(orgs);
        setSystemHealth(health);
        setRecentErrors(errors);
        setRefreshedAt(new Date());
      })
      .catch((err) => setError(err.message ?? 'Failed to load platform dashboard'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  useEffect(() => {
    const { from, to } = getReportDateRange(preset);
    setLoadingRevenue(true);
    Promise.all([PlatformService.getRevenueSummary(from, to), PlatformService.getRevenueByPlan(from, to)])
      .then(([summary, byPlan]) => {
        setRevenueSummary(summary);
        setRevenueByPlan(byPlan);
      })
      .catch((err) => setError(err.message ?? 'Failed to load revenue'))
      .finally(() => setLoadingRevenue(false));
  }, [preset]);

  const filteredOrgs = useMemo(() => {
    return organizations.filter((o) => {
      if (billingFilter !== 'all' && o.billingStatus !== billingFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !o.name.toLowerCase().includes(q) &&
          !o.ownerEmail?.toLowerCase().includes(q) &&
          !categoryLabel(o.businessCategory).toLowerCase().includes(q)
        ) return false;
      }
      return true;
    });
  }, [organizations, search, billingFilter]);

  // Category breakdown counts
  const categoryBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const org of organizations) {
      counts[org.businessCategory] = (counts[org.businessCategory] ?? 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [organizations]);

  const healthStatus = (val: number, warnAt = 1, dangerAt = 5) => {
    if (val >= dangerAt) return 'plat-health-danger';
    if (val >= warnAt) return 'plat-health-warn';
    return 'plat-health-ok';
  };

  if (loading) return <PageLoader />;

  return (
    <div className="page">
      {/* ── Header ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Platform Dashboard</h1>
          <p className="page-subtitle">Updated {timeAgo(refreshedAt.toISOString())}</p>
        </div>
        <Button variant="ghost" className="btn-sm" onClick={load}>
          Refresh
        </Button>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}

      {/* ── KPI Strip ── */}
      <div className="plat-kpi-grid">
        <div className="plat-kpi-card">
          <p className="plat-kpi-value">{overview?.totalOrganizations ?? 0}</p>
          <p className="plat-kpi-label">Organizations</p>
          {(overview?.newOrganizations30d ?? 0) > 0 && (
            <p className="plat-kpi-sub">+{overview!.newOrganizations30d} this month</p>
          )}
        </div>
        <div className="plat-kpi-card">
          <p className="plat-kpi-value">{overview?.totalUsers ?? 0}</p>
          <p className="plat-kpi-label">Users</p>
        </div>
        <div className="plat-kpi-card">
          <p className="plat-kpi-value">{overview?.trialingSubscriptions ?? 0}</p>
          <p className="plat-kpi-label">On trial</p>
        </div>
        <div className="plat-kpi-card plat-kpi-brand">
          <p className="plat-kpi-value">{overview?.activeSubscriptions ?? 0}</p>
          <p className="plat-kpi-label">Active subs</p>
        </div>
        <div className={`plat-kpi-card ${(overview?.pastDueOrganizations ?? 0) > 0 ? 'plat-kpi-danger' : ''}`}>
          <p className="plat-kpi-value">{overview?.pastDueOrganizations ?? 0}</p>
          <p className="plat-kpi-label">Past due</p>
        </div>
      </div>

      {/* ── System Health ── */}
      <div className="card">
        <p className="plat-section-title">System Health</p>
        <div className="plat-health-grid">
          <div className={`plat-health-item ${healthStatus(systemHealth?.failedAuditEvents24h ?? 0)}`}>
            <p className="plat-health-value">{systemHealth?.failedAuditEvents24h ?? 0}</p>
            <p className="plat-health-label">Failed audit events (24h)</p>
          </div>
          <div className={`plat-health-item ${healthStatus(systemHealth?.failedTransactions24h ?? 0)}`}>
            <p className="plat-health-value">{systemHealth?.failedTransactions24h ?? 0}</p>
            <p className="plat-health-label">Failed payments (24h)</p>
          </div>
          <div className={`plat-health-item ${healthStatus(systemHealth?.pastDueOrganizations ?? 0)}`}>
            <p className="plat-health-value">{systemHealth?.pastDueOrganizations ?? 0}</p>
            <p className="plat-health-label">Past-due orgs</p>
          </div>
          <div className={`plat-health-item ${healthStatus(systemHealth?.suspendedOrganizations ?? 0)}`}>
            <p className="plat-health-value">{systemHealth?.suspendedOrganizations ?? 0}</p>
            <p className="plat-health-label">Suspended orgs</p>
          </div>
        </div>

        {recentErrors.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <p className="plat-section-sub">Recent failed events</p>
            <div className="list">
              {recentErrors.slice(0, 8).map((err) => (
                <div key={err.id} className="list-item">
                  <div>
                    <p className="list-item-title">{err.action.replace(/_/g, ' ')}</p>
                    <p className="list-item-subtitle">{err.orgName ?? '—'} · {err.actorEmail ?? '—'} · {timeAgo(err.createdAt)}</p>
                  </div>
                  <span className="badge badge-warning">{err.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Merchants ── */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <p className="plat-section-title" style={{ margin: 0 }}>
            Merchants ({filteredOrgs.length}{filteredOrgs.length !== organizations.length ? ` of ${organizations.length}` : ''})
          </p>
        </div>

        <div className="plat-search-row">
          <input
            type="text"
            className="input"
            placeholder="Search by name, email or industry…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 1 }}
          />
          <div className="plat-filter-pills">
            {(['all', 'trial', 'active', 'past_due', 'suspended'] as BillingFilter[]).map((f) => (
              <button
                key={f}
                type="button"
                className={`plat-filter-pill${billingFilter === f ? ' active' : ''}`}
                onClick={() => setBillingFilter(f)}
              >
                {f === 'all' ? 'All' : BILLING_LABELS[f]}
              </button>
            ))}
          </div>
        </div>

        {filteredOrgs.length === 0 ? (
          <p className="list-item-subtitle" style={{ textAlign: 'center', padding: '20px 0' }}>No merchants match your search.</p>
        ) : (
          <div className="list">
            {filteredOrgs.map((org) => (
              <div key={org.orgId} className="plat-org-row">
                <div className="plat-org-category">{categoryEmoji(org.businessCategory)}</div>
                <div className="plat-org-info">
                  <p className="plat-org-name">{org.name}</p>
                  <p className="list-item-subtitle">{org.ownerEmail ?? '—'}</p>
                  <p className="list-item-subtitle">
                    {categoryLabel(org.businessCategory)} · {org.storeCount} store{org.storeCount !== 1 ? 's' : ''}
                    {org.planName ? ` · ${org.planName}` : ''}
                  </p>
                </div>
                <div className="plat-org-meta">
                  <span className={`badge ${BILLING_BADGE[org.billingStatus] ?? 'badge-default'}`}>
                    {BILLING_LABELS[org.billingStatus] ?? org.billingStatus}
                  </span>
                  <p className="list-item-subtitle" style={{ textAlign: 'right', marginTop: 4 }}>
                    {timeAgo(org.createdAt)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Industry Breakdown ── */}
      {categoryBreakdown.length > 0 && (
        <div className="card">
          <p className="plat-section-title">Industries</p>
          <div className="plat-category-breakdown">
            {categoryBreakdown.map(([cat, count]) => (
              <div key={cat} className="plat-category-row">
                <span className="plat-category-emoji">{categoryEmoji(cat)}</span>
                <span className="plat-category-name">{categoryLabel(cat)}</span>
                <div className="plat-category-bar-wrap">
                  <div
                    className="plat-category-bar"
                    style={{ width: `${Math.round((count / organizations.length) * 100)}%` }}
                  />
                </div>
                <span className="plat-category-count">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Network Inventory ── */}
      <div className="card">
        <p className="plat-section-title">Network Inventory</p>
        <div className="stats-grid stats-grid-3">
          <div className="stat-card">
            <p className="stat-label">Products</p>
            <p className="stat-value">{(inventoryOverview?.totalProducts ?? 0).toLocaleString()}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Staff</p>
            <p className="stat-value">{(inventoryOverview?.totalStaff ?? 0).toLocaleString()}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Stores</p>
            <p className="stat-value">{overview?.activeStores ?? 0} / {overview?.totalStores ?? 0}</p>
          </div>
        </div>
        <div className="stats-grid" style={{ marginTop: 10 }}>
          <div className="stat-card">
            <p className="stat-label">Inventory value (cost)</p>
            <p className="stat-value">{formatMoney(inventoryOverview?.inventoryValueCost ?? 0)}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Inventory value (retail)</p>
            <p className="stat-value">{formatMoney(inventoryOverview?.inventoryValueRetail ?? 0)}</p>
          </div>
        </div>
      </div>

      {/* ── Platform Revenue ── */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <p className="plat-section-title" style={{ margin: 0 }}>Platform Revenue</p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {REPORT_DATE_RANGE_PRESETS.map((p) => (
              <Button
                key={p.value}
                className="btn-sm"
                variant={preset === p.value ? 'primary' : 'ghost'}
                onClick={() => setPreset(p.value)}
              >
                {p.label}
              </Button>
            ))}
          </div>
        </div>

        {loadingRevenue ? (
          <PageLoader />
        ) : (
          <>
            <div className="plat-revenue-highlight">
              <p className="plat-revenue-value">{formatMoney(revenueSummary?.totalRevenue ?? 0)}</p>
              <p className="plat-revenue-sub">
                {revenueSummary?.successfulCount ?? 0} successful · {revenueSummary?.failedCount ?? 0} failed · {revenueSummary?.transactionCount ?? 0} total
              </p>
            </div>

            {revenueByPlan.length > 0 ? (
              <div style={{ marginTop: 12 }}>
                <p className="plat-section-sub">By plan</p>
                {revenueByPlan.map((p) => {
                  const pct = revenueSummary?.totalRevenue
                    ? Math.round((p.revenue / revenueSummary.totalRevenue) * 100)
                    : 0;
                  return (
                    <div key={p.planId} className="plat-plan-row">
                      <div className="plat-plan-info">
                        <span className="plat-plan-name">{p.planName}</span>
                        <span className="list-item-subtitle">{p.transactionCount} transaction{p.transactionCount !== 1 ? 's' : ''}</span>
                      </div>
                      <div className="plat-plan-bar-wrap">
                        <div className="plat-plan-bar" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="plat-plan-amount">{formatMoney(p.revenue)}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="list-item-subtitle" style={{ textAlign: 'center', marginTop: 12 }}>No revenue data for this period.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
