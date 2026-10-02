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
import { KpiCard, KpiGrid } from '../components/ui/KpiCard';
import { PageLoader } from '../components/ui/PageLoader';
import { StateBlock } from '../components/ui/StateBlock';
import { getBusinessExperience, type DashboardMetric } from '../config/businessExperience';
import { isResolvableMetric } from '../config/dashboardMetrics';
import type { AuditLog, PaymentMethod, PaymentMethodBreakdown, Product, Sale, SalesSummary, Store, TopProduct } from '../types';
import { formatMoney, formatNumber } from '../utils/format';
import {
  HomeBars,
  HomeDonut,
  HomeMetricCard,
  HomePanel,
  type HomeBar,
  type HomeMetric,
  type HomeSlice,
} from '../components/home/HomeDashboard';
import '../styles/dashboard.css';

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
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodBreakdown[] | null>(null);
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
    setPaymentMethods(null);
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
      const [storeRow, sales, allProducts, low, logs, orders, refundRows, customers, jobSummary, methods, top] = await Promise.all([
        StoreService.getStore(storeId),
        canReadReports ? optional(ReportService.getSalesSummary(storeId, todayStart.toISOString(), now.toISOString())) : Promise.resolve(null),
        canReadInventory ? optional(ProductService.getProducts(storeId)) : Promise.resolve(null),
        canReadInventory ? optional(ProductService.getProducts(storeId, { status: 'active', lowStockOnly: true })) : Promise.resolve(null),
        optional(AuditService.getStoreAuditLogs(storeId, 8, 0, permittedActivityTypes)),
        category === 'restaurant' && canReadSales ? optional(SaleService.getKitchenOrders(storeId)) : Promise.resolve(null),
        canReadSales ? optional(SaleService.getRefundCount(storeId, todayStart.toISOString(), now.toISOString())) : Promise.resolve(null),
        canReadCustomers ? optional(CustomerService.getCustomers(storeId)) : Promise.resolve(null),
        canReadJobs ? optional(JobService.summary(storeId)) : Promise.resolve(null),
        canReadReports ? optional(ReportService.getSalesByPaymentMethod(storeId, todayStart.toISOString(), now.toISOString())) : Promise.resolve(null),
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
      setPaymentMethods(methods);
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

  const methodTone: Record<PaymentMethod, HomeSlice['tone']> = {
    cash: 'success',
    card: 'orders',
    transfer: 'users',
    credit: 'pending',
    other: 'failed',
  };
  const totalRevenue = summary?.totalRevenue ?? 0;
  const donutSlices: HomeSlice[] = (paymentMethods ?? [])
    .filter((row) => row.amount > 0)
    .map((row) => ({
      label: row.method.replace(/_/g, ' '),
      value: formatMoney(row.amount),
      percent: totalRevenue > 0 ? Math.round((row.amount / totalRevenue) * 1000) / 10 : 0,
      tone: methodTone[row.method],
    }));
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

  return (
    <div className="page dash">
      <TrialStatus />
      <div className="page-header waya-home-header">
        <div className="waya-home-heading">
          <p className="waya-home-context">{store?.name ? `${store.name} workspace` : experience.displayName}</p>
          <h1 className="waya-home-title">Home</h1>
          <p className="waya-home-sub">{greetingForNow(profile?.firstName)}. {experience.primaryQuestion}</p>
        </div>
        <div className="waya-home-actions">
          {experience.secondaryActions.filter(action => action.implemented && canUseAction(action.route)).map(action => (
            <Link key={action.route} className="btn btn-ghost btn-sm" to={action.route}>{action.label}</Link>
          ))}
          <Button variant="outline" className="btn-sm" onClick={loadDashboard}>Refresh</Button>
          {experience.primaryAction.implemented && canUseAction(experience.primaryAction.route) && (
            <Button onClick={() => navigate(experience.primaryAction.route === '/jobs' ? '/jobs?new=1' : experience.primaryAction.route)}>
              {experience.primaryAction.label}
            </Button>
          )}
        </div>
      </div>

      {partialFailures > 0 && !error && (
        <div className="alert alert-warning" role="status">
          <span className="alert-text">{partialFailures} dashboard source{partialFailures === 1 ? '' : 's'} could not load. Unavailable figures are hidden.</span>
          <Button variant="ghost" className="btn-sm" onClick={loadDashboard}>Try again</Button>
        </div>
      )}

      {error ? (
        <div className="card">
          <StateBlock
            variant="error"
            title="Could not load the dashboard"
            body={error}
            actions={<Button variant="outline" className="btn-sm" onClick={loadDashboard}>Try again</Button>}
          />
        </div>
      ) : !hasAvailableData ? (
        <div className="card">
          <StateBlock
            variant="unavailable"
            title="Dashboard data unavailable"
            body="Your role has no accessible dashboard data, or the available sources did not answer."
            actions={partialFailures > 0 && <Button variant="outline" className="btn-sm" onClick={loadDashboard}>Try again</Button>}
          />
        </div>
      ) : (
        <>
          {homeMetrics.length > 0 && (
            <section className="hd-metrics" aria-label="Key business metrics">
              {homeMetrics.map((metric) => (
                <HomeMetricCard key={metric.label} metric={metric} />
              ))}
            </section>
          )}

          <div className="hd-grid">
            {canReadReports && (
              <DashboardRevenuePanel
                load={loadRevenue}
                title="Sales performance"
                breakdownTitle="Sales by payment method"
                note="Completed sales only. Revenue is after discounts and includes tax; credit sales are not necessarily cash received."
                emptyDescription={experience.emptyStates.dashboard}
                emptyAction={experience.primaryAction.implemented && canUseAction(experience.primaryAction.route)
                  ? <Button className="btn-sm" onClick={() => navigate(experience.primaryAction.route === '/jobs' ? '/jobs?new=1' : experience.primaryAction.route)}>{experience.primaryAction.label}</Button>
                  : undefined}
              />
            )}
            <HomePanel title="Sales by payment method" subtitle="Completed sales today, by how customers paid.">
              {donutSlices.length > 0 ? (
                <HomeDonut slices={donutSlices} />
              ) : (
                <p className="hd-panel-note">No completed sales today, or the payment breakdown is unavailable.</p>
              )}
            </HomePanel>
          </div>

          <div className="hd-grid">
            <HomePanel title="Top products" subtitle="Best sellers today, as a share of today's revenue.">
              {topBars.length > 0 ? (
                <HomeBars total={formatMoney(totalRevenue)} bars={topBars} />
              ) : (
                <p className="hd-panel-note">No completed sales to rank yet.</p>
              )}
            </HomePanel>
            <HomePanel title="Recent activity" subtitle="The latest changes in this workspace.">
              {activity === null ? (
                <p className="hd-panel-note">Activity is unavailable.</p>
              ) : (
                <BusinessActivity logs={activity.slice(0, 4)} actorId={profile?.id} actorName={profile?.firstName} />
              )}
            </HomePanel>
          </div>

          <div className="hd-grid">
            <HomePanel title={`${experience.terminology.stock} attention`} subtitle="Items at or below their reorder level.">
              {lowStock === null ? (
                <p className="hd-panel-note">Stock status is unavailable.</p>
              ) : lowStock.length === 0 ? (
                <p className="hd-panel-note">No low-stock {experience.terminology.lineItem.toLowerCase()} need attention.</p>
              ) : (
                <div className="list">
                  {lowStock.slice(0, 4).map((product) => (
                    <Link className="list-item" key={product.id} to={`/inventory/products/${product.id}`}>
                      <div>
                        <p className="list-item-title">{product.name}</p>
                        <p className="list-item-subtitle">Available: {stockQuantity(product.stockQty, product.unit)}</p>
                      </div>
                      <span className={`badge ${product.stockQty <= 0 ? 'badge-danger' : 'badge-warning'}`}>{stockState(product)}</span>
                    </Link>
                  ))}
                </div>
              )}
            </HomePanel>
            <HomePanel title="Needs attention" subtitle="Actionable issues across this workspace.">
              {attentionItems.length === 0 ? (
                <p className="hd-panel-note">No urgent issues need attention right now.</p>
              ) : (
                <div className="hd-attention">
                  {attentionItems.slice(0, 4).map((item) => (
                    <Link className="hd-attention-item" key={item.title} to={item.to}>
                      <strong>{item.title}</strong>
                      <span>{item.body}</span>
                    </Link>
                  ))}
                </div>
              )}
            </HomePanel>
          </div>

          {operationalMetrics.length > 0 && (
            <section className="hd-operational" aria-label={`${experience.displayName} metrics`}>
              <h2 className="hd-operational-title">Operational focus</h2>
              <KpiGrid>
                {operationalMetrics.map(({ metric, value, sub }) => {
                  const tone = metric.tone === 'warn' ? 'warning' : metric.tone === 'danger' ? 'danger' : 'default';
                  return (
                    <KpiCard
                      key={metric.key}
                      label={metric.label}
                      value={value}
                      foot={sub}
                      tone={tone}
                      onClick={metric.linkTo && (metric.linkTo.startsWith('/jobs') ? canReadJobs : canUseAction(metric.linkTo)) ? () => navigate(metric.linkTo!) : undefined}
                      ariaLabel={metric.linkTo ? `${metric.label}: ${value}. Open details` : undefined}
                    />
                  );
                })}
              </KpiGrid>
            </section>
          )}
        </>
      )}
    </div>
  );
}
