import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../../contexts/AuthContext';
import { usePermissions } from '../../../hooks/usePermissions';
import { Card, CardHead, Page, PageHeader, Pill, btn } from '../../../components/kit';
import { PageLoader } from '../../../components/ui/PageLoader';
import { RestockService, type PurchaseRow } from '../../../services/restock.service';
import { formatDate, formatMoney } from '../../../utils/format';
import { RestockNav } from './RestockNav';

/** /inventory/restock: what needs attention in stock, and recent deliveries. */
export default function RestockHubPage() {
  const { profile } = useAuth();
  const { hasPermission } = usePermissions();
  const storeId = profile?.currentStoreId ?? '';
  const [s, setS] = useState<{ low: number; out: number; owed: number | null; suppliers: number; inbound: number; counting: boolean; recent: PurchaseRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const money = hasPermission('purchase:view');

  useEffect(() => {
    if (!storeId) return;
    const safe = <T,>(p: Promise<T>, fallback: T) => p.catch(() => fallback);
    Promise.all([
      safe(RestockService.lowStock(storeId), []),
      safe(RestockService.suppliers(storeId), []),
      safe(RestockService.transfers(storeId), []),
      safe(RestockService.openCount(storeId), null),
      money ? safe(RestockService.purchases(storeId), []) : Promise.resolve([] as PurchaseRow[]),
    ]).then(([low, sup, tr, count, recent]) => setS({
      low: low.length, out: low.filter((l) => l.stockQty <= 0).length,
      owed: money ? sup.reduce((a, x) => a + (x.owed ?? 0), 0) : null, suppliers: sup.length,
      inbound: tr.filter((t) => t.direction === 'in' && t.status === 'in_transit').length, counting: Boolean(count), recent: recent.slice(0, 6),
    })).catch((e) => setError(e.message));
  }, [storeId, money]);

  if (!s && !error) return <PageLoader />;
  const tiles = s ? [
    { to: '/inventory/low-stock', label: 'Running low', value: String(s.low), hint: s.out ? `${s.out} out of stock` : 'At or below reorder level', tone: s.low ? 'warn' : undefined },
    { to: '/inventory/suppliers', label: 'You owe suppliers', value: s.owed === null ? '—' : formatMoney(s.owed), hint: `${s.suppliers} supplier${s.suppliers === 1 ? '' : 's'}`, tone: s.owed ? 'danger' : undefined },
    { to: '/inventory/transfers', label: 'Arriving from branches', value: String(s.inbound), hint: s.inbound ? 'Confirm what arrived' : 'Nothing on the way' },
    { to: '/inventory/count', label: 'Stock count', value: s.counting ? 'In progress' : 'None open', hint: s.counting ? 'Continue counting' : 'Count the shelf and fix the numbers' },
  ] : [];
  return (
    <Page>
      <PageHeader title="Restock" subtitle="Deliveries, suppliers, counts and branch transfers"
        actions={hasPermission('purchase:create') ? <Link className={btn('primary')} to="/inventory/receive">Receive stock</Link> : undefined} />
      <RestockNav />
      {error && <p className="mb-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">{error}</p>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <Link key={t.to} to={t.to} className="min-w-0 rounded-xl border border-line bg-surface p-4 text-inherit no-underline shadow-card transition-colors hover:bg-subtle sm:p-5">
            <p className="m-0 text-[13px] font-medium text-ink-2">{t.label}</p>
            <p className={`m-0 mt-2 truncate text-[20px] font-semibold tabular-nums leading-7 sm:text-2xl ${t.tone === 'warn' ? 'text-warn-ink' : t.tone === 'danger' ? 'text-danger' : 'text-ink'}`}>{t.value}</p>
            <p className="m-0 mt-1 text-xs text-ink-3">{t.hint}</p>
          </Link>
        ))}
      </div>
      {money && (
        <Card padded={false} className="mt-4 overflow-hidden lg:mt-6">
          <div className="px-4 pt-4 sm:px-5"><CardHead title="Recent deliveries" action={<Link className="text-[13px] font-semibold text-brand no-underline" to="/inventory/suppliers?tab=deliveries">All deliveries</Link>} /></div>
          {s && s.recent.length ? (
            <ul className="m-0 list-none divide-y divide-line border-t border-line p-0">
              {s.recent.map((p) => (
                <li key={p.id}>
                  <Link to={`/inventory/purchases/${p.id}`} className="flex items-center gap-3 px-4 py-3 text-inherit no-underline hover:bg-subtle sm:px-5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{p.supplierName ?? 'No supplier'}{p.reference ? ` · ${p.reference}` : ''}</span>
                      <span className="block text-xs text-ink-3">{formatDate(p.purchasedOn)} · {p.lineCount} item{p.lineCount === 1 ? '' : 's'}</span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-sm font-semibold tabular-nums text-ink">{formatMoney(p.total)}</span>
                      {p.owed > 0 ? <Pill tone="warn">Owe {formatMoney(p.owed)}</Pill> : <Pill tone="success">Paid</Pill>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className="m-0 border-t border-line px-4 py-6 text-sm text-ink-3 sm:px-5">No deliveries yet. Use Receive stock when goods arrive.</p>}
        </Card>
      )}
    </Page>
  );
}
