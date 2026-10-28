import { DashboardRevenuePanel } from '../../../components/ui/DashboardRevenuePanel';
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
import { MeterList, type MeterItem } from '../../../components/ui/MeterList';
import { DefList, type DefRow } from '../../../components/ui/DefList';
import { Card, Pill, Stat, btn, cn } from '../../../components/kit';
import { Notice, SkeletonLines, linkClass } from '../../../components/platform/ui';

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

  const totalSubs = counts.activeSubs + counts.trialingSubs + counts.pastDueSubs;
  const subSlices: Slice[] = totalSubs > 0
    ? [
        { label: 'Active', value: counts.activeSubs, tone: 'bg-success' },
        { label: 'Trialing', value: counts.trialingSubs, tone: 'bg-brand' },
        { label: 'Past due', value: counts.pastDueSubs, tone: 'bg-danger' },
      ]
    : [];

  const billingBars: MeterItem[] = counts.businesses > 0
    ? [
        { id: 'paying', label: 'Paying', value: counts.paying, max: counts.businesses, tone: 'success', display: `${formatNumber(counts.paying)} (${Math.round((counts.paying / counts.businesses) * 100)}%)` },
        { id: 'trial', label: 'On trial', value: counts.trial, max: counts.businesses, tone: 'accent', display: `${formatNumber(counts.trial)} (${Math.round((counts.trial / counts.businesses) * 100)}%)` },
        { id: 'suspended', label: 'Suspended', value: counts.suspendedBusinesses, max: counts.businesses, tone: 'danger', display: `${formatNumber(counts.suspendedBusinesses)} (${Math.round((counts.suspendedBusinesses / counts.businesses) * 100)}%)` },
      ]
    : [];

  const statusLink = (to: string, value: number) => <Link className={linkClass} to={to}>{formatNumber(value)}</Link>;
  const subscriptionState: DefRow[] = [
    { term: 'Paying businesses', value: data.organizations && data.entitlements ? statusLink('/platform/businesses?billing=active', counts.paying) : '—' },
    { term: 'Businesses on trial', value: data.organizations && data.entitlements ? statusLink('/platform/businesses?billing=trial', counts.trial) : '—' },
    { term: 'Trialing subscriptions', value: data.entitlements ? statusLink('/platform/billing?filter=trialing', counts.trialingSubs) : '—' },
    { term: 'Expiring within 30 days', value: data.entitlements ? statusLink('/platform/billing?filter=expiring', counts.expiring) : '—' },
    { term: 'Suspended businesses', value: data.organizations && data.entitlements ? statusLink('/platform/businesses?billing=suspended', counts.suspendedBusinesses) : '—' },
    { term: 'Recent failed events', value: data.recentErrors ? statusLink('/platform/health', counts.failedEvents) : '—' },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-4 lg:gap-6">
      <PlatformPageHead
        area={AREA}
        description={`Signed in as ${access?.isSuperAdmin ? 'platform owner' : 'platform admin'}. Businesses, subscription activity and verified revenue.`}
        actions={<>
          <RefreshButton onClick={() => { setRevenueRevision(value => value + 1); void reload(); }} loading={loading} />
          <Link className={btn('outline', 'sm')} to="/platform/businesses">View businesses</Link>
        </>}
      />

      {failed > 0 && (
        <Notice tone="warn" role="status">
          Some dashboard information could not load. Available information is shown below.
        </Notice>
      )}

      <section aria-label="Platform overview">
        {loading ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4" aria-label="Loading dashboard" aria-busy="true">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="rounded-xl border border-line bg-surface p-4 shadow-card sm:p-5">
                <span className="block h-3.5 w-20 animate-pulse rounded bg-tray" />
                <span className="mt-3 block h-7 w-12 animate-pulse rounded-md bg-tray" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
            <Stat label="Businesses" value={data.organizations && data.entitlements ? formatNumber(counts.businesses) : '—'} hint={`${formatNumber(counts.new30d)} new in 30 days`} />
            <Stat label="Active access" value={data.entitlements ? formatNumber(counts.activeSubs) : '—'} hint="Live product subscriptions" />
            <Stat label="On trial" value={data.entitlements ? formatNumber(counts.trialingSubs) : '—'} hint="Trialing subscriptions" />
            <Stat label="Failed payments" value={data.revenue ? <span className={counts.failedPayments > 0 ? 'text-danger' : undefined}>{formatNumber(counts.failedPayments)}</span> : '—'} hint="Last 30 days" />
          </div>
        )}
      </section>

      <div className="grid min-w-0 items-start gap-4 lg:gap-6 xl:grid-cols-[minmax(0,1fr)_380px]" data-overview="main">
        <DashboardRevenuePanel load={loadPlatformRevenue} refreshKey={revenueRevision} title="Subscription revenue" breakdownTitle="Revenue by recorded plan"
          note="Successful payments only. Sandbox businesses are excluded. Plan grouping follows the plan recorded on each payment."
          emptyDescription="Verified subscription payments will appear here. Choose another period to review earlier payments." />

        <Card aria-labelledby="needs-attention" data-overview="side">
          <SectionHead
            id="needs-attention"
            title="Needs attention"
            actions={attention.length > 0 ? <Pill tone="warn">{attention.length}</Pill> : undefined}
          />
          {loading ? (
            <SkeletonLines count={3} label="Loading attention items" />
          ) : attention.length > 0 ? (
            <AttentionList items={attention} />
          ) : !canAssertHealthy ? (
            <StateBlock compact variant="error" title="Attention status unavailable" body="Some account, subscription, or payment records did not load." actions={<Button variant="outline" className="btn-sm" onClick={reload}>Try again</Button>} />
          ) : (
            <HealthyStrip>No failed payments, overdue subscriptions, or access expiring within 30 days.</HealthyStrip>
          )}
          <div className="mt-4">
            <AreaCoverage title="Monitoring coverage" gaps={['Support tickets, integration incidents, and application incidents are not yet connected to the overview.']} />
          </div>
        </Card>
      </div>

      <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3 lg:gap-6">
        <Card aria-labelledby="at-a-glance">
          <SectionHead
            id="at-a-glance"
            title="Subscription state"
            actions={<Button variant="ghost" className="btn-sm" onClick={() => navigate('/platform/health')}>System health</Button>}
          />
          {loading ? <SkeletonLines count={4} label="Loading subscriptions" /> : <DefList rows={subscriptionState} />}
          <p className="m-0 mt-4 text-xs text-ink-3">
            Business and subscription counts are current. Sandbox businesses are excluded
            {counts.sandbox > 0 ? ` (${formatNumber(counts.sandbox)} excluded)` : ''}.
          </p>
        </Card>

        <Card aria-labelledby="subs-by-status">
          <SectionHead id="subs-by-status" title="Subscriptions by status" sub="Active, trialing and past-due product subscriptions." />
          {loading ? <SkeletonLines count={3} label="Loading subscriptions by status" /> : subSlices.length > 0 ? (
            <SplitBar slices={subSlices} total={totalSubs} />
          ) : (
            <p className="m-0 text-[13px] text-ink-3">No product subscriptions recorded yet.</p>
          )}
        </Card>

        <Card aria-labelledby="billing-status" className="md:col-span-2 xl:col-span-1">
          <SectionHead
            id="billing-status"
            title="Businesses by billing status"
            sub={`Live businesses, excluding sandbox${counts.sandbox > 0 ? ` (${formatNumber(counts.sandbox)} excluded)` : ''}. ${formatNumber(counts.new30d)} new in 30 days.`}
          />
          {loading ? <SkeletonLines count={3} label="Loading billing status" /> : billingBars.length > 0 ? (
            <>
              <p className="m-0 mb-4 text-[28px] font-semibold leading-9 tabular-nums text-ink">{formatNumber(counts.businesses)}</p>
              <MeterList items={billingBars} />
            </>
          ) : (
            <p className="m-0 text-[13px] text-ink-3">No live businesses recorded yet.</p>
          )}
        </Card>
      </div>

      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-6">
        <Card aria-labelledby="recent-activity">
          <SectionHead
            id="recent-activity"
            title="Recent activity"
            actions={<Button variant="ghost" className="btn-sm" onClick={() => navigate('/platform/audit')}>All audit logs</Button>}
          />
          {loading ? (
            <SkeletonLines count={2} label="Loading activity" />
          ) : !data.audit && !data.recentErrors ? (
            <StateBlock compact variant="error" title="Activity unavailable" body="Recent actions could not load." actions={<Button variant="outline" className="btn-sm" onClick={reload}>Try again</Button>} />
          ) : activity.length > 0 ? (
            <Timeline items={activity.slice(0, 4)} />
          ) : (
            <StateBlock variant="empty" title="Nothing recorded yet" body="Administrative actions appear here." />
          )}
        </Card>

        <Card aria-labelledby="product-access">
          <SectionHead id="product-access" title="Product access" actions={<Link className={btn('ghost', 'sm')} to="/platform/businesses">All businesses</Link>} />
          {loading ? (
            <SkeletonLines count={2} label="Loading products" />
          ) : !data.entitlements ? (
            <StateBlock compact variant="error" title="Product access unavailable" body="Subscriptions did not load." actions={<Button variant="outline" className="btn-sm" onClick={reload}>Try again</Button>} />
          ) : productAccess.length === 0 ? (
            <StateBlock compact title="No product subscriptions" body="Businesses will appear here after their product access is created." />
          ) : (
            <ul className="m-0 list-none divide-y divide-line p-0">
              {productAccess.map((product) => (
                <li key={product.key} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5 first:pt-0 last:pb-0">
                  <Link className={linkClass} to={`/platform/businesses?product=${encodeURIComponent(product.key)}`}>{product.name}</Link>
                  <span className="text-[13px] tabular-nums text-ink-2">{formatNumber(product.active)} active · {formatNumber(product.trialing)} trialing</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

interface Slice { label: string; value: number; tone: string }

/** One stacked bar for a share-of-whole, with a legend that carries the numbers. */
function SplitBar({ slices, total }: { slices: Slice[]; total: number }) {
  const percent = (value: number) => Math.round((value / total) * 100);
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-tray" role="img"
        aria-label={slices.map((slice) => `${slice.label} ${percent(slice.value)}%`).join(', ')}>
        {slices.filter((slice) => slice.value > 0).map((slice) => (
          <span key={slice.label} className={cn('h-full border-r-2 border-surface last:border-r-0', slice.tone)} style={{ width: `${(slice.value / total) * 100}%` }} />
        ))}
      </div>
      <dl className="m-0 mt-4 divide-y divide-line">
        {slices.map((slice) => (
          <div key={slice.label} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
            <dt className="flex items-center gap-2 text-[13px] text-ink-2"><span className={cn('size-2.5 rounded-sm', slice.tone)} aria-hidden="true" />{slice.label}</dt>
            <dd className="m-0 text-sm font-medium tabular-nums text-ink">{formatNumber(slice.value)} <span className="font-normal text-ink-3">({percent(slice.value)}%)</span></dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
