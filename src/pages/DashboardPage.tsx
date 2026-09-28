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
import { formatMoney } from '../utils/format';
import '../styles/dashboard.css';

function daysUntil(dateish: string | undefined): number | null {
  if (!dateish) return null;
  const then = new Date(dateish);
  if (Number.isNaN(then.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  then.setHours(0, 0, 0, 0);
  return Math.round((then.getTime() - today.getTime()) / 86_400_000);
}

function timeAgo(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

interface MetricContext {
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

/**
 * Maps a metric key to something the merchant can act on. Returns null when the
 * data is unavailable, and that card is then simply not rendered - never rendered
 * blank and never filled with a placeholder figure.
 */
function resolveMetric(metric: DashboardMetric, ctx: MetricContext): ResolvedMetric | null {
  if (!isResolvableMetric(metric.key)) return null;

  const expiringWithin = (days: number) =>
    (ctx.products ?? []).filter((p) => {
      const left = daysUntil(p.attributes?.expiryDate);
      return left !== null && left >= 0 && left <= days;
    });

  switch (metric.key) {
    case 'sales_today': {
      if (!ctx.summary) return null;
      const count = ctx.summary.transactionCount;
      return {
        metric,
        value: formatMoney(ctx.summary.totalRevenue),
        sub: `${count} sale${count === 1 ? '' : 's'}`,
      };
    }
    case 'transactions_today':
      if (!ctx.summary) return null;
      return { metric, value: String(ctx.summary.transactionCount) };
    case 'low_stock':
      if (!ctx.lowStock) return null;
      return { metric, value: String(ctx.lowStock.length) };
    case 'unavailable_items':
      if (!ctx.products) return null;
      return {
        metric,
        value: String(ctx.products.filter((p) => p.trackInventory && p.stockQty <= 0).length),
      };
    case 'open_orders':
      if (!ctx.kitchenOrders) return null;
      return { metric, value: String(ctx.kitchenOrders.filter((o) => o.orderStatus === 'new').length) };
    case 'preparing':
      if (!ctx.kitchenOrders) return null;
      return {
        metric,
        value: String(ctx.kitchenOrders.filter((o) => o.orderStatus === 'preparing').length),
      };
    case 'ready':
      if (!ctx.kitchenOrders) return null;
      return {
        metric,
        value: String(ctx.kitchenOrders.filter((o) => o.orderStatus === 'ready').length),
      };
    case 'near_expiry':
    case 'expiring':
      if (!ctx.products) return null;
      return { metric, value: String(expiringWithin(90).length) };
    case 'expired':
      if (!ctx.products) return null;
      return {
        metric,
        value: String(
          ctx.products.filter((p) => {
            const left = daysUntil(p.attributes?.expiryDate);
            return left !== null && left < 0;
          }).length
        ),
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
  const { category } = useBusinessContext();
  const { hasPermission, loading: permissionsLoading } = usePermissions();
  const canReadReports = hasPermission('reports:view');
  const canReadInventory = hasPermission('inventory:view');
  const canReadSales = hasPermission('sales:view');
  const canReadCustomers = hasPermission('customer:view');
  const experience = getBusinessExperience(category);
  const storeId = profile?.currentStoreId;
  const dashboardRequest = useRef(0);

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
      const [storeRow, sales, allProducts, low, logs, orders, refundRows, customers] = await Promise.all([
        StoreService.getStore(storeId),
        canReadReports ? optional(ReportService.getSalesSummary(storeId, todayStart.toISOString(), now.toISOString())) : Promise.resolve(null),
        canReadInventory ? optional(ProductService.getProducts(storeId)) : Promise.resolve(null),
        canReadInventory ? optional(ProductService.getProducts(storeId, { status: 'active', lowStockOnly: true })) : Promise.resolve(null),
        optional(AuditService.getStoreAuditLogs(storeId, 8)),
        category === 'restaurant' && canReadSales ? optional(SaleService.getKitchenOrders(storeId)) : Promise.resolve(null),
        canReadSales ? optional(SaleService.getRefundCount(storeId, todayStart.toISOString(), now.toISOString())) : Promise.resolve(null),
        canReadCustomers ? optional(CustomerService.getCustomers(storeId)) : Promise.resolve(null),
      ]);
      if (request !== dashboardRequest.current) return;
      setStore(storeRow);
      setSummary(sales);
      setProducts(allProducts);
      setLowStock(low);
      setActivity(logs);
      setKitchenOrders(orders);
      setRefundCount(refundRows);
      setCustomerCount(customers?.length ?? null);
      setPartialFailures(failed);
    } catch (err) {
      if (request === dashboardRequest.current) setError((err as Error)?.message ?? 'Could not load your dashboard');
    } finally {
      if (request === dashboardRequest.current) setLoading(false);
    }
  }, [storeId, permissionsLoading, canReadReports, canReadInventory, canReadSales, canReadCustomers, category]);

  useEffect(() => { void loadDashboard(); }, [loadDashboard]);

  const resolved = useMemo(() => {
    const ctx: MetricContext = {
      summary,
      products,
      lowStock,
      kitchenOrders,
      refundCount,
      customerCount,
    };
    return experience.dashboard
      .filter((metric) => metric.implemented)
      .map((metric) => resolveMetric(metric, ctx))
      .filter((entry): entry is ResolvedMetric => entry !== null);
  }, [experience, summary, products, lowStock, kitchenOrders, refundCount, customerCount]);

  // A business with no records at all gets guidance, not zeroes.
  const hasAnyRecords =
    (summary?.transactionCount ?? 0) > 0 || (products?.length ?? 0) > 0 || (customerCount ?? 0) > 0;
  const hasAvailableData = summary !== null || products !== null || customerCount !== null || kitchenOrders !== null;
  const canUseAction = (route: string) => {
    if (permissionsLoading) return false;
    if (route === '/sales/checkout') return hasPermission('sales:create');
    if (route === '/inventory/products/new') return hasPermission('product:create');
    return true;
  };

  if (loading || permissionsLoading) return <PageLoader />;

  return (
    <div className="page dash">
      <div className="page-header">
        <div>
          <h1 className="page-title">{store?.name ?? 'Overview'}</h1>
          {/* The question this business opens the app to answer. */}
          <p className="page-subtitle">{experience.primaryQuestion}</p>
        </div>
      </div>

      {/* Primary action first: it is what this business does most often. */}
      <div className="btn-row dash-actions">
        {experience.primaryAction.implemented && canUseAction(experience.primaryAction.route) && (
          <Button onClick={() => navigate(experience.primaryAction.route)}>
            {experience.primaryAction.label}
          </Button>
        )}
        {experience.secondaryActions
          .filter((action) => action.implemented)
          .filter((action) => canUseAction(action.route))
          .map((action) => (
            <Button key={action.label} variant="outline" onClick={() => navigate(action.route)}>
              {action.label}
            </Button>
          ))}
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
          <StateBlock variant="unavailable" title="Dashboard data unavailable" body="Your role has no accessible dashboard data, or the available sources did not answer." actions={partialFailures > 0 && <Button variant="outline" className="btn-sm" onClick={loadDashboard}>Try again</Button>} />
        </div>
      ) : !hasAnyRecords ? (
        <div className="card">
          <StateBlock
            variant={partialFailures > 0 ? 'error' : 'empty'}
            title={partialFailures > 0 ? 'Dashboard is incomplete' : `No ${experience.terminology.recordPlural.toLowerCase()} to show yet`}
            body={partialFailures > 0 ? 'Some data did not load, so an empty result cannot be confirmed.' : experience.emptyStates.dashboard}
            actions={partialFailures > 0 ? (
              <Button variant="outline" className="btn-sm" onClick={loadDashboard}>Try again</Button>
            ) : canUseAction(experience.primaryAction.route) ? (
              <Link className="btn btn-primary btn-sm" to={experience.primaryAction.route}>
                {experience.primaryAction.label}
              </Link>
            ) : null}
          />
        </div>
      ) : (
        <>
          <KpiGrid>
            {resolved.map(({ metric, value, sub }) => {
              const tone = metric.tone === 'warn' ? 'warning' : metric.tone === 'danger' ? 'danger' : 'default';
              return <KpiCard key={metric.key} label={metric.label} value={value} foot={sub} tone={tone}
                onClick={metric.linkTo ? () => navigate(metric.linkTo!) : undefined}
                ariaLabel={metric.linkTo ? `${metric.label}: ${value}. Open details` : undefined} />;
            })}
          </KpiGrid>

          <div className="dash-panels">
            <section className="card dash-panel" aria-labelledby="recent-activity-title">
              <SectionHead id="recent-activity-title" title="Recent activity" />
              {activity === null ? (
                <StateBlock compact variant="error" title="Activity unavailable" body="Recent actions could not be loaded." actions={<Button variant="outline" className="btn-sm" onClick={loadDashboard}>Try again</Button>} />
              ) : activity.length === 0 ? (
                <StateBlock compact title="No recent activity" body="Completed changes and actions will appear here." />
              ) : (
                <div className="list">
                  {activity.slice(0, 5).map((log) => (
                    <div className="list-item" key={log.id}>
                      <div>
                        <p className="list-item-title">{log.action.replace(/_/g, ' ').toLowerCase()}</p>
                        <p className="list-item-subtitle">{log.resourceName ?? log.resourceType ?? 'record'} · {timeAgo(log.createdAt)}</p>
                      </div>
                      <span className={`badge ${log.status === 'success' ? 'badge-success' : 'badge-warning'}`}>{log.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {hasPermission('inventory:view') && (
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
                    {lowStock.slice(0, 5).map((product) => (
                      <Link className="list-item" key={product.id} to={`/inventory/products/${product.id}`}>
                        <div>
                          <p className="list-item-title">{product.name}</p>
                          <p className="list-item-subtitle">Reorder at {product.reorderLevel.toLocaleString()} {product.unit}</p>
                        </div>
                        <span className="badge badge-warning">{product.stockQty.toLocaleString()} left</span>
                      </Link>
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>
        </>
      )}
    </div>
  );
}
