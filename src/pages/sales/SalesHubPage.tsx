import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { SaleService } from '../../services/sale.service';
import { ReportService } from '../../services/report.service';
import { Button } from '../../components/ui/Button';
import { PageLoader } from '../../components/ui/PageLoader';
import { getReportDateRange } from '../../utils/report-date-ranges';
import type { Sale, PendingSalePayment, PaymentMethodBreakdown } from '../../types';

export default function SalesHubPage() {
  const { profile } = useAuth();
  const { hasPermission, loading: permsLoading } = usePermissions();
  const storeId = profile?.currentStoreId;

  const canCheckout = hasPermission('sales:create');
  const canVerifyPayments = hasPermission('sales:refund');

  const [recentSales, setRecentSales] = useState<Sale[]>([]);
  const [pending, setPending] = useState<PendingSalePayment[]>([]);
  const [paymentBreakdown, setPaymentBreakdown] = useState<PaymentMethodBreakdown[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!storeId) {
      setLoading(false);
      return;
    }

    const { from, to } = getReportDateRange('today');

    Promise.all([
      SaleService.getSales(storeId, { status: 'completed' }),
      canVerifyPayments ? SaleService.getPendingPayments(storeId) : Promise.resolve([]),
      ReportService.getSalesByPaymentMethod(storeId, from, to),
    ])
      .then(([sales, pendingPayments, breakdown]) => {
        setRecentSales(sales.slice(0, 5));
        setPending(pendingPayments);
        setPaymentBreakdown(breakdown);
      })
      .catch((err) => setError(err.message ?? 'Failed to load sales'))
      .finally(() => setLoading(false));
  }, [storeId, canVerifyPayments]);

  if (permsLoading || loading) return <PageLoader />;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Sales</h1>
          <p className="page-subtitle">Today's checkout, payments and recent activity</p>
        </div>
        {canCheckout && (
          <Link to="/sales/checkout">
            <Button className="btn-sm">New sale</Button>
          </Link>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {paymentBreakdown.length > 0 && (
        <div className="card">
          <p className="list-item-title" style={{ marginBottom: 8 }}>
            Today's payment status
          </p>
          <div className="list">
            {paymentBreakdown.map((row) => (
              <div key={row.method} className="list-item" style={{ cursor: 'default' }}>
                <p className="list-item-title" style={{ textTransform: 'capitalize' }}>
                  {row.method}
                </p>
                <div className="list-item-meta">
                  <span className="list-item-title">₦{row.amount.toLocaleString()}</span>
                  <span className="list-item-subtitle">
                    {row.transactionCount} txn{row.transactionCount === 1 ? '' : 's'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {canVerifyPayments && (
        <div className="card">
          <div className="page-header" style={{ marginBottom: 8 }}>
            <p className="list-item-title" style={{ margin: 0 }}>
              Pending transactions
            </p>
            <Link to="/payments" className="btn-ghost" style={{ fontSize: 13 }}>
              View all
            </Link>
          </div>
          {pending.length === 0 ? (
            <div className="empty-state">No payments awaiting verification.</div>
          ) : (
            <div className="list">
              {pending.slice(0, 3).map((payment) => (
                <Link key={payment.id} to={`/sales/${payment.saleId}`} className="list-item">
                  <div>
                    <p className="list-item-title">Sale #{payment.saleNumber}</p>
                    <p className="list-item-subtitle" style={{ textTransform: 'capitalize' }}>
                      {payment.method}
                      {payment.reference && ` · Ref: ${payment.reference}`}
                    </p>
                  </div>
                  <span className="list-item-title">₦{payment.amount.toLocaleString()}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="card">
        <div className="page-header" style={{ marginBottom: 8 }}>
          <p className="list-item-title" style={{ margin: 0 }}>
            Recent sales
          </p>
          <Link to="/sales/history" className="btn-ghost" style={{ fontSize: 13 }}>
            View all
          </Link>
        </div>
        {recentSales.length === 0 ? (
          <div className="empty-state">No sales yet today.</div>
        ) : (
          <div className="list">
            {recentSales.map((sale) => (
              <Link key={sale.id} to={`/sales/${sale.id}`} className="list-item">
                <div>
                  <p className="list-item-title">Sale #{sale.saleNumber}</p>
                  <p className="list-item-subtitle">{new Date(sale.createdAt).toLocaleString()}</p>
                </div>
                <span className="list-item-title">₦{sale.total.toLocaleString()}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
