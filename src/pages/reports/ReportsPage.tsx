import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { ReportService } from '../../services/report.service';
import { Button } from '../../components/ui/Button';
import { PageLoader } from '../../components/ui/PageLoader';
import { getReportDateRange, REPORT_DATE_RANGE_PRESETS, type ReportDateRangePreset } from '../../utils/report-date-ranges';
import type {
  SalesSummary,
  PaymentMethodBreakdown,
  TopProduct,
  InventoryValuation,
  CustomerBalancesSummary,
} from '../../types';

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  transfer: 'Transfer',
  credit: 'Credit',
  other: 'Other',
};

export default function ReportsPage() {
  const { profile } = useAuth();
  const storeId = profile?.currentStoreId;

  const [preset, setPreset] = useState<ReportDateRangePreset>('today');
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [paymentBreakdown, setPaymentBreakdown] = useState<PaymentMethodBreakdown[]>([]);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [inventoryValuation, setInventoryValuation] = useState<InventoryValuation | null>(null);
  const [customerBalances, setCustomerBalances] = useState<CustomerBalancesSummary | null>(null);

  const [loadingSales, setLoadingSales] = useState(true);
  const [loadingSnapshots, setLoadingSnapshots] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!storeId) return;
    const { from, to } = getReportDateRange(preset);

    setLoadingSales(true);
    Promise.all([
      ReportService.getSalesSummary(storeId, from, to),
      ReportService.getSalesByPaymentMethod(storeId, from, to),
      ReportService.getTopProducts(storeId, from, to, 10),
    ])
      .then(([s, payments, products]) => {
        setSummary(s);
        setPaymentBreakdown(payments);
        setTopProducts(products);
      })
      .catch((err) => setError(err.message ?? 'Failed to load sales reports'))
      .finally(() => setLoadingSales(false));
  }, [storeId, preset]);

  useEffect(() => {
    if (!storeId) return;
    setLoadingSnapshots(true);
    Promise.all([ReportService.getInventoryValuation(storeId), ReportService.getCustomerBalancesSummary(storeId)])
      .then(([inventory, customers]) => {
        setInventoryValuation(inventory);
        setCustomerBalances(customers);
      })
      .catch((err) => setError(err.message ?? 'Failed to load inventory/customer snapshots'))
      .finally(() => setLoadingSnapshots(false));
  }, [storeId]);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="page-subtitle">Sales, inventory, and customer snapshots</p>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {REPORT_DATE_RANGE_PRESETS.map((p) => (
          <Button
            key={p.value}
            className="btn-sm"
            variant={preset === p.value ? 'primary' : 'ghost'}
            onClick={() => setPreset(p.value)}
          >
            {p.label}
          </Button>
        ))}
      </div>

      {loadingSales ? (
        <PageLoader />
      ) : (
        <>
          <div className="card">
            <p className="list-item-title" style={{ marginBottom: 8 }}>
              Sales summary
            </p>
            <div className="total-row">
              <span>Transactions</span>
              <span>{summary?.transactionCount.toLocaleString() ?? 0}</span>
            </div>
            <div className="total-row">
              <span>Discounts given</span>
              <span>₦{(summary?.discountTotal ?? 0).toLocaleString()}</span>
            </div>
            <div className="total-row">
              <span>Tax collected</span>
              <span>₦{(summary?.taxTotal ?? 0).toLocaleString()}</span>
            </div>
            <div className="total-row">
              <span>Average sale</span>
              <span>₦{(summary?.averageSale ?? 0).toLocaleString()}</span>
            </div>
            <div className="total-row">
              <span>Voided sales</span>
              <span>{summary?.voidedCount.toLocaleString() ?? 0}</span>
            </div>
            <div className="total-row grand">
              <span>Total revenue</span>
              <span>₦{(summary?.totalRevenue ?? 0).toLocaleString()}</span>
            </div>
          </div>

          <div className="card">
            <p className="list-item-title" style={{ marginBottom: 8 }}>
              Sales by payment method
            </p>
            {paymentBreakdown.length === 0 ? (
              <p className="page-subtitle">No completed sales in this period.</p>
            ) : (
              paymentBreakdown.map((p) => (
                <div key={p.method} className="movement-row">
                  <div>{PAYMENT_METHOD_LABELS[p.method] ?? p.method}</div>
                  <div style={{ textAlign: 'right' }}>
                    <div>₦{p.amount.toLocaleString()}</div>
                    <div className="page-subtitle">
                      {p.transactionCount} transaction{p.transactionCount === 1 ? '' : 's'}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="card">
            <p className="list-item-title" style={{ marginBottom: 8 }}>
              Top products
            </p>
            {topProducts.length === 0 ? (
              <p className="page-subtitle">No completed sales in this period.</p>
            ) : (
              topProducts.map((p, i) => (
                <div key={p.productId ?? `${p.productName}-${i}`} className="movement-row">
                  <div>
                    <div>{p.productName}</div>
                    {p.sku && <div className="page-subtitle">{p.sku}</div>}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div>₦{p.revenue.toLocaleString()}</div>
                    <div className="page-subtitle">{p.quantitySold.toLocaleString()} sold</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {loadingSnapshots ? (
        <PageLoader />
      ) : (
        <>
          <div className="card">
            <p className="list-item-title" style={{ marginBottom: 8 }}>
              Inventory valuation
            </p>
            <div className="total-row">
              <span>Products tracked</span>
              <span>{inventoryValuation?.productCount.toLocaleString() ?? 0}</span>
            </div>
            <div className="total-row">
              <span>Total stock quantity</span>
              <span>{inventoryValuation?.totalStockQty.toLocaleString() ?? 0}</span>
            </div>
            <div className="total-row">
              <span>Stock value (cost)</span>
              <span>₦{(inventoryValuation?.totalCostValue ?? 0).toLocaleString()}</span>
            </div>
            <div className="total-row grand">
              <span>Stock value (retail)</span>
              <span>₦{(inventoryValuation?.totalRetailValue ?? 0).toLocaleString()}</span>
            </div>
            <div className="total-row">
              <span>Low stock products</span>
              <span>{inventoryValuation?.lowStockCount.toLocaleString() ?? 0}</span>
            </div>
          </div>

          <div className="card">
            <p className="list-item-title" style={{ marginBottom: 8 }}>
              Customer balances
            </p>
            <div className="total-row">
              <span>Customers with a balance</span>
              <span>{customerBalances?.customersWithBalance.toLocaleString() ?? 0}</span>
            </div>
            <div className="total-row">
              <span>Loyalty points outstanding</span>
              <span>{customerBalances?.totalLoyaltyPoints.toLocaleString() ?? 0}</span>
            </div>
            <div className="total-row grand">
              <span>Total receivables</span>
              <span>₦{(customerBalances?.totalReceivables ?? 0).toLocaleString()}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
