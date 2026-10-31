import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { recordSaleAction } from '../../utils/business-language';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { SaleService } from '../../services/sale.service';
import { Button } from '../../components/ui/Button';
import { PageLoader } from '../../components/ui/PageLoader';
import { SectionState, StateBlock } from '../../components/ui/StateBlock';
import { StatusBadge, statusLabel } from '../../components/ui/StatusBadge';
import { useToast } from '../../components/ui/Toast';
import { Card, CardHead, Page, PageHeader, Pill, btn, cn, inputClass } from '../../components/kit';
import { DownloadIcon, SearchIcon } from '../../components/icons';
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

  const label = 'mb-1.5 block text-[13px] font-medium text-ink-2';
  const reviewable = ['sending', 'pending', 'unresolved', 'reconciliation_required'];
  const needsReconciliation = attempts.filter((attempt) => ['unresolved', 'reconciliation_required'].includes(attempt.status)).length;
  const methodLabel = (method: string) => method === 'any' ? 'Card or transfer' : method.replaceAll('_', ' ').replace(/^\w/, (c) => c.toUpperCase());
  const activeFilters = [attemptMethod !== 'all', attemptTerminal !== 'all', attemptCashier !== 'all', attemptMinAmount, attemptMaxAmount, attemptDateFrom, attemptDateTo].filter(Boolean).length;
  const cols = 'md:grid-cols-[minmax(0,1.6fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.8fr)_120px]';

  return (
    <Page>
      <PageHeader
        title="Payments"
        subtitle="Customer payment attempts, manual verifications, and refunds"
        actions={<>
          <Link className={btn('outline')} to="/settings/payments/moniepoint">POS settings</Link>
          {canReview && <Link className={btn('outline')} to="/payments/reconciliation">Reconciliation</Link>}
        </>}
      />

      <SectionState loading={loading} error={error} onRetry={load}>
        <div className="flex flex-col gap-4 lg:gap-6">
          {canReview && needsReconciliation > 0 && (
            <section className="flex flex-col gap-3 rounded-xl bg-warn-soft px-4 py-3.5 text-warn-ink sm:flex-row sm:items-center sm:justify-between sm:px-5" aria-label="POS reconciliation">
              <div className="min-w-0">
                <h2 className="m-0 text-sm font-semibold">Reconciliation needed</h2>
                <p className="m-0 mt-0.5 text-[13px]">
                  {needsReconciliation} request{needsReconciliation === 1 ? ' needs' : 's need'} a provider status check or an authorised review. Do not take a second payment while the outcome is unknown.
                </p>
                <p className="m-0 mt-1 text-xs">Use Check status below. If Moniepoint confirms a charge but the sale remains pending, contact support with the TrackOja and provider references.</p>
              </div>
              <Link className={cn(btn('outline', 'sm'), 'shrink-0 self-start sm:self-center')} to="/payments/reconciliation">Review</Link>
            </section>
          )}

          <Card padded={false} aria-labelledby="pos-transactions-title">
            <div className="px-4 pt-4 sm:px-5 sm:pt-5">
              <CardHead title={<span id="pos-transactions-title">Moniepoint POS transactions</span>}
                hint="Most recent 100 attempts in this branch. Only provider-verified payments complete a sale."
                action={canReview && filteredAttempts.length > 0
                  ? <Button variant="outline" className="btn-sm shrink-0" onClick={exportVisible} aria-label="Export visible transactions"><DownloadIcon width={15} height={15} />Export</Button>
                  : undefined} />
              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="min-w-0 flex-1">
                  <label className="sr-only" htmlFor="payment-search">Search reference, terminal, or sale</label>
                  <div className="relative">
                    <SearchIcon width={17} height={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
                    <input id="payment-search" type="search" className={cn(inputClass, 'pl-9')} aria-label="Search payment transactions"
                      placeholder="Search reference, terminal, or sale" value={attemptSearch} onChange={(event) => setAttemptSearch(event.target.value)} />
                  </div>
                </div>
                <div className="sm:w-56">
                  <label className="sr-only" htmlFor="payment-status">Status</label>
                  <select id="payment-status" className={inputClass} value={attemptStatus}
                    onChange={(event) => setAttemptStatus(event.target.value)}>
                    <option value="all">All statuses</option>
                    {['pending', 'unresolved', 'reconciliation_required', 'successful', 'failed', 'cancelled'].map((status) =>
                      <option key={status} value={status}>{statusLabel(status)}</option>)}
                  </select>
                </div>
              </div>
              <div className="mt-3">
                <details className="group">
                  <summary className="inline-flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-md text-[13px] font-semibold text-brand-ink [&::-webkit-details-marker]:hidden">
                    <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" className="transition-transform group-open:rotate-90"><path d="m6 4 4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    {activeFilters ? `More payment filters (${activeFilters} on)` : 'More payment filters'}
                  </summary>
                  <div className="mt-2 grid gap-x-4 gap-y-3 rounded-lg bg-subtle p-3 sm:grid-cols-2 sm:p-4 lg:grid-cols-3">
                    <div><label className={label} htmlFor="payment-date-from">From</label>
                      <input id="payment-date-from" className={inputClass} type="date" value={attemptDateFrom}
                        onChange={(event) => setAttemptDateFrom(event.target.value)} /></div>
                    <div><label className={label} htmlFor="payment-date-to">To</label>
                      <input id="payment-date-to" className={inputClass} type="date" value={attemptDateTo}
                        onChange={(event) => setAttemptDateTo(event.target.value)} /></div>
                    <div><label className={label} htmlFor="payment-method">Method</label>
                      <select id="payment-method" className={inputClass} value={attemptMethod}
                        onChange={(event) => setAttemptMethod(event.target.value)}>
                        <option value="all">All methods</option><option value="any">Card or transfer</option>
                        <option value="card">Card</option><option value="transfer">Transfer</option>
                      </select></div>
                    <div><label className={label} htmlFor="payment-terminal">Terminal</label>
                      <select id="payment-terminal" className={inputClass} value={attemptTerminal}
                        onChange={(event) => setAttemptTerminal(event.target.value)}>
                        <option value="all">All terminals</option>
                        {Array.from(new Map(attempts.map((attempt) => [attempt.terminalId, attempt.terminalLastFour])).entries())
                          .map(([id, lastFour]) => <option key={id} value={id}>••••{lastFour}</option>)}
                      </select></div>
                    {canReview && <div><label className={label} htmlFor="payment-cashier">Cashier</label>
                      <select id="payment-cashier" className={inputClass} value={attemptCashier}
                        onChange={(event) => setAttemptCashier(event.target.value)}>
                        <option value="all">All cashiers</option>
                        {Array.from(new Map(attempts.map((attempt) => [attempt.initiatedBy,
                          attempt.initiatorName ?? `Staff ${attempt.initiatedBy.slice(0, 8)}`])).entries())
                          .map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                      </select></div>}
                    <div><label className={label} htmlFor="payment-min-amount">Minimum amount (₦)</label>
                      <input id="payment-min-amount" className={inputClass} type="number" min="0" value={attemptMinAmount}
                        onChange={(event) => setAttemptMinAmount(event.target.value)} /></div>
                    <div><label className={label} htmlFor="payment-max-amount">Maximum amount (₦)</label>
                      <input id="payment-max-amount" className={inputClass} type="number" min="0" value={attemptMaxAmount}
                        onChange={(event) => setAttemptMaxAmount(event.target.value)} /></div>
                  </div>
                </details>
              </div>
            </div>

            <div className="mt-4">
              {attemptError ? <div className="px-4 pb-4 sm:px-5"><StateBlock variant="error" title="POS transactions unavailable" body={attemptError}
                actions={<Button variant="outline" className="btn-sm" onClick={load}>Try again</Button>} /></div> :
              attempts.length === 0 ? <div className="px-4 pb-4 sm:px-5"><StateBlock title="No POS attempts yet"
                body="Moniepoint requests sent from checkout will appear here."
                actions={hasPermission('sales:create') ? <Link className={btn('primary', 'sm')} to="/sales/checkout">{recordSaleAction(category)}</Link> : undefined} /></div> :
              filteredAttempts.length === 0 ? <div className="px-4 pb-4 sm:px-5"><StateBlock title="No matching transactions" body="Try a different reference or status." /></div> :
              <>
                <div className={cn('hidden gap-4 border-y border-line bg-subtle px-5 py-2.5 text-xs font-semibold uppercase tracking-[.06em] text-ink-3 md:grid', cols)} aria-hidden="true">
                  <span>Reference</span><span>Sale</span><span>Status</span><span className="text-right">Amount</span><span />
                </div>
                <ul className="m-0 list-none divide-y divide-line border-t border-line p-0 md:border-t-0" aria-label="Merchant payment attempts">
                  {filteredAttempts.map((attempt) => (
                    <li key={attempt.id} className={cn('grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-4 py-3 sm:px-5', cols)}>
                      <div className="min-w-0">
                        <Link className="block truncate font-mono text-[13px] font-medium text-ink no-underline hover:text-brand-ink hover:underline" to={`/payments/transactions/${attempt.id}`}>{attempt.merchantReference}</Link>
                        <p className="m-0 mt-0.5 truncate text-xs text-ink-3">
                          {attempt.providerReference ? <>Provider: <span className="font-mono">{attempt.providerReference}</span></> : 'No provider reference yet'}
                          {attempt.environment === 'sandbox' && <> · <span className="font-semibold text-warn-ink">Sandbox</span></>}
                        </p>
                      </div>
                      <div className="col-start-1 row-start-2 min-w-0 md:col-auto md:row-auto">
                        <p className="m-0 truncate text-[13px] text-ink-2">
                          {attempt.saleNumber ? <>Sale <span className="tabular-nums">#{attempt.saleNumber}</span></> : '—'}
                          {attempt.customerName && ` · ${attempt.customerName}`}
                        </p>
                        <p className="m-0 mt-0.5 truncate text-xs text-ink-3">
                          {methodLabel(attempt.actualPaymentMethod ?? attempt.paymentMethod)} · {formatDateTime(attempt.initiatedAt)}
                        </p>
                      </div>
                      <div className="col-start-2 row-start-2 flex justify-end md:col-auto md:row-auto md:justify-start"><StatusBadge status={attempt.status} dot /></div>
                      <div className="col-start-2 row-start-1 text-right text-sm font-semibold tabular-nums text-ink md:col-auto md:row-auto">{formatMoney(attempt.expectedAmount)}</div>
                      <div className={cn('col-span-2 md:col-span-1 md:flex md:justify-end', !reviewable.includes(attempt.status) && 'hidden')}>
                        {reviewable.includes(attempt.status)
                          ? <Button variant="outline" className="btn-sm mt-1 w-full md:mt-0 md:w-auto" loading={actingId === attempt.id} onClick={() => checkAttempt(attempt.id)}>Check status</Button>
                          : <Link className={btn('ghost', 'sm')} to={`/payments/transactions/${attempt.id}`}>View</Link>}
                      </div>
                    </li>
                  ))}
                </ul>
              </>}
            </div>
          </Card>

          {canReview && (
            <div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
              <Card padded={false} className="overflow-hidden" aria-labelledby="pending-payments-title">
                <div className="px-4 pb-3 pt-4 sm:px-5 sm:pt-5">
                  <h2 id="pending-payments-title" className="m-0 text-[15px] font-semibold text-ink">Pending verification</h2>
                  <p className="m-0 mt-0.5 text-[13px] text-ink-3">Payments that require an authorised review</p>
                </div>
                {pending.length === 0 ? (
                  <div className="px-4 pb-4 sm:px-5"><StateBlock compact title="All payments are reviewed" body="New payments that need verification will appear here." /></div>
                ) : (
                  <ul className="m-0 list-none divide-y divide-line border-t border-line p-0">
                    {pending.map((payment) => (
                      <li key={payment.id} className="px-4 py-3 sm:px-5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <Link to={`/sales/${payment.saleId}`} className="text-sm font-medium text-ink no-underline hover:underline">
                              Sale #{payment.saleNumber}
                            </Link>
                            <p className="m-0 mt-0.5 truncate text-xs text-ink-3">
                              {methodLabel(payment.method)} · {formatDateTime(payment.createdAt)}
                            </p>
                            {payment.reference && <p className="m-0 mt-0.5 truncate text-xs text-ink-2">Ref: <span className="font-mono">{payment.reference}</span></p>}
                          </div>
                          <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">{formatMoney(payment.amount)}</span>
                        </div>
                        <div className="mt-2.5 flex gap-2">
                          <Button
                            variant="outline"
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
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card padded={false} className="overflow-hidden" aria-labelledby="recent-refunds-title">
                <div className="px-4 pb-3 pt-4 sm:px-5 sm:pt-5">
                  <h2 id="recent-refunds-title" className="m-0 text-[15px] font-semibold text-ink">Recent refunds</h2>
                  <p className="m-0 mt-0.5 text-[13px] text-ink-3">Completed refunds with their source transaction</p>
                </div>
                {refunds.length === 0 ? (
                  <div className="px-4 pb-4 sm:px-5"><StateBlock compact title="No refunds processed" body="Refunded transactions will be listed here for review." /></div>
                ) : (
                  <ul className="m-0 list-none divide-y divide-line border-t border-line p-0">
                    {refunds.map((refund) => (
                      <li key={refund.id}>
                        <Link to={`/sales/${refund.saleId}`} className="flex items-start justify-between gap-3 px-4 py-3 text-inherit no-underline transition-colors hover:bg-subtle sm:px-5">
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-ink">Sale #{refund.saleNumber}</span>
                            <span className="block truncate text-xs text-ink-2">{refund.reason}</span>
                            <span className="block truncate text-xs text-ink-3">
                              {formatDateTime(refund.createdAt)}
                              {refund.createdByEmail && ` · ${refund.createdByEmail}`}
                            </span>
                          </span>
                          <span className="flex shrink-0 flex-col items-end gap-1">
                            <span className="text-sm font-semibold tabular-nums text-ink">{formatMoney(refund.amount)}</span>
                            <Pill>{methodLabel(refund.method)}</Pill>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          )}
        </div>
      </SectionState>
    </Page>
  );
}
