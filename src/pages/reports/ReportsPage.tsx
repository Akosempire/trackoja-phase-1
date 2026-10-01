import { useWorkspaceState } from '../../hooks/useWorkspaceState';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { usePermissions } from '../../hooks/usePermissions';
import { ReportService } from '../../services/report.service';
import { MeterList } from '../../components/ui/MeterList';
import { MetricStrip } from '../../components/ui/MetricStrip';
import { SectionHead } from '../../components/ui/SectionHead';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { SectionState, StateBlock } from '../../components/ui/StateBlock';
import { getBusinessExperience } from '../../config/businessExperience';
import {
  formatReportDateRange,
  getReportDateRange,
  REPORT_DATE_RANGE_PRESETS,
  type ReportDateRangePreset,
} from '../../utils/report-date-ranges';
import { formatMoney, formatNumber } from '../../utils/format';
import { lineItemPlural, recordSaleAction } from '../../utils/business-language';
import type {
  SalesSummary,
  PaymentMethodBreakdown,
  TopProduct,
  InventoryValuation,
  CustomerBalancesSummary,
} from '../../types';
import '../../styles/reports.css';

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Cash', card: 'Card', transfer: 'Transfer', credit: 'Credit', other: 'Other',
};

export default function ReportsPage() {
  const { profile } = useAuth();
  const { category, loading: businessLoading } = useBusinessContext();
  const { hasPermission, loading: permissionsLoading } = usePermissions();
  const experience = getBusinessExperience(category);
  const storeId = profile?.currentStoreId;
  const salesRequest = useRef(0);
  const snapshotRequest = useRef(0);

  const [preset, setPreset] = useWorkspaceState<ReportDateRangePreset>('report-period', 'today');
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [paymentBreakdown, setPaymentBreakdown] = useState<PaymentMethodBreakdown[]>([]);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [inventoryValuation, setInventoryValuation] = useState<InventoryValuation | null>(null);
  const [customerBalances, setCustomerBalances] = useState<CustomerBalancesSummary | null>(null);
  const [loadingSales, setLoadingSales] = useState(true);
  const [loadingSnapshots, setLoadingSnapshots] = useState(true);
  const [salesError, setSalesError] = useState<string | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);

  const range = useMemo(() => getReportDateRange(preset), [preset]);
  const rangeLabel = useMemo(() => formatReportDateRange(range), [range]);
  const itemPlural = lineItemPlural(experience.terminology.lineItem);
  const canRecordSale = !permissionsLoading && hasPermission('sales:create');
  const canAddProduct = !permissionsLoading && hasPermission('product:create');

  const loadSales = useCallback(async () => {
    if (!storeId) {
      setLoadingSales(false);
      setSalesError('Choose a business workspace to view its reports.');
      return;
    }
    const request = ++salesRequest.current;
    setLoadingSales(true);
    setSalesError(null);
    setSummary(null);
    setPaymentBreakdown([]);
    setTopProducts([]);
    try {
      const [nextSummary, payments, products] = await Promise.all([
        ReportService.getSalesSummary(storeId, range.from, range.to),
        ReportService.getSalesByPaymentMethod(storeId, range.from, range.to),
        ReportService.getTopProducts(storeId, range.from, range.to, 10),
      ]);
      if (request !== salesRequest.current) return;
      setSummary(nextSummary);
      setPaymentBreakdown(payments);
      setTopProducts(products);
    } catch (error) {
      if (request === salesRequest.current) setSalesError((error as Error)?.message ?? 'Could not load sales reports.');
    } finally {
      if (request === salesRequest.current) setLoadingSales(false);
    }
  }, [range.from, range.to, storeId]);

  const loadSnapshots = useCallback(async () => {
    if (!storeId) {
      setLoadingSnapshots(false);
      setSnapshotError('Choose a business workspace to view its stock snapshot.');
      return;
    }
    const request = ++snapshotRequest.current;
    setLoadingSnapshots(true);
    setSnapshotError(null);
    setInventoryValuation(null);
    setCustomerBalances(null);
    try {
      const [inventory, customers] = await Promise.all([
        ReportService.getInventoryValuation(storeId),
        ReportService.getCustomerBalancesSummary(storeId),
      ]);
      if (request !== snapshotRequest.current) return;
      setInventoryValuation(inventory);
      setCustomerBalances(customers);
    } catch (error) {
      if (request === snapshotRequest.current) setSnapshotError((error as Error)?.message ?? 'Could not load current business snapshots.');
    } finally {
      if (request === snapshotRequest.current) setLoadingSnapshots(false);
    }
  }, [storeId]);

  useEffect(() => { void loadSales(); }, [loadSales]);
  useEffect(() => { void loadSnapshots(); }, [loadSnapshots]);

  const noCompletedSales = summary?.transactionCount === 0;
  const salesAction = canRecordSale ? (
    <Link className="btn btn-primary btn-sm" to="/sales/checkout">
      {recordSaleAction(category)}
    </Link>
  ) : null;
  const inventoryAction = canAddProduct ? (
    <Link className="btn btn-primary btn-sm" to="/inventory/products/new">
      Add {experience.terminology.lineItem.toLowerCase()}
    </Link>
  ) : null;

  return (
    <div className="page reports-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="page-subtitle">Sales performance and current business snapshots</p>
        </div>
      </div>

      <div className="report-period-bar">
        <SegmentedControl label="Reporting period" value={preset} options={REPORT_DATE_RANGE_PRESETS} onChange={setPreset} />
        <p className="report-period-label" aria-live="polite">{rangeLabel} · Completed transactions only</p>
      </div>

      <section className="report-panel" aria-labelledby="sales-summary-title">
        <SectionHead id="sales-summary-title" title="Sales summary" sub={`${rangeLabel} · Excludes cancelled and voided transactions from revenue`} />
        <SectionState loading={loadingSales || businessLoading} error={salesError} onRetry={loadSales}>
          {summary && (
            <>
              <div className="report-revenue">
                <span className="report-revenue-label">Total revenue</span>
                <strong className="report-revenue-value">{formatMoney(summary.totalRevenue)}</strong>
              </div>
              <MetricStrip metrics={[
                { id: 'transactions', label: 'Transactions', value: formatNumber(summary.transactionCount) },
                { id: 'average', label: 'Average sale', value: formatMoney(summary.averageSale) },
                { id: 'discounts', label: 'Discounts', value: formatMoney(summary.discountTotal) },
                { id: 'tax', label: 'Tax collected', value: formatMoney(summary.taxTotal) },
                { id: 'voided', label: 'Voided sales', value: formatNumber(summary.voidedCount), tone: summary.voidedCount > 0 ? 'warning' : 'default' },
              ]} />
            </>
          )}
        </SectionState>
      </section>

      {!salesError && <div className="report-grid">
        <SectionState
          loading={loadingSales || businessLoading}
          error={salesError}
          onRetry={loadSales}
          empty={noCompletedSales}
          emptyTitle={`No completed ${category === 'restaurant' ? 'orders' : 'sales'} for this period`}
          emptyBody={`Payment and ${itemPlural} breakdowns will appear after the first completed transaction.`}
          emptyActions={salesAction}
        >
          <section className="report-panel" aria-labelledby="payment-method-title">
            <SectionHead id="payment-method-title" title="Sales by payment method" sub="Revenue and completed transaction count" />
            {paymentBreakdown.length === 0 ? (
              <StateBlock variant="unavailable" title="Payment split unavailable" body="Completed revenue exists, but no payment allocation was returned for this period." />
            ) : (
              <MeterList items={paymentBreakdown.map((payment) => ({
                label: PAYMENT_METHOD_LABELS[payment.method] ?? payment.method,
                value: payment.amount,
                display: formatMoney(payment.amount),
                detail: `${formatNumber(payment.transactionCount)} transaction${payment.transactionCount === 1 ? '' : 's'}`,
              }))} />
            )}
          </section>

          <section className="report-panel" aria-labelledby="top-products-title">
            <SectionHead id="top-products-title" title={`Top ${itemPlural}`} sub="Ranked by completed sales revenue" />
            {topProducts.length === 0 ? (
              <StateBlock variant="unavailable" title={`${itemPlural[0].toUpperCase()}${itemPlural.slice(1)} unavailable`} body="Completed revenue exists, but no sold item lines were returned for this period." />
            ) : (
              <MeterList items={topProducts.map((product, index) => ({
                id: product.productId ?? `${product.productName}-${index}`,
                label: product.productName,
                value: product.revenue,
                display: formatMoney(product.revenue),
                detail: `${formatNumber(product.quantitySold)} sold${product.sku ? ` · ${product.sku}` : ''}`,
                tone: index === 0 ? 'accent' : 'muted',
              }))} />
            )}
          </section>
        </SectionState>
      </div>}

      <div className="report-grid">
        <SectionState loading={loadingSnapshots || businessLoading} error={snapshotError} onRetry={loadSnapshots}>
          <section className="report-panel" aria-labelledby="inventory-title">
            <SectionHead id="inventory-title" title={`${experience.terminology.stock} valuation`} sub="Current stock snapshot · the selected sales period does not apply" />
            <SectionState
              empty={inventoryValuation?.productCount === 0}
              emptyTitle={`No ${itemPlural} are being tracked`}
              emptyBody={`Add a ${experience.terminology.lineItem.toLowerCase()} and enable stock tracking to see its valuation here.`}
              emptyActions={inventoryAction}
            >
              {inventoryValuation && <MetricStrip metrics={[
                { id: 'products', label: `${itemPlural[0].toUpperCase()}${itemPlural.slice(1)} tracked`, value: formatNumber(inventoryValuation.productCount) },
                { id: 'quantity', label: 'Total quantity', value: formatNumber(inventoryValuation.totalStockQty) },
                { id: 'cost', label: 'Cost value', value: formatMoney(inventoryValuation.totalCostValue) },
                { id: 'retail', label: 'Retail value', value: formatMoney(inventoryValuation.totalRetailValue) },
                { id: 'low', label: 'Low stock', value: formatNumber(inventoryValuation.lowStockCount), tone: inventoryValuation.lowStockCount > 0 ? 'warning' : 'default' },
              ]} />}
            </SectionState>
          </section>

          <section className="report-panel" aria-labelledby="balances-title">
            <SectionHead id="balances-title" title={`${experience.terminology.customer} balances`} sub="Current balances · the selected sales period does not apply" />
            {customerBalances && <MetricStrip metrics={[
              { id: 'receivables', label: 'Total receivables', value: formatMoney(customerBalances.totalReceivables) },
              { id: 'balances', label: `${experience.terminology.customer}s with a balance`, value: formatNumber(customerBalances.customersWithBalance) },
              { id: 'loyalty', label: 'Loyalty points outstanding', value: formatNumber(customerBalances.totalLoyaltyPoints) },
            ]} />}
          </section>
        </SectionState>
      </div>
    </div>
  );
}
