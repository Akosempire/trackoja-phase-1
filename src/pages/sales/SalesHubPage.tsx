import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { SaleService } from '../../services/sale.service';
import { ReportService } from '../../services/report.service';
import { Button } from '../../components/ui/Button';
import { PageLoader } from '../../components/ui/PageLoader';
import { MeterList } from '../../components/ui/MeterList';
import { SectionHead } from '../../components/ui/SectionHead';
import { StateBlock } from '../../components/ui/StateBlock';
import { getReportDateRange } from '../../utils/report-date-ranges';
import { OfflineSalesService, type PendingSale } from '../../services/offlineSales.service';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import type { Sale, PendingSalePayment, PaymentMethodBreakdown } from '../../types';
import { getBusinessExperience } from '../../config/businessExperience';
import { formatDateTime, formatMoney, formatNumber } from '../../utils/format';
import { recordSaleAction } from '../../utils/business-language';

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

  if (error) {
    return (
      <div className="page">
        <div className="page-header">
          <div><h1 className="page-title">{experience.terminology.recordPlural}</h1><p className="page-subtitle">Today’s checkout, payments and recent activity</p></div>
        </div>
        <div className="card"><StateBlock variant="error" title={`Could not load ${experience.terminology.recordPlural.toLowerCase()}`} body={error}
          actions={<Button variant="outline" className="btn-sm" onClick={loadSalesHub}>Try again</Button>} /></div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{experience.terminology.recordPlural}</h1>
          <p className="page-subtitle">Today's checkout, payments and recent activity</p>
        </div>
        {canCheckout && (
          <Link to="/sales/checkout">
            <Button className="btn-sm">{category === 'restaurant' ? 'New order' : 'New sale'}</Button>
          </Link>
        )}
      </div>

      {pendingOfflineSales.length > 0 && (
        <div className="card">
          <div className="page-header" style={{ marginBottom: 8 }}>
            <p className="list-item-title" style={{ margin: 0 }}>
              Pending sync
            </p>
            {online && (
              <Button variant="ghost" className="btn-sm" onClick={syncNow} loading={syncing}>
                Sync now
              </Button>
            )}
          </div>
          <div className="list">
            {pendingOfflineSales.map((sale) => (
              <div key={sale.id} className="list-item" style={{ cursor: 'default' }}>
                <div>
                  <p className="list-item-title">
                    {sale.itemCount} item{sale.itemCount === 1 ? '' : 's'}
                  </p>
                  <p className="list-item-subtitle">Saved offline · {new Date(sale.createdAt).toLocaleString()}</p>
                </div>
              <span className="list-item-title">{formatMoney(sale.total)}</span>
              </div>
            ))}
          </div>
          {!online && <p className="scanner-hint" style={{ marginTop: 8 }}>Will sync automatically when you're back online.</p>}
        </div>
      )}

      {paymentBreakdown.length > 0 && (
        <div className="card">
          <SectionHead title="Today’s payment status" sub="Completed revenue by payment method" />
          <MeterList items={paymentBreakdown.map((row) => ({
            label: row.method[0].toUpperCase() + row.method.slice(1), value: row.amount,
            display: formatMoney(row.amount), detail: `${formatNumber(row.transactionCount)} transaction${row.transactionCount === 1 ? '' : 's'}`,
          }))} />
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
            <StateBlock title="All payments are reviewed" body="New payments that need verification will appear here." />
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
                  <span className="list-item-title">{formatMoney(payment.amount)}</span>
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
          <StateBlock title={`No ${experience.terminology.recordPlural.toLowerCase()} yet today`}
            body={experience.emptyStates.primaryList}
            actions={canCheckout ? <Link className="btn btn-primary btn-sm" to="/sales/checkout">{recordSaleAction(category)}</Link> : null} />
        ) : (
          <div className="list">
            {recentSales.map((sale) => (
              <Link key={sale.id} to={`/sales/${sale.id}`} className="list-item">
                <div>
                  <p className="list-item-title">{experience.terminology.record} #{sale.saleNumber}</p>
                  <p className="list-item-subtitle">{formatDateTime(sale.createdAt)}</p>
                </div>
                <span className="list-item-title">{formatMoney(sale.total)}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
