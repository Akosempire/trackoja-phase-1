import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../hooks/usePermissions';
import { useBusinessContext } from '../contexts/BusinessContext';
import { StoreService } from '../services/store.service';
import { ReportService } from '../services/report.service';
import { ProductService } from '../services/product.service';
import { AuditService } from '../services/audit.service';
import { SaleService } from '../services/sale.service';
import { PageLoader } from '../components/ui/PageLoader';
import {
  AlertIcon, ChevronRightIcon, KitchenIcon, ExpiryIcon,
  SalesIcon, ProductsIcon, ReportsIcon,
} from '../components/icons';
import type { Store, SalesSummary, Product, AuditLog } from '../types';

function startOfToday(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatAction(log: AuditLog): string {
  const label = log.action.toLowerCase().replace(/_/g, ' ');
  const friendly = label.charAt(0).toUpperCase() + label.slice(1);
  return log.resourceName ? `${friendly} · ${log.resourceName}` : friendly;
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function activityIcon(action: string): string {
  const a = action.toLowerCase();
  if (a.includes('sale') || a.includes('checkout')) return '🛒';
  if (a.includes('refund')) return '↩';
  if (a.includes('product') || a.includes('stock') || a.includes('inventory')) return '📦';
  if (a.includes('customer')) return '👤';
  if (a.includes('report')) return '📊';
  if (a.includes('payment')) return '💳';
  return '📝';
}

export default function DashboardPage() {
  const { user, profile } = useAuth();
  const { hasPermission, roleName } = usePermissions();
  const { config, category } = useBusinessContext();

  const [store, setStore] = useState<Store | null>(null);
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [profitToday, setProfitToday] = useState(0);
  const [lowStock, setLowStock] = useState<Product[]>([]);
  const [activity, setActivity] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [kitchenActiveCount, setKitchenActiveCount] = useState<number | null>(null);
  const [expiryAlertCount, setExpiryAlertCount] = useState<number | null>(null);

  useEffect(() => {
    if (!profile?.currentOrgId) { setLoading(false); return; }
    const storeId = profile.currentStoreId;
    const todayStart = startOfToday();
    const now = new Date().toISOString();

    Promise.all([
      storeId ? StoreService.getStore(storeId) : Promise.resolve(null),
      storeId ? ReportService.getSalesSummary(storeId, todayStart, now) : Promise.resolve(null),
      storeId ? ReportService.getProfitSummary(storeId, todayStart, now) : Promise.resolve(0),
      storeId ? ProductService.getProducts(storeId, { status: 'active', lowStockOnly: true }) : Promise.resolve([]),
      storeId ? AuditService.getStoreAuditLogs(storeId, 8) : Promise.resolve([]),
    ])
      .then(([s, salesSummary, profit, lowStockProducts, recentActivity]) => {
        setStore(s);
        setSummary(salesSummary);
        setProfitToday(profit);
        setLowStock(lowStockProducts);
        setActivity(recentActivity);
      })
      .finally(() => setLoading(false));
  }, [profile?.currentOrgId, profile?.currentStoreId]);

  useEffect(() => {
    const storeId = profile?.currentStoreId;
    if (!storeId || !category) return;
    if (category === 'restaurant') {
      SaleService.getKitchenOrders(storeId).then((orders) => {
        setKitchenActiveCount(orders.filter((o) => o.orderStatus !== 'served').length);
      });
    } else if (category === 'pharmacy') {
      ProductService.getProducts(storeId).then((products) => {
        const now = new Date();
        const count = products.filter((p) => {
          const raw = p.attributes?.expiryDate;
          if (!raw) return false;
          const d = new Date(raw);
          return !isNaN(d.getTime()) && (d.getTime() - now.getTime()) / 86400000 <= 90;
        }).length;
        setExpiryAlertCount(count);
      });
    }
  }, [category, profile?.currentStoreId]);

  if (loading) return <PageLoader />;

  const firstName = profile?.firstName || user?.email?.split('@')[0] || 'there';
  const canSales = hasPermission('sales:create');
  const canProduct = hasPermission('product:create');
  const canCustomer = hasPermission('customer:create');
  const canReports = hasPermission('reports:view');
  const isCashier = roleName === 'cashier';
  const isInventoryOfficer = roleName === 'inventory_officer';

  const actionCount = [canSales, canProduct, canCustomer, canReports].filter(Boolean).length;

  return (
    <div className="page">
      {/* Greeting */}
      <div className="dash-header">
        <h1 className="page-title">{greeting()}, {firstName}</h1>
        <p className="page-subtitle">
          {store?.name ?? 'No store selected'} · {config.emoji} {config.label}
        </p>
      </div>

      {!store ? (
        <div className="empty-state">No store selected yet.</div>
      ) : (
        <>
          {/* KPI strip — only for users who can see reports */}
          {canReports && (
            <div className="dash-kpis">
              <div className="dash-kpi">
                <div className="dash-kpi-icon">₦</div>
                <div>
                  <p className="dash-kpi-label">Today's sales</p>
                  <p className="dash-kpi-value">₦{(summary?.totalRevenue ?? 0).toLocaleString()}</p>
                </div>
              </div>
              <div className="dash-kpi">
                <div className="dash-kpi-icon">#</div>
                <div>
                  <p className="dash-kpi-label">Transactions</p>
                  <p className="dash-kpi-value">{summary?.transactionCount ?? 0}</p>
                </div>
              </div>
              <div className="dash-kpi dash-kpi-profit">
                <div className="dash-kpi-icon">↑</div>
                <div>
                  <p className="dash-kpi-label">Profit today</p>
                  <p className="dash-kpi-value">₦{profitToday.toLocaleString()}</p>
                </div>
              </div>
            </div>
          )}

          {/* Cashier: transactions count widget when no full KPIs */}
          {isCashier && summary && (
            <div className="dash-kpis" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="dash-kpi">
                <div className="dash-kpi-icon">#</div>
                <div>
                  <p className="dash-kpi-label">My sales today</p>
                  <p className="dash-kpi-value">{summary.transactionCount}</p>
                </div>
              </div>
              <div className="dash-kpi">
                <div className="dash-kpi-icon">₦</div>
                <div>
                  <p className="dash-kpi-label">Revenue today</p>
                  <p className="dash-kpi-value">₦{(summary.totalRevenue ?? 0).toLocaleString()}</p>
                </div>
              </div>
            </div>
          )}

          <div className="dash-body">
            {/* ── LEFT: actions + module widgets ── */}
            <div className="dash-body-left">
              {actionCount > 0 && (
                <>
                  <p className="dash-section-label">Quick actions</p>
                  <div className="dash-actions" style={actionCount === 1 ? { gridTemplateColumns: '1fr' } : undefined}>
                    {canSales && (
                      <Link to="/sales/checkout" className="dash-action-card dash-action-primary">
                        <SalesIcon width={22} height={22} />
                        <span>New sale</span>
                      </Link>
                    )}
                    {canProduct && (
                      <Link to="/inventory/products/new" className="dash-action-card">
                        <ProductsIcon width={22} height={22} />
                        <span>Add product</span>
                      </Link>
                    )}
                    {canCustomer && (
                      <Link to="/customers/new" className="dash-action-card">
                        <span className="dash-action-emoji">👤</span>
                        <span>Add customer</span>
                      </Link>
                    )}
                    {canReports && (
                      <Link to="/reports" className="dash-action-card">
                        <ReportsIcon width={22} height={22} />
                        <span>Reports</span>
                      </Link>
                    )}
                  </div>
                </>
              )}

              {/* Module widgets */}
              {category === 'restaurant' && kitchenActiveCount !== null && (
                <Link to="/kitchen" className="card module-widget-card">
                  <div className="module-widget-icon"><KitchenIcon width={20} height={20} /></div>
                  <div className="module-widget-body">
                    <p className="module-widget-label">Kitchen queue</p>
                    <p className="module-widget-value">
                      {kitchenActiveCount} active order{kitchenActiveCount === 1 ? '' : 's'}
                    </p>
                  </div>
                  <ChevronRightIcon width={16} height={16} style={{ color: 'var(--t2)' }} />
                </Link>
              )}

              {category === 'pharmacy' && expiryAlertCount !== null && expiryAlertCount > 0 && (
                <Link to="/pharmacy/expiry" className="card module-widget-card module-widget-warn">
                  <div className="module-widget-icon"><ExpiryIcon width={20} height={20} /></div>
                  <div className="module-widget-body">
                    <p className="module-widget-label">Expiry alerts</p>
                    <p className="module-widget-value">
                      {expiryAlertCount} product{expiryAlertCount === 1 ? '' : 's'} expiring within 90 days
                    </p>
                  </div>
                  <ChevronRightIcon width={16} height={16} style={{ color: 'var(--t2)' }} />
                </Link>
              )}

              {/* Inventory officer: low stock hero */}
              {isInventoryOfficer && lowStock.length > 0 && (
                <div className="card">
                  <div className="dash-card-header">
                    <p className="list-item-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <AlertIcon width={15} height={15} style={{ color: 'var(--amber)' }} />
                      Low stock ({lowStock.length})
                    </p>
                    <Link to="/inventory/products" className="btn-ghost" style={{ fontSize: 12 }}>View all</Link>
                  </div>
                  {lowStock.slice(0, 5).map((product) => (
                    <Link key={product.id} to={`/inventory/products/${product.id}`} className="list-item">
                      <div>
                        <p className="list-item-title">{product.name}</p>
                        <p className="list-item-subtitle">SKU {product.sku}</p>
                      </div>
                      <span className="badge badge-warning">{product.stockQty} {product.unit} left</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* ── RIGHT: alerts + activity ── */}
            <div className="dash-body-right">
              {/* Low stock (for non-inventory-officer) */}
              {!isInventoryOfficer && lowStock.length > 0 && (
                <div className="card">
                  <div className="dash-card-header">
                    <p className="list-item-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <AlertIcon width={15} height={15} style={{ color: 'var(--amber)' }} />
                      Low stock
                    </p>
                    <Link to="/inventory/products" className="btn-ghost" style={{ fontSize: 12 }}>View all</Link>
                  </div>
                  {lowStock.slice(0, 4).map((product) => (
                    <Link key={product.id} to={`/inventory/products/${product.id}`} className="list-item">
                      <div>
                        <p className="list-item-title">{product.name}</p>
                        <p className="list-item-subtitle">SKU {product.sku}</p>
                      </div>
                      <span className="badge badge-warning">{product.stockQty} left</span>
                    </Link>
                  ))}
                </div>
              )}

              {/* Recent activity */}
              <div className="card">
                <p className="list-item-title" style={{ marginBottom: 10 }}>Recent activity</p>
                {activity.length === 0 ? (
                  <div className="empty-state">No recent activity.</div>
                ) : (
                  <div>
                    {activity.map((log) => (
                      <div key={log.id} className="dash-activity-item">
                        <div className="dash-activity-icon">{activityIcon(log.action)}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p className="list-item-title">{formatAction(log)}</p>
                          <p className="list-item-subtitle">{timeAgo(log.createdAt)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
