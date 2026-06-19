import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../hooks/usePermissions';
import { useBusinessContext } from '../contexts/BusinessContext';
import { StoreService } from '../services/store.service';
import { ReportService } from '../services/report.service';
import { ProductService } from '../services/product.service';
import { AuditService } from '../services/audit.service';
import { PageLoader } from '../components/ui/PageLoader';
import { AlertIcon, ChevronRightIcon } from '../components/icons';
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

export default function DashboardPage() {
  const { user, profile } = useAuth();
  const { hasPermission } = usePermissions();
  const { config } = useBusinessContext();

  const [store, setStore] = useState<Store | null>(null);
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [profitToday, setProfitToday] = useState(0);
  const [lowStock, setLowStock] = useState<Product[]>([]);
  const [activity, setActivity] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile?.currentOrgId) {
      setLoading(false);
      return;
    }

    const storeId = profile.currentStoreId;
    const todayStart = startOfToday();
    const now = new Date().toISOString();

    Promise.all([
      storeId ? StoreService.getStore(storeId) : Promise.resolve(null),
      storeId ? ReportService.getSalesSummary(storeId, todayStart, now) : Promise.resolve(null),
      storeId ? ReportService.getProfitSummary(storeId, todayStart, now) : Promise.resolve(0),
      storeId ? ProductService.getProducts(storeId, { status: 'active', lowStockOnly: true }) : Promise.resolve([]),
      storeId ? AuditService.getStoreAuditLogs(storeId, 6) : Promise.resolve([]),
    ])
      .then(([currentStore, salesSummary, profit, lowStockProducts, recentActivity]) => {
        setStore(currentStore);
        setSummary(salesSummary);
        setProfitToday(profit);
        setLowStock(lowStockProducts);
        setActivity(recentActivity);
      })
      .finally(() => setLoading(false));
  }, [profile?.currentOrgId, profile?.currentStoreId]);

  if (loading) return <PageLoader />;

  const firstName = profile?.firstName || user?.email?.split('@')[0] || 'there';

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">
            {greeting()}, {firstName}
          </h1>
          <p className="page-subtitle">
            {store?.name ?? 'No store selected'} · {config.emoji} {config.label}
          </p>
        </div>
      </div>

      {!store ? (
        <div className="empty-state">No store selected yet.</div>
      ) : (
        <>
          <div className="stats-grid stats-grid-3">
            <div className="stat-card">
              <p className="stat-label">Today's sales</p>
              <p className="stat-value">₦{(summary?.totalRevenue ?? 0).toLocaleString()}</p>
            </div>
            <div className="stat-card">
              <p className="stat-label">Transactions</p>
              <p className="stat-value">{summary?.transactionCount ?? 0}</p>
            </div>
            <div className="stat-card">
              <p className="stat-label">Profit</p>
              <p className="stat-value">₦{profitToday.toLocaleString()}</p>
            </div>
          </div>

          {lowStock.length > 0 && (
            <div className="card">
              <div className="page-header" style={{ marginBottom: 8 }}>
                <p className="list-item-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <AlertIcon width={16} height={16} style={{ color: 'var(--amber)' }} />
                  Low stock alerts
                </p>
                <Link to="/inventory/products" className="btn-ghost" style={{ fontSize: 13 }}>
                  View all
                </Link>
              </div>
              <div className="list">
                {lowStock.slice(0, 4).map((product) => (
                  <Link key={product.id} to={`/inventory/products/${product.id}`} className="list-item">
                    <div>
                      <p className="list-item-title">{product.name}</p>
                      <p className="list-item-subtitle">SKU {product.sku}</p>
                    </div>
                    <span className="badge badge-warning">
                      {product.stockQty} {product.unit} left
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          <div className="card">
            <p className="list-item-title" style={{ marginBottom: 12 }}>
              Quick actions
            </p>
            <div className="btn-row" style={{ flexWrap: 'wrap' }}>
              {hasPermission('sales:create') && (
                <Link to="/sales/checkout" className="btn btn-primary btn-sm">
                  New sale
                </Link>
              )}
              {hasPermission('product:create') && (
                <Link to="/inventory/products/new" className="btn btn-ghost btn-sm">
                  Add product
                </Link>
              )}
              {hasPermission('customer:create') && (
                <Link to="/customers/new" className="btn btn-ghost btn-sm">
                  Add customer
                </Link>
              )}
              {hasPermission('reports:view') && (
                <Link to="/reports" className="btn btn-ghost btn-sm">
                  Reports
                </Link>
              )}
            </div>
          </div>

          <div className="card">
            <p className="list-item-title" style={{ marginBottom: 8 }}>
              Recent activity
            </p>
            {activity.length === 0 ? (
              <div className="empty-state">No recent activity.</div>
            ) : (
              <div className="list">
                {activity.map((log) => (
                  <div key={log.id} className="list-item" style={{ cursor: 'default' }}>
                    <div>
                      <p className="list-item-title">{formatAction(log)}</p>
                      <p className="list-item-subtitle">{timeAgo(log.createdAt)}</p>
                    </div>
                    <ChevronRightIcon width={16} height={16} style={{ color: 'var(--t2)' }} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
