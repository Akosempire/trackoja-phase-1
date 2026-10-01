import { DashboardRevenuePanel, DashboardWelcome } from '../../../components/ui/DashboardRevenuePanel';
import type { ReportDateRange } from '../../../utils/report-date-ranges';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PlatformAdminService, type PlatformAuditLog } from '../../../services/platformAdmin.service';
import { PlatformService } from '../../../services/platform.service';
import { usePlatform } from '../../../components/platform/PlatformContext';
import { AreaCoverage, PlatformPageHead, RefreshButton } from '../../../components/platform/PlatformPageHead';
import { AttentionList, HealthyStrip, type AttentionItem } from '../../../components/ui/AttentionList';
import { SectionHead } from '../../../components/ui/SectionHead';
import { Timeline, type TimelineEntry } from '../../../components/ui/Timeline';
import { Button } from '../../../components/ui/Button';
import { StateBlock } from '../../../components/ui/StateBlock';
import { PLATFORM_AREAS } from '../../../config/platformAreas';
import { daysUntil, formatNumber, formatRelative, humaniseToken } from '../../../utils/format';
import { getReportDateRange } from '../../../utils/report-date-ranges';
import type { PlatformInventoryOverview, PlatformOrganization, PlatformOverview, PlatformRecentError, PlatformRevenueSummary } from '../../../types';
import type { PlatformOverviewV2, ProductBusiness } from '../../../services/platformAdmin.service';
import {
  HomeBar,
  HomeBars,
  HomeDashboardSkeleton,
  HomeDonut,
  HomeMetricCard,
  HomePanel,
  type HomeMetric,
  type HomeSlice,
} from '../../../components/home/HomeDashboard';
import '../../../styles/platform-overview.css';

const AREA = PLATFORM_AREAS.find((area) => area.id === 'overview')!;

interface OverviewData {
  v2: PlatformOverviewV2;
  legacy: PlatformOverview;
  inventory: PlatformInventoryOverview;
  organizations: PlatformOrganization[];
  entitlements: ProductBusiness[];
  revenue: PlatformRevenueSummary;
  recentErrors: PlatformRecentError[];
  audit: PlatformAuditLog[];
  unredeemedKeys: number;
}

/**
 * Reads the Overview sources, keeping whichever answered.
 *
 * A failing source must not blank the screen, but it must not be hidden either:
 * how many failed is returned so the page can say the figures are partial. The
 * activation-key read is skipped entirely when the operator lacks the
 * permission, so an expected refusal is never reported as a failure.
 */
function useOverviewData(canSeeActivation: boolean) {
  const [data, setData] = useState<Partial<OverviewData>>({});
  const [failed, setFailed] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { from, to } = getReportDateRange('last30');

    const sources: Array<[keyof OverviewData, Promise<unknown>]> = [
      ['v2', PlatformAdminService.getOverview()],
      ['legacy', PlatformService.getOverview()],
      ['inventory', PlatformService.getInventoryOverview()],
      ['organizations', PlatformService.listOrganizations()],
      ['entitlements', PlatformAdminService.listBusinesses({ limit: 200 })],
      ['revenue', PlatformService.getRevenueSummary(from, to)],
      ['recentErrors', PlatformService.getRecentErrors(15)],
      ['audit', PlatformAdminService.listAuditLogs({ limit: 6 }).then((page) => page.entries)],
    ];

    if (canSeeActivation) {
      // A key that was issued and never redeemed is a customer who has paid and
      // still has no access — worth surfacing, not just listed on its own screen.
      sources.push([
        'unredeemedKeys',
        PlatformAdminService.listActivationKeys({ status: 'issued', limit: 100 }).then((rows) => rows.length),
      ]);
    }

    const results = await Promise.allSettled(sources.map(([, promise]) => promise));
    const next: Partial<OverviewData> = {};
    let failures = 0;

    results.forEach((result, index) => {
      const [key] = sources[index];
      if (result.status === 'fulfilled') (next as Record<string, unknown>)[key] = result.value;
      else failures += 1;
    });

    setData(next);
    setFailed(failures);
    setTotal(sources.length);
    setLoading(false);
  }, [canSeeActivation]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, failed, total, loading, reload: load };
}

async function loadPlatformRevenue({ from, to }: ReportDateRange) {
  const [summary, plans] = await Promise.all([
    PlatformService.getRevenueSummary(from, to),
    PlatformService.getRevenueByPlan(from, to).catch(() => null),
  ]);
  return { total: summary.totalRevenue, count: summary.successfulCount,
    rows: plans?.map(row => ({ key: row.planId, label: row.planName, amount: row.revenue })) ?? null };
}

export default function OverviewArea() {
  const navigate = useNavigate();
  const [revenueRevision, setRevenueRevision] = useState(0);
  const { access, can } = usePlatform();
  const canSeeActivation = can('platform:manage_activation');
  const { data, failed, loading, reload } = useOverviewData(canSeeActivation);

  const organizations = data.organizations ?? [];
  const entitlements = data.entitlements ?? [];

  /** `list_platform_organizations` predates the sandbox column, so it is read off the entitlements. */
  const sandboxOrgIds = useMemo(
    () => new Set(entitlements.filter((row) => row.isSandbox).map((row) => row.orgId)),
    [entitlements],
  );

  const counts = useMemo(() => {
    const live = organizations.filter((org) => !sandboxOrgIds.has(org.orgId));
    const liveEntitlements = entitlements.filter((row) => !row.isSandbox);

    const now = Date.now();
    let expiring = 0;
    let expired = 0;
    let soonestExpiry: string | null = null;

    for (const row of liveEntitlements) {
      const days = daysUntil(row.expiresAt, now);
      if (days === null) continue;
      if (days < 0) expired += 1;
      else if (days <= 30) {
        expiring += 1;
        if (!soonestExpiry || (row.expiresAt ?? '') < soonestExpiry) soonestExpiry = row.expiresAt;
      }
    }

    return {
      businesses: live.length,
      trial: live.filter((org) => org.billingStatus === 'trial').length,
      paying: live.filter((org) => org.billingStatus === 'active').length,
      suspendedBusinesses: live.filter((org) => org.billingStatus === 'suspended').length,
      new30d: data.legacy?.newOrganizations30d ?? 0,
      activeSubs: liveEntitlements.filter((row) => row.entitlementStatus === 'active').length,
      trialingSubs: liveEntitlements.filter((row) => row.entitlementStatus === 'pending').length,
      pastDueSubs: liveEntitlements.filter((row) => row.entitlementStatus === 'past_due').length,
      expiring,
      expired,
      soonestExpiry,
      failedPayments: data.revenue?.failedCount ?? data.v2?.failedPayments30d ?? 0,
      revenue30d: data.revenue?.totalRevenue ?? data.v2?.revenue30d ?? 0,
      successfulPayments: data.revenue?.successfulCount ?? 0,
      failedEvents: (data.recentErrors ?? []).length,
      sandbox: data.v2?.sandboxBusinesses ?? 0,
      unredeemedKeys: data.unredeemedKeys ?? 0,
    };
  }, [organizations, entitlements, sandboxOrgIds, data.legacy, data.revenue, data.v2, data.recentErrors, data.unredeemedKeys]);

  /*
   * The queue. Every entry is something an operator can act on today, in the
   * order that costs the most if it is left: money that did not arrive, access
   * about to lapse, access already lapsed, then a business that is switched off.
   */
  const attention = useMemo<AttentionItem[]>(() => {
    const items: AttentionItem[] = [];

    if (counts.failedPayments > 0) {
      items.push({
        id: 'failed-payments',
        tone: 'danger',
        title: `${formatNumber(counts.failedPayments)} failed payment${counts.failedPayments === 1 ? '' : 's'}`,
        meta: `Last 30 days. ${formatNumber(counts.successfulPayments)} succeeded in the same period.`,
        action: (
          <Button variant="outline" className="btn-sm" onClick={() => navigate('/platform/billing?filter=failed')}>
            Review
          </Button>
        ),
      });
    }

    if (counts.pastDueSubs > 0) {
      items.push({
        id: 'past-due',
        tone: 'danger',
        title: `${formatNumber(counts.pastDueSubs)} subscription${counts.pastDueSubs === 1 ? '' : 's'} past due`,
        meta: 'Access continues until the seat check next runs.',
        action: (
          <Button variant="outline" className="btn-sm" onClick={() => navigate('/platform/billing?filter=past_due')}>
            Review
          </Button>
        ),
      });
    }

    if (counts.expiring > 0) {
      items.push({
        id: 'expiring',
        tone: 'warning',
        title: `${formatNumber(counts.expiring)} expiring within 30 days`,
        meta: counts.soonestExpiry
          ? `Soonest ${formatRelative(counts.soonestExpiry)}.`
          : 'Renewals to confirm.',
        action: (
          <Button variant="outline" className="btn-sm" onClick={() => navigate('/platform/billing?filter=expiring')}>
            Review
          </Button>
        ),
      });
    }

    if (counts.expired > 0) {
      items.push({
        id: 'expired',
        tone: 'danger',
        title: `${formatNumber(counts.expired)} past their expiry date`,
        meta: 'Nothing sweeps these, so they still read as active in the counts below.',
        action: (
          <Button variant="outline" className="btn-sm" onClick={() => navigate('/platform/billing?filter=expired')}>
            Review
          </Button>
        ),
      });
    }

    if (counts.suspendedBusinesses > 0) {
      items.push({
        id: 'suspended',
        tone: 'warning',
        title: `${formatNumber(counts.suspendedBusinesses)} suspended`,
        meta: 'Billing status suspended.',
        action: (
          <Button variant="outline" className="btn-sm" onClick={() => navigate('/platform/businesses?billing=suspended')}>
            Review
          </Button>
        ),
      });
    }

    if (counts.unredeemedKeys > 0) {
      items.push({
        id: 'unredeemed-keys',
        tone: 'warning',
        title: `${formatNumber(counts.unredeemedKeys)} activation key${counts.unredeemedKeys === 1 ? '' : 's'} not redeemed`,
        meta: 'Issued but unused — the customer may have paid and still have no access.',
        action: (
          <Button variant="outline" className="btn-sm" onClick={() => navigate('/platform/activation')}>
            Review
          </Button>
        ),
      });
    }

    return items;
  }, [counts, navigate]);

  const activity = useMemo<TimelineEntry[]>(() => {
    if (data.audit && data.audit.length > 0) {
      return data.audit.map((entry) => ({
        id: entry.id,
        title: humaniseToken(entry.action),
        meta: `${entry.actorEmail ?? 'System'} · ${entry.orgName ?? 'Platform'} · ${formatRelative(entry.createdAt)}`,
        tone: entry.status === 'failed' ? 'danger' : entry.status === 'attempted' ? 'accent' : 'success',
      }));
    }
    return (data.recentErrors ?? []).slice(0, 6).map((entry) => ({
      id: entry.id,
      title: humaniseToken(entry.action),
      meta: `${entry.actorEmail ?? 'System'} · ${entry.orgName ?? 'Platform'} · ${formatRelative(entry.createdAt)}`,
      tone: entry.status === 'failed' ? 'danger' : 'accent',
    }));
  }, [data.audit, data.recentErrors]);

  const productAccess = useMemo(() => {
    const products = new Map<string, { name: string; active: number; trialing: number }>();
    for (const row of entitlements) {
      if (row.isSandbox) continue;
      const product = products.get(row.productKey) ?? { name: row.productName, active: 0, trialing: 0 };
      if (row.entitlementStatus === 'active') product.active += 1;
      if (row.entitlementStatus === 'pending') product.trialing += 1;
      products.set(row.productKey, product);
    }
    return [...products.entries()].map(([key, value]) => ({ key, ...value }));
  }, [entitlements]);
  const canAssertHealthy = Boolean(data.entitlements && data.organizations && (data.revenue || data.v2));

  const platformMetrics: HomeMetric[] = [
    { label: 'Businesses', value: data.organizations && data.entitlements ? formatNumber(counts.businesses) : '—' },
    { label: 'Active access', value: data.entitlements ? formatNumber(counts.activeSubs) : '—' },
    { label: 'On trial', value: data.entitlements ? formatNumber(counts.trialingSubs) : '—' },
    { label: 'Failed payments', value: data.revenue ? formatNumber(counts.failedPayments) : '—' },
  ];

  const totalSubs = counts.activeSubs + counts.trialingSubs + counts.pastDueSubs;
  const subSlices: HomeSlice[] = totalSubs > 0
    ? [
        { label: 'Active', value: formatNumber(counts.activeSubs), percent: Math.round((counts.activeSubs / totalSubs) * 100), tone: 'success' },
        { label: 'Trialing', value: formatNumber(counts.trialingSubs), percent: Math.round((counts.trialingSubs / totalSubs) * 100), tone: 'pending' },
        { label: 'Past due', value: formatNumber(counts.pastDueSubs), percent: Math.round((counts.pastDueSubs / totalSubs) * 100), tone: 'failed' },
      ]
    : [];

  const billingBars: HomeBar[] = counts.businesses > 0
    ? [
        { label: 'Paying', amount: formatNumber(counts.paying), percent: `${Math.round((counts.paying / counts.businesses) * 100)}%`, width: (counts.paying / counts.businesses) * 100 },
        { label: 'On trial', amount: formatNumber(counts.trial), percent: `${Math.round((counts.trial / counts.businesses) * 100)}%`, width: (counts.trial / counts.businesses) * 100 },
        { label: 'Suspended', amount: formatNumber(counts.suspendedBusinesses), percent: `${Math.round((counts.suspendedBusinesses / counts.businesses) * 100)}%`, width: (counts.suspendedBusinesses / counts.businesses) * 100 },
      ]
    : [];

  return (
    <div className="platform-overview">
      <PlatformPageHead
        area={AREA}
        description={`Signed in as ${access?.isSuperAdmin ? 'platform owner' : 'platform admin'}.`}
        actions={<RefreshButton onClick={() => { setRevenueRevision(value => value + 1); void reload(); }} loading={loading} />}
      />

      {failed > 0 && (
        <div className="alert alert-warning" role="status">
          <span className="alert-text">
            Some dashboard information could not load. Available information is shown below.
          </span>
        </div>
      )}

      <DashboardWelcome title="Your platform at a glance" description="Manage businesses, follow subscription activity, and review verified revenue."
        actions={<Link className="btn btn-outline" to="/platform/businesses">View businesses</Link>} />
      <div className="owner-dashboard-main">
        <DashboardRevenuePanel load={loadPlatformRevenue} refreshKey={revenueRevision} title="Subscription revenue" breakdownTitle="Revenue by recorded plan"
          note="Successful payments only. Sandbox businesses are excluded. Plan grouping follows the plan recorded on each payment."
          emptyDescription="Verified subscription payments will appear here. Choose another period to review earlier payments." />
        <aside className="owner-dashboard-side" aria-label="Platform updates">
      <section className="overview-panel" aria-labelledby="at-a-glance">
        <SectionHead
          id="at-a-glance"
          title="Subscription state"
          actions={
            <Button variant="ghost" className="btn-sm" onClick={() => navigate('/platform/health')}>
              System health
            </Button>
          }
        />
        {loading ? (
          <div className="skeleton-inline" role="status" aria-label="Loading subscriptions"><span className="skeleton skeleton-text" /><span className="skeleton skeleton-text" /><span className="skeleton skeleton-text is-short" /></div>
        ) : (
          <dl className="overview-status-list">
            <div><dt>Paying businesses</dt><dd>{data.organizations && data.entitlements ? <Link to="/platform/businesses?billing=active">{formatNumber(counts.paying)}</Link> : '—'}</dd></div>
            <div><dt>Businesses on trial</dt><dd>{data.organizations && data.entitlements ? <Link to="/platform/businesses?billing=trial">{formatNumber(counts.trial)}</Link> : '—'}</dd></div>
            <div><dt>Trialing subscriptions</dt><dd>{data.entitlements ? <Link to="/platform/billing?filter=trialing">{formatNumber(counts.trialingSubs)}</Link> : '—'}</dd></div>
            <div><dt>Expiring within 30 days</dt><dd>{data.entitlements ? <Link to="/platform/billing?filter=expiring">{formatNumber(counts.expiring)}</Link> : '—'}</dd></div>
            <div><dt>Suspended businesses</dt><dd>{data.organizations && data.entitlements ? <Link to="/platform/businesses?billing=suspended">{formatNumber(counts.suspendedBusinesses)}</Link> : '—'}</dd></div>
            <div><dt>Recent failed events</dt><dd>{data.recentErrors ? <Link to="/platform/health">{formatNumber(counts.failedEvents)}</Link> : '—'}</dd></div>
          </dl>
        )}
        <p className="section-sub">
          Business and subscription counts are current. Sandbox businesses are excluded
          {counts.sandbox > 0 ? ` (${formatNumber(counts.sandbox)} excluded)` : ''}.
        </p>
      </section>
      <section className="overview-panel" aria-labelledby="product-access">
        <SectionHead id="product-access" title="Product access" actions={<Link className="btn btn-ghost btn-sm" to="/platform/businesses">All businesses</Link>} />
        {loading ? (
          <div className="skeleton-inline" role="status" aria-label="Loading products"><span className="skeleton skeleton-text" /><span className="skeleton skeleton-text is-short" /></div>
        ) : !data.entitlements ? (
          <StateBlock compact variant="error" title="Product access unavailable" body="Subscriptions did not load." actions={<Button variant="outline" className="btn-sm" onClick={reload}>Try again</Button>} />
        ) : productAccess.length === 0 ? (
          <StateBlock compact title="No product subscriptions" body="Businesses will appear here after their product access is created." />
        ) : (
          <dl className="overview-status-list">
            {productAccess.map((product) => (
              <div key={product.key}>
                <dt><Link to={`/platform/businesses?product=${encodeURIComponent(product.key)}`}>{product.name}</Link></dt>
                <dd>{formatNumber(product.active)} active · {formatNumber(product.trialing)} trialing</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
        </aside>
      </div>
      <section className="hd-home" aria-label="Platform overview">
        {loading ? (
          <HomeDashboardSkeleton metricCount={4} panelCount={2} />
        ) : (
          <>
            <div className="hd-metrics">
              {platformMetrics.map((metric) => (
                <HomeMetricCard key={metric.label} metric={metric} />
              ))}
            </div>
            <div className="hd-grid">
              <HomePanel title="Subscriptions by status" subtitle="Active, trialing and past-due product subscriptions.">
                {subSlices.length > 0 ? (
                  <HomeDonut slices={subSlices} />
                ) : (
                  <p className="hd-panel-note">No product subscriptions recorded yet.</p>
                )}
              </HomePanel>
              <HomePanel
                title="Businesses by billing status"
                subtitle={`Live businesses, excluding sandbox${counts.sandbox > 0 ? ` (${formatNumber(counts.sandbox)} excluded)` : ''}. ${formatNumber(counts.new30d)} new in 30 days.`}
              >
                {billingBars.length > 0 ? (
                  <HomeBars total={formatNumber(counts.businesses)} bars={billingBars} />
                ) : (
                  <p className="hd-panel-note">No live businesses recorded yet.</p>
                )}
              </HomePanel>
            </div>
          </>
        )}
      </section>

      <div className="overview-panels">
      <section className="overview-panel" aria-labelledby="needs-attention">
        <SectionHead
          id="needs-attention"
          title="Needs attention"
          actions={attention.length > 0 ? <span className="badge badge-warning">{attention.length}</span> : undefined}
        />

        {loading ? (
          <div className="skeleton-inline" role="status" aria-label="Loading attention items">
            <span className="skeleton skeleton-text" />
            <span className="skeleton skeleton-text is-short" />
          </div>
        ) : attention.length > 0 ? (
          <AttentionList items={attention} />
        ) : !canAssertHealthy ? (
          <StateBlock compact variant="error" title="Attention status unavailable" body="Some account, subscription, or payment records did not load." actions={<Button variant="outline" className="btn-sm" onClick={reload}>Try again</Button>} />
        ) : (
          <HealthyStrip>No failed payments, overdue subscriptions, or access expiring within 30 days.</HealthyStrip>
        )}
        <AreaCoverage title="Monitoring coverage" gaps={['Support tickets, integration incidents, and application incidents are not yet connected to the overview.']} />
      </section>


      <section className="overview-panel" aria-labelledby="recent-activity">
        <SectionHead
          id="recent-activity"
          title="Recent activity"
          actions={
            <Button variant="ghost" className="btn-sm" onClick={() => navigate('/platform/audit')}>
              All audit logs
            </Button>
          }
        />
        {loading ? (
          <div className="skeleton-inline" role="status" aria-label="Loading activity"><span className="skeleton skeleton-text" /><span className="skeleton skeleton-text is-short" /></div>
        ) : !data.audit && !data.recentErrors ? (
          <StateBlock compact variant="error" title="Activity unavailable" body="Recent actions could not load." actions={<Button variant="outline" className="btn-sm" onClick={reload}>Try again</Button>} />
        ) : activity.length > 0 ? (
          <Timeline items={activity.slice(0, 4)} />
        ) : (
          <StateBlock variant="empty" title="Nothing recorded yet" body="Administrative actions appear here." />
        )}
      </section>

      </div>
    </div>
  );
}
