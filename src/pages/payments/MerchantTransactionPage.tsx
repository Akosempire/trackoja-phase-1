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
import { Card, CardHead, Page, PageHeader, btn } from '../../components/kit';

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
  if (error || !attempt) return (
    <Page width="form">
      <Card>
        <StateBlock variant="error" title="Transaction unavailable"
          body={error ?? 'This transaction could not be found.'}
          actions={<>
            <Button variant="outline" className="btn-sm" onClick={load}>Try again</Button>
            <Link className={btn('ghost', 'sm')} to="/payments">Back to payments</Link>
          </>} />
      </Card>
    </Page>
  );

  const isOpen = ['sending', 'pending', 'unresolved', 'reconciliation_required'].includes(attempt.status);
  const mono = (value: string) => <span className="break-all font-mono text-[13px]">{value}</span>;

  return <Page width="form">
    <PageHeader eyebrow="Payments" title="POS transaction" subtitle={<span className="break-all font-mono text-[13px]">{attempt.merchantReference}</span>} />

    <div className="flex flex-col gap-4 lg:gap-6">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="m-0 text-[13px] font-medium text-ink-2">Customer payment to this business</p>
            <h2 className="m-0 mt-1 text-[28px] font-semibold leading-9 tracking-tight tabular-nums text-ink">{formatMoney(attempt.expectedAmount)}</h2>
            <p className="m-0 mt-1 text-[13px] text-ink-3">
              {formatDateTime(attempt.initiatedAt)}{attempt.environment === 'sandbox' ? ' · Sandbox test' : ''}
            </p>
          </div>
          <StatusBadge status={attempt.status} dot />
        </div>
        {isOpen &&
          <div className="mt-4 rounded-lg bg-warn-soft px-4 py-3 text-[13px] font-medium text-warn-ink" role="status">Do not collect another payment until this request has been verified.</div>}
        {attempt.failureCode && <p className="m-0 mt-4 rounded-lg bg-tray px-4 py-3 text-[13px] text-ink-2">{describeAttempt(attempt)}</p>}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {isOpen &&
            <Button variant="primary" loading={checking} onClick={check}>Check status</Button>}
          <Link className={btn(isOpen ? 'outline' : 'primary')} to={`/sales/${attempt.saleId}`}>
            {attempt.status === 'successful' ? 'View receipt' : 'View pending sale'}
          </Link>
          <Link className={btn('ghost')} to="/payments">Back to payments</Link>
        </div>
      </Card>

      <Card aria-labelledby="transaction-references-title">
        <CardHead title={<span id="transaction-references-title">References</span>} hint="Quote these when you contact Moniepoint or support." />
        <DefList rows={[
          { term: 'TrackOja reference', value: mono(attempt.merchantReference) },
          { term: 'Provider reference', value: attempt.providerReference ? mono(attempt.providerReference) : 'Not returned yet', muted: !attempt.providerReference },
          { term: 'Provider status', value: attempt.providerStatus ?? 'Not available', muted: !attempt.providerStatus },
          { term: 'Provider', value: 'Moniepoint POS' },
          { term: 'Environment', value: attempt.environment === 'sandbox' ? 'Sandbox test' : 'Live' },
        ]} />
      </Card>

      <Card aria-labelledby="transaction-details-title">
        <CardHead title={<span id="transaction-details-title">Payment details</span>} />
        <DefList rows={[
          { term: 'Expected amount', value: formatMoney(attempt.expectedAmount) },
          { term: 'Verified amount', value: attempt.actualAmount == null ? 'Not verified' : formatMoney(attempt.actualAmount), muted: attempt.actualAmount == null },
          { term: 'Payment method', value: attempt.actualPaymentMethod === 'card' ? 'Card' :
            attempt.actualPaymentMethod === 'transfer' ? 'POS transfer' : 'Not verified yet', muted: !attempt.actualPaymentMethod },
          { term: 'Sale', value: saleNumber ? `#${saleNumber}` : mono(attempt.saleId) },
          { term: 'Customer', value: customerName ?? 'Walk-in customer', muted: !customerName },
          { term: 'Branch', value: branchName ?? 'Branch unavailable', muted: !branchName },
          { term: 'Terminal', value: `${terminalName ?? 'Terminal'} · ••••${attempt.terminalLastFour}` },
          { term: 'Initiated by', value: attempt.initiatedBy === user?.id ? 'You' : 'Another authorised staff member' },
          { term: 'Created', value: formatDateTime(attempt.initiatedAt) },
          { term: 'Completed', value: attempt.completedAt ? formatDateTime(attempt.completedAt) : 'Not completed', muted: !attempt.completedAt },
        ]} />
      </Card>
    </div>
  </Page>;
}
