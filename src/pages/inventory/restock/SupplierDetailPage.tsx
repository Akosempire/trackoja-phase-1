import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../../contexts/AuthContext';
import { usePermissions } from '../../../hooks/usePermissions';
import { RestockService, type PurchaseRow, type SupplierBalance } from '../../../services/restock.service';
import { Button } from '../../../components/ui/Button';
import { PageLoader } from '../../../components/ui/PageLoader';
import { StateBlock } from '../../../components/ui/StateBlock';
import { Card, CardHead, Empty, Page, PageHeader, Pill, Stat, btn } from '../../../components/kit';
import { formatDate, formatMoney } from '../../../utils/format';
import { PayDialog } from './PayDialog';
import { SupplierForm } from './SupplierForm';

/** /inventory/suppliers/:supplierId: contact, totals, deliveries, pay. */
export default function SupplierDetailPage() {
  const { supplierId = '' } = useParams();
  const { profile } = useAuth();
  const { hasPermission } = usePermissions();
  const storeId = profile?.currentStoreId ?? '';
  const [s, setS] = useState<SupplierBalance | null | undefined>(undefined);
  const [deliveries, setDeliveries] = useState<PurchaseRow[]>([]);
  const [paying, setPaying] = useState(false);
  const [editing, setEditing] = useState(false);
  const money = hasPermission('purchase:view');
  const load = useCallback(() => {
    if (!storeId) return;
    RestockService.suppliers(storeId, true).then((all) => setS(all.find((x) => x.id === supplierId) ?? null)).catch(() => setS(null));
    if (money) RestockService.purchases(storeId, supplierId).then(setDeliveries).catch(() => setDeliveries([]));
  }, [storeId, supplierId, money]);
  useEffect(load, [load]);

  if (s === undefined) return <PageLoader />;
  if (!s) return <Page width="form"><Card><StateBlock variant="error" title="Supplier not found" actions={<Link className={btn('outline')} to="/inventory/suppliers">All suppliers</Link>} /></Card></Page>;
  const tel = s.phone?.replace(/[^\d+]/g, '');
  return (
    <Page>
      <PageHeader eyebrow="Supplier" title={s.name} subtitle={[s.contactName, s.paymentTerms].filter(Boolean).join(' · ') || undefined}
        actions={<>
          {hasPermission('supplier:update') && <Button variant="outline" onClick={() => setEditing(true)}>Edit</Button>}
          {money && hasPermission('purchase:create') && (s.owed ?? 0) > 0 && <Button onClick={() => setPaying(true)}>Record payment</Button>}
        </>} />
      {money && (
        <div className="mb-4 grid grid-cols-3 gap-3 lg:mb-6">
          <Stat label="Bought" value={formatMoney(s.purchasedTotal ?? 0)} hint={`${s.purchaseCount} deliver${s.purchaseCount === 1 ? 'y' : 'ies'}`} />
          <Stat label="Paid" value={formatMoney(s.paidTotal ?? 0)} />
          <Stat label="You owe" value={formatMoney(s.owed ?? 0)} tone={(s.owed ?? 0) > 0 ? 'warn' : undefined} />
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-6">
        <Card padded={false} className="overflow-hidden">
          <div className="px-4 pt-4 sm:px-5"><CardHead title="Deliveries" action={hasPermission('purchase:create') ? <Link className="text-[13px] font-semibold text-brand no-underline" to="/inventory/receive">Receive stock</Link> : undefined} /></div>
          {deliveries.length ? (
            <ul className="m-0 list-none divide-y divide-line border-t border-line p-0">
              {deliveries.map((p) => (
                <li key={p.id}>
                  <Link to={`/inventory/purchases/${p.id}`} className="flex items-center gap-3 px-4 py-3 text-inherit no-underline hover:bg-subtle sm:px-5">
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-ink">{p.reference || formatDate(p.purchasedOn)}</span>
                      <span className="block text-xs text-ink-3">{formatDate(p.purchasedOn)} · {p.lineCount} item{p.lineCount === 1 ? '' : 's'}</span></span>
                    <span className="flex shrink-0 flex-col items-end gap-1"><span className="text-sm font-semibold tabular-nums">{formatMoney(p.total)}</span>
                      {p.owed > 0 ? <Pill tone="warn">Owe {formatMoney(p.owed)}</Pill> : <Pill tone="success">Paid</Pill>}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <div className="border-t border-line p-4"><Empty title={money ? 'No deliveries yet' : 'Deliveries are hidden'} body={money ? undefined : 'Only people who can see purchases see amounts.'} /></div>}
        </Card>
        <Card>
          <CardHead title="Contact" />
          <dl className="m-0 flex flex-col gap-2 text-sm">
            {[['Person', s.contactName], ['Phone', s.phone], ['Email', s.email], ['Address', s.address], ['Notes', s.notes]].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4"><dt className="text-ink-3">{k}</dt><dd className="m-0 min-w-0 break-words text-right text-ink">{v || '—'}</dd></div>
            ))}
          </dl>
          {tel && <div className="mt-3 flex gap-2"><a className={btn('outline', 'sm')} href={`tel:${tel}`}>Call</a><a className={btn('outline', 'sm')} href={`https://wa.me/${tel.replace(/^0/, '234').replace(/^\+/, '')}`} target="_blank" rel="noreferrer">WhatsApp</a></div>}
        </Card>
      </div>
      {paying && <PayDialog open onClose={() => setPaying(false)} onDone={load} storeId={storeId} supplierId={s.id} owed={s.owed ?? 0} supplierName={s.name} />}
      {editing && <SupplierForm storeId={storeId} supplier={s} onClose={() => setEditing(false)} onSaved={load} />}
    </Page>
  );
}
