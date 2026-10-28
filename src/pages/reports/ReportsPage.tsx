import { useWorkspaceState } from '../../hooks/useWorkspaceState';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { usePermissions } from '../../hooks/usePermissions';
import { ReportService } from '../../services/report.service';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { SectionState, StateBlock } from '../../components/ui/StateBlock';
import { Card, CardHead, Page, PageHeader, Stat, btn, cn } from '../../components/kit';
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

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Cash', card: 'Card', transfer: 'Transfer', credit: 'Credit', other: 'Other', pos: 'POS',
};

// Segment colours for the payment mix, in rank order. Tokens only, so both themes work.
const MIX_COLOURS = ['bg-brand', 'bg-success', 'bg-warn', 'bg-ink-3', 'bg-line-strong'];

const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** A thin horizontal meter. `value` is 0–100. */
function Meter({ value, tone = 'bg-brand', label }: { value: number; tone?: string; label?: string }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-tray" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <span className={cn('block h-full rounded-full', tone)} style={{ width: `${Math.min(100, Math.max(value > 0 ? 2 : 0, value))}%` }} />
    </div>
  );
}

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
  const [grossProfit, setGrossProfit] = useState<number | null>(null);
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
    setGrossProfit(null);
    setPaymentBreakdown([]);
    setTopProducts([]);
    try {
      const [nextSummary, payments, products, profit] = await Promise.all([
        ReportService.getSalesSummary(storeId, range.from, range.to),
        ReportService.getSalesByPaymentMethod(storeId, range.from, range.to),
        ReportService.getTopProducts(storeId, range.from, range.to, 10),
        // Profit is an estimate from current cost prices; when it cannot be read the
        // rest of the report still stands, so its failure is not the page's failure.
        ReportService.getProfitSummary(storeId, range.from, range.to).catch(() => null),
      ]);
      if (request !== salesRequest.current) return;
      setSummary(nextSummary);
      setGrossProfit(typeof profit === 'number' && Number.isFinite(profit) ? profit : null);
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
    <Link className={btn('primary', 'sm')} to="/sales/checkout">
      {recordSaleAction(category)}
    </Link>
  ) : null;
  const inventoryAction = canAddProduct ? (
    <Link className={btn('primary', 'sm')} to="/inventory/products/new">
      Add {experience.terminology.lineItem.toLowerCase()}
    </Link>
  ) : null;

  const itemTitle = `${itemPlural[0].toUpperCase()}${itemPlural.slice(1)}`;
  const paymentTotal = paymentBreakdown.reduce((sum, payment) => sum + payment.amount, 0);
  const paymentMix = [...paymentBreakdown].sort((a, b) => b.amount - a.amount);
  const topRevenue = topProducts.reduce((max, product) => Math.max(max, product.revenue), 0);
  const margin = summary && grossProfit !== null && summary.totalRevenue > 0 ? grossProfit / summary.totalRevenue : null;
  const stockMargin = inventoryValuation ? inventoryValuation.totalRetailValue - inventoryValuation.totalCostValue : 0;

  return (
    <Page>
      <PageHeader title="Reports" subtitle="Sales performance and current business snapshots" />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between lg:mb-6">
        <SegmentedControl label="Reporting period" value={preset} options={REPORT_DATE_RANGE_PRESETS} onChange={setPreset} />
        <p className="m-0 px-1 text-[13px] text-ink-3" aria-live="polite">{rangeLabel} · Completed transactions only</p>
      </div>

      <div className="flex flex-col gap-4 lg:gap-6">
        <Card aria-labelledby="sales-summary-title">
          <CardHead title={<span id="sales-summary-title">Sales summary</span>} hint={`${rangeLabel} · Excludes cancelled and voided transactions from revenue`} />
          <SectionState loading={loadingSales || businessLoading} error={salesError} onRetry={loadSales}>
            {summary && (
              <div className="flex flex-col gap-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="min-w-0 rounded-xl bg-subtle p-4 sm:p-5">
                    <p className="m-0 text-[13px] font-medium text-ink-2">Total revenue</p>
                    <p className="m-0 mt-1 truncate text-[32px] font-semibold leading-10 tracking-tight tabular-nums text-ink">{formatMoney(summary.totalRevenue)}</p>
                    <p className="m-0 mt-1 text-xs text-ink-3">{formatNumber(summary.transactionCount)} completed transaction{summary.transactionCount === 1 ? '' : 's'}</p>
                  </div>
                  <div className="min-w-0 rounded-xl bg-subtle p-4 sm:p-5">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="m-0 text-[13px] font-medium text-ink-2">Estimated profit</p>
                      {margin !== null && <p className="m-0 text-xs font-medium tabular-nums text-ink-2">{Math.round(margin * 100)}% margin</p>}
                    </div>
                    <p className={cn('m-0 mt-1 truncate text-[32px] font-semibold leading-10 tracking-tight tabular-nums', grossProfit === null ? 'text-ink-3' : grossProfit < 0 ? 'text-danger' : 'text-success-ink')}>
                      {grossProfit === null ? 'Unavailable' : formatMoney(grossProfit)}
                    </p>
                    {margin !== null && (
                      <div className="mt-2">
                        <Meter value={Math.max(0, margin * 100)} tone={margin < 0 ? 'bg-danger' : 'bg-success'} label={`Profit is ${Math.round(margin * 100)}% of revenue`} />
                      </div>
                    )}
                    <p className="m-0 mt-2 text-xs text-ink-3">Revenue less current cost prices, before expenses.</p>
                  </div>
                </div>
                <KpiGrid>
                  <Stat label="Transactions" value={formatNumber(summary.transactionCount)} />
                  <Stat label="Average sale" value={formatMoney(summary.averageSale)} />
                  <Stat label="Discounts" value={formatMoney(summary.discountTotal)} />
                  <Stat label="Tax collected" value={formatMoney(summary.taxTotal)} />
                  <Stat label="Voided sales" value={formatNumber(summary.voidedCount)} tone={summary.voidedCount > 0 ? 'warn' : undefined} />
                </KpiGrid>
              </div>
            )}
          </SectionState>
        </Card>

        {!salesError && (
          <div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
            <SectionState
              loading={loadingSales || businessLoading}
              error={salesError}
              onRetry={loadSales}
              empty={noCompletedSales}
              emptyTitle={`No completed ${category === 'restaurant' ? 'orders' : 'sales'} for this period`}
              emptyBody={`Payment and ${itemPlural} breakdowns will appear after the first completed transaction.`}
              emptyActions={salesAction}
            >
              <Card aria-labelledby="payment-method-title">
                <CardHead title={<span id="payment-method-title">Sales by payment method</span>} hint="Revenue and completed transaction count" />
                {paymentBreakdown.length === 0 ? (
                  <StateBlock variant="unavailable" title="Payment split unavailable" body="Completed revenue exists, but no payment allocation was returned for this period." />
                ) : (
                  <>
                    <div className="mb-4 flex h-3 gap-0.5 overflow-hidden rounded-full bg-tray" aria-hidden="true">
                      {paymentMix.map((payment, index) => (
                        <span key={payment.method} className={cn('block h-full first:rounded-l-full last:rounded-r-full', MIX_COLOURS[index % MIX_COLOURS.length])}
                          style={{ width: `${Math.max(1, percent(payment.amount, paymentTotal))}%` }} />
                      ))}
                    </div>
                    <ul className="m-0 list-none divide-y divide-line p-0">
                      {paymentMix.map((payment, index) => (
                        <li key={payment.method} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                          <span aria-hidden="true" className={cn('size-2.5 shrink-0 rounded-full', MIX_COLOURS[index % MIX_COLOURS.length])} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-ink">{PAYMENT_METHOD_LABELS[payment.method] ?? payment.method}</span>
                            <span className="block text-xs text-ink-3">{formatNumber(payment.transactionCount)} transaction{payment.transactionCount === 1 ? '' : 's'}</span>
                          </span>
                          <span className="shrink-0 text-right">
                            <span className="block text-sm font-semibold tabular-nums text-ink">{formatMoney(payment.amount)}</span>
                            <span className="block text-xs tabular-nums text-ink-3">{percent(payment.amount, paymentTotal)}%</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </Card>

              <Card aria-labelledby="top-products-title">
                <CardHead title={<span id="top-products-title">{`Top ${itemPlural}`}</span>} hint="Ranked by completed sales revenue" />
                {topProducts.length === 0 ? (
                  <StateBlock variant="unavailable" title={`${itemTitle} unavailable`} body="Completed revenue exists, but no sold item lines were returned for this period." />
                ) : (
                  <ol className="m-0 list-none space-y-3.5 p-0">
                    {topProducts.map((product, index) => (
                      <li key={product.productId ?? `${product.productName}-${index}`}>
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="min-w-0 truncate text-sm text-ink">
                            <span className="mr-2 inline-block w-4 text-ink-3 tabular-nums">{index + 1}</span>{product.productName}
                          </span>
                          <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">{formatMoney(product.revenue)}</span>
                        </div>
                        <div className="mt-1.5 pl-6">
                          <Meter value={percent(product.revenue, topRevenue)} tone={index === 0 ? 'bg-brand' : 'bg-brand/45'} />
                          <p className="m-0 mt-1 truncate text-xs text-ink-3">{formatNumber(product.quantitySold)} sold{product.sku ? ` · ${product.sku}` : ''}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </Card>
            </SectionState>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
          <SectionState loading={loadingSnapshots || businessLoading} error={snapshotError} onRetry={loadSnapshots}>
            <Card aria-labelledby="inventory-title">
              <CardHead title={<span id="inventory-title">{`${experience.terminology.stock} valuation`}</span>} hint="Current stock snapshot · the selected sales period does not apply" />
              <SectionState
                empty={inventoryValuation?.productCount === 0}
                emptyTitle={`No ${itemPlural} are being tracked`}
                emptyBody={`Add a ${experience.terminology.lineItem.toLowerCase()} and enable stock tracking to see its valuation here.`}
                emptyActions={inventoryAction}
              >
                {inventoryValuation && (
                  <>
                    <dl className="m-0 space-y-3">
                      <div>
                        <div className="flex items-baseline justify-between gap-3">
                          <dt className="text-[13px] text-ink-2">Retail value</dt>
                          <dd className="m-0 text-base font-semibold tabular-nums text-ink">{formatMoney(inventoryValuation.totalRetailValue)}</dd>
                        </div>
                        <div className="mt-1.5"><Meter value={inventoryValuation.totalRetailValue > 0 ? 100 : 0} /></div>
                      </div>
                      <div>
                        <div className="flex items-baseline justify-between gap-3">
                          <dt className="text-[13px] text-ink-2">Cost value</dt>
                          <dd className="m-0 text-base font-semibold tabular-nums text-ink">{formatMoney(inventoryValuation.totalCostValue)}</dd>
                        </div>
                        <div className="mt-1.5"><Meter value={percent(inventoryValuation.totalCostValue, inventoryValuation.totalRetailValue)} tone="bg-ink-3" /></div>
                      </div>
                    </dl>
                    <p className="m-0 mt-3 text-xs text-ink-3">
                      {stockMargin >= 0
                        ? `${formatMoney(stockMargin)} potential profit if everything sells at today's prices.`
                        : `Stock is priced ${formatMoney(Math.abs(stockMargin))} below cost.`}
                    </p>
                    <div className="mt-4 grid grid-cols-3 divide-x divide-line rounded-lg bg-subtle py-3 text-center">
                      <div className="min-w-0 px-2">
                        <p className="m-0 truncate text-[11px] font-medium text-ink-3 sm:text-xs">{itemTitle} tracked</p>
                        <p className="m-0 mt-0.5 text-[15px] font-semibold tabular-nums text-ink">{formatNumber(inventoryValuation.productCount)}</p>
                      </div>
                      <div className="min-w-0 px-2">
                        <p className="m-0 truncate text-[11px] font-medium text-ink-3 sm:text-xs">Total quantity</p>
                        <p className="m-0 mt-0.5 text-[15px] font-semibold tabular-nums text-ink">{formatNumber(inventoryValuation.totalStockQty)}</p>
                      </div>
                      <div className="min-w-0 px-2">
                        <p className="m-0 truncate text-[11px] font-medium text-ink-3 sm:text-xs">Low stock</p>
                        <p className={cn('m-0 mt-0.5 text-[15px] font-semibold tabular-nums', inventoryValuation.lowStockCount > 0 ? 'text-warn-ink' : 'text-ink')}>{formatNumber(inventoryValuation.lowStockCount)}</p>
                      </div>
                    </div>
                  </>
                )}
              </SectionState>
            </Card>

            <Card aria-labelledby="balances-title">
              <CardHead title={<span id="balances-title">{`${experience.terminology.customer} balances`}</span>} hint="Current balances · the selected sales period does not apply" />
              {customerBalances && (
                <dl className="m-0 divide-y divide-line">
                  <div className="flex items-baseline justify-between gap-3 pb-3">
                    <dt className="text-[13px] text-ink-2">Total receivables</dt>
                    <dd className={cn('m-0 text-xl font-semibold tabular-nums', customerBalances.totalReceivables > 0 ? 'text-warn-ink' : 'text-ink')}>{formatMoney(customerBalances.totalReceivables)}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3 py-3">
                    <dt className="text-[13px] text-ink-2">{`${experience.terminology.customer}s with a balance`}</dt>
                    <dd className="m-0 text-sm font-semibold tabular-nums text-ink">{formatNumber(customerBalances.customersWithBalance)}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3 pt-3">
                    <dt className="text-[13px] text-ink-2">Loyalty points outstanding</dt>
                    <dd className="m-0 text-sm font-semibold tabular-nums text-ink">{formatNumber(customerBalances.totalLoyaltyPoints)}</dd>
                  </div>
                </dl>
              )}
            </Card>
          </SectionState>
        </div>
      </div>
    </Page>
  );
}

/** Two-up on phones (the odd last tile spans the row), one row on wide screens. */
function KpiGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-5 [&>*:last-child:nth-child(odd)]:col-span-2 lg:[&>*:last-child:nth-child(odd)]:col-span-1">{children}</div>;
}
