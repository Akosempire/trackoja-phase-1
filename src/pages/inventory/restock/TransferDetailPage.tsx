import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../../contexts/AuthContext';
import { usePermissions } from '../../../hooks/usePermissions';
import { RestockService, type TransferDetail } from '../../../services/restock.service';
import { Button } from '../../../components/ui/Button';
import { PageLoader } from '../../../components/ui/PageLoader';
import { StateBlock } from '../../../components/ui/StateBlock';
import { useToast } from '../../../components/ui/Toast';
import { Card, Page, PageHeader, Pill, btn, cn } from '../../../components/kit';
import { formatDateTime } from '../../../utils/format';
import { NumberBox } from './shared';
import { stockQuantity } from '../../../utils/business-activity';

/** /inventory/transfers/:transferId: the receiving branch confirms what arrived; the sender can cancel while it's on the way. */
export default function TransferDetailPage() {
  const { transferId = '' } = useParams();
  const { profile } = useAuth();
  const { hasPermission } = usePermissions();
  const toast = useToast();
  const storeId = profile?.currentStoreId ?? '';
  const [d, setD] = useState<TransferDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [got, setGot] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    RestockService.transfer(transferId).then((x) => { setD(x); setGot(Object.fromEntries(x.lines.map((l) => [l.id, String(Number(l.quantity_received ?? l.quantity_sent))]))); }).catch((e) => setError(e.message));
  }, [transferId]);
  useEffect(load, [load]);
  if (error) return <Page width="form"><Card><StateBlock variant="error" title="Transfer not found" body={error} actions={<Link className={btn('outline')} to="/inventory/transfers">All transfers</Link>} /></Card></Page>;
  if (!d) return <PageLoader />;
  const t = d.transfer;
  const receiving = t.status === 'in_transit' && t.to_store_id === storeId && hasPermission('inventory:adjust');
  const sending = t.status === 'in_transit' && t.from_store_id === storeId && hasPermission('inventory:adjust');
  async function act(kind: 'receive' | 'cancel') {
    setBusy(true);
    try {
      if (kind === 'receive') await RestockService.receiveTransfer(t.id, d!.lines.map((l) => ({ lineId: l.id, quantityReceived: Number(got[l.id] ?? l.quantity_sent) })));
      else await RestockService.cancelTransfer(t.id);
      toast.success(kind === 'receive' ? 'Stock added to this branch' : 'Transfer cancelled', { description: kind === 'cancel' ? 'The stock is back in this branch.' : undefined });
      load();
    } catch (e) { toast.error('That did not work', { description: e instanceof Error ? e.message : '' }); } finally { setBusy(false); }
  }
  const invalid = d.lines.some((l) => { const v = Number(got[l.id]); return Number.isNaN(v) || v < 0 || v > Number(l.quantity_sent); });
  return (
    <Page width="form">
      <PageHeader eyebrow="Transfer" title={`${t.from_name} → ${t.to_name}`} subtitle={`Sent ${formatDateTime(t.sent_at)}${t.received_at ? ` · ${t.status === 'cancelled' ? 'cancelled' : 'received'} ${formatDateTime(t.received_at)}` : ''}`}
        actions={<Pill tone={t.status === 'received' ? 'success' : t.status === 'cancelled' ? 'neutral' : 'warn'}>{t.status === 'in_transit' ? 'On the way' : t.status === 'received' ? 'Received' : 'Cancelled'}</Pill>} />
      {t.notes && <p className="mb-4 text-sm text-ink-2">{t.notes}</p>}
      <Card padded={false} className="overflow-hidden">
        <ul className="m-0 list-none divide-y divide-line p-0">
          {d.lines.map((l) => {
            const short = l.quantity_received !== null && Number(l.quantity_received) < Number(l.quantity_sent);
            return (
              <li key={l.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{l.product_name}</span>
                  <span className={cn('block text-xs', short ? 'text-danger' : 'text-ink-3')}>Sent {stockQuantity(Number(l.quantity_sent), l.unit)}{l.quantity_received !== null ? ` · arrived ${Number(l.quantity_received)}` : ''}{short ? ' · short' : ''}</span></span>
                {receiving && <NumberBox label={`Arrived ${l.product_name}`} className="w-24 shrink-0" align="right" value={got[l.id] ?? ''} onChange={(v) => setGot({ ...got, [l.id]: v })} />}
              </li>
            );
          })}
        </ul>
        {(receiving || sending) && (
          <div className="flex flex-col gap-2 border-t border-line p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <p className="m-0 text-xs text-ink-3">{receiving ? 'Change a number if less arrived. Products new to this branch are added with the same SKU and price.' : 'Cancelling puts the stock back in this branch.'}</p>
            {receiving ? <Button onClick={() => act('receive')} loading={busy} disabled={invalid}>Confirm arrival</Button> : <Button variant="danger" onClick={() => act('cancel')} loading={busy}>Cancel transfer</Button>}
          </div>
        )}
      </Card>
    </Page>
  );
}
