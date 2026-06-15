import { useEffect, useState } from 'react';
import { PlatformService } from '../../services/platform.service';
import { Button } from '../../components/ui/Button';
import { PageLoader } from '../../components/ui/PageLoader';
import { getReportDateRange, REPORT_DATE_RANGE_PRESETS, type ReportDateRangePreset } from '../../utils/report-date-ranges';
import type {
  PlatformOverview,
  PlatformInventoryOverview,
  PlatformOrganization,
  PlatformRevenueSummary,
  PlatformRevenueByPlan,
  PlatformSystemHealth,
  PlatformRecentError,
} from '../../types';

const BILLING_STATUS_LABELS: Record<string, string> = {
  trial: 'Trial',
  active: 'Active',
  past_due: 'Past due',
  suspended: 'Suspended',
  cancelled: 'Cancelled',
};

const HEALTHY_BILLING_STATUSES = ['trial', 'active'];

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString();
}

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

  useEffect(() => {
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
      })
      .catch((err) => setError(err.message ?? 'Failed to load platform dashboard'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const { from, to } = getReportDateRange(preset);

    setLoadingRevenue(true);
    Promise.all([PlatformService.getRevenueSummary(from, to), PlatformService.getRevenueByPlan(from, to)])
      .then(([summary, byPlan]) => {
        setRevenueSummary(summary);
        setRevenueByPlan(byPlan);
      })
      .catch((err) => setError(err.message ?? 'Failed to load platform revenue'))
      .finally(() => setLoadingRevenue(false));
  }, [preset]);

  if (loading) return <PageLoader />;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Platform Dashboard</h1>
          <p className="page-subtitle">Cross-organization overview for platform owners</p>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="card">
        <p className="list-item-title" style={{ marginBottom: 8 }}>
          Network at a glance
        </p>
        <div className="stats-grid stats-grid-3">
          <div className="stat-card">
            <p className="stat-label">Branches / shops</p>
            <p className="stat-value">{overview?.totalStores.toLocaleString() ?? 0}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Products</p>
            <p className="stat-value">{inventoryOverview?.totalProducts.toLocaleString() ?? 0}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Staff</p>
            <p className="stat-value">{inventoryOverview?.totalStaff.toLocaleString() ?? 0}</p>
          </div>
        </div>
        <div className="stats-grid">
          <div className="stat-card">
            <p className="stat-label">Inventory worth (cost)</p>
            <p className="stat-value">₦{(inventoryOverview?.inventoryValueCost ?? 0).toLocaleString()}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Inventory worth (retail)</p>
            <p className="stat-value">₦{(inventoryOverview?.inventoryValueRetail ?? 0).toLocaleString()}</p>
          </div>
        </div>
      </div>

      <div className="card">
        <p className="list-item-title" style={{ marginBottom: 8 }}>
          Overview
        </p>
        <div className="total-row">
          <span>Organizations</span>
          <span>{overview?.totalOrganizations.toLocaleString() ?? 0}</span>
        </div>
        <div className="total-row">
          <span>New organizations (30d)</span>
          <span>{overview?.newOrganizations30d.toLocaleString() ?? 0}</span>
        </div>
        <div className="total-row">
          <span>Stores (active / total)</span>
          <span>
            {overview?.activeStores.toLocaleString() ?? 0} / {overview?.totalStores.toLocaleString() ?? 0}
          </span>
        </div>
        <div className="total-row">
          <span>Users</span>
          <span>{overview?.totalUsers.toLocaleString() ?? 0}</span>
        </div>
        <div className="total-row">
          <span>Trialing subscriptions</span>
          <span>{overview?.trialingSubscriptions.toLocaleString() ?? 0}</span>
        </div>
        <div className="total-row">
          <span>Active subscriptions</span>
          <span>{overview?.activeSubscriptions.toLocaleString() ?? 0}</span>
        </div>
        <div className="total-row grand">
          <span>Past-due organizations</span>
          <span>{overview?.pastDueOrganizations.toLocaleString() ?? 0}</span>
        </div>
      </div>

      <div className="card">
        <p className="list-item-title" style={{ marginBottom: 8 }}>
          Organizations
        </p>
        {organizations.length === 0 ? (
          <p className="page-subtitle">No organizations yet.</p>
        ) : (
          <div className="list">
            {organizations.map((org) => (
              <div key={org.orgId} className="list-item">
                <div>
                  <div className="list-item-title">{org.name}</div>
                  <div className="page-subtitle">{org.ownerEmail ?? '—'}</div>
                  <div className="page-subtitle">
                    {org.planName ?? 'No plan'}
                    {org.subscriptionStatus ? ` · ${org.subscriptionStatus}` : ''} · {org.storeCount} store
                    {org.storeCount === 1 ? '' : 's'} · joined {formatDate(org.createdAt)}
                  </div>
                </div>
                <span
                  className={`badge ${HEALTHY_BILLING_STATUSES.includes(org.billingStatus) ? 'badge-default' : 'badge-warning'}`}
                >
                  {BILLING_STATUS_LABELS[org.billingStatus] ?? org.billingStatus}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <p className="list-item-title" style={{ marginBottom: 8 }}>
          Revenue
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
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

        {loadingRevenue ? (
          <PageLoader />
        ) : (
          <>
            <div className="total-row">
              <span>Successful payments</span>
              <span>{revenueSummary?.successfulCount.toLocaleString() ?? 0}</span>
            </div>
            <div className="total-row">
              <span>Failed payments</span>
              <span>{revenueSummary?.failedCount.toLocaleString() ?? 0}</span>
            </div>
            <div className="total-row">
              <span>Total payment attempts</span>
              <span>{revenueSummary?.transactionCount.toLocaleString() ?? 0}</span>
            </div>
            <div className="total-row grand">
              <span>Total revenue</span>
              <span>₦{(revenueSummary?.totalRevenue ?? 0).toLocaleString()}</span>
            </div>

            {revenueByPlan.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <p className="page-subtitle" style={{ marginBottom: 8 }}>
                  By plan
                </p>
                {revenueByPlan.map((p) => (
                  <div key={p.planId} className="movement-row">
                    <div>{p.planName}</div>
                    <div style={{ textAlign: 'right' }}>
                      <div>₦{p.revenue.toLocaleString()}</div>
                      <div className="page-subtitle">
                        {p.transactionCount} transaction{p.transactionCount === 1 ? '' : 's'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="card">
        <p className="list-item-title" style={{ marginBottom: 8 }}>
          System health
        </p>
        <div className="total-row">
          <span>Failed audit events (24h)</span>
          <span>{systemHealth?.failedAuditEvents24h.toLocaleString() ?? 0}</span>
        </div>
        <div className="total-row">
          <span>Failed payments (24h)</span>
          <span>{systemHealth?.failedTransactions24h.toLocaleString() ?? 0}</span>
        </div>
        <div className="total-row">
          <span>Past-due organizations</span>
          <span>{systemHealth?.pastDueOrganizations.toLocaleString() ?? 0}</span>
        </div>
        <div className="total-row grand">
          <span>Suspended organizations</span>
          <span>{systemHealth?.suspendedOrganizations.toLocaleString() ?? 0}</span>
        </div>

        {recentErrors.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <p className="page-subtitle" style={{ marginBottom: 8 }}>
              Recent failed/attempted actions
            </p>
            {recentErrors.map((err) => (
              <div key={err.id} className="movement-row">
                <div>
                  <div>{err.action}</div>
                  <div className="page-subtitle">
                    {err.orgName ?? 'Unknown org'} · {err.actorEmail ?? 'Unknown user'}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span className="badge badge-warning">{err.status}</span>
                  <div className="page-subtitle">{formatDate(err.createdAt)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
