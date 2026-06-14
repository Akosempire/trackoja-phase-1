import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { SaleService } from '../../services/sale.service';
import { Button } from '../../components/ui/Button';
import { PageLoader } from '../../components/ui/PageLoader';
import type { Sale, SaleStatus } from '../../types';

export default function SalesHistoryPage() {
  const { profile } = useAuth();
  const { hasPermission, loading: permsLoading } = usePermissions();
  const storeId = profile?.currentStoreId;

  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<SaleStatus | ''>('');

  const canCheckout = hasPermission('sales:create');

  useEffect(() => {
    if (!storeId) return;
    setLoading(true);
    SaleService.getSales(storeId, { status: status || undefined })
      .then(setSales)
      .catch((err) => setError(err.message ?? 'Failed to load sales'))
      .finally(() => setLoading(false));
  }, [storeId, status]);

  if (permsLoading) return <PageLoader />;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Sales history</h1>
          <p className="page-subtitle">{sales.length} sale{sales.length === 1 ? '' : 's'}</p>
        </div>
        {canCheckout && (
          <Link to="/sales/checkout">
            <Button className="btn-sm">New sale</Button>
          </Link>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="form-group">
        <select className="select-input" value={status} onChange={(e) => setStatus(e.target.value as SaleStatus | '')}>
          <option value="">All sales</option>
          <option value="completed">Completed</option>
          <option value="voided">Voided</option>
        </select>
      </div>

      {loading ? (
        <PageLoader />
      ) : sales.length === 0 ? (
        <div className="empty-state">No sales found.</div>
      ) : (
        <div className="list">
          {sales.map((sale) => (
            <Link key={sale.id} to={`/sales/${sale.id}`} className="list-item">
              <div>
                <p className="list-item-title">Sale #{sale.saleNumber}</p>
                <p className="list-item-subtitle">{new Date(sale.createdAt).toLocaleString()}</p>
              </div>
              <div className="list-item-meta">
                <span className={`badge ${sale.status === 'voided' ? 'badge-danger' : 'badge-success'}`}>{sale.status}</span>
                <span className="list-item-subtitle">₦{sale.total.toLocaleString()}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
