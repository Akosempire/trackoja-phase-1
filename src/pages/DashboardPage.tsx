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
  products: Product[];
  lowStock: Product[];
  kitchenOrders: Sale[] | null;
  refunds: { createdAt?: string }[] | null;
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
    ctx.products.filter((p) => {
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
      return { metric, value: String(ctx.lowStock.length) };
    case 'unavailable_items':
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
      return { metric, value: String(expiringWithin(90).length) };
    case 'expired':
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
      if (!ctx.refunds) return null;
      return { metric, value: String(ctx.refunds.length) };
    default:
      return null;
  }
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { category } = useBusinessContext();
  const { hasPermission, loading: permissionsLoading } = usePermissions();
  const experience = getBusinessExperience(category);
  const storeId = profile?.currentStoreId;
  const dashboardRequest = useRef(0);

  const [store, setStore] = useState<Store | null>(null);
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [lowStock, setLowStock] = useState<Product[]>([]);
  const [kitchenOrders, setKitchenOrders] = useState<Sale[] | null>(null);
  const [refunds, setRefunds] = useState<{ createdAt?: string }[] | null>(null);
  const [customerCount, setCustomerCount] = useState<number | null>(null);
  const [activity, setActivity] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
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
    setProducts([]);
    setLowStock([]);
    setKitchenOrders(null);
    setRefunds(null);
    setCustomerCount(null);
    setActivity([]);

    try {
      const [storeRow, sales, allProducts, low, logs, orders, refundRows, customers] = await Promise.all([
        StoreService.getStore(storeId),
        ReportService.getSalesSummary(storeId, todayStart.toISOString(), now.toISOString()),
        ProductService.getProducts(storeId),
        ProductService.getProducts(storeId, { status: 'active', lowStockOnly: true }),
        AuditService.getStoreAuditLogs(storeId, 8),
        // These enrich the dashboard; an unavailable module must not break core figures.
        SaleService.getKitchenOrders(storeId).catch(() => null),
        SaleService.getRecentRefunds(storeId).catch(() => null),
        CustomerService.getCustomers(storeId).catch(() => null),
      ]);
      if (request !== dashboardRequest.current) return;
      setStore(storeRow);
      setSummary(sales);
      setProducts(allProducts);
      setLowStock(low);
      setActivity(logs);
      setKitchenOrders(orders);
      setRefunds(refundRows as { createdAt?: string }[] | null);
      setCustomerCount(customers?.length ?? null);
    } catch (err) {
      if (request === dashboardRequest.current) setError((err as Error)?.message ?? 'Could not load your dashboard');
    } finally {
      if (request === dashboardRequest.current) setLoading(false);
    }
  }, [storeId]);

  useEffect(() => { void loadDashboard(); }, [loadDashboard]);

  const resolved = useMemo(() => {
    const ctx: MetricContext = {
      summary,
      products,
      lowStock,
      kitchenOrders,
      refunds,
      customerCount,
    };
    return experience.dashboard
      .filter((metric) => metric.implemented)
      .map((metric) => resolveMetric(metric, ctx))
      .filter((entry): entry is ResolvedMetric => entry !== null);
  }, [experience, summary, products, lowStock, kitchenOrders, refunds, customerCount]);

  // A business with no records at all gets guidance, not zeroes.
  const hasAnyRecords =
    (summary?.transactionCount ?? 0) > 0 || products.length > 0 || (customerCount ?? 0) > 0;
  const canUseAction = (route: string) => {
    if (permissionsLoading) return false;
    if (route === '/sales/checkout') return hasPermission('sales:create');
    if (route === '/inventory/products/new') return hasPermission('product:create');
    return true;
  };

  if (loading) return <PageLoader />;

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

      {error ? (
        <div className="card">
          <StateBlock
            variant="error"
            title="Could not load the dashboard"
            body={error}
            actions={<Button variant="outline" className="btn-sm" onClick={loadDashboard}>Try again</Button>}
          />
        </div>
      ) : !hasAnyRecords ? (
        <div className="card">
          <StateBlock
            title={`No ${experience.terminology.recordPlural.toLowerCase()} to show yet`}
            body={experience.emptyStates.dashboard}
            actions={canUseAction(experience.primaryAction.route) ? (
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

          <section className="card" aria-labelledby="recent-activity-title">
            <SectionHead id="recent-activity-title" title="Recent activity" />
            {activity.length === 0 ? (
              <StateBlock title="No recent activity" body="Completed changes and actions will appear here." />
            ) : (
              <div className="list">
                {activity.map((log) => (
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
        </>
      )}
    </div>
  );
}
