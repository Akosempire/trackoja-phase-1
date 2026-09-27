import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PlatformAdminService, type PlatformAuditLog } from '../../../services/platformAdmin.service';
import { PlatformService } from '../../../services/platform.service';
import { usePlatform } from '../../../components/platform/PlatformContext';
import { PlatformPageHead, RefreshButton } from '../../../components/platform/PlatformPageHead';
import { AttentionList, HealthyStrip, type AttentionItem } from '../../../components/ui/AttentionList';
import { MetricStrip, type Metric } from '../../../components/ui/MetricStrip';
import { SectionHead } from '../../../components/ui/SectionHead';
import { Timeline, type TimelineEntry } from '../../../components/ui/Timeline';
import { Button } from '../../../components/ui/Button';
import { StateBlock } from '../../../components/ui/StateBlock';
import { PLATFORM_AREAS } from '../../../config/platformAreas';
import { daysUntil, formatMoneyCompact, formatNumber, formatRelative, humaniseToken } from '../../../utils/format';
import { getReportDateRange } from '../../../utils/report-date-ranges';
import type { PlatformInventoryOverview, PlatformOrganization, PlatformOverview, PlatformRecentError, PlatformRevenueSummary } from '../../../types';
import type { PlatformOverviewV2, ProductBusiness } from '../../../services/platformAdmin.service';

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

export default function OverviewArea() {
  const navigate = useNavigate();
  const { access, can } = usePlatform();
  const canSeeActivation = can('platform:manage_activation');
  const { data, failed, total, loading, reload } = useOverviewData(canSeeActivation);

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

    // Support tickets, integrations and incidents are named in the brief as
    // things to prioritise. None has a backend, so this states that once
    // instead of inventing a queue that would read as "no problems".
    items.push({
      id: 'unmonitored',
      tone: 'muted',
      title: 'Tickets, integrations and incidents are not monitored',
      meta: 'No backend for any of the three, so nothing here can report them.',
      action: (
        <Button variant="ghost" className="btn-sm" onClick={() => navigate('/platform/support')}>
          Details
        </Button>
      ),
    });

    return items;
  }, [counts, navigate]);

  const metrics = useMemo<Metric[]>(
    () => [
      {
        id: 'businesses',
        label: 'Businesses',
        value: formatNumber(counts.businesses),
        foot: `${formatNumber(counts.new30d)} new in 30 days`,
        onClick: () => navigate('/platform/businesses'),
      },
      {
        id: 'paying',
        label: 'Paying',
        value: formatNumber(counts.paying),
        onClick: () => navigate('/platform/businesses?billing=active'),
      },
      { id: 'trial', label: 'On trial', value: formatNumber(counts.trial), onClick: () => navigate('/platform/businesses?billing=trial') },
      {
        id: 'suspended',
        label: 'Suspended',
        value: formatNumber(counts.suspendedBusinesses),
        tone: counts.suspendedBusinesses > 0 ? 'warning' : 'default',
        onClick: () => navigate('/platform/businesses?billing=suspended'),
      },
      {
        id: 'active-subs',
        label: 'Active access',
        value: formatNumber(counts.activeSubs),
        onClick: () => navigate('/platform/billing?filter=active'),
      },
      {
        id: 'trialing',
        label: 'Trialing',
        value: formatNumber(counts.trialingSubs),
        onClick: () => navigate('/platform/billing?filter=trialing'),
      },
      {
        id: 'revenue',
        label: 'Revenue',
        value: formatMoneyCompact(counts.revenue30d),
        foot: 'Last 30 days',
      },
      {
        id: 'failed',
        label: 'Failed payments',
        value: formatNumber(counts.failedPayments),
        tone: counts.failedPayments > 0 ? 'danger' : 'default',
        foot: 'Last 30 days',
        onClick: () => navigate('/platform/billing?filter=failed'),
      },
      {
        id: 'signals',
        label: 'Failed events',
        value: formatNumber(counts.failedEvents),
        tone: counts.failedEvents > 0 ? 'warning' : 'default',
        foot: 'Recent, not a 24h total',
        onClick: () => navigate('/platform/health'),
      },
    ],
    [counts, navigate],
  );

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

  const actionable = attention.filter((item) => item.tone !== 'muted');
  const unmonitored = attention.filter((item) => item.tone === 'muted');

  return (
    <>
      <PlatformPageHead
        area={AREA}
        description={`Signed in as ${access?.isSuperAdmin ? 'platform owner' : 'platform admin'}.`}
        actions={<RefreshButton onClick={reload} loading={loading} />}
      />

      {failed > 0 && (
        <div className="alert alert-warning" role="status">
          <span className="alert-text">
            {failed} of {total} sources did not answer. The rest is correct; treat the remainder as unknown, not zero.
          </span>
        </div>
      )}

      <section className="card" aria-labelledby="needs-attention">
        <SectionHead
          id="needs-attention"
          title="Needs attention"
          actions={actionable.length > 0 ? <span className="badge badge-warning">{actionable.length}</span> : undefined}
        />

        {actionable.length > 0 ? (
          <AttentionList items={attention} />
        ) : loading ? (
          <div className="skeleton-inline" role="status" aria-label="Loading">
            <span className="skeleton skeleton-text" />
            <span className="skeleton skeleton-text is-short" />
          </div>
        ) : (
          <>
            <HealthyStrip>
              Nothing needs attention. No failed payments, nothing past due, and no subscription expiring in the next
              30 days.
            </HealthyStrip>
            <AttentionList items={unmonitored} />
          </>
        )}
      </section>

      <section className="card" aria-labelledby="at-a-glance">
        <SectionHead
          id="at-a-glance"
          title="At a glance"
          actions={
            <Button variant="ghost" className="btn-sm" onClick={() => navigate('/platform/health')}>
              System health
            </Button>
          }
        />
        <MetricStrip metrics={metrics} />
        <p className="section-sub">
          Revenue and failed payments cover the last 30 days. Sandbox businesses are excluded
          {counts.sandbox > 0 ? ` (${formatNumber(counts.sandbox)} excluded)` : ''}.
        </p>
      </section>

      <section className="card" aria-labelledby="recent-activity">
        <SectionHead
          id="recent-activity"
          title="Recent activity"
          actions={
            <Button variant="ghost" className="btn-sm" onClick={() => navigate('/platform/audit')}>
              All audit logs
            </Button>
          }
        />
        {activity.length > 0 ? (
          <Timeline items={activity} />
        ) : (
          <StateBlock variant="empty" title="Nothing recorded yet" body="Administrative actions appear here." />
        )}
      </section>
    </>
  );
}
