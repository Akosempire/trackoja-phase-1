import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { SaleService } from '../../services/sale.service';
import { Button } from '../../components/ui/Button';
import { PageLoader } from '../../components/ui/PageLoader';
import { SectionHead } from '../../components/ui/SectionHead';
import { SectionState, StateBlock } from '../../components/ui/StateBlock';
import { useToast } from '../../components/ui/Toast';
import { formatDateTime, formatMoney } from '../../utils/format';
import type { PendingSalePayment, RecentRefund } from '../../types';

export default function PaymentsPage() {
  const { profile } = useAuth();
  const { loading: permsLoading } = usePermissions();
  const storeId = profile?.currentStoreId;
  const toast = useToast();

  const [pending, setPending] = useState<PendingSalePayment[]>([]);
  const [refunds, setRefunds] = useState<RecentRefund[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!storeId) {
      setLoading(false);
      setError('Choose a business workspace to view its payments.');
      return;
    }
    setLoading(true);
    setError(null);
    setPending([]);
    setRefunds([]);
    try {
      const [pendingData, refundsData] = await Promise.all([
        SaleService.getPendingPayments(storeId),
        SaleService.getRecentRefunds(storeId),
      ]);
      setPending(pendingData);
      setRefunds(refundsData);
    } catch (err) {
      setError((err as Error)?.message ?? 'Failed to load payments');
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleVerify = async (paymentId: string, status: 'verified' | 'rejected') => {
    setActingId(paymentId);
    setError(null);
    try {
      await SaleService.verifySalePayment(paymentId, status);
      toast.success(status === 'verified' ? 'Payment verified' : 'Payment rejected');
      await load();
    } catch (err: unknown) {
      toast.error('Payment update failed', { description: (err as Error)?.message });
    } finally {
      setActingId(null);
    }
  };

  if (permsLoading) return <PageLoader />;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Payments</h1>
          <p className="page-subtitle">Pending verifications and recent refunds</p>
        </div>
      </div>

      <SectionState loading={loading} error={error} onRetry={load}>
        <section className="card" aria-labelledby="pending-payments-title">
          <SectionHead id="pending-payments-title" title="Pending verification" sub="Payments that require an authorised review" />
          {pending.length === 0 ? (
            <StateBlock title="All payments are reviewed" body="New payments that need verification will appear here." />
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
                    {payment.reference && ` · Ref: ${payment.reference}`} · {formatDateTime(payment.createdAt)}
                  </p>
                </div>
                <div className="list-item-meta">
                  <span className="list-item-subtitle">{formatMoney(payment.amount)}</span>
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
        </section>

        <section className="card" aria-labelledby="recent-refunds-title">
          <SectionHead id="recent-refunds-title" title="Recent refunds" sub="Completed refunds with their source transaction" />
        {refunds.length === 0 ? (
          <StateBlock title="No refunds processed" body="Refunded transactions will be listed here for review." />
        ) : (
          <div className="list">
            {refunds.map((refund) => (
              <Link key={refund.id} to={`/sales/${refund.saleId}`} className="list-item">
                <div>
                  <p className="list-item-title">Sale #{refund.saleNumber}</p>
                  <p className="list-item-subtitle">
                    {refund.reason} · {formatDateTime(refund.createdAt)}
                    {refund.createdByEmail && ` · ${refund.createdByEmail}`}
                  </p>
                </div>
                <div className="list-item-meta">
                  <span className="badge badge-default" style={{ textTransform: 'capitalize' }}>
                    {refund.method}
                  </span>
                  <span className="list-item-subtitle">{formatMoney(refund.amount)}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
        </section>
      </SectionState>
    </div>
  );
}
