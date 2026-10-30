import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../../contexts/AuthContext';
import { usePermissions } from '../../../hooks/usePermissions';
import { ProductService } from '../../../services/product.service';
import { RestockService, type TransferRow } from '../../../services/restock.service';
import { Button } from '../../../components/ui/Button';
import { PageLoader } from '../../../components/ui/PageLoader';
import { useToast } from '../../../components/ui/Toast';
import { Card, CardHead, Empty, Page, PageHeader, Pill, cn, inputClass } from '../../../components/kit';
import { formatDate, formatMoney } from '../../../utils/format';
import type { Product } from '../../../types';
import { Labelled, NumberBox, ProductPicker } from './shared';
import { stockQuantity } from '../../../utils/business-activity';
import { RestockNav } from './RestockNav';

const STATUS: Record<TransferRow['status'], { label: string; tone: 'warn' | 'success' | 'neutral' }> = {
  in_transit: { label: 'On the way', tone: 'warn' }, received: { label: 'Received', tone: 'success' }, cancelled: { label: 'Cancelled', tone: 'neutral' },
};

/**
 * /inventory/transfers: move stock to another branch of this business. Stock
 * leaves here when you send it and arrives there when they confirm.
 */
export default function TransfersPage() {
  const { profile } = useAuth();
  const { hasPermission } = usePermissions();
  const toast = useToast();
  const navigate = useNavigate();
  const storeId = profile?.currentStoreId ?? '';
  const [rows, setRows] = useState<TransferRow[] | null>(null);
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [composing, setComposing] = useState(false);
  const [to, setTo] = useState('');
  const [lines, setLines] = useState<Array<{ product: Product; qty: string }>>([]);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const canSend = hasPermission('inventory:adjust');

  const load = useCallback(() => {
    if (!storeId) return;
    RestockService.transfers(storeId).then(setRows).catch(() => setRows([]));
    if (canSend) RestockService.branches(storeId).then((b) => { setBranches(b); setTo((t) => t || b[0]?.id || ''); }).catch(() => setBranches([]));
  }, [storeId, canSend]);
  useEffect(load, [load]);
  useEffect(() => { if (composing && !products.length) ProductService.getProducts(storeId).then((ps) => setProducts(ps.filter((p) => p.status === 'active' && p.trackInventory))).catch(() => undefined); }, [composing, storeId, products.length]);

  async function send() {
    setBusy(true);
    try {
      const id = await RestockService.sendTransfer(storeId, to, lines.map((l) => ({ productId: l.product.id, quantity: Number(l.qty) })), notes);
      toast.success('Sent', { description: 'Stock left this branch. The other branch confirms when it arrives.' });
      navigate(`/inventory/transfers/${id}`);
    } catch (e) { toast.error('Not sent', { description: e instanceof Error ? e.message : '' }); } finally { setBusy(false); }
  }

  if (!rows) return <PageLoader />;
  const ok = to && lines.length > 0 && lines.every((l) => Number(l.qty) > 0 && Number(l.qty) <= Math.max(l.product.stockQty, 0));
  return (
    <Page>
      <PageHeader title="Transfers" subtitle="Move stock between your branches"
        actions={canSend && branches.length > 0 && !composing ? <Button onClick={() => setComposing(true)}>Send stock</Button> : undefined} />
      <RestockNav />
      {composing && (
        <Card className="mb-4 lg:mb-6">
          <CardHead title="Send stock to another branch" />
          <div className="flex flex-col gap-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <Labelled label="To branch"><select className={inputClass} value={to} onChange={(e) => setTo(e.target.value)}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Labelled>
              <Labelled label="Note"><input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional, e.g. weekend stock" /></Labelled>
            </div>
            <ProductPicker products={products} exclude={lines.map((l) => l.product.id)} onPick={(p) => setLines((ls) => [...ls, { product: p, qty: '1' }])} />
            {lines.length > 0 && (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {lines.map((l) => {
                  const over = Number(l.qty) > Math.max(l.product.stockQty, 0);
                  return (
                    <li key={l.product.id} className="flex items-center gap-3 rounded-lg border border-line p-2.5">
                      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{l.product.name}</span><span className={cn('block text-xs', over ? 'text-danger' : 'text-ink-3')}>{stockQuantity(l.product.stockQty, l.product.unit)} here{over ? ' · not enough' : ''}</span></span>
                      <NumberBox label={`Quantity ${l.product.name}`} className="w-24 shrink-0" align="right" value={l.qty} onChange={(v) => setLines((ls) => ls.map((x) => (x === l ? { ...x, qty: v } : x)))} />
                      <button type="button" className="text-xs font-semibold text-danger" onClick={() => setLines((ls) => ls.filter((x) => x !== l))}>Remove</button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => { setComposing(false); setLines([]); }}>Cancel</Button><Button onClick={send} loading={busy} disabled={!ok}>Send</Button></div>
          </div>
        </Card>
      )}
      {canSend && branches.length === 0 && <p className="mb-4 text-sm text-ink-3">You have one branch. Add another branch to move stock between them.</p>}
      <Card padded={false} className="overflow-hidden">
        {rows.length ? (
          <ul className="m-0 list-none divide-y divide-line p-0">
            {rows.map((t) => (
              <li key={t.id}>
                <Link to={`/inventory/transfers/${t.id}`} className="flex items-center gap-3 px-4 py-3 text-inherit no-underline hover:bg-subtle sm:px-5">
                  <span className={cn('inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold', t.direction === 'in' ? 'bg-success-soft text-success-ink' : 'bg-tray text-ink-2')} aria-hidden="true">{t.direction === 'in' ? '↓' : '↑'}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-ink">{t.direction === 'in' ? 'From' : 'To'} {t.otherBranch}</span>
                    <span className="block text-xs text-ink-3">{formatDate(t.sentAt)} · {t.lineCount} product{t.lineCount === 1 ? '' : 's'} · {formatMoney(t.value)}</span></span>
                  <Pill tone={t.status === 'in_transit' && t.direction === 'in' ? 'brand' : STATUS[t.status].tone}>{t.status === 'in_transit' && t.direction === 'in' ? 'Confirm arrival' : STATUS[t.status].label}</Pill>
                </Link>
              </li>
            ))}
          </ul>
        ) : <div className="p-4"><Empty title="No transfers yet" body="Stock you send to or receive from other branches shows here." /></div>}
      </Card>
    </Page>
  );
}
