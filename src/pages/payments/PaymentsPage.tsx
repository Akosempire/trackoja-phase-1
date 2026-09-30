import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { recordSaleAction } from '../../utils/business-language';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { SaleService } from '../../services/sale.service';
import { Button } from '../../components/ui/Button';
import { DataTable } from '../../components/ui/DataTable';
import { Disclosure } from '../../components/ui/Disclosure';
import { SearchInput } from '../../components/ui/SearchInput';
import { PageLoader } from '../../components/ui/PageLoader';
import { SectionHead } from '../../components/ui/SectionHead';
import { SectionState, StateBlock } from '../../components/ui/StateBlock';
import { useToast } from '../../components/ui/Toast';
import { formatDateTime, formatMoney } from '../../utils/format';
import { MerchantPaymentService, type MerchantAttempt } from '../../services/merchantPayment.service';
import type { PendingSalePayment, RecentRefund } from '../../types';

export default function PaymentsPage() {
  const { profile } = useAuth();
  const { category } = useBusinessContext();
  const { loading: permsLoading, hasPermission } = usePermissions();
  const storeId = profile?.currentStoreId;
  const toast = useToast();
  const canReview = hasPermission('sales:refund');

  const [pending, setPending] = useState<PendingSalePayment[]>([]);
  const [refunds, setRefunds] = useState<RecentRefund[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [attempts, setAttempts] = useState<MerchantAttempt[]>([]);
  const [attemptSearch, setAttemptSearch] = useState('');
  const [attemptStatus, setAttemptStatus] = useState('all');
  const [attemptMethod, setAttemptMethod] = useState('all');
  const [attemptDateFrom, setAttemptDateFrom] = useState('');
  const [attemptDateTo, setAttemptDateTo] = useState('');
  const [attemptTerminal, setAttemptTerminal] = useState('all');
  const [attemptCashier, setAttemptCashier] = useState('all');
  const [attemptMinAmount, setAttemptMinAmount] = useState('');
  const [attemptMaxAmount, setAttemptMaxAmount] = useState('');
  const [attemptError, setAttemptError] = useState<string | null>(null);

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
    setAttempts([]);
    setAttemptError(null);
    try {
      const [pendingData, refundsData, attemptData] = await Promise.all([
        canReview ? SaleService.getPendingPayments(storeId) : Promise.resolve([]),
        canReview ? SaleService.getRecentRefunds(storeId) : Promise.resolve([]),
        MerchantPaymentService.attempts(storeId).catch((cause) => {
          setAttemptError(cause instanceof Error ? cause.message : 'POS transactions could not be loaded');
          return [];
        }),
      ]);
      setPending(pendingData);
      setRefunds(refundsData);
      setAttempts(attemptData);
    } catch (err) {
      setError((err as Error)?.message ?? 'Failed to load payments');
    } finally {
      setLoading(false);
    }
  }, [storeId, canReview]);

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

  const checkAttempt = async (attemptId: string) => {
    setActingId(attemptId);
    try {
      const result = await MerchantPaymentService.check(attemptId);
      toast.info(result.attempt.status === 'successful' ? 'Payment verified' :
        result.message ?? `Payment status: ${result.attempt.status.replaceAll('_', ' ')}`);
      await load();
    } catch (cause) {
      toast.error('Status check unavailable', { description: cause instanceof Error ? cause.message : undefined });
    } finally { setActingId(null); }
  };

  const filteredAttempts = attempts.filter((attempt) => {
    if (attemptStatus !== 'all' && attempt.status !== attemptStatus) return false;
    if (attemptMethod !== 'all' && (attempt.actualPaymentMethod ?? attempt.paymentMethod) !== attemptMethod) return false;
    if (attemptTerminal !== 'all' && attempt.terminalId !== attemptTerminal) return false;
    if (attemptCashier !== 'all' && attempt.initiatedBy !== attemptCashier) return false;
    if (attemptMinAmount && attempt.expectedAmount < Number(attemptMinAmount)) return false;
    if (attemptMaxAmount && attempt.expectedAmount > Number(attemptMaxAmount)) return false;
    if (attemptDateFrom && new Date(attempt.initiatedAt) < new Date(`${attemptDateFrom}T00:00:00`)) return false;
    if (attemptDateTo && new Date(attempt.initiatedAt) >= new Date(new Date(`${attemptDateTo}T00:00:00`).getTime() + 86400000)) return false;
    const query = attemptSearch.trim().toLowerCase();
    return !query || [attempt.merchantReference, attempt.providerReference, attempt.terminalLastFour,
      attempt.saleId, attempt.saleNumber, attempt.customerName, attempt.initiatorName,
      attempt.actualPaymentMethod ?? attempt.paymentMethod]
      .some((value) => String(value ?? '').toLowerCase().includes(query));
  });

  const exportVisible = () => {
    const fields = ['TrackOja reference', 'Provider reference', 'Sale', 'Customer', 'Cashier', 'Terminal',
      'Amount NGN', 'Method', 'Status', 'Provider status', 'Created'];
    const quote = (value: unknown) => {
      const raw = String(value ?? '');
      const safe = /^[=+\-@\t\r\n]/.test(raw) ? `'${raw}` : raw;
      return `"${safe.replaceAll('"', '""')}"`;
    };
    const rows = filteredAttempts.map((attempt) => [attempt.merchantReference, attempt.providerReference,
      attempt.saleNumber, attempt.customerName, attempt.initiatorName, attempt.terminalLastFour,
      attempt.expectedAmount, attempt.actualPaymentMethod ?? attempt.paymentMethod,
      attempt.status, attempt.providerStatus, attempt.initiatedAt]);
    const csv = [fields, ...rows].map((row) => row.map(quote).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'trackoja-moniepoint-visible-transactions.csv'; link.click();
    URL.revokeObjectURL(url);
  };

  if (permsLoading) return <PageLoader />;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Payments</h1>
          <p className="page-subtitle">Customer payment attempts, manual verifications, and refunds</p>
        </div>
        {canReview && <Link className="btn btn-outline" to="/payments/reconciliation">Reconciliation</Link>}
      </div>

      <SectionState loading={loading} error={error} onRetry={load}>
        <section className="card" aria-labelledby="pos-transactions-title">
          <SectionHead id="pos-transactions-title" title="Moniepoint POS transactions"
            sub="Most recent 100 attempts in this branch. Only provider-verified payments complete a sale."
            actions={<Link className="btn btn-outline btn-sm" to="/settings/payments/moniepoint">POS settings</Link>} />
          <div className="payment-filter-bar">
            <div className="form-group"><label className="form-label" htmlFor="payment-search">Search reference, terminal, or sale</label>
              <SearchInput id="payment-search" aria-label="Search payment transactions" value={attemptSearch}
                onChange={(event) => setAttemptSearch(event.target.value)} /></div>
            <div className="form-group"><label className="form-label" htmlFor="payment-status">Status</label>
              <select id="payment-status" className="select-input" value={attemptStatus}
                onChange={(event) => setAttemptStatus(event.target.value)}>
                <option value="all">All statuses</option>
                {['pending', 'unresolved', 'reconciliation_required', 'successful', 'failed', 'cancelled'].map((status) =>
                  <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}
              </select></div>
          </div>
          <Disclosure summary="More payment filters">
          <div className="payment-advanced-filters">
            <div className="form-group"><label className="form-label" htmlFor="payment-date-from">From</label>
              <input id="payment-date-from" className="form-input" type="date" value={attemptDateFrom}
                onChange={(event) => setAttemptDateFrom(event.target.value)} /></div>
            <div className="form-group"><label className="form-label" htmlFor="payment-date-to">To</label>
              <input id="payment-date-to" className="form-input" type="date" value={attemptDateTo}
                onChange={(event) => setAttemptDateTo(event.target.value)} /></div>
            <div className="form-group"><label className="form-label" htmlFor="payment-method">Method</label>
              <select id="payment-method" className="select-input" value={attemptMethod}
                onChange={(event) => setAttemptMethod(event.target.value)}>
                <option value="all">All methods</option><option value="any">Card or transfer</option>
                <option value="card">Card</option><option value="transfer">Transfer</option>
              </select></div>
            <div className="form-group"><label className="form-label" htmlFor="payment-terminal">Terminal</label>
              <select id="payment-terminal" className="select-input" value={attemptTerminal}
                onChange={(event) => setAttemptTerminal(event.target.value)}>
                <option value="all">All terminals</option>
                {Array.from(new Map(attempts.map((attempt) => [attempt.terminalId, attempt.terminalLastFour])).entries())
                  .map(([id, lastFour]) => <option key={id} value={id}>••••{lastFour}</option>)}
              </select></div>
            {canReview && <div className="form-group"><label className="form-label" htmlFor="payment-cashier">Cashier</label>
              <select id="payment-cashier" className="select-input" value={attemptCashier}
                onChange={(event) => setAttemptCashier(event.target.value)}>
                <option value="all">All cashiers</option>
                {Array.from(new Map(attempts.map((attempt) => [attempt.initiatedBy,
                  attempt.initiatorName ?? `Staff ${attempt.initiatedBy.slice(0, 8)}`])).entries())
                  .map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select></div>}
            <div className="form-group"><label className="form-label" htmlFor="payment-min-amount">Minimum amount (₦)</label>
              <input id="payment-min-amount" className="form-input" type="number" min="0" value={attemptMinAmount}
                onChange={(event) => setAttemptMinAmount(event.target.value)} /></div>
            <div className="form-group"><label className="form-label" htmlFor="payment-max-amount">Maximum amount (₦)</label>
              <input id="payment-max-amount" className="form-input" type="number" min="0" value={attemptMaxAmount}
                onChange={(event) => setAttemptMaxAmount(event.target.value)} /></div>
          </div>
          </Disclosure>
          {canReview && filteredAttempts.length > 0 && <div className="btn-row payment-export-actions">
            <Button variant="outline" className="btn-sm" onClick={exportVisible}>Export visible transactions</Button>
          </div>}
          {attemptError ? <StateBlock variant="error" title="POS transactions unavailable" body={attemptError}
            actions={<Button variant="outline" onClick={load}>Try again</Button>} /> :
          attempts.length === 0 ? <StateBlock title="No POS attempts yet"
            body="Moniepoint requests sent from checkout will appear here."
            actions={hasPermission('sales:create') ? <Link className="btn btn-primary" to="/sales/checkout">{recordSaleAction(category)}</Link> : undefined} /> :
            filteredAttempts.length === 0 ? <StateBlock title="No matching transactions" body="Try a different reference or status." /> :
            <DataTable
              caption="Merchant payment attempts"
              rows={filteredAttempts}
              rowKey={(attempt) => attempt.id}
              stacked
              columns={[
                { key: 'reference', header: 'Reference', label: '', render: (attempt) => <div>
                  <Link className="data-table-primary" to={`/payments/transactions/${attempt.id}`}>{attempt.merchantReference}</Link>
                  {attempt.providerReference && <span className="data-table-secondary">Provider: {attempt.providerReference}</span>}
                  {attempt.environment === 'sandbox' && <span className="badge badge-warning">Sandbox</span>}
                </div> },
                { key: 'sale', header: 'Sale', render: (attempt) => <div>
                  <span>{attempt.saleNumber ? `#${attempt.saleNumber}` : '—'}</span>
                  {attempt.customerName && <span className="data-table-secondary">{attempt.customerName}</span>}
                </div> },
                { key: 'amount', header: 'Amount', numeric: true, render: (attempt) => formatMoney(attempt.expectedAmount) },
                { key: 'method', header: 'Method', render: (attempt) => (attempt.actualPaymentMethod ?? attempt.paymentMethod).replaceAll('_', ' ') },
                { key: 'status', header: 'Status', render: (attempt) => <span className={`badge ${attempt.status === 'successful' ? 'badge-success' : ['unresolved', 'reconciliation_required', 'pending'].includes(attempt.status) ? 'badge-warning' : 'badge-default'}`}>{attempt.status.replaceAll('_', ' ')}</span> },
                { key: 'date', header: 'Date', render: (attempt) => formatDateTime(attempt.initiatedAt) },
                { key: 'action', header: 'Action', render: (attempt) => ['sending', 'pending', 'unresolved', 'reconciliation_required'].includes(attempt.status)
                  ? <Button variant="outline" className="btn-sm" loading={actingId === attempt.id} onClick={() => checkAttempt(attempt.id)}>Check status</Button>
                  : <Link className="btn btn-ghost btn-sm" to={`/payments/transactions/${attempt.id}`}>View</Link> },
              ]}
            />}
        </section>

        {canReview && attempts.some((attempt) =>
          ['unresolved', 'reconciliation_required'].includes(attempt.status)) &&
          <section className="card" aria-label="POS reconciliation" style={{ marginTop: 'var(--space-16)' }}>
            <SectionHead title="Reconciliation needed" sub="These requests need a provider status check or an authorised review. Do not take a second payment while the outcome is unknown." />
            <p className="page-subtitle">Use Check status above. If Moniepoint confirms a charge but the sale remains pending, contact support with the TrackOja and provider references.</p>
          </section>}
        {canReview && <section className="card" aria-labelledby="pending-payments-title">
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
        </section>}

        {canReview && <section className="card" aria-labelledby="recent-refunds-title">
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
        </section>}
      </SectionState>
    </div>
  );
}
