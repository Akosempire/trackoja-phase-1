import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../hooks/usePermissions';
import { OrganizationService } from '../services/organization.service';
import { StoreService } from '../services/store.service';
import { ReportService } from '../services/report.service';
import { SaleService } from '../services/sale.service';
import { PageLoader } from '../components/ui/PageLoader';
import type { Organization, Store, Sale, SalesSummary, InventoryValuation, CustomerBalancesSummary } from '../types';

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

export default function DashboardPage() {
  const { user, profile } = useAuth();
  const { hasPermission } = usePermissions();

  const [organization, setOrganization] = useState<Organization | null>(null);
  const [store, setStore] = useState<Store | null>(null);
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [inventory, setInventory] = useState<InventoryValuation | null>(null);
  const [balances, setBalances] = useState<CustomerBalancesSummary | null>(null);
  const [recentSales, setRecentSales] = useState<Sale[]>([]);
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
      OrganizationService.getOrganization(profile.currentOrgId),
      storeId ? StoreService.getStore(storeId) : Promise.resolve(null),
      storeId ? ReportService.getSalesSummary(storeId, todayStart, now) : Promise.resolve(null),
      storeId ? ReportService.getInventoryValuation(storeId) : Promise.resolve(null),
      storeId ? ReportService.getCustomerBalancesSummary(storeId) : Promise.resolve(null),
      storeId ? SaleService.getSales(storeId, { dateFrom: todayStart }) : Promise.resolve([]),
    ])
      .then(([org, currentStore, salesSummary, inv, bal, sales]) => {
        setOrganization(org);
        setStore(currentStore);
        setSummary(salesSummary);
        setInventory(inv);
        setBalances(bal);
        setRecentSales(sales.slice(0, 5));
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
            {organization?.name}
            {store ? ` · ${store.name}` : ''}
          </p>
        </div>
      </div>

      {!store ? (
        <div className="empty-state">No store selected yet.</div>
      ) : (
        <>
          <div className="stats-grid">
            <div className="stat-card">
              <p className="stat-label">Revenue today</p>
              <p className="stat-value">₦{(summary?.totalRevenue ?? 0).toLocaleString()}</p>
            </div>
            <div className="stat-card">
              <p className="stat-label">Transactions today</p>
              <p className="stat-value">{summary?.transactionCount ?? 0}</p>
            </div>
            <div className="stat-card">
              <p className="stat-label">Low stock items</p>
              <p className="stat-value">{inventory?.lowStockCount ?? 0}</p>
            </div>
            <div className="stat-card">
              <p className="stat-label">Outstanding balance</p>
              <p className="stat-value">₦{(balances?.totalReceivables ?? 0).toLocaleString()}</p>
            </div>
          </div>

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

          <div className="page-header">
            <p className="list-item-title" style={{ margin: 0 }}>
              Recent sales
            </p>
            {hasPermission('sales:view') && (
              <Link to="/sales" className="btn-ghost" style={{ fontSize: 13 }}>
                View all
              </Link>
            )}
          </div>

          {recentSales.length === 0 ? (
            <div className="empty-state">No sales yet today.</div>
          ) : (
            <div className="list">
              {recentSales.map((sale) => (
                <Link key={sale.id} to={`/sales/${sale.id}`} className="list-item">
                  <div>
                    <p className="list-item-title">{sale.saleNumber}</p>
                    <p className="list-item-subtitle">
                      {sale.customerName || 'Walk-in customer'} ·{' '}
                      {new Date(sale.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <div className="list-item-meta">
                    <span className="list-item-title">₦{sale.total.toLocaleString()}</span>
                    {sale.status !== 'completed' && (
                      <span className="badge badge-warning" style={{ textTransform: 'capitalize' }}>
                        {sale.status}
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
