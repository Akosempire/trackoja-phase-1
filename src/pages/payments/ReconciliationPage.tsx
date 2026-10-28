import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { MerchantPaymentService, type MerchantAttempt } from '../../services/merchantPayment.service';
import { Button } from '../../components/ui/Button';
import { PageLoader } from '../../components/ui/PageLoader';
import { StateBlock } from '../../components/ui/StateBlock';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { useToast } from '../../components/ui/Toast';
import { formatDateTime, formatMoney } from '../../utils/format';
import { Card, CardHead, Page, PageHeader, btn, cn } from '../../components/kit';

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
  if (!canReview) return <Page width="form"><Card><StateBlock variant="unavailable" title="Review access required"
    body="Ask a business owner or manager to review unresolved payments." /></Card></Page>;
  return <Page>
    <PageHeader eyebrow="Payments" title="POS reconciliation" subtitle="Provider results that need a status check or authorised review"
      actions={<Link className={btn('outline')} to="/payments">Back to payments</Link>} />
    <Card padded={false} className="overflow-hidden" aria-labelledby="unresolved-title">
      <div className="px-4 pt-4 sm:px-5 sm:pt-5">
        <CardHead title={<span id="unresolved-title">Unresolved requests</span>} hint="Never collect a second payment until a request's outcome is known."
          action={<Button variant="outline" className="btn-sm shrink-0" onClick={load}>Refresh</Button>} />
      </div>
      {error ? <div className="px-4 pb-4 sm:px-5"><StateBlock variant="error" title="Could not load reconciliation" body={error}
        actions={<Button variant="outline" className="btn-sm" onClick={load}>Try again</Button>} /></div> :
        attempts.length === 0 ? <div className="px-4 pb-4 sm:px-5"><StateBlock title="No unresolved POS requests"
          body="Requests needing manual attention will appear here." /></div> :
          <ul className="m-0 list-none divide-y divide-line border-t border-line p-0">{attempts.map((attempt) => <li className="px-4 py-4 sm:px-5" key={attempt.id}>
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
              <div className="min-w-0">
                <Link className="block break-all font-mono text-[13px] font-medium text-ink no-underline hover:text-brand hover:underline" to={`/payments/transactions/${attempt.id}`}>{attempt.merchantReference}</Link>
                <p className="m-0 mt-0.5 text-xs text-ink-3">{formatDateTime(attempt.initiatedAt)} · Terminal ••••{attempt.terminalLastFour}
                  {attempt.environment === 'sandbox' ? ' · Sandbox' : ''}</p>
              </div>
              <StatusBadge status={attempt.status} dot />
            </div>
            <dl className="m-0 mt-3 grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg bg-subtle px-3 py-2.5 text-[13px] sm:grid-cols-4">
              <div className="min-w-0"><dt className="text-xs text-ink-3">Expected</dt><dd className="m-0 font-semibold tabular-nums text-ink">{formatMoney(attempt.expectedAmount)}</dd></div>
              <div className="min-w-0"><dt className="text-xs text-ink-3">Actual</dt><dd className={cn('m-0 tabular-nums', attempt.actualAmount == null ? 'text-ink-3' : 'font-semibold text-ink')}>{attempt.actualAmount == null ? 'Not verified' : formatMoney(attempt.actualAmount)}</dd></div>
              <div className="min-w-0"><dt className="text-xs text-ink-3">Provider</dt><dd className="m-0 truncate text-ink-2">{attempt.providerStatus ?? 'Unavailable'}</dd></div>
              <div className="min-w-0"><dt className="text-xs text-ink-3">Provider ref</dt><dd className="m-0 truncate font-mono text-ink-2">{attempt.providerReference ?? 'Not returned'}</dd></div>
            </dl>
            {attempt.failureCode && <p className="m-0 mt-2 text-xs text-ink-2">Review reason: {attempt.failureCode.replaceAll('_', ' ').toLowerCase()}</p>}
            <div className="mt-3">
              <Button variant="outline" className="btn-sm w-full sm:w-auto" loading={checking === attempt.id}
                onClick={() => check(attempt.id)}>Check status</Button>
            </div>
          </li>)}</ul>}
    </Card>
  </Page>;
}
