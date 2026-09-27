import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useBusinessContext } from '../contexts/BusinessContext';
import { StoreService } from '../services/store.service';
import { ReportService } from '../services/report.service';
import { ProductService } from '../services/product.service';
import { AuditService } from '../services/audit.service';
import { SaleService } from '../services/sale.service';
import { CustomerService } from '../services/customer.service';
import { Button } from '../components/ui/Button';
import { PageLoader } from '../components/ui/PageLoader';
import { getBusinessExperience, type DashboardMetric } from '../config/businessExperience';
import { isResolvableMetric } from '../config/dashboardMetrics';
import type { AuditLog, Product, Sale, SalesSummary, Store } from '../types';
import '../styles/dashboard.css';

function formatMoney(value: number): string {
  return `₦${Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
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
  kitchenOrders: Sale[];
  refunds: { createdAt?: string }[];
  customerCount: number;
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
      return { metric, value: String(ctx.kitchenOrders.filter((o) => o.orderStatus === 'new').length) };
    case 'preparing':
      return {
        metric,
        value: String(ctx.kitchenOrders.filter((o) => o.orderStatus === 'preparing').length),
      };
    case 'ready':
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
      return { metric, value: String(ctx.customerCount) };
    case 'returns':
      return { metric, value: String(ctx.refunds.length) };
    default:
      return null;
  }
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { category } = useBusinessContext();
  const experience = getBusinessExperience(category);
  const storeId = profile?.currentStoreId;

  const [store, setStore] = useState<Store | null>(null);
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [lowStock, setLowStock] = useState<Product[]>([]);
  const [kitchenOrders, setKitchenOrders] = useState<Sale[]>([]);
  const [refunds, setRefunds] = useState<{ createdAt?: string }[]>([]);
  const [customerCount, setCustomerCount] = useState(0);
  const [activity, setActivity] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!storeId) {
      setLoading(false);
      return;
    }
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      StoreService.getStore(storeId),
      ReportService.getSalesSummary(storeId, todayStart.toISOString(), now.toISOString()),
      ProductService.getProducts(storeId),
      ProductService.getProducts(storeId, { status: 'active', lowStockOnly: true }),
      AuditService.getStoreAuditLogs(storeId, 8),
      // Optional sources: absent data must not break the dashboard.
      SaleService.getKitchenOrders(storeId).catch(() => [] as Sale[]),
      SaleService.getRecentRefunds(storeId).catch(() => []),
      CustomerService.getCustomers(storeId).catch(() => []),
    ])
      .then(([storeRow, sales, allProducts, low, logs, orders, refundRows, customers]) => {
        if (cancelled) return;
        setStore(storeRow);
        setSummary(sales);
        setProducts(allProducts);
        setLowStock(low);
        setActivity(logs);
        setKitchenOrders(orders);
        setRefunds(refundRows as { createdAt?: string }[]);
        setCustomerCount(customers.length);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError((err as Error)?.message ?? 'Could not load your dashboard');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [storeId]);

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
    (summary?.transactionCount ?? 0) > 0 || products.length > 0 || customerCount > 0;

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

      {error && <div className="alert alert-error">{error}</div>}

      {/* Primary action first: it is what this business does most often. */}
      <div className="btn-row dash-actions">
        <Button
          onClick={() => navigate(experience.primaryAction.route)}
          disabled={!experience.primaryAction.implemented}
        >
          {experience.primaryAction.label}
        </Button>
        {experience.secondaryActions
          .filter((action) => action.implemented)
          .map((action) => (
            <Button key={action.label} variant="outline" onClick={() => navigate(action.route)}>
              {action.label}
            </Button>
          ))}
      </div>

      {resolved.length === 0 ? (
        <div className="card dash-empty">
          <p className="list-item-title">Nothing to show yet</p>
          <p className="page-subtitle">{experience.emptyStates.dashboard}</p>
          <Link className="btn btn-primary btn-sm" to={experience.primaryAction.route}>
            {experience.primaryAction.label}
          </Link>
        </div>
      ) : (
        <div className="stats-grid dash-metrics">
          {resolved.map(({ metric, value, sub }) => {
            const toneClass =
              metric.tone === 'warn'
                ? ' dash-value-warn'
                : metric.tone === 'danger'
                  ? ' dash-value-danger'
                  : '';
            const body = (
              <>
                <p className="stat-label">{metric.label}</p>
                <p className={`stat-value${toneClass}`}>{value}</p>
                {sub && <p className="dash-metric-sub">{sub}</p>}
              </>
            );
            return metric.linkTo ? (
              <Link className="stat-card dash-metric" key={metric.key} to={metric.linkTo}>
                {body}
              </Link>
            ) : (
              <div className="stat-card dash-metric" key={metric.key}>
                {body}
              </div>
            );
          })}
        </div>
      )}

      <div className="card">
        <p className="list-item-title">Recent activity</p>
        {!hasAnyRecords ? (
          <p className="page-subtitle">{experience.emptyStates.primaryList}</p>
        ) : activity.length === 0 ? (
          <p className="page-subtitle">No activity recorded yet.</p>
        ) : (
          <div className="list">
            {activity.map((log) => (
              <div className="list-item" key={log.id}>
                <div>
                  <p className="list-item-title">{log.action.replace(/_/g, ' ').toLowerCase()}</p>
                  <p className="list-item-subtitle">
                    {log.resourceName ?? log.resourceType ?? 'record'} · {timeAgo(log.createdAt)}
                  </p>
                </div>
                <span
                  className={`badge ${log.status === 'success' ? 'badge-success' : 'badge-warning'}`}
                >
                  {log.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
