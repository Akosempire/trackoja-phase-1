import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { SaleService } from '../../services/sale.service';
import { Button } from '../../components/ui/Button';
import { PageLoader } from '../../components/ui/PageLoader';
import type { PendingSalePayment, RecentRefund } from '../../types';

export default function PaymentsPage() {
  const { profile } = useAuth();
  const { loading: permsLoading } = usePermissions();
  const storeId = profile?.currentStoreId;

  const [pending, setPending] = useState<PendingSalePayment[]>([]);
  const [refunds, setRefunds] = useState<RecentRefund[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  const load = () => {
    if (!storeId) return;
    setLoading(true);
    Promise.all([SaleService.getPendingPayments(storeId), SaleService.getRecentRefunds(storeId)])
      .then(([pendingData, refundsData]) => {
        setPending(pendingData);
        setRefunds(refundsData);
      })
      .catch((err) => setError(err.message ?? 'Failed to load payments'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [storeId]);

  const handleVerify = async (paymentId: string, status: 'verified' | 'rejected') => {
    setActingId(paymentId);
    setError(null);
    try {
      await SaleService.verifySalePayment(paymentId, status);
      load();
    } catch (err: any) {
      setError(err.message ?? 'Failed to update payment verification');
    } finally {
      setActingId(null);
    }
  };

  if (permsLoading || loading) return <PageLoader />;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Payments</h1>
          <p className="page-subtitle">Pending verifications and recent refunds</p>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="card">
        <p className="list-item-title" style={{ marginBottom: 8 }}>
          Pending verification
        </p>
        {pending.length === 0 ? (
          <div className="empty-state">No payments awaiting verification.</div>
        ) : (
          <div className="list">
            {pending.map((payment) => (
              <div key={payment.id} className="list-item">
                <div>
                  <Link to={`/sales/${payment.saleId}`} className="list-item-title">
                    Sale #{payment.saleNumber}
                  </Link>
                  <p className="list-item-subtitle" style={{ textTransform: 'capitalize' }}>
                    {payment.method}
                    {payment.reference && ` · Ref: ${payment.reference}`} · {new Date(payment.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="list-item-meta">
                  <span className="list-item-subtitle">₦{payment.amount.toLocaleString()}</span>
                  <div className="btn-row">
                    <Button
                      variant="ghost"
                      className="btn-sm"
                      loading={actingId === payment.id}
                      onClick={() => handleVerify(payment.id, 'verified')}
                    >
                      Verify
                    </Button>
                    <Button
                      variant="ghost"
                      className="btn-sm"
                      loading={actingId === payment.id}
                      onClick={() => handleVerify(payment.id, 'rejected')}
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <p className="list-item-title" style={{ marginBottom: 8 }}>
          Recent refunds
        </p>
        {refunds.length === 0 ? (
          <div className="empty-state">No refunds processed yet.</div>
        ) : (
          <div className="list">
            {refunds.map((refund) => (
              <Link key={refund.id} to={`/sales/${refund.saleId}`} className="list-item">
                <div>
                  <p className="list-item-title">Sale #{refund.saleNumber}</p>
                  <p className="list-item-subtitle">
                    {refund.reason} · {new Date(refund.createdAt).toLocaleString()}
                    {refund.createdByEmail && ` · ${refund.createdByEmail}`}
                  </p>
                </div>
                <div className="list-item-meta">
                  <span className="badge badge-default" style={{ textTransform: 'capitalize' }}>
                    {refund.method}
                  </span>
                  <span className="list-item-subtitle">₦{refund.amount.toLocaleString()}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
