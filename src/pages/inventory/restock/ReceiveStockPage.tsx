import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../../contexts/AuthContext';
import { usePermissions } from '../../../hooks/usePermissions';
import { ProductService } from '../../../services/product.service';
import { RestockService, REORDER_KEY, type SupplierBalance } from '../../../services/restock.service';
import { Button } from '../../../components/ui/Button';
import { Dialog } from '../../../components/ui/Dialog';
import { PageLoader } from '../../../components/ui/PageLoader';
import { StateBlock } from '../../../components/ui/StateBlock';
import { useToast } from '../../../components/ui/Toast';
import { Card, CardHead, Empty, Page, PageHeader, cn, inputClass } from '../../../components/kit';
import { amountPaidNow, deliveryProblems, deliveryTotal, weightedCost } from '../../../utils/restock';
import { formatMoney } from '../../../utils/format';
import type { Product } from '../../../types';
import { Labelled, NumberBox, ProductPicker } from './shared';
import { RestockNav } from './RestockNav';

interface Line { key: string; product: Product; qty: string; cost: string; batch: string; expiry: string; showBatch: boolean }
const METHODS = [['cash', 'Cash'], ['transfer', 'Transfer'], ['card', 'Card'], ['credit', 'On credit (pay later)'], ['other', 'Other']] as const;
const today = () => new Date().toISOString().slice(0, 10);

/**
 * /inventory/receive: a delivery from a supplier. Raises stock for every line and
 * moves each product's cost to the weighted average of what was on the shelf and
 * what arrived, so one cheap or dear delivery doesn't rewrite the profit on
 * stock you already had.
 */
export default function ReceiveStockPage() {
  const { profile } = useAuth();
  const { hasPermission } = usePermissions();
  const toast = useToast();
  const navigate = useNavigate();
  const storeId = profile?.currentStoreId ?? '';
  const [products, setProducts] = useState<Product[] | null>(null);
  const [suppliers, setSuppliers] = useState<SupplierBalance[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [date, setDate] = useState(today());
  const [reference, setReference] = useState('');
  const [method, setMethod] = useState('transfer');
  const [paid, setPaid] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newSupplier, setNewSupplier] = useState<string | null>(null);

  useEffect(() => {
    if (!storeId) return;
    Promise.all([ProductService.getProducts(storeId), RestockService.suppliers(storeId).catch(() => [])]).then(([ps, ss]) => {
      const active = ps.filter((p) => p.status === 'active');
      setProducts(active); setSuppliers(ss);
      // "Reorder" from Low stock
      try {
        const raw = sessionStorage.getItem(REORDER_KEY);
        if (raw) {
          sessionStorage.removeItem(REORDER_KEY);
          const r = JSON.parse(raw) as { supplierId?: string | null; lines: Array<{ productId: string; quantity: number; unitCost: number }> };
          if (r.supplierId) setSupplierId(r.supplierId);
          setLines(r.lines.flatMap((l) => { const p = active.find((x) => x.id === l.productId); return p ? [mkLine(p, String(l.quantity), String(l.unitCost))] : []; }));
        }
      } catch { /* nothing to prefill */ }
    }).catch((e) => setError(e.message));
  }, [storeId]);

  const parsed = useMemo(() => lines.map((l) => ({ productId: l.product.id, quantity: Number(l.qty), unitCost: Number(l.cost) })), [lines]);
  const total = deliveryTotal(parsed);
  const paidNow = amountPaidNow(total, method, paid);
  const problems = deliveryProblems(parsed);
  const batchMissing = lines.some((l) => l.showBatch && l.expiry && !l.batch.trim());

  function mkLine(p: Product, qty = '1', cost = String(p.costPrice || '')): Line {
    return { key: `${p.id}-${Math.random().toString(36).slice(2, 7)}`, product: p, qty, cost, batch: '', expiry: '', showBatch: false };
  }
  const add = (p: Product) => setLines((ls) => {
    const same = ls.find((l) => l.product.id === p.id && !l.showBatch);
    return same ? ls.map((l) => (l === same ? { ...l, qty: String((Number(l.qty) || 0) + 1) } : l)) : [...ls, mkLine(p)];
  });
  const set = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  async function save() {
    if (problems.length || batchMissing) return;
    setSaving(true); setError(null);
    try {
      const id = await RestockService.receive(storeId, {
        lines: lines.map((l) => ({ productId: l.product.id, quantity: Number(l.qty), unitCost: Number(l.cost) || 0,
          ...(l.showBatch && l.batch.trim() ? { lotType: 'batch' as const, identifier: l.batch.trim(), expiryDate: l.expiry || undefined } : {}) })),
        supplierId: supplierId || null, date, method, reference, notes, amountPaid: paidNow,
      });
      toast.success('Stock received', { description: `${lines.length} product${lines.length === 1 ? '' : 's'} added to stock.` });
      navigate(`/inventory/purchases/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the delivery');
    } finally { setSaving(false); }
  }

  async function createSupplier() {
    if (!newSupplier?.trim()) return;
    try {
      const id = await RestockService.saveSupplier(storeId, { name: newSupplier.trim() });
      setSuppliers(await RestockService.suppliers(storeId));
      setSupplierId(id); setNewSupplier(null);
    } catch (e) { toast.error('Supplier not added', { description: e instanceof Error ? e.message : '' }); }
  }

  if (!hasPermission('purchase:create') || !hasPermission('inventory:adjust')) {
    return <Page width="form"><Card><StateBlock variant="denied" title="You can't receive stock" body="Ask an owner or manager to record deliveries." /></Card></Page>;
  }
  if (!products) return error ? <Page width="form"><Card><StateBlock variant="error" title="Couldn't load products" body={error} /></Card></Page> : <PageLoader />;

  return (
    <Page>
      <PageHeader title="Receive stock" subtitle="Record a delivery. Stock goes up as soon as you save." />
      <RestockNav />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-6">
        <Card>
          <CardHead title="What arrived" hint="Search, type a barcode or scan. Cost is what you paid per unit." />
          <ProductPicker products={products} onPick={add} />
          {lines.length === 0 ? (
            <div className="mt-4"><Empty title="No products yet" body="Add each product in this delivery." /></div>
          ) : (
            <ul className="m-0 mt-4 flex list-none flex-col gap-3 p-0">
              {lines.map((l) => {
                const q = Number(l.qty) || 0, c = Number(l.cost) || 0;
                const newCost = q > 0 ? weightedCost(l.product.stockQty, l.product.costPrice, q, c) : l.product.costPrice;
                return (
                  <li key={l.key} className="rounded-lg border border-line p-3">
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-ink">{l.product.name}</span>
                        <span className="block text-xs text-ink-3">{l.product.sku} · {l.product.stockQty} in stock now</span>
                      </span>
                      <button type="button" className="shrink-0 text-xs font-semibold text-danger" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>Remove</button>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <Labelled label={`Quantity (${l.product.unit})`}><NumberBox label="Quantity" value={l.qty} onChange={(v) => set(l.key, { qty: v })} /></Labelled>
                      <Labelled label="Cost per unit"><NumberBox label="Cost per unit" value={l.cost} onChange={(v) => set(l.key, { cost: v })} /></Labelled>
                      <div className="col-span-2 flex flex-col justify-end text-right sm:col-span-1">
                        <span className="text-xs text-ink-3">Line total</span>
                        <span className="text-sm font-semibold tabular-nums text-ink">{formatMoney(Math.round(q * c * 100) / 100)}</span>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-3">
                      <span>New cost price: <strong className="font-semibold text-ink-2">{formatMoney(newCost)}</strong>{newCost !== l.product.costPrice ? ` (was ${formatMoney(l.product.costPrice)})` : ''}</span>
                      <button type="button" className="font-semibold text-brand" onClick={() => set(l.key, { showBatch: !l.showBatch })}>{l.showBatch ? 'No batch' : 'Add batch & expiry'}</button>
                    </div>
                    {l.showBatch && (
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <Labelled label="Batch number"><input className={inputClass} value={l.batch} onChange={(e) => set(l.key, { batch: e.target.value })} /></Labelled>
                        <Labelled label="Expiry date"><input type="date" className={inputClass} value={l.expiry} onChange={(e) => set(l.key, { expiry: e.target.value })} /></Labelled>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="lg:sticky lg:top-6">
          <CardHead title="Delivery details" />
          <div className="flex flex-col gap-3">
            <Labelled label="Supplier">
              <div className="flex gap-2">
                <select className={cn(inputClass, 'flex-1')} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                  <option value="">No supplier</option>
                  {suppliers.filter((s) => s.status === 'active').map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                {hasPermission('supplier:create') && <Button variant="outline" onClick={() => setNewSupplier('')}>New</Button>}
              </div>
            </Labelled>
            <div className="grid grid-cols-2 gap-2">
              <Labelled label="Date"><input type="date" max={today()} className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} /></Labelled>
              <Labelled label="Invoice / ref"><input className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" /></Labelled>
            </div>
            <Labelled label="How you paid">
              <select className={inputClass} value={method} onChange={(e) => { setMethod(e.target.value); setPaid(''); }}>
                {METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Labelled>
            <Labelled label="Paid now" hint={method === 'credit' ? 'Nothing is paid now. Record payments from the supplier page.' : 'Leave blank if you paid it all.'}>
              <NumberBox label="Paid now" value={paid} onChange={setPaid} />
            </Labelled>
            <Labelled label="Notes"><input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" /></Labelled>
            <dl className="m-0 mt-1 flex flex-col gap-1.5 border-t border-line pt-3 text-sm">
              <div className="flex justify-between"><dt className="text-ink-2">Total</dt><dd className="m-0 font-semibold tabular-nums text-ink">{formatMoney(total)}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-2">Paid now</dt><dd className="m-0 tabular-nums text-ink">{formatMoney(paidNow)}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-2">You'll owe</dt><dd className={cn('m-0 font-semibold tabular-nums', total - paidNow > 0 ? 'text-warn-ink' : 'text-ink')}>{formatMoney(total - paidNow)}</dd></div>
            </dl>
            {error && <p className="m-0 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">{error}</p>}
            {batchMissing && <p className="m-0 text-xs text-danger">Add the batch number for lines with an expiry date.</p>}
            <Button onClick={save} loading={saving} disabled={problems.length > 0 || batchMissing} className="w-full">Save and add to stock</Button>
            <p className="m-0 text-xs text-ink-3">Cost price becomes the average of what's on the shelf and what arrived. The delivery also shows in <Link to="/expenses" className="text-brand">Expenses</Link>.</p>
          </div>
        </Card>
      </div>

      <Dialog open={newSupplier !== null} onClose={() => setNewSupplier(null)} title="New supplier"
        footer={<><Button variant="ghost" onClick={() => setNewSupplier(null)}>Cancel</Button><Button onClick={createSupplier} disabled={!newSupplier?.trim()}>Add supplier</Button></>}>
        <Labelled label="Name"><input autoFocus className={inputClass} value={newSupplier ?? ''} onChange={(e) => setNewSupplier(e.target.value)} placeholder="e.g. Dangote Foods" /></Labelled>
      </Dialog>
    </Page>
  );
}
