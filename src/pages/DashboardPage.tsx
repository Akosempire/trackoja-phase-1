import { BusinessActivity } from '../components/BusinessActivity';
import { activityTypes, businessActivity, stockState, stockQuantity } from '../utils/business-activity';
import { routeModule } from '../utils/merchant-experience';
import { JobService, type JobSummary } from '../services/job.service';
import { DashboardRevenuePanel } from '../components/ui/DashboardRevenuePanel';
import type { ReportDateRange } from '../utils/report-date-ranges';
import { TrialStatus } from '../components/TrialStatus';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useBusinessContext } from '../contexts/BusinessContext';
import { usePermissions } from '../hooks/usePermissions';
import { StoreService } from '../services/store.service';
import { ReportService } from '../services/report.service';
import { ProductService } from '../services/product.service';
import { AuditService } from '../services/audit.service';
import { SaleService } from '../services/sale.service';
import { CustomerService } from '../services/customer.service';
import { Button } from '../components/ui/Button';
import { PageLoader } from '../components/ui/PageLoader';
import { StateBlock } from '../components/ui/StateBlock';
import { getBusinessExperience, type DashboardMetric } from '../config/businessExperience';
import { isResolvableMetric } from '../config/dashboardMetrics';
import type { AuditLog, Product, Sale, SalesSummary, Store, TopProduct } from '../types';
import { formatMoney, formatNumber } from '../utils/format';
import { Card, CardHead, Page, PageHeader, Pill, Stat, btn } from '../components/kit';
import { ChevronRightIcon, RefreshIcon } from '../components/icons';

interface HomeMetric { label: string; value: string }
interface HomeBar { label: string; amount: string; percent: string; width: number }

function greetingForNow(name?: string) {
  const hour = new Date().getHours();
  const time = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  return `${time}${name ? `, ${name}` : ''}`;
}

function daysUntil(dateish: string | undefined): number | null {
  if (!dateish) return null;
  const then = new Date(dateish);
  if (Number.isNaN(then.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  then.setHours(0, 0, 0, 0);
  return Math.round((then.getTime() - today.getTime()) / 86_400_000);
}

interface MetricContext {
  jobs: JobSummary | null;
  summary: SalesSummary | null;
  products: Product[] | null;
  lowStock: Product[] | null;
  kitchenOrders: Sale[] | null;
  refundCount: number | null;
  customerCount: number | null;
}

interface ResolvedMetric {
  metric: DashboardMetric;
  value: string;
  sub?: string;
}

function resolveMetric(metric: DashboardMetric, ctx: MetricContext): ResolvedMetric | null {
  if (!isResolvableMetric(metric.key)) return null;

  const expiringWithin = (days: number) =>
    (ctx.products ?? []).filter((p) => {
      const left = daysUntil(p.attributes?.expiryDate);
      return left !== null && left >= 0 && left <= days;
    });

  const jobKeys: Record<string, keyof JobSummary> = {
    jobs_due_soon: 'jobsDueSoon',
    jobs_overdue: 'jobsOverdue',
    upcoming_fittings: 'upcomingFittings',
    awaiting_pickup: 'awaitingPickup',
    outstanding_balances: 'outstandingBalances',
    open_jobs: 'openJobs',
  };
  if (jobKeys[metric.key]) {
    return ctx.jobs
      ? {
          metric,
          value: metric.key === 'outstanding_balances' ? formatMoney(ctx.jobs[jobKeys[metric.key]]) : String(ctx.jobs[jobKeys[metric.key]]),
          sub: metric.period,
        }
      : null;
  }

  switch (metric.key) {
    case 'sales_today': {
      if (!ctx.summary) return null;
      const count = ctx.summary.transactionCount;
      return { metric, value: formatMoney(ctx.summary.totalRevenue), sub: `${count} sale${count === 1 ? '' : 's'}` };
    }
    case 'transactions_today':
      if (!ctx.summary) return null;
      return { metric, value: String(ctx.summary.transactionCount) };
    case 'low_stock':
      if (!ctx.lowStock) return null;
      return { metric, value: String(ctx.lowStock.filter(product => product.stockQty > 0 && product.stockQty <= product.reorderLevel).length) };
    case 'unavailable_items':
      if (!ctx.products) return null;
      return { metric, value: String(ctx.products.filter((p) => p.trackInventory && p.stockQty <= 0).length) };
    case 'open_orders':
      if (!ctx.kitchenOrders) return null;
      return { metric, value: String(ctx.kitchenOrders.filter((o) => o.orderStatus === 'new').length) };
    case 'preparing':
      if (!ctx.kitchenOrders) return null;
      return { metric, value: String(ctx.kitchenOrders.filter((o) => o.orderStatus === 'preparing').length) };
    case 'ready':
      if (!ctx.kitchenOrders) return null;
      return { metric, value: String(ctx.kitchenOrders.filter((o) => o.orderStatus === 'ready').length) };
    case 'near_expiry':
    case 'expiring':
      if (!ctx.products) return null;
      return { metric, value: String(expiringWithin(90).length) };
    case 'expired':
      if (!ctx.products) return null;
      return {
        metric,
        value: String(ctx.products.filter((p) => {
          const left = daysUntil(p.attributes?.expiryDate);
          return left !== null && left < 0;
        }).length),
      };
    case 'clients':
      if (ctx.customerCount === null) return null;
      return { metric, value: String(ctx.customerCount) };
    case 'returns':
      if (ctx.refundCount === null) return null;
      return { metric, value: String(ctx.refundCount) };
    default:
      return null;
  }
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { category, modules } = useBusinessContext();
  const experience = getBusinessExperience(category, modules);
  const enabled = modules ?? experience.defaultModules;
  const { hasPermission, loading: permissionsLoading } = usePermissions();
  const canReadReports = hasPermission('reports:view');
  const canReadInventory = enabled.includes('inventory') && hasPermission('inventory:view');
  const canReadSales = enabled.includes('sales') && hasPermission('sales:view');
  const canReadCustomers = enabled.includes('customers') && hasPermission('customer:view');
  const canReadJobs = enabled.includes('tailoring') && hasPermission('job:view');
  const storeId = profile?.currentStoreId;
  const dashboardRequest = useRef(0);

  const [jobs, setJobs] = useState<JobSummary | null>(null);
  const [store, setStore] = useState<Store | null>(null);
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [lowStock, setLowStock] = useState<Product[] | null>(null);
  const [kitchenOrders, setKitchenOrders] = useState<Sale[] | null>(null);
  const [refundCount, setRefundCount] = useState<number | null>(null);
  const [customerCount, setCustomerCount] = useState<number | null>(null);
  const [topProducts, setTopProducts] = useState<TopProduct[] | null>(null);
  const [activity, setActivity] = useState<AuditLog[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [partialFailures, setPartialFailures] = useState(0);

  const loadDashboard = useCallback(async () => {
    if (permissionsLoading) return;
    if (!storeId) {
      setLoading(false);
      setError('Choose a business workspace to view its dashboard.');
      return;
    }

    const request = ++dashboardRequest.current;
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    setLoading(true);
    setError(null);
    setStore(null);
    setJobs(null);
    setSummary(null);
    setProducts(null);
    setLowStock(null);
    setKitchenOrders(null);
    setRefundCount(null);
    setCustomerCount(null);
    setTopProducts(null);
    setActivity(null);
    setPartialFailures(0);

    try {
      let failed = 0;
      const optional = <T,>(request: Promise<T>): Promise<T | null> => request.catch(() => {
        failed += 1;
        return null;
      });
      const permittedActivityTypes = activityTypes(permission => hasPermission(permission) && (
        permission.startsWith('inventory')
          ? canReadInventory
          : permission.startsWith('sales')
            ? canReadSales
            : permission.startsWith('customer')
              ? canReadCustomers
              : canReadJobs
      ));
      const [storeRow, sales, allProducts, low, logs, orders, refundRows, customers, jobSummary, top] = await Promise.all([
        StoreService.getStore(storeId),
        canReadReports ? optional(ReportService.getSalesSummary(storeId, todayStart.toISOString(), now.toISOString())) : Promise.resolve(null),
        canReadInventory ? optional(ProductService.getProducts(storeId)) : Promise.resolve(null),
        canReadInventory ? optional(ProductService.getProducts(storeId, { status: 'active', lowStockOnly: true })) : Promise.resolve(null),
        optional(AuditService.getStoreAuditLogs(storeId, 8, 0, permittedActivityTypes)),
        category === 'restaurant' && canReadSales ? optional(SaleService.getKitchenOrders(storeId)) : Promise.resolve(null),
        canReadSales ? optional(SaleService.getRefundCount(storeId, todayStart.toISOString(), now.toISOString())) : Promise.resolve(null),
        canReadCustomers ? optional(CustomerService.getCustomers(storeId)) : Promise.resolve(null),
        canReadJobs ? optional(JobService.summary(storeId)) : Promise.resolve(null),
        canReadReports ? optional(ReportService.getTopProducts(storeId, todayStart.toISOString(), now.toISOString(), 5)) : Promise.resolve(null),
      ]);
      if (request !== dashboardRequest.current) return;
      setStore(storeRow);
      setJobs(jobSummary);
      setSummary(sales);
      setProducts(allProducts);
      setLowStock(low?.filter(product => product.trackInventory && stockState(product)).sort((a, b) => a.stockQty - b.stockQty) ?? null);
      setActivity(logs === null ? null : businessActivity(logs, permittedActivityTypes));
      setKitchenOrders(orders);
      setRefundCount(refundRows);
      setCustomerCount(customers?.length ?? null);
      setTopProducts(top);
      setPartialFailures(failed);
    } catch (err) {
      if (request === dashboardRequest.current) setError((err as Error)?.message ?? 'Could not load your dashboard');
    } finally {
      if (request === dashboardRequest.current) setLoading(false);
    }
  }, [storeId, permissionsLoading, canReadReports, canReadInventory, canReadSales, canReadCustomers, canReadJobs, category]);

  useEffect(() => { void loadDashboard(); }, [loadDashboard]);

  const loadRevenue = useCallback(async ({ from, to }: ReportDateRange) => {
    if (!storeId || !canReadReports) throw new Error('Reports access required');
    const [sales, methods] = await Promise.all([
      ReportService.getSalesSummary(storeId, from, to),
      ReportService.getSalesByPaymentMethod(storeId, from, to).catch(() => null),
    ]);
    return {
      total: sales.totalRevenue,
      count: sales.transactionCount,
      rows: methods?.map(row => ({ key: row.method, label: row.method.replace(/_/g, ' '), amount: row.amount })) ?? null,
    };
  }, [storeId, canReadReports]);

  const resolved = useMemo(() => {
    const ctx: MetricContext = { jobs, summary, products, lowStock, kitchenOrders, refundCount, customerCount };
    return experience.dashboard
      .filter((metric) => metric.implemented)
      .map((metric) => resolveMetric(metric, ctx))
      .filter((entry): entry is ResolvedMetric => entry !== null);
  }, [experience, jobs, summary, products, lowStock, kitchenOrders, refundCount, customerCount]);

  const canUseAction = (route: string) => {
    if (permissionsLoading || (routeModule(route) && !enabled.includes(routeModule(route)!))) return false;
    if (route === '/jobs') return hasPermission('job:create');
    if (route.startsWith('/sales') && route !== '/sales/checkout') return canReadSales;
    if (route === '/sales/checkout') return hasPermission('sales:create');
    if (route === '/inventory/products/new') return hasPermission('product:create');
    if (route === '/kitchen') return canReadSales;
    if (route.startsWith('/inventory')) return canReadInventory;
    if (route === '/customers/new') return hasPermission('customer:create');
    if (route.startsWith('/customers')) return canReadCustomers;
    if (route.startsWith('/jobs')) return route.includes('new=1') ? hasPermission('job:create') : canReadJobs;
    if (route === '/settings') return hasPermission('store:update');
    return true;
  };

  const uncategorizedProducts = products?.filter((product) => !product.categoryId).length ?? null;
  const averageSale = summary && summary.transactionCount > 0 ? summary.totalRevenue / summary.transactionCount : 0;
  const homeMetrics: HomeMetric[] = [
    canReadReports && summary ? { label: 'Sales revenue today', value: formatMoney(summary.totalRevenue) } : null,
    canReadReports && summary ? { label: 'Transactions', value: formatNumber(summary.transactionCount) } : null,
    canReadReports && summary ? { label: 'Average sale', value: formatMoney(averageSale) } : null,
    canReadInventory && lowStock ? { label: `${experience.terminology.stock} alerts`, value: formatNumber(lowStock.length) } : null,
  ].filter((item): item is HomeMetric => item !== null);

  const totalRevenue = summary?.totalRevenue ?? 0;
  const topBars: HomeBar[] = (topProducts ?? []).map((p) => ({
    label: p.productName,
    amount: formatMoney(p.revenue),
    percent: totalRevenue > 0 ? `${((p.revenue / totalRevenue) * 100).toFixed(1)}%` : '0%',
    width: totalRevenue > 0 ? (p.revenue / totalRevenue) * 100 : 0,
  }));

  const duplicateMetricKeys = new Set(['sales_today', 'transactions_today', 'low_stock', 'clients']);
  const operationalMetrics = resolved.filter(({ metric }) => !duplicateMetricKeys.has(metric.key));

  // Needs attention holds only issues that have no dedicated dashboard section.
  // Out-of-stock and low-stock products live in Stock attention, so they are not
  // repeated here (one issue, one home).
  const attentionItems = [
    canReadInventory && uncategorizedProducts !== null && uncategorizedProducts > 0
      ? { title: `${uncategorizedProducts} uncategorized ${experience.terminology.lineItem.toLowerCase()}${uncategorizedProducts === 1 ? '' : 's'}`, body: 'Categories make checkout and reports easier to scan.', to: '/inventory/categories' }
      : null,
    canReadCustomers && customerCount === 0 && canUseAction('/customers/new')
      ? { title: `No ${experience.terminology.customer.toLowerCase()} records yet`, body: `Add ${experience.terminology.customer.toLowerCase()}s to track repeat buyers and balances.`, to: '/customers/new' }
      : null,
  ].filter((item): item is { title: string; body: string; to: string } => Boolean(item));

  const hasAvailableData = activity !== null || jobs !== null || summary !== null || products !== null || customerCount !== null || kitchenOrders !== null;

  if (loading || permissionsLoading) return <PageLoader />;

  const primary = experience.primaryAction.implemented && canUseAction(experience.primaryAction.route)
    ? { label: experience.primaryAction.label, go: () => navigate(experience.primaryAction.route === '/jobs' ? '/jobs?new=1' : experience.primaryAction.route) }
    : null;

  return (
    <Page className="dash">
      <TrialStatus />
      <PageHeader
        eyebrow={store?.name ?? experience.displayName}
        title={greetingForNow(profile?.firstName)}
        subtitle={experience.primaryQuestion}
        actions={<>
          {experience.secondaryActions.filter(action => action.implemented && canUseAction(action.route)).map(action => (
            <Link key={action.route} className={btn('outline')} to={action.route}>{action.label}</Link>
          ))}
          <button type="button" className={btn('ghost')} onClick={loadDashboard} aria-label="Refresh"><RefreshIcon width={17} height={17} /></button>
          {primary && <Button onClick={primary.go}>{primary.label}</Button>}
        </>}
      />

      {partialFailures > 0 && !error && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-warn-soft px-4 py-2.5 text-[13px] text-warn-ink" role="status">
          <span>{partialFailures} dashboard source{partialFailures === 1 ? '' : 's'} could not load. Unavailable figures are hidden.</span>
          <Button variant="ghost" className="btn-sm" onClick={loadDashboard}>Try again</Button>
        </div>
      )}

      {error ? (
        <Card>
          <StateBlock variant="error" title="Could not load the dashboard" body={error}
            actions={<Button variant="outline" className="btn-sm" onClick={loadDashboard}>Try again</Button>} />
        </Card>
      ) : !hasAvailableData ? (
        <Card>
          <StateBlock variant="unavailable" title="Dashboard data unavailable"
            body="Your role has no accessible dashboard data, or the available sources did not answer."
            actions={partialFailures > 0 && <Button variant="outline" className="btn-sm" onClick={loadDashboard}>Try again</Button>} />
        </Card>
      ) : (
        <div className="flex flex-col gap-4 lg:gap-6">
          {homeMetrics.length > 0 && (
            <section className="hd-metrics grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4" aria-label="Key business metrics">
              {homeMetrics.map((metric) => (
                <Stat key={metric.label} label={metric.label} value={metric.value}
                  tone={metric.label.endsWith('alerts') && metric.value !== '0' ? 'warn' : undefined} />
              ))}
            </section>
          )}

          <div className="grid gap-4 lg:grid-cols-3 lg:gap-6">
            {canReadReports && (
              <div className="min-w-0 lg:col-span-2">
                <DashboardRevenuePanel
                  load={loadRevenue}
                  title="Sales performance"
                  breakdownTitle="By payment method"
                  note="Completed sales only. Revenue is after discounts and includes tax; credit sales are not necessarily cash received."
                  emptyDescription={experience.emptyStates.dashboard}
                  emptyAction={primary ? <Button className="btn-sm" onClick={primary.go}>{primary.label}</Button> : undefined}
                />
              </div>
            )}
            <Card className={canReadReports ? '' : 'lg:col-span-3'}>
              <CardHead title={`${experience.terminology.stock} running low`} hint="At or below reorder level"
                action={canReadInventory ? <Link className="text-[13px] font-semibold text-brand no-underline" to="/inventory/low-stock">View all & reorder</Link> : undefined} />
              {lowStock === null ? (
                <p className="m-0 text-sm text-ink-3">Stock status is unavailable.</p>
              ) : lowStock.length === 0 ? (
                <p className="m-0 text-sm text-ink-3">Nothing is running low. Nice.</p>
              ) : (
                <ul className="m-0 list-none divide-y divide-line p-0">
                  {lowStock.slice(0, 5).map((product) => (
                    <li key={product.id}>
                      <Link className="flex items-center justify-between gap-3 py-2.5 text-inherit no-underline" to={`/inventory/products/${product.id}`}>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-ink">{product.name}</span>
                          <span className="block text-xs text-ink-3">{stockQuantity(product.stockQty, product.unit)} left</span>
                        </span>
                        <Pill tone={product.stockQty <= 0 ? 'danger' : 'warn'}>{stockState(product)}</Pill>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3 lg:gap-6">
            <Card>
              <CardHead title="Top sellers today" hint={topBars.length ? `Share of ${formatMoney(totalRevenue)}` : undefined} />
              {topBars.length > 0 ? (
                <ol className="m-0 list-none space-y-3 p-0">
                  {topBars.map((bar, index) => (
                    <li key={bar.label}>
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="min-w-0 truncate text-ink"><span className="mr-2 text-ink-3 tabular-nums">{index + 1}</span>{bar.label}</span>
                        <span className="shrink-0 font-semibold tabular-nums text-ink">{bar.amount}</span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-tray" aria-hidden="true"><span className="block h-full rounded-full bg-brand" style={{ width: `${Math.max(2, bar.width)}%` }} /></div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="m-0 text-sm text-ink-3">No completed sales to rank yet.</p>
              )}
            </Card>
            <Card>
              <CardHead title="Recent activity" action={<Link className="text-[13px] font-semibold text-brand no-underline" to="/activity">View all</Link>} />
              {activity === null ? (
                <p className="m-0 text-sm text-ink-3">Activity is unavailable.</p>
              ) : (
                <BusinessActivity logs={activity.slice(0, 5)} actorId={profile?.id} actorName={profile?.firstName} />
              )}
            </Card>
            <Card>
              <CardHead title="To do" hint="Quick fixes that make the shop run smoother" />
              {attentionItems.length === 0 ? (
                <p className="m-0 text-sm text-ink-3">You're all caught up.</p>
              ) : (
                <ul className="m-0 list-none space-y-2 p-0">
                  {attentionItems.slice(0, 4).map((item) => (
                    <li key={item.title}>
                      <Link className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5 text-inherit no-underline hover:bg-subtle" to={item.to}>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-ink">{item.title}</span>
                          <span className="block text-xs text-ink-3">{item.body}</span>
                        </span>
                        <ChevronRightIcon width={16} height={16} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {operationalMetrics.length > 0 && (
            <section aria-label={`${experience.displayName} metrics`}>
              <h2 className="m-0 mb-3 text-[15px] font-semibold text-ink">Operational focus</h2>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
                {operationalMetrics.map(({ metric, value, sub }) => {
                  const link = metric.linkTo && (metric.linkTo.startsWith('/jobs') ? canReadJobs : canUseAction(metric.linkTo)) ? metric.linkTo : null;
                  const tile = <Stat label={metric.label} value={value} hint={sub} tone={metric.tone === 'warn' ? 'warn' : metric.tone === 'danger' ? 'danger' : undefined} />;
                  return link
                    ? <Link key={metric.key} to={link} className="text-inherit no-underline" aria-label={`${metric.label}: ${value}. Open details`}>{tile}</Link>
                    : <div key={metric.key}>{tile}</div>;
                })}
              </div>
            </section>
          )}
        </div>
      )}
    </Page>
  );
}
