import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../../contexts/AuthContext';
import { usePermissions } from '../../../hooks/usePermissions';
import { RestockService, type PurchaseRow, type SupplierBalance } from '../../../services/restock.service';
import { Button } from '../../../components/ui/Button';
import { PageLoader } from '../../../components/ui/PageLoader';
import { Card, Empty, Page, PageHeader, Pill, cn } from '../../../components/kit';
import { formatDate, formatMoney } from '../../../utils/format';
import { RestockNav } from './RestockNav';
import { SupplierForm } from './SupplierForm';

/** /inventory/suppliers: who you buy from and what you owe, plus every delivery. */
export default function SuppliersPage() {
  const { profile } = useAuth();
  const { hasPermission } = usePermissions();
  const storeId = profile?.currentStoreId ?? '';
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'deliveries' ? 'deliveries' : 'suppliers';
  const [suppliers, setSuppliers] = useState<SupplierBalance[] | null>(null);
  const [deliveries, setDeliveries] = useState<PurchaseRow[] | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<SupplierBalance | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const money = hasPermission('purchase:view');

  const load = useCallback(() => {
    if (!storeId) return;
    RestockService.suppliers(storeId, showInactive).then(setSuppliers).catch((e) => setError(e.message));
    if (money) RestockService.purchases(storeId).then(setDeliveries).catch(() => setDeliveries([]));
  }, [storeId, showInactive, money]);
  useEffect(load, [load]);

  if (!suppliers && !error) return <PageLoader />;
  const owed = (suppliers ?? []).reduce((a, s) => a + (s.owed ?? 0), 0);
  return (
    <Page>
      <PageHeader title="Suppliers" subtitle={money && owed > 0 ? `You owe ${formatMoney(owed)} in total` : 'Who you buy from'}
        actions={hasPermission('supplier:create') ? <Button onClick={() => setEditing('new')}>Add supplier</Button> : undefined} />
      <RestockNav />
      {error && <p className="mb-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">{error}</p>}
      {money && (
        <div className="mb-4 inline-flex gap-1 rounded-lg bg-tray p-1" role="tablist">
          {(['suppliers', 'deliveries'] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setParams(t === 'deliveries' ? { tab: t } : {})}
              className={cn('h-8 rounded-md px-3 text-[13px] font-medium capitalize', tab === t ? 'bg-surface text-ink shadow-card ring-1 ring-line' : 'text-ink-2')}>{t}</button>
          ))}
        </div>
      )}
      {tab === 'suppliers' ? (
        <Card padded={false} className="overflow-hidden">
          {suppliers?.length ? (
            <ul className="m-0 list-none divide-y divide-line p-0">
              {suppliers.map((s) => (
                <li key={s.id}>
                  <Link to={`/inventory/suppliers/${s.id}`} className="flex items-center gap-3 px-4 py-3 text-inherit no-underline hover:bg-subtle sm:px-5">
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 truncate text-sm font-medium text-ink">{s.name}{s.status === 'inactive' && <Pill>Inactive</Pill>}</span>
                      <span className="block truncate text-xs text-ink-3">{[s.contactName, s.phone].filter(Boolean).join(' · ') || 'No contact yet'}{s.lastPurchaseOn ? ` · last delivery ${formatDate(s.lastPurchaseOn)}` : ''}</span>
                    </span>
                    {s.owed !== null && (s.owed > 0 ? <Pill tone="warn">Owe {formatMoney(s.owed)}</Pill> : <span className="text-xs text-ink-3">{s.purchaseCount} deliver{s.purchaseCount === 1 ? 'y' : 'ies'}</span>)}
                  </Link>
                </li>
              ))}
            </ul>
          ) : <div className="p-4"><Empty title="No suppliers yet" body="Add the people you buy stock from to track deliveries and what you owe." /></div>}
          <label className="flex items-center gap-2 border-t border-line px-4 py-3 text-[13px] text-ink-2 sm:px-5">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive suppliers
          </label>
        </Card>
      ) : (
        <Card padded={false} className="overflow-hidden">
          {deliveries?.length ? (
            <ul className="m-0 list-none divide-y divide-line p-0">
              {deliveries.map((p) => (
                <li key={p.id}>
                  <Link to={`/inventory/purchases/${p.id}`} className="flex items-center gap-3 px-4 py-3 text-inherit no-underline hover:bg-subtle sm:px-5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{p.supplierName ?? 'No supplier'}{p.reference ? ` · ${p.reference}` : ''}</span>
                      <span className="block text-xs text-ink-3">{formatDate(p.purchasedOn)} · {p.lineCount} item{p.lineCount === 1 ? '' : 's'}{p.recordedBy ? ` · ${p.recordedBy}` : ''}</span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-sm font-semibold tabular-nums text-ink">{formatMoney(p.total)}</span>
                      {p.owed > 0 ? <Pill tone="warn">Owe {formatMoney(p.owed)}</Pill> : <Pill tone="success">Paid</Pill>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <div className="p-4"><Empty title="No deliveries yet" action={<Link className="text-sm font-semibold text-brand" to="/inventory/receive">Receive stock</Link>} /></div>}
        </Card>
      )}
      {editing && <SupplierForm storeId={storeId} supplier={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={load} />}
    </Page>
  );
}
