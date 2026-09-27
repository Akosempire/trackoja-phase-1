import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PlatformAdminService, type PlatformAuditLog } from '../../../services/platformAdmin.service';
import { PlatformService } from '../../../services/platform.service';
import { usePlatform } from '../../../components/platform/PlatformContext';
import { AreaCoverage, PlatformPageHead, RefreshButton } from '../../../components/platform/PlatformPageHead';
import { KpiCard, KpiGrid } from '../../../components/ui/KpiCard';
import { MeterList, type MeterItem } from '../../../components/ui/MeterList';
import { SectionHead } from '../../../components/ui/SectionHead';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { Timeline, type TimelineEntry } from '../../../components/ui/Timeline';
import { Button } from '../../../components/ui/Button';
import { StateBlock } from '../../../components/ui/StateBlock';
import { PLATFORM_AREAS } from '../../../config/platformAreas';
import { getReportDateRange, REPORT_DATE_RANGE_PRESETS, type ReportDateRangePreset } from '../../../utils/report-date-ranges';
import { daysUntil, formatMoney, formatMoneyCompact, formatNumber, formatRelative, humaniseToken } from '../../../utils/format';
import type {
  PlatformInventoryOverview,
  PlatformOrganization,
  PlatformOverview,
  PlatformRevenueByPlan,
  PlatformRevenueSummary,
  PlatformRecentError,
} from '../../../types';
import type { PlatformOverviewV2, ProductBusiness } from '../../../services/platformAdmin.service';

const AREA = PLATFORM_AREAS.find((area) => area.id === 'overview')!;

interface OverviewData {
  v2: PlatformOverviewV2;
  legacy: PlatformOverview;
  inventory: PlatformInventoryOverview;
  organizations: PlatformOrganization[];
  entitlements: ProductBusiness[];
  revenueSummary: PlatformRevenueSummary;
  revenueByPlan: PlatformRevenueByPlan[];
  recentErrors: PlatformRecentError[];
  audit: PlatformAuditLog[];
}

/**
 * Reads every Overview source, keeping the ones that worked.
 *
 * Platform reads have different permission gates and one of them failing must
 * not blank the screen — but it must not be hidden either, so the failures are
 * returned and the page says the figures are partial.
 */
function useOverviewData(preset: ReportDateRangePreset) {
  const [data, setData] = useState<Partial<OverviewData>>({});
  const [failed, setFailed] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { from, to } = getReportDateRange(preset);

    const sources: Array<[keyof OverviewData, Promise<unknown>]> = [
      ['v2', PlatformAdminService.getOverview()],
      ['legacy', PlatformService.getOverview()],
      ['inventory', PlatformService.getInventoryOverview()],
      ['organizations', PlatformService.listOrganizations()],
      ['entitlements', PlatformAdminService.listBusinesses({ limit: 200 })],
      ['revenueSummary', PlatformService.getRevenueSummary(from, to)],
      ['revenueByPlan', PlatformService.getRevenueByPlan(from, to)],
      ['recentErrors', PlatformService.getRecentErrors(15)],
      ['audit', PlatformAdminService.listAuditLogs({ limit: 12 }).then((page) => page.entries)],
    ];

    const results = await Promise.allSettled(sources.map(([, promise]) => promise));
    const next: Partial<OverviewData> = {};
    const failures: string[] = [];

    results.forEach((result, index) => {
      const [key] = sources[index];
      if (result.status === 'fulfilled') {
        (next as Record<string, unknown>)[key] = result.value;
      } else {
        failures.push(key);
      }
    });

    setData(next);
    setFailed(failures);
    setLoading(false);
  }, [preset]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, failed, loading, reload: load };
}

export default function OverviewArea() {
  const navigate = useNavigate();
  const { access, environment } = usePlatform();
  const [preset, setPreset] = useState<ReportDateRangePreset>('last30');
  const { data, failed, loading, reload } = useOverviewData(preset);

  const organizations = data.organizations ?? [];
  const entitlements = data.entitlements ?? [];

  /**
   * Sandbox business ids.
   *
   * `list_platform_organizations` does not return the sandbox flag (it predates
   * the column), so the flag is taken from the entitlement rows, which do carry
   * it, and matched by organisation id.
   */
  const sandboxOrgIds = useMemo(
    () => new Set(entitlements.filter((row) => row.isSandbox).map((row) => row.orgId)),
    [entitlements],
  );

  /**
   * Business lifecycle counts.
   *
   * `billing_status` is the legacy organisation column and is the only place a
   * suspended business is recorded today, because no suspend endpoint exists.
   */
  const businessCounts = useMemo(() => {
    const live = organizations.filter((org) => !sandboxOrgIds.has(org.orgId));
    return {
      total: data.v2?.totalBusinesses ?? live.length,
      trial: live.filter((org) => org.billingStatus === 'trial').length,
      active: live.filter((org) => org.billingStatus === 'active').length,
      suspended: live.filter((org) => org.billingStatus === 'suspended').length,
      new30d: data.legacy?.newOrganizations30d ?? 0,
      stores: data.legacy?.totalStores ?? 0,
      users: data.legacy?.totalUsers ?? 0,
    };
  }, [organizations, sandboxOrgIds, data.v2, data.legacy]);

  /** Entitlement-derived counts. These are the numbers billing actually keys off. */
  const entitlementCounts = useMemo(() => {
    const live = entitlements.filter((row) => !row.isSandbox);
    const now = Date.now();
    let expiring = 0;
    let expired = 0;
    let renewalsNext30 = 0;
    for (const row of live) {
      const days = daysUntil(row.expiresAt, now);
      if (days === null) continue;
      if (days < 0) expired += 1;
      else if (days <= 30) {
        expiring += 1;
        renewalsNext30 += 1;
      }
    }
    return {
      active: live.filter((row) => row.entitlementStatus === 'active').length,
      trialing: live.filter((row) => row.entitlementStatus === 'pending').length,
      pastDue: live.filter((row) => row.entitlementStatus === 'past_due').length,
      suspended: live.filter((row) => row.entitlementStatus === 'suspended').length,
      cancelled: live.filter((row) => row.entitlementStatus === 'cancelled').length,
      expiring,
      renewalsNext30,
      expired,
    };
  }, [entitlements]);

  const revenueMeters = useMemo<MeterItem[]>(() => {
    const rows = data.revenueByPlan ?? [];
    return rows
      .filter((row) => row.revenue > 0)
      .map((row) => ({
        label: row.planName,
        value: row.revenue,
        display: formatMoneyCompact(row.revenue),
        detail: `${formatNumber(row.transactionCount)} txn`,
      }));
  }, [data.revenueByPlan]);

  const activityEntries = useMemo<TimelineEntry[]>(() => {
    if (data.audit && data.audit.length > 0) {
      return data.audit.map((entry) => ({
        id: entry.id,
        title: humaniseToken(entry.action),
        meta: `${entry.actorEmail ?? 'System'} · ${entry.orgName ?? 'Platform-wide'} · ${formatRelative(entry.createdAt)}`,
        text: entry.resourceName ? `${humaniseToken(entry.resourceType)}: ${entry.resourceName}` : undefined,
        tone: entry.status === 'failed' ? 'danger' : entry.status === 'attempted' ? 'accent' : 'success',
      }));
    }
    return (data.recentErrors ?? []).map((entry) => ({
      id: entry.id,
      title: humaniseToken(entry.action),
      meta: `${entry.actorEmail ?? 'System'} · ${entry.orgName ?? 'Platform-wide'} · ${formatRelative(entry.createdAt)}`,
      text: entry.resourceName ?? undefined,
      tone: entry.status === 'failed' ? 'danger' : 'accent',
    }));
  }, [data.audit, data.recentErrors]);

  const signal = data.v2;
  const partial = failed.length > 0;

  return (
    <>
      <PlatformPageHead
        area={AREA}
        description={`What needs attention across every business. Signed in as ${access?.isSuperAdmin ? 'platform owner' : 'platform admin'} in ${environment.label.toLowerCase()}.`}
        actions={<RefreshButton onClick={reload} loading={loading} />}
      />

      {partial && (
        <div className="callout callout-warning" role="status">
          <div>
            <p className="callout-title">Some figures could not be loaded</p>
            <p className="callout-text">
              {failed.length} of 9 sources failed to return data ({failed.join(', ')}). Everything shown below is
              correct for the sources that answered; treat the rest as unknown rather than zero.
            </p>
          </div>
        </div>
      )}

      <AreaCoverage gaps={AREA.gaps} title="What this page cannot show yet" />

      {/* ── Needs attention ───────────────────────────────────────── */}
      <section className="card" aria-labelledby="overview-attention">
        <SectionHead
          id="overview-attention"
          title="Needs attention"
          sub="Each figure opens the filtered list behind it."
        />
        <KpiGrid>
          <KpiCard
            label="Failed payments (30 days)"
            value={loading ? '—' : formatNumber(signal?.failedPayments30d)}
            tone={(signal?.failedPayments30d ?? 0) > 0 ? 'danger' : 'default'}
            foot={signal?.failedPayments30d ? 'Money that did not arrive' : 'Nothing failed'}
            onClick={() => navigate(`/platform/billing?filter=failed`)}
          />
          <KpiCard
            label="Past due"
            value={loading ? '—' : formatNumber(entitlementCounts.pastDue)}
            tone={entitlementCounts.pastDue > 0 ? 'danger' : 'default'}
            foot={entitlementCounts.pastDue > 0 ? 'Access at risk' : 'Nothing overdue'}
            onClick={() => navigate(`/platform/billing?filter=past_due`)}
          />
          <KpiCard
            label="Renewals in 30 days"
            value={loading ? '—' : formatNumber(entitlementCounts.renewalsNext30)}
            tone={entitlementCounts.renewalsNext30 > 0 ? 'warning' : 'default'}
            foot="Entitlements expiring soon"
            onClick={() => navigate(`/platform/billing?filter=expiring`)}
          />
          <KpiCard
            label="Expired access"
            value={loading ? '—' : formatNumber(entitlementCounts.expired)}
            tone={entitlementCounts.expired > 0 ? 'danger' : 'default'}
            foot={entitlementCounts.expired > 0 ? 'Businesses locked out' : 'None lapsed'}
            onClick={() => navigate(`/platform/billing?filter=expired`)}
          />
        </KpiGrid>
      </section>

      {/* ── Businesses ────────────────────────────────────────────── */}
      <section className="card" aria-labelledby="overview-businesses">
        <SectionHead
          id="overview-businesses"
          title="Businesses"
          sub="Live customer businesses, excluding sandbox records."
        />
        <KpiGrid>
          <KpiCard
            label="Total businesses"
            value={loading ? '—' : formatNumber(businessCounts.total)}
            foot={`${formatNumber(businessCounts.stores)} stores · ${formatNumber(businessCounts.users)} users`}
            onClick={() => navigate('/platform/businesses')}
          />
          <KpiCard
            label="On trial"
            value={loading ? '—' : formatNumber(businessCounts.trial)}
            foot="Convert before the trial ends"
            onClick={() => navigate('/platform/businesses?billing=trial')}
          />
          <KpiCard
            label="Paying"
            value={loading ? '—' : formatNumber(businessCounts.active)}
            foot="Billing status active"
            onClick={() => navigate('/platform/businesses?billing=active')}
          />
          <KpiCard
            label="Suspended"
            value={loading ? '—' : formatNumber(businessCounts.suspended)}
            tone={businessCounts.suspended > 0 ? 'warning' : 'default'}
            foot={businessCounts.suspended > 0 ? 'Access withdrawn' : 'None suspended'}
            onClick={() => navigate('/platform/businesses?billing=suspended')}
          />
          <KpiCard
            label="New in 30 days"
            value={loading ? '—' : formatNumber(businessCounts.new30d)}
            foot="Signed up recently"
            onClick={() => navigate('/platform/businesses?sort=newest')}
          />
        </KpiGrid>
      </section>

      {/* ── Subscriptions ─────────────────────────────────────────── */}
      <section className="card" aria-labelledby="overview-subscriptions">
        <SectionHead
          id="overview-subscriptions"
          title="Subscriptions & access"
          sub="Entitlement status is what actually grants a business access, and what the seat limit enforces."
          actions={
            <Button variant="ghost" className="btn-sm" onClick={() => navigate(`/platform/billing`)}>
              Open billing
            </Button>
          }
        />
        <KpiGrid>
          <KpiCard
            label="Active entitlements"
            value={loading ? '—' : formatNumber(entitlementCounts.active)}
            foot="Current access"
            onClick={() => navigate('/platform/billing?filter=active')}
          />
          <KpiCard
            label="Trialing"
            value={loading ? '—' : formatNumber(entitlementCounts.trialing)}
            foot="Trial period, not yet paid"
            onClick={() => navigate('/platform/billing?filter=trialing')}
          />
          <KpiCard
            label="Suspended"
            value={loading ? '—' : formatNumber(entitlementCounts.suspended)}
            foot="Entitlement withdrawn"
            onClick={() => navigate('/platform/billing?filter=suspended')}
          />
          <KpiCard
            label="Cancelled"
            value={loading ? '—' : formatNumber(entitlementCounts.cancelled)}
            foot="Ended by request"
            onClick={() => navigate('/platform/billing?filter=cancelled')}
          />
        </KpiGrid>
        {entitlementCounts.expired > 0 && (
          <div className="callout callout-danger">
            <div>
              <p className="callout-title">{entitlementCounts.expired} entitlements have passed their expiry date</p>
              <p className="callout-text">
                Nothing sweeps lapsed entitlements, so these still read as active in the counts above. Their access
                ends when the seat check next runs, not on the expiry date.
              </p>
            </div>
          </div>
        )}
      </section>

      {/* ── Revenue ───────────────────────────────────────────────── */}
      <section className="card" aria-labelledby="overview-revenue">
        <SectionHead
          id="overview-revenue"
          title="Revenue"
          sub="Platform subscription payments in the selected period. Sandbox transactions are excluded."
          actions={
            <div className="toolbar-group">
              {REPORT_DATE_RANGE_PRESETS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`chip${preset === option.value ? ' active' : ''}`}
                  aria-pressed={preset === option.value}
                  onClick={() => setPreset(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          }
        />
        <KpiGrid>
          <KpiCard
            label="Revenue in period"
            value={loading ? '—' : formatMoney(data.revenueSummary?.totalRevenue ?? 0)}
            foot={`${formatNumber(data.revenueSummary?.successfulCount ?? 0)} successful payments`}
          />
          <KpiCard
            label="Failed payments"
            value={loading ? '—' : formatNumber(data.revenueSummary?.failedCount ?? 0)}
            tone={(data.revenueSummary?.failedCount ?? 0) > 0 ? 'warning' : 'default'}
            foot={`${formatNumber(data.revenueSummary?.transactionCount ?? 0)} attempts in total`}
            onClick={() => navigate('/platform/billing?filter=failed')}
          />
          <KpiCard
            label="Revenue (30 days)"
            value={loading ? '—' : formatMoneyCompact(signal?.revenue30d)}
            foot="Rolling window from the entitlement table"
          />
        </KpiGrid>

        <div style={{ marginTop: 'var(--space-16)' }}>
          <SectionHead title="Revenue by plan" sub="Which tiers are actually earning." />
          {revenueMeters.length > 0 ? (
            <MeterList items={revenueMeters} />
          ) : (
            <StateBlock
              variant="empty"
              title="No revenue recorded in this period"
              body="No subscription payment succeeded in the selected range. Try a longer period."
            />
          )}
        </div>
      </section>

      {/* ── Platform signals ──────────────────────────────────────── */}
      <section className="card" aria-labelledby="overview-signals">
        <SectionHead
          id="overview-signals"
          title="Platform signals"
          sub="Counters derived from business records over the last 24 hours. These are not infrastructure health checks."
          actions={
            <Button variant="ghost" className="btn-sm" onClick={() => navigate('/platform/health')}>
              System health
            </Button>
          }
        />
        {data.recentErrors || data.v2 ? (
          <KpiGrid>
            <KpiCard
              label="Recent failed events"
              value={formatNumber((data.recentErrors ?? []).length)}
              tone={(data.recentErrors ?? []).length > 0 ? 'warning' : 'default'}
              foot="Audit rows recorded as failed or attempted"
              onClick={() => navigate('/platform/audit?status=failed')}
            />
            <KpiCard
              label="Sandbox businesses"
              value={formatNumber(signal?.sandboxBusinesses)}
              foot="Excluded from every figure above"
              onClick={() => navigate('/platform/developer')}
            />
            <KpiCard
              label="Inventory value (retail)"
              value={formatMoneyCompact(data.inventory?.inventoryValueRetail)}
              foot={`${formatNumber(data.inventory?.totalProducts)} products across all businesses`}
            />
            <KpiCard
              label="Staff accounts"
              value={formatNumber(data.inventory?.totalStaff)}
              foot="Seat usage across all businesses"
            />
          </KpiGrid>
        ) : (
          <StateBlock variant="unavailable" title="Not configured" body="The platform signal counters did not return." />
        )}
      </section>

      {/* ── Activity ──────────────────────────────────────────────── */}
      <section className="card" aria-labelledby="overview-activity">
        <SectionHead
          id="overview-activity"
          title="Recent platform activity"
          sub={
            data.audit
              ? 'Administrative actions recorded in the audit trail.'
              : 'The audit browse endpoint is unavailable, so this falls back to failed and attempted events only.'
          }
          actions={
            <Button variant="ghost" className="btn-sm" onClick={() => navigate('/platform/audit')}>
              All audit logs
            </Button>
          }
        />
        <Timeline items={activityEntries} />
      </section>

      {/* ── Not wired yet ─────────────────────────────────────────── */}
      <section className="card" aria-labelledby="overview-unavailable">
        <SectionHead
          id="overview-unavailable"
          title="Not connected yet"
          sub="These areas have no backend, so they show nothing rather than a placeholder figure."
        />
        <ul className="list">
          {PLATFORM_AREAS.filter((area) => area.capability === 'specified').map((area) => (
            <li className="list-item" key={area.id}>
              <div>
                <p className="list-item-title">
                  {area.label} <StatusBadge status="not_configured" />
                </p>
                <p className="list-item-subtitle">{area.gaps?.[0]}</p>
              </div>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => navigate(`/platform/${area.path}`)}>
                <span className="btn-label">Open</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <p className="section-sub">
        Sandbox records are excluded from every figure on this page. Counts are a snapshot taken when the page
        loaded; press Refresh to re-read them.
      </p>
    </>
  );
}
