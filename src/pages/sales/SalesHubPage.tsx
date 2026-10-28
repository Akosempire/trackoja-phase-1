import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { SaleService } from '../../services/sale.service';
import { ReportService } from '../../services/report.service';
import { Button } from '../../components/ui/Button';
import { PageLoader } from '../../components/ui/PageLoader';
import { StateBlock } from '../../components/ui/StateBlock';
import { Card, Page, PageHeader, Pill, btn } from '../../components/kit';
import { getReportDateRange } from '../../utils/report-date-ranges';
import { OfflineSalesService, type PendingSale } from '../../services/offlineSales.service';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import type { Sale, PendingSalePayment, PaymentMethodBreakdown } from '../../types';
import { getBusinessExperience } from '../../config/businessExperience';
import { formatDateTime, formatMoney, formatNumber } from '../../utils/format';
import { recordSaleAction } from '../../utils/business-language';

const linkClass = 'text-[13px] font-semibold text-brand no-underline';
const rowClass = 'flex items-center justify-between gap-3 px-4 py-3 text-inherit no-underline transition-colors hover:bg-subtle sm:px-5';
const methodLabel = (method: string) => method.length <= 3 ? method.toUpperCase() : method[0].toUpperCase() + method.slice(1).replace(/_/g, ' ');

export default function SalesHubPage() {
  const { profile } = useAuth();
  const { hasPermission, loading: permsLoading } = usePermissions();
  const { category } = useBusinessContext();
  const experience = getBusinessExperience(category);
  const storeId = profile?.currentStoreId;

  const canCheckout = hasPermission('sales:create');
  const canVerifyPayments = hasPermission('sales:refund');

  const [recentSales, setRecentSales] = useState<Sale[]>([]);
  const [pending, setPending] = useState<PendingSalePayment[]>([]);
  const [paymentBreakdown, setPaymentBreakdown] = useState<PaymentMethodBreakdown[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingOfflineSales, setPendingOfflineSales] = useState<PendingSale[]>([]);
  const [syncing, setSyncing] = useState(false);
  const online = useOnlineStatus();

  const loadSalesHub = useCallback(async () => {
    if (!storeId) {
      setLoading(false);
      setError('Choose a business workspace to view its sales.');
      return;
    }
    const { from, to } = getReportDateRange('today');
    setLoading(true);
    setError(null);
    setRecentSales([]);
    setPending([]);
    setPaymentBreakdown([]);
    try {
      const [sales, pendingPayments, breakdown] = await Promise.all([
        SaleService.getSales(storeId, { status: 'completed' }),
        canVerifyPayments ? SaleService.getPendingPayments(storeId) : Promise.resolve([]),
        ReportService.getSalesByPaymentMethod(storeId, from, to),
      ]);
      setRecentSales(sales.slice(0, 5));
      setPending(pendingPayments);
      setPaymentBreakdown(breakdown);
    } catch (err) {
      setError((err as Error)?.message ?? 'Failed to load sales');
    } finally {
      setLoading(false);
    }
  }, [storeId, canVerifyPayments]);

  useEffect(() => { void loadSalesHub(); }, [loadSalesHub]);

  useEffect(() => {
    if (!storeId) return;
    const refresh = () => setPendingOfflineSales(OfflineSalesService.getPendingSales(storeId));
    refresh();
    return OfflineSalesService.subscribe(refresh);
  }, [storeId]);

  const syncNow = async () => {
    if (!storeId || syncing) return;
    setSyncing(true);
    try {
      await OfflineSalesService.flushPendingSales(storeId);
    } finally {
      setSyncing(false);
    }
  };

  if (permsLoading || loading) return <PageLoader />;

  const recordPlural = experience.terminology.recordPlural;
  const header = (
    <PageHeader
      title={recordPlural}
      subtitle="Today's checkout, payments and recent activity"
      actions={<>
        <Link className={btn('outline')} to="/sales/history">History</Link>
        {canCheckout && <Link className={btn('primary')} to="/sales/checkout">{recordSaleAction(category)}</Link>}
      </>}
    />
  );

  if (error) {
    return (
      <Page>
        {header}
        <Card>
          <StateBlock variant="error" title={`Could not load ${recordPlural.toLowerCase()}`} body={error}
            actions={<Button variant="outline" className="btn-sm" onClick={loadSalesHub}>Try again</Button>} />
        </Card>
      </Page>
    );
  }

  const todayTotal = paymentBreakdown.reduce((sum, row) => sum + row.amount, 0);

  return (
    <Page>
      {header}

      {pendingOfflineSales.length > 0 && (
        <Card className="mb-4 border-warn-soft lg:mb-6" padded={false} aria-label="Pending sync">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4 sm:px-5">
            <div className="min-w-0">
              <h2 className="m-0 text-[15px] font-semibold text-ink">Pending sync</h2>
              <p className="m-0 mt-0.5 text-[13px] text-ink-3">
                {online ? 'Saved while offline. Sync to send them to your records.' : "Will sync automatically when you're back online."}
              </p>
            </div>
            {online && <Button variant="outline" className="btn-sm" onClick={syncNow} loading={syncing}>Sync now</Button>}
          </div>
          <ul className="m-0 mt-3 list-none divide-y divide-line border-t border-line p-0">
            {pendingOfflineSales.map((sale) => (
              <li key={sale.id} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">{sale.itemCount} item{sale.itemCount === 1 ? '' : 's'}</span>
                  <span className="block truncate text-xs text-ink-3">Saved offline · {new Date(sale.createdAt).toLocaleString()}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <Pill tone="warn">Not synced</Pill>
                  <span className="text-sm font-semibold tabular-nums text-ink">{formatMoney(sale.total)}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3 lg:gap-6">
        <Card padded={false} className="overflow-hidden lg:col-span-2" aria-labelledby="recent-sales-title">
          <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-4 sm:px-5">
            <h2 id="recent-sales-title" className="m-0 text-[15px] font-semibold text-ink">Recent {recordPlural.toLowerCase()}</h2>
            <Link to="/sales/history" className={linkClass}>View all</Link>
          </div>
          {recentSales.length === 0 ? (
            <div className="px-4 pb-5 sm:px-5">
              <StateBlock title={`No ${recordPlural.toLowerCase()} yet today`} body={experience.emptyStates.primaryList} />
            </div>
          ) : (
            <ul className="m-0 list-none divide-y divide-line border-t border-line p-0">
              {recentSales.map((sale) => (
                <li key={sale.id}>
                  <Link to={`/sales/${sale.id}`} className={rowClass}>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink">{experience.terminology.record} <span className="tabular-nums">#{sale.saleNumber}</span></span>
                      <span className="block truncate text-xs text-ink-3">{formatDateTime(sale.createdAt)}{sale.customerName ? ` · ${sale.customerName}` : ''}</span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">{formatMoney(sale.total)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="flex min-w-0 flex-col gap-4 lg:gap-6">
          {paymentBreakdown.length > 0 && (
            <Card aria-labelledby="payment-status-title">
              <div className="mb-4">
                <h2 id="payment-status-title" className="m-0 text-[15px] font-semibold leading-[22px] text-ink">Today’s payment status</h2>
                <p className="m-0 mt-0.5 text-[13px] text-ink-3">Completed revenue by payment method</p>
              </div>
              <ul className="m-0 list-none space-y-3 p-0">
                {paymentBreakdown.map((row) => (
                  <li key={row.method}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate text-ink">{methodLabel(row.method)}
                        <span className="ml-2 text-xs text-ink-3">{formatNumber(row.transactionCount)} transaction{row.transactionCount === 1 ? '' : 's'}</span>
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums text-ink">{formatMoney(row.amount)}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-tray" aria-hidden="true">
                      <span className="block h-full rounded-full bg-brand" style={{ width: `${todayTotal > 0 ? Math.max(2, (row.amount / todayTotal) * 100) : 0}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {canVerifyPayments && (
            <Card padded={false} className="overflow-hidden" aria-labelledby="pending-transactions-title">
              <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-4 sm:px-5">
                <h2 id="pending-transactions-title" className="m-0 text-[15px] font-semibold text-ink">Pending transactions</h2>
                <Link to="/payments" className={linkClass}>View all</Link>
              </div>
              {pending.length === 0 ? (
                <div className="px-4 pb-5 sm:px-5">
                  <StateBlock compact title="All payments are reviewed" body="New payments that need verification will appear here." />
                </div>
              ) : (
                <ul className="m-0 list-none divide-y divide-line border-t border-line p-0">
                  {pending.slice(0, 3).map((payment) => (
                    <li key={payment.id}>
                      <Link to={`/sales/${payment.saleId}`} className={rowClass}>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-ink">Sale <span className="tabular-nums">#{payment.saleNumber}</span></span>
                          <span className="block truncate text-xs text-ink-3">
                            {methodLabel(payment.method)}
                            {payment.reference && <> · Ref: <span className="font-mono">{payment.reference}</span></>}
                          </span>
                        </span>
                        <span className="flex shrink-0 flex-col items-end gap-1">
                          <span className="text-sm font-semibold tabular-nums text-ink">{formatMoney(payment.amount)}</span>
                          <Pill tone="warn">To verify</Pill>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
      </div>
    </Page>
  );
}
