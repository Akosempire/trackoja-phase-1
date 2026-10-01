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
import { SectionHead } from '../components/ui/SectionHead';
import { StateBlock } from '../components/ui/StateBlock';
import { HealthyStrip } from '../components/ui/AttentionList';
import { getBusinessExperience, type DashboardMetric } from '../config/businessExperience';
import { isResolvableMetric } from '../config/dashboardMetrics';
import type { AuditLog, Product, Sale, SalesSummary, Store } from '../types';
import { formatMoney, formatNumber } from '../utils/format';
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
      const [storeRow, sales, allProducts, low, logs, orders, refundRows, customers, jobSummary] = await Promise.all([
        StoreService.getStore(storeId),
        canReadReports ? optional(ReportService.getSalesSummary(storeId, todayStart.toISOString(), now.toISOString())) : Promise.resolve(null),
        canReadInventory ? optional(ProductService.getProducts(storeId)) : Promise.resolve(null),
        canReadInventory ? optional(ProductService.getProducts(storeId, { status: 'active', lowStockOnly: true })) : Promise.resolve(null),
        optional(AuditService.getStoreAuditLogs(storeId, 8, 0, permittedActivityTypes)),
        category === 'restaurant' && canReadSales ? optional(SaleService.getKitchenOrders(storeId)) : Promise.resolve(null),
        canReadSales ? optional(SaleService.getRefundCount(storeId, todayStart.toISOString(), now.toISOString())) : Promise.resolve(null),
        canReadCustomers ? optional(CustomerService.getCustomers(storeId)) : Promise.resolve(null),
        canReadJobs ? optional(JobService.summary(storeId)) : Promise.resolve(null),
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
    if (route === '/sales/checkout') return hasPermission('sales:create');
    if (route === '/inventory/products/new') return hasPermission('product:create');
    if (route === '/kitchen') return canReadSales;
    if (route.startsWith('/inventory')) return canReadInventory;
    if (route === '/customers/new') return hasPermission('customer:create');
    if (route.startsWith('/customers')) return canReadCustomers;
    if (route.startsWith('/jobs')) return hasPermission('job:create');
    if (route === '/settings') return hasPermission('store:update');
    return true;
  };

  const trackedProducts = products?.filter((product) => product.trackInventory) ?? null;
  const outOfStockCount = trackedProducts?.filter((product) => product.stockQty <= 0).length ?? null;
  const uncategorizedProducts = products?.filter((product) => !product.categoryId).length ?? null;
  const averageSale = summary && summary.transactionCount > 0 ? summary.totalRevenue / summary.transactionCount : 0;
  const salesSubtitle = summary
    ? `${formatNumber(summary.transactionCount)} completed ${summary.transactionCount === 1 ? 'sale' : 'sales'} today`
    : canReadReports
      ? 'Sales data is unavailable'
      : 'Reports access is required';

  const overviewCards = [
    canReadReports && summary ? { label: 'Gross Volume', value: formatMoney(summary.totalRevenue), noData: summary.transactionCount === 0 } : null,
    canReadReports && summary ? { label: 'Net Volume', value: formatMoney(summary.totalRevenue), noData: summary.transactionCount === 0 } : null,
    canReadCustomers && customerCount !== null ? { label: 'New Customers', value: formatNumber(customerCount), noData: customerCount === 0 } : null,
    canReadReports && summary ? { label: 'Average sale', value: formatMoney(averageSale), noData: summary.transactionCount === 0 } : null,
    canReadInventory && lowStock ? { label: `${experience.terminology.stock} alerts`, value: formatNumber(lowStock.length), noData: lowStock.length === 0 } : null,
    canReadInventory && trackedProducts ? { label: 'Items tracked', value: formatNumber(trackedProducts.length), noData: trackedProducts.length === 0 } : null,
  ].filter((item): item is { label: string; value: string; noData: boolean } => Boolean(item));

  const duplicateMetricKeys = new Set(['sales_today', 'transactions_today', 'low_stock', 'clients']);
  const operationalMetrics = resolved.filter(({ metric }) => !duplicateMetricKeys.has(metric.key));
  const lowStockAvailable = lowStock?.filter((product) => product.stockQty > 0).length ?? 0;

  const attentionItems = [
    canReadInventory && outOfStockCount !== null && outOfStockCount > 0
      ? { title: `${outOfStockCount} ${experience.terminology.lineItem.toLowerCase()}${outOfStockCount === 1 ? '' : 's'} out of stock`, body: 'Review stock before the next sale.', to: '/inventory/products' }
      : null,
    canReadInventory && lowStockAvailable > 0
      ? { title: `${lowStockAvailable} low-stock ${experience.terminology.lineItem.toLowerCase()}${lowStockAvailable === 1 ? '' : 's'}`, body: 'Restock items before they run out.', to: '/inventory/products' }
      : null,
    canReadInventory && uncategorizedProducts !== null && uncategorizedProducts > 0
      ? { title: `${uncategorizedProducts} uncategorized ${experience.terminology.lineItem.toLowerCase()}${uncategorizedProducts === 1 ? '' : 's'}`, body: 'Categories make checkout and reports easier to scan.', to: '/inventory/categories' }
      : null,
    canReadReports && summary && summary.transactionCount === 0 && canUseAction(experience.primaryAction.route)
      ? { title: `No ${experience.terminology.record.toLowerCase()} recorded today`, body: experience.emptyStates.dashboard, to: experience.primaryAction.route === '/jobs' ? '/jobs?new=1' : experience.primaryAction.route }
      : null,
    canReadCustomers && customerCount === 0 && canUseAction('/customers/new')
      ? { title: `No ${experience.terminology.customer.toLowerCase()} records yet`, body: `Add ${experience.terminology.customer.toLowerCase()}s to track repeat buyers and balances.`, to: '/customers/new' }
      : null,
  ].filter((item): item is { title: string; body: string; to: string } => Boolean(item));

  const hasAvailableData = jobs !== null || summary !== null || products !== null || customerCount !== null || kitchenOrders !== null;

  if (loading || permissionsLoading) return <PageLoader />;

  return (
    <div className="page dash">
      <TrialStatus />
      <div className="page-header dashboard-command-header">
        <div>
          <p className="dashboard-greeting">{store?.name ? `${store.name} workspace` : experience.displayName}</p>
          <h1 className="page-title">{greetingForNow(profile?.firstName)}</h1>
          <p className="page-subtitle">Here is an overview of your sales, stock, and business activity. {experience.primaryQuestion}</p>
        </div>
        <div className="dashboard-header-actions">
          <span className="dashboard-date-chip">Today</span>
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
          <section className={`dashboard-command-grid${canReadReports ? '' : ' dashboard-command-grid-compact'}`} aria-label="Business command center">
            {canReadReports && (
              <DashboardRevenuePanel
                load={loadRevenue}
                title="Sales revenue"
                breakdownTitle="Sales by payment method"
                note="Completed sales only. Revenue is after discounts and includes tax; credit sales are not necessarily cash received."
                emptyDescription={experience.emptyStates.dashboard}
                emptyAction={experience.primaryAction.implemented && canUseAction(experience.primaryAction.route)
                  ? <Button className="btn-sm" onClick={() => navigate(experience.primaryAction.route === '/jobs' ? '/jobs?new=1' : experience.primaryAction.route)}>{experience.primaryAction.label}</Button>
                  : undefined}
              />
            )}
            <aside className="dashboard-support-stack" aria-label="Current business status">
              <section className="dashboard-balance-card">
                <span className="dashboard-support-label">Branch Balance</span>
                <strong>{summary ? formatMoney(summary.totalRevenue) : formatMoney(0)}</strong>
                <div className="dashboard-balance-meter" aria-hidden="true"><span /></div>
                <div className="dashboard-balance-row">
                  <span>Available</span>
                  <span>Pending</span>
                  <strong>{summary ? formatMoney(summary.totalRevenue) : formatMoney(0)} available</strong>
                </div>
                <div className="dashboard-withdrawal-row">
                  <span>Last withdrawal<br /><strong>{formatMoney(0)}</strong></span>
                  <button type="button">Withdraw funds</button>
                </div>
              </section>
              <section className="dashboard-recent-payments-card">
                <span className="dashboard-support-label">Recent payments</span>
                <div className="dashboard-payment-skeleton" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
                <strong>Nothing here yet</strong>
                <p>Your incoming payments will appear here.</p>
              </section>
            </aside>
          </section>

          {overviewCards.length > 0 && (
            <section className="dashboard-overview-section" aria-label="Overview metrics">
              <div className="dashboard-overview-head">
                <h2>Overview</h2>
                <button type="button" className="dashboard-customize-button">Customize</button>
              </div>
              <div className="dashboard-overview-filters">
                <button type="button">Last 3 months</button>
                <button type="button">3 Jul 2026 to 1 Oct 2026</button>
              </div>
              <div className="dashboard-overview-cards">
                {overviewCards.slice(0, 6).map((metric) => (
                  <section className="dashboard-overview-card" key={metric.label}>
                    <span>{metric.label}</span>
                    <strong>{metric.value}</strong>
                    <div className="dashboard-mini-chart" aria-hidden="true">
                      <span />
                      <span />
                      <i>{metric.noData ? 'No data available' : salesSubtitle}</i>
                    </div>
                  </section>
                ))}
              </div>
            </section>
          )}

          <section className="dashboard-attention" aria-labelledby="dashboard-attention-title">
            <SectionHead id="dashboard-attention-title" title="Needs attention" />
            {attentionItems.length === 0 ? (
              <HealthyStrip>No urgent business issues need attention right now.</HealthyStrip>
            ) : (
              <div className="dashboard-attention-grid">
                {attentionItems.slice(0, 4).map((item) => (
                  <Link className="dashboard-attention-card" key={item.title} to={item.to}>
                    <strong>{item.title}</strong>
                    <span>{item.body}</span>
                  </Link>
                ))}
              </div>
            )}
          </section>

          {operationalMetrics.length > 0 && (
            <section className="owner-metrics" aria-label={`${experience.displayName} metrics`}>
              <div className="owner-dashboard-snapshot">
                <h2>Operational focus</h2>
                <p>These figures change based on the type of business you selected during onboarding.</p>
              </div>
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
                      onClick={metric.linkTo && (metric.linkTo.startsWith('/sales') ? canReadSales : true) ? () => navigate(metric.linkTo!) : undefined}
                      ariaLabel={metric.linkTo ? `${metric.label}: ${value}. Open details` : undefined}
                    />
                  );
                })}
              </KpiGrid>
            </section>
          )}

          <div className="dashboard-operations-grid">
            {canReadInventory && (
              <section className="card dash-panel" aria-labelledby="stock-attention-title">
                <SectionHead
                  id="stock-attention-title"
                  title={`${experience.terminology.stock} attention`}
                  actions={<Link className="btn btn-ghost btn-sm" to="/inventory/products">View {experience.terminology.lineItem.toLowerCase()}</Link>}
                />
                {lowStock === null ? (
                  <StateBlock compact variant="error" title="Stock status unavailable" body="Inventory could not be loaded." actions={<Button variant="outline" className="btn-sm" onClick={loadDashboard}>Try again</Button>} />
                ) : lowStock.length === 0 ? (
                  <HealthyStrip>No low-stock {experience.terminology.lineItem.toLowerCase()} need attention.</HealthyStrip>
                ) : (
                  <div className="list">
                    {lowStock.slice(0, 3).map((product) => (
                      <Link className="list-item" key={product.id} to={`/inventory/products/${product.id}`}>
                        <div>
                          <p className="list-item-title">{product.name}</p>
                          <p className="list-item-subtitle">Available: {stockQuantity(product.stockQty, product.unit)}. Reorder level: {stockQuantity(product.reorderLevel, product.unit)}</p>
                        </div>
                        <span className={`badge ${product.stockQty <= 0 ? 'badge-danger' : 'badge-warning'}`}>{stockState(product)}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </section>
            )}
            <section className="card dash-panel" aria-labelledby="recent-activity-title">
              <SectionHead id="recent-activity-title" title="Recent activity" actions={<Link className="btn btn-ghost btn-sm" to="/activity">View activity</Link>} />
              {activity === null
                ? <StateBlock compact variant="error" title="Activity unavailable" actions={<Button variant="outline" onClick={loadDashboard}>Try again</Button>} />
                : <BusinessActivity logs={activity.slice(0, 3)} actorId={profile?.id} actorName={profile?.firstName} />}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
