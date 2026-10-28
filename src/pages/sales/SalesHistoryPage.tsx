import { useWorkspaceState } from '../../hooks/useWorkspaceState';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { SaleService } from '../../services/sale.service';
import { PageLoader } from '../../components/ui/PageLoader';
import { SectionState } from '../../components/ui/StateBlock';
import { Card, Page, PageHeader, Pill, btn, cn, inputClass } from '../../components/kit';
import { getBusinessExperience } from '../../config/businessExperience';
import { formatMoney } from '../../utils/format';
import { recordSaleAction } from '../../utils/business-language';
import type { Sale, SaleStatus } from '../../types';

const STATUS_FILTERS: Array<[SaleStatus | '', string]> = [
  ['', 'All'],
  ['completed', 'Completed'],
  ['pending_payment', 'Awaiting payment'],
  ['voided', 'Voided'],
];

const METHOD_LABELS: Record<string, string> = { cash: 'Cash', card: 'Card', transfer: 'Transfer', credit: 'Credit', other: 'Other', pos: 'POS' };

function saleStatusPill(status: SaleStatus) {
  if (status === 'voided') return <Pill tone="danger">Voided</Pill>;
  if (status === 'pending_payment') return <Pill tone="warn">Awaiting payment</Pill>;
  return <Pill tone="success">Completed</Pill>;
}

function salePaymentLabel(sale: Sale): string | null {
  const methods = Array.from(new Set((sale.payments ?? []).map((payment) => payment.method)));
  if (methods.length === 0) return null;
  if (methods.length > 1) return 'Split payment';
  return METHOD_LABELS[methods[0]] ?? methods[0].replace(/_/g, ' ');
}

function saleItemCount(sale: Sale): number | null {
  if (!sale.items?.length) return null;
  return sale.items.reduce((sum, item) => sum + item.quantity, 0);
}

function dayKey(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dayLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (dayKey(value) === dayKey(today.toISOString())) return 'Today';
  if (dayKey(value) === dayKey(yesterday.toISOString())) return 'Yesterday';
  return date.toLocaleDateString('en-NG', {
    weekday: 'short', day: 'numeric', month: 'short',
    year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
}

const timeOf = (value: string) => new Date(value).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });

export default function SalesHistoryPage() {
  const { profile } = useAuth();
  const { hasPermission, loading: permsLoading } = usePermissions();
  const { category } = useBusinessContext();
  const experience = getBusinessExperience(category);
  const storeId = profile?.currentStoreId;
  const recordPlural = experience.terminology.recordPlural.toLowerCase();

  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useWorkspaceState<SaleStatus | ''>('sales-status', '');
  const [search, setSearch] = useState('');

  const canCheckout = hasPermission('sales:create');

  const loadSales = useCallback(async () => {
    if (!storeId) {
      setLoading(false);
      setError('Choose a business workspace to view its sales.');
      return;
    }
    setLoading(true);
    setError(null);
    setSales([]);
    try {
      setSales(await SaleService.getSales(storeId, { status: status || undefined }));
    } catch (err) {
      setError((err as Error)?.message ?? 'Failed to load sales');
    } finally {
      setLoading(false);
    }
  }, [storeId, status]);

  useEffect(() => { void loadSales(); }, [loadSales]);

  const query = search.trim().toLowerCase().replace(/^#/, '');
  const shown = useMemo(() => (query
    ? sales.filter((sale) => [sale.saleNumber, sale.customerName, sale.customerPhone].some((value) => value?.toLowerCase().includes(query)))
    : sales), [sales, query]);

  const groups = useMemo(() => {
    const result: Array<{ key: string; label: string; sales: Sale[]; total: number }> = [];
    for (const sale of shown) {
      const key = dayKey(sale.createdAt);
      let group = result[result.length - 1];
      if (!group || group.key !== key) {
        group = { key, label: dayLabel(sale.createdAt), sales: [], total: 0 };
        result.push(group);
      }
      group.sales.push(sale);
      if (sale.status === 'completed') group.total += sale.total;
    }
    return result;
  }, [shown]);

  if (permsLoading) return <PageLoader />;

  const statusLabel = STATUS_FILTERS.find(([value]) => value === status)?.[1].toLowerCase();

  return (
    <Page>
      <PageHeader
        title={`${experience.terminology.recordPlural} history`}
        subtitle={loading ? 'Loading records…' : error ? 'Records unavailable' : `${sales.length} ${recordPlural}`}
        actions={canCheckout && <Link className={btn('primary')} to="/sales/checkout">{recordSaleAction(category)}</Link>}
      />

      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative min-w-0 flex-1">
          <svg aria-hidden="true" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input type="search" className={cn(inputClass, 'pl-9')} aria-label={`Search ${recordPlural}`}
            placeholder="Receipt number or customer" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
          <div className="inline-flex shrink-0 rounded-lg bg-tray p-1" role="group" aria-label="Status">
            {STATUS_FILTERS.map(([value, label]) => (
              <button key={label} type="button" aria-pressed={status === value}
                className={cn('h-8 whitespace-nowrap rounded-md px-3 text-[13px] font-medium transition-colors',
                  status === value ? 'bg-surface text-ink shadow-card' : 'text-ink-2 hover:text-ink')}
                onClick={() => setStatus(value)}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <SectionState
        loading={loading}
        error={error}
        onRetry={loadSales}
        empty={shown.length === 0}
        emptyTitle={query ? `No matching ${recordPlural}` : status ? `No ${statusLabel} ${recordPlural}` : `No ${recordPlural} yet`}
        emptyBody={query ? 'Check the receipt number or customer name.' : status ? 'Choose another status to broaden the list.' : experience.emptyStates.primaryList}
      >
        <div className="flex flex-col gap-5">
          {groups.map((group) => (
            <section key={group.key} aria-label={group.label}>
              <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
                <h2 className="m-0 text-[13px] font-semibold text-ink-2">{group.label}</h2>
                <p className="m-0 text-xs tabular-nums text-ink-3">
                  {group.sales.length} {group.sales.length === 1 ? experience.terminology.record.toLowerCase() : recordPlural}
                  {group.total > 0 && <> · <span className="font-medium text-ink-2">{formatMoney(group.total)}</span></>}
                </p>
              </div>
              <Card padded={false} className="overflow-hidden">
                <ul className="m-0 list-none divide-y divide-line p-0">
                  {group.sales.map((sale) => {
                    const count = saleItemCount(sale);
                    const method = salePaymentLabel(sale);
                    const items = count === null ? null : `${count} ${count === 1 ? 'item' : 'items'}`;
                    return (
                      <li key={sale.id}>
                        <Link to={`/sales/${sale.id}`}
                          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3 text-inherit no-underline transition-colors hover:bg-subtle sm:px-5 md:grid-cols-[minmax(0,1fr)_120px_150px_120px]">
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-ink">
                              {experience.terminology.record} <span className="tabular-nums">#{sale.saleNumber}</span>
                            </span>
                            <span className="block truncate text-xs text-ink-3">
                              {timeOf(sale.createdAt)}
                              {method && <span className="md:hidden"> · {method}</span>}
                              {items && ` · ${items}`}
                              {sale.customerName && ` · ${sale.customerName}`}
                            </span>
                          </span>
                          <span className="hidden truncate text-[13px] text-ink-2 md:block">{method ?? '—'}</span>
                          <span className="hidden md:block">{saleStatusPill(sale.status)}</span>
                          <span className="flex flex-col items-end gap-1 text-right">
                            <span className={cn('block text-sm font-semibold tabular-nums', sale.status === 'voided' ? 'text-ink-3 line-through' : 'text-ink')}>{formatMoney(sale.total)}</span>
                            {sale.status !== 'completed' && <span className="md:hidden">{saleStatusPill(sale.status)}</span>}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            </section>
          ))}
        </div>
      </SectionState>
    </Page>
  );
}
