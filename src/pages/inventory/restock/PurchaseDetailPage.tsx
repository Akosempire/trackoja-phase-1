import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../../contexts/AuthContext';
import { usePermissions } from '../../../hooks/usePermissions';
import { RestockService, type PurchaseDetail } from '../../../services/restock.service';
import { Button } from '../../../components/ui/Button';
import { PageLoader } from '../../../components/ui/PageLoader';
import { StateBlock } from '../../../components/ui/StateBlock';
import { Card, CardHead, Page, PageHeader, Pill, btn } from '../../../components/kit';
import { formatDate, formatMoney } from '../../../utils/format';
import { PayDialog } from './PayDialog';

/** /inventory/purchases/:purchaseId: one delivery, its lines and payments. */
export default function PurchaseDetailPage() {
  const { purchaseId = '' } = useParams();
  const { profile } = useAuth();
  const { hasPermission } = usePermissions();
  const storeId = profile?.currentStoreId ?? '';
  const [d, setD] = useState<PurchaseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const load = useCallback(() => { RestockService.purchase(purchaseId).then(setD).catch((e) => setError(e.message)); }, [purchaseId]);
  useEffect(load, [load]);
  if (error) return <Page width="form"><Card><StateBlock variant="error" title="Delivery not found" body={error} actions={<Link className={btn('outline')} to="/inventory/suppliers?tab=deliveries">All deliveries</Link>} /></Card></Page>;
  if (!d) return <PageLoader />;
  const p = d.purchase, owed = Number(p.owed);
  return (
    <Page width="form">
      <PageHeader eyebrow="Delivery" title={p.supplier_name ?? 'No supplier'} subtitle={`${formatDate(p.purchased_on)}${p.reference ? ` · ${p.reference}` : ''}`}
        actions={owed > 0 ? <Pill tone="warn">Owe {formatMoney(owed)}</Pill> : <Pill tone="success">Paid</Pill>} />
      <Card padded={false} className="mb-4 overflow-hidden">
        <ul className="m-0 list-none divide-y divide-line p-0">
          {d.items.map((i) => (
            <li key={i.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-ink">{i.name}</span>
                <span className="block text-xs text-ink-3">{Number(i.quantity)} {i.unit ?? ''} × {formatMoney(Number(i.unit_cost))}{i.lot_identifier ? ` · batch ${i.lot_identifier}` : ''}</span></span>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">{formatMoney(Number(i.line_total))}</span>
            </li>
          ))}
        </ul>
        <dl className="m-0 flex flex-col gap-1.5 border-t border-line px-4 py-3 text-sm sm:px-5">
          <div className="flex justify-between"><dt className="text-ink-2">Total</dt><dd className="m-0 font-semibold tabular-nums">{formatMoney(Number(p.total))}</dd></div>
          <div className="flex justify-between"><dt className="text-ink-2">Paid</dt><dd className="m-0 tabular-nums">{formatMoney(Number(p.amount_paid))}</dd></div>
          <div className="flex justify-between"><dt className="text-ink-2">Owed</dt><dd className={`m-0 font-semibold tabular-nums ${owed > 0 ? 'text-warn-ink' : ''}`}>{formatMoney(owed)}</dd></div>
        </dl>
      </Card>
      <Card>
        <CardHead title="Payments" action={owed > 0 && p.supplier_id && hasPermission('purchase:create') ? <Button className="btn-sm" onClick={() => setPaying(true)}>Record payment</Button> : undefined} />
        {d.payments.length ? (
          <ul className="m-0 list-none divide-y divide-line p-0">
            {d.payments.map((x) => (
              <li key={x.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="min-w-0"><span className="block text-ink">{formatDate(x.paid_on)} · {x.method ?? 'other'}</span>{(x.reference || x.notes) && <span className="block text-xs text-ink-3">{[x.reference, x.notes].filter(Boolean).join(' · ')}</span>}</span>
                <span className="shrink-0 font-semibold tabular-nums">{formatMoney(Number(x.amount))}</span>
              </li>
            ))}
          </ul>
        ) : <p className="m-0 text-sm text-ink-3">Nothing paid yet.</p>}
        {p.notes && <p className="m-0 mt-3 border-t border-line pt-3 text-sm text-ink-2">{p.notes}</p>}
      </Card>
      {p.supplier_id && <div className="mt-4"><Link className="text-sm font-semibold text-brand-ink" to={`/inventory/suppliers/${p.supplier_id}`}>Open supplier</Link></div>}
      {paying && p.supplier_id && <PayDialog open onClose={() => setPaying(false)} onDone={load} storeId={storeId} supplierId={p.supplier_id} purchaseId={p.id} owed={owed} supplierName={p.supplier_name ?? 'supplier'} />}
    </Page>
  );
}
