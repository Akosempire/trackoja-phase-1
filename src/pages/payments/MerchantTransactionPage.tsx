import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { MerchantPaymentService, describeAttempt, type MerchantAttempt } from '../../services/merchantPayment.service';
import { DeviceService } from '../../services/device.service';
import { StoreService } from '../../services/store.service';
import { SaleService } from '../../services/sale.service';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../../components/ui/Button';
import { DefList } from '../../components/ui/DefList';
import { PageLoader } from '../../components/ui/PageLoader';
import { StateBlock } from '../../components/ui/StateBlock';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { useToast } from '../../components/ui/Toast';
import { formatDateTime, formatMoney } from '../../utils/format';

export default function MerchantTransactionPage() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const { user } = useAuth();
  const toast = useToast();
  const [attempt, setAttempt] = useState<MerchantAttempt | null>(null);
  const [branchName, setBranchName] = useState<string | null>(null);
  const [terminalName, setTerminalName] = useState<string | null>(null);
  const [saleNumber, setSaleNumber] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!attemptId) return;
    setLoading(true); setError(null);
    try {
      const row = await MerchantPaymentService.getAttempt(attemptId);
      setAttempt(row);
      const [branch, terminal, sale] = await Promise.allSettled([
        StoreService.getStore(row.storeId), DeviceService.getDevice(row.terminalId), SaleService.getSale(row.saleId),
      ]);
      setBranchName(branch.status === 'fulfilled' ? branch.value.name : null);
      setTerminalName(terminal.status === 'fulfilled' ? terminal.value.name : null);
      setSaleNumber(sale.status === 'fulfilled' ? sale.value.saleNumber : null);
      setCustomerName(sale.status === 'fulfilled' ? sale.value.customerName ?? null : null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Transaction unavailable'); }
    finally { setLoading(false); }
  }, [attemptId]);
  useEffect(() => { void load(); }, [load]);

  const check = async () => {
    if (!attempt) return;
    setChecking(true);
    try {
      const result = await MerchantPaymentService.check(attempt.id);
      setAttempt(result.attempt);
      toast.info(result.attempt.status === 'successful' ? 'Payment verified' :
        result.message ?? `Payment status: ${result.attempt.status.replaceAll('_', ' ')}`);
    } catch (cause) {
      toast.error('Status check unavailable', { description: cause instanceof Error ? cause.message : undefined });
    } finally { setChecking(false); }
  };

  if (loading) return <PageLoader />;
  if (error || !attempt) return <StateBlock variant="error" title="Transaction unavailable"
    body={error ?? 'This transaction could not be found.'}
    actions={<Button variant="outline" onClick={load}>Try again</Button>} />;
  return <div className="page">
    <div className="page-header"><div>
      <h1 className="page-title">POS transaction</h1>
      <p className="page-subtitle">{attempt.merchantReference}</p>
    </div></div>
    <div className="card" style={{ maxWidth: 800 }}>
      <div className="section-head"><div className="section-head-text">
        <h2 className="section-title">{formatMoney(attempt.expectedAmount)}</h2>
        <p className="section-sub">Customer payment to this business</p>
      </div><StatusBadge status={attempt.status} /></div>
      {['sending', 'pending', 'unresolved', 'reconciliation_required'].includes(attempt.status) &&
        <div className="alert alert-warning" role="status">Do not collect another payment until this request has been verified.</div>}
      {attempt.failureCode && <p className="page-subtitle">{describeAttempt(attempt)}</p>}
      <DefList rows={[
        { term: 'TrackOja reference', value: attempt.merchantReference },
        { term: 'Provider reference', value: attempt.providerReference ?? 'Not returned yet', muted: !attempt.providerReference },
        { term: 'Provider status', value: attempt.providerStatus ?? 'Not available', muted: !attempt.providerStatus },
        { term: 'Expected amount', value: formatMoney(attempt.expectedAmount) },
        { term: 'Verified amount', value: attempt.actualAmount == null ? 'Not verified' : formatMoney(attempt.actualAmount), muted: attempt.actualAmount == null },
        { term: 'Payment method', value: attempt.actualPaymentMethod === 'card' ? 'Card' :
          attempt.actualPaymentMethod === 'transfer' ? 'POS transfer' : 'Not verified yet', muted: !attempt.actualPaymentMethod },
        { term: 'Provider', value: 'Moniepoint POS' },
        { term: 'Sale', value: saleNumber ? `#${saleNumber}` : attempt.saleId },
        { term: 'Customer', value: customerName ?? 'Walk-in customer', muted: !customerName },
        { term: 'Branch', value: branchName ?? 'Branch unavailable', muted: !branchName },
        { term: 'Terminal', value: `${terminalName ?? 'Terminal'} · ••••${attempt.terminalLastFour}` },
        { term: 'Initiated by', value: attempt.initiatedBy === user?.id ? 'You' : 'Another authorised staff member' },
        { term: 'Created', value: formatDateTime(attempt.initiatedAt) },
        { term: 'Completed', value: attempt.completedAt ? formatDateTime(attempt.completedAt) : 'Not completed', muted: !attempt.completedAt },
        { term: 'Environment', value: attempt.environment === 'sandbox' ? 'Sandbox test' : 'Live' },
      ]} />
      <div className="btn-row">
        {['sending', 'pending', 'unresolved', 'reconciliation_required'].includes(attempt.status) &&
          <Button variant="outline" loading={checking} onClick={check}>Check status</Button>}
        <Link className="btn btn-ghost" to={`/sales/${attempt.saleId}`}>
          {attempt.status === 'successful' ? 'View receipt' : 'View pending sale'}
        </Link>
        <Link className="btn btn-ghost" to="/payments">Back to payments</Link>
      </div>
    </div>
  </div>;
}
