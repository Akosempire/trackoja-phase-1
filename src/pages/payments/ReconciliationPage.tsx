import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { MerchantPaymentService, type MerchantAttempt } from '../../services/merchantPayment.service';
import { Button } from '../../components/ui/Button';
import { PageLoader } from '../../components/ui/PageLoader';
import { SectionHead } from '../../components/ui/SectionHead';
import { StateBlock } from '../../components/ui/StateBlock';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { useToast } from '../../components/ui/Toast';
import { formatDateTime, formatMoney } from '../../utils/format';

export default function ReconciliationPage() {
  const { profile } = useAuth();
  const { hasPermission, loading: permsLoading } = usePermissions();
  const toast = useToast();
  const storeId = profile?.currentStoreId;
  const canReview = hasPermission('sales:refund');
  const [attempts, setAttempts] = useState<MerchantAttempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!storeId) { setLoading(false); return; }
    setLoading(true); setError(null);
    try { setAttempts(await MerchantPaymentService.reconciliationAttempts(storeId)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Reconciliation unavailable'); }
    finally { setLoading(false); }
  }, [storeId]);
  useEffect(() => { if (canReview) void load(); else setLoading(false); }, [canReview, load]);
  const check = async (attemptId: string) => {
    setChecking(attemptId);
    try {
      const result = await MerchantPaymentService.check(attemptId);
      toast.info(result.attempt.status === 'successful' ? 'Payment verified and sale completed' :
        result.message ?? `Status: ${result.attempt.status.replaceAll('_', ' ')}`);
      await load();
    } catch (cause) {
      toast.error('Provider status unavailable', { description: cause instanceof Error ? cause.message : undefined });
    } finally { setChecking(null); }
  };
  if (permsLoading || loading) return <PageLoader />;
  if (!canReview) return <StateBlock variant="unavailable" title="Review access required"
    body="Ask a business owner or manager to review unresolved payments." />;
  return <div className="page">
    <div className="page-header"><div><h1 className="page-title">POS reconciliation</h1>
      <p className="page-subtitle">Provider results that need a status check or authorised review</p></div></div>
    <section className="card">
      <SectionHead title="Unresolved requests" sub="Never collect a second payment until a request's outcome is known."
        actions={<Button variant="outline" className="btn-sm" onClick={load}>Refresh</Button>} />
      {error ? <StateBlock variant="error" title="Could not load reconciliation" body={error}
        actions={<Button variant="outline" onClick={load}>Try again</Button>} /> :
        attempts.length === 0 ? <StateBlock title="No unresolved POS requests"
          body="Requests needing manual attention will appear here." /> :
          <div className="list">{attempts.map((attempt) => <div className="list-item" key={attempt.id}>
            <div><Link className="list-item-title" to={`/payments/transactions/${attempt.id}`}>{attempt.merchantReference}</Link>
              <p className="list-item-subtitle">{formatDateTime(attempt.initiatedAt)} · Terminal ••••{attempt.terminalLastFour}
                {attempt.environment === 'sandbox' ? ' · Sandbox' : ''}</p>
              <p className="list-item-subtitle">Provider: {attempt.providerStatus ?? 'Unavailable'} · Provider ref: {attempt.providerReference ?? 'Not returned'}</p>
              {attempt.failureCode && <p className="list-item-subtitle">Review reason: {attempt.failureCode.replaceAll('_', ' ').toLowerCase()}</p>}
            </div>
            <div className="list-item-meta"><StatusBadge status={attempt.status} />
              <span>Expected {formatMoney(attempt.expectedAmount)}</span>
              <span>Actual {attempt.actualAmount == null ? 'Not verified' : formatMoney(attempt.actualAmount)}</span>
              <Button variant="outline" className="btn-sm" loading={checking === attempt.id}
                onClick={() => check(attempt.id)}>Check status</Button></div>
          </div>)}</div>}
    </section>
    <div className="btn-row"><Link className="btn btn-ghost" to="/payments">Back to payments</Link></div>
  </div>;
}
