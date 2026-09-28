import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { SaleService } from '../../services/sale.service';
import { Button } from '../../components/ui/Button';
import { PageLoader } from '../../components/ui/PageLoader';
import { SectionState } from '../../components/ui/StateBlock';
import { getBusinessExperience } from '../../config/businessExperience';
import { formatDateTime, formatMoney } from '../../utils/format';
import { recordSaleAction } from '../../utils/business-language';
import type { Sale, SaleStatus } from '../../types';

export default function SalesHistoryPage() {
  const { profile } = useAuth();
  const { hasPermission, loading: permsLoading } = usePermissions();
  const { category } = useBusinessContext();
  const experience = getBusinessExperience(category);
  const storeId = profile?.currentStoreId;

  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<SaleStatus | ''>('');

  const canCheckout = hasPermission('sales:create');

  const loadSales = useCallback(async () => {
    if (!storeId) {
      setLoading(false);
      setError('Choose a business workspace to view its sales.');
      return;
    }
    setLoading(true);
    setError(null);
    setSales([]);
    try {
      setSales(await SaleService.getSales(storeId, { status: status || undefined }));
    } catch (err) {
      setError((err as Error)?.message ?? 'Failed to load sales');
    } finally {
      setLoading(false);
    }
  }, [storeId, status]);

  useEffect(() => { void loadSales(); }, [loadSales]);

  if (permsLoading) return <PageLoader />;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{experience.terminology.recordPlural} history</h1>
          <p className="page-subtitle">{loading ? 'Loading records…' : `${sales.length} ${experience.terminology.recordPlural.toLowerCase()}`}</p>
        </div>
        {canCheckout && (
          <Link to="/sales/checkout">
            <Button className="btn-sm">{category === 'restaurant' ? 'New order' : 'New sale'}</Button>
          </Link>
        )}
      </div>

      <div className="form-group">
        <select className="select-input" value={status} onChange={(e) => setStatus(e.target.value as SaleStatus | '')}>
          <option value="">All sales</option>
          <option value="completed">Completed</option>
          <option value="pending_payment">Awaiting payment</option>
          <option value="voided">Voided</option>
        </select>
      </div>

      <SectionState
        loading={loading}
        error={error}
        onRetry={loadSales}
        empty={sales.length === 0}
        emptyTitle={status ? `No ${status} ${experience.terminology.recordPlural.toLowerCase()}` : `No ${experience.terminology.recordPlural.toLowerCase()} yet`}
        emptyBody={status ? 'Choose another status to broaden the list.' : experience.emptyStates.primaryList}
        emptyActions={!status && canCheckout ? <Link className="btn btn-primary btn-sm" to="/sales/checkout">{recordSaleAction(category)}</Link> : null}
      >
        <div className="list">
          {sales.map((sale) => (
            <Link key={sale.id} to={`/sales/${sale.id}`} className="list-item">
              <div>
                <p className="list-item-title">{experience.terminology.record} #{sale.saleNumber}</p>
                <p className="list-item-subtitle">{formatDateTime(sale.createdAt)}</p>
              </div>
              <div className="list-item-meta">
                <span className={`badge ${sale.status === 'voided' ? 'badge-danger' : sale.status === 'pending_payment' ? 'badge-warning' : 'badge-success'}`}>
                  {sale.status === 'pending_payment' ? 'Awaiting payment' : sale.status}
                </span>
                <span className="list-item-subtitle">{formatMoney(sale.total)}</span>
              </div>
            </Link>
          ))}
        </div>
      </SectionState>
    </div>
  );
}
