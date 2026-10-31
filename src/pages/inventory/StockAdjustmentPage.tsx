import { useWorkspaceState } from '../../hooks/useWorkspaceState';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { ProductService } from '../../services/product.service';
import { InventoryService } from '../../services/inventory.service';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { PageLoader } from '../../components/ui/PageLoader';
import { Card, Empty, Page, PageHeader, cn, inputClass } from '../../components/kit';
import { stockQuantity } from '../../utils/business-activity';
import type { InventoryMovement, Product } from '../../types';
import { useToast } from '../../components/ui/Toast';

type AdjustmentMovementType = 'replenishment' | 'transfer_in' | 'transfer_out' | 'adjustment';

const MOVEMENT_LABELS: Record<AdjustmentMovementType, string> = {
  replenishment: 'Replenishment (stock in)',
  transfer_in: 'Transfer in',
  transfer_out: 'Transfer out',
  adjustment: 'Adjustment (stock count correction)',
};

/** The reason choices, written the way a shop owner would say them. */
const MOVEMENT_CHOICES: Array<{ value: AdjustmentMovementType; title: string; hint: string; sign: '+' | '−' | '±' }> = [
  { value: 'replenishment', title: 'New stock arrived', hint: 'Delivery or purchase from a supplier', sign: '+' },
  { value: 'transfer_in', title: 'Transfer in', hint: 'Received from another branch', sign: '+' },
  { value: 'transfer_out', title: 'Transfer out', hint: 'Sent to another branch', sign: '−' },
  { value: 'adjustment', title: 'Count correction', hint: 'Fix the number after counting, damage or loss', sign: '±' },
];

const HISTORY_LABELS: Record<string, string> = {
  replenishment: 'Stock received',
  transfer_in: 'Transfer in',
  transfer_out: 'Transfer out',
  adjustment: 'Count correction',
  sale: 'Sold',
  refund: 'Refunded',
  void: 'Sale voided',
};

export default function StockAdjustmentPage() {
  const toast = useToast();
  const { profile } = useAuth();
  const [searchParams] = useSearchParams();
  const storeId = profile?.currentStoreId;

  const [products, setProducts] = useState<Product[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [productId, setProductId] = useWorkspaceState('stock-product', searchParams.get('productId') ?? '');
  const [movementType, setMovementType] = useWorkspaceState<AdjustmentMovementType>('stock-movement', 'replenishment');
  const [direction, setDirection] = useWorkspaceState<'increase' | 'decrease'>('stock-direction', 'increase');
  const [quantity, setQuantity] = useWorkspaceState('stock-quantity', '');
  const [reason, setReason] = useState('');

  const selectedProduct = products.find((p) => p.id === productId);

  const loadMovements = (pid: string) => {
    if (!storeId || !pid) {
      setMovements([]);
      return;
    }
    InventoryService.getMovements(storeId, { productId: pid, limit: 20 })
      .then(setMovements)
      .catch((err) => console.error('Load movements error:', err));
  };

  useEffect(() => {
    if (!storeId) return;
    setLoading(true);
    ProductService.getProducts(storeId, { lowStockOnly: false })
      .then((all) => {
        const tracked = all.filter((p) => p.trackInventory);
        setProducts(tracked);
        if (!productId && tracked.length > 0) {
          setProductId(tracked[0].id);
        }
      })
      .catch((err) => setError(err.message ?? 'Failed to load products'))
      .finally(() => setLoading(false));
  }, [storeId]);

  useEffect(() => {
    loadMovements(productId);
  }, [storeId, productId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storeId || !productId) return;

    const magnitude = Number(quantity);
    if (!magnitude || magnitude <= 0) {
      setError('Enter a quantity greater than zero');
      return;
    }

    let signedQuantity = magnitude;
    if (movementType === 'transfer_out') signedQuantity = -magnitude;
    if (movementType === 'adjustment') signedQuantity = direction === 'decrease' ? -magnitude : magnitude;

    if (movementType === 'adjustment' && !reason.trim()) {
      setError('A reason is required for adjustments');
      return;
    }

    setSaving(true);
    setError(null);
    const toastId = toast.loading('Recording stock movement…', { dedupeKey: 'stock-adjustment' });
    try {
      await InventoryService.adjustStock(storeId, {
        productId,
        movementType,
        quantity: signedQuantity,
        reason: reason || undefined,
      });
      toast.update(toastId, { variant: 'success', message: 'Stock updated', description: `${selectedProduct?.name ?? 'Product'} inventory was adjusted.` });
      setQuantity('');
      setReason('');
      const updated = await ProductService.getProduct(productId);
      setProducts((prev) => prev.map((p) => (p.id === productId ? updated : p)));
      loadMovements(productId);
    } catch (err: any) {
      const message = err.message ?? 'Failed to record stock movement';
      setError(message);
      toast.update(toastId, { variant: 'error', message: 'Stock was not updated', description: message });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <PageLoader />;

  const magnitude = Number(quantity);
  const validQuantity = Number.isFinite(magnitude) && magnitude > 0;
  const sign = movementType === 'transfer_out' || (movementType === 'adjustment' && direction === 'decrease') ? -1 : 1;
  const before = selectedProduct?.stockQty ?? 0;
  const after = before + (validQuantity ? sign * magnitude : 0);
  const unit = selectedProduct?.unit ?? '';
  const label = 'mb-1.5 block text-[13px] font-medium text-ink-2';
  const when = (value: string) => new Date(value).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    <Page>
      <PageHeader
        title="Adjust stock"
        subtitle="Quick one-off corrections. For deliveries, counts and branch transfers use Restock."
        actions={<Link className="tap text-[13px] font-semibold text-brand-ink no-underline" to="/inventory/restock">Open Restock</Link>}
      />

      {error && <div className="mb-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">{error}</div>}

      {products.length === 0 ? (
        <Empty
          title="No tracked inventory yet"
          body="Turn on inventory tracking for a product before recording stock movements."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-5 lg:gap-6">
          <form onSubmit={handleSubmit} className="min-w-0 lg:col-span-3" aria-label="Record a stock movement">
            <Card>
              <div className="mb-5">
                <label className={label} htmlFor="stock-product">
                  Product
                </label>
                <select
                  id="stock-product"
                  className={inputClass}
                  value={productId}
                  onChange={(e) => setProductId(e.target.value)}
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.stockQty} {p.unit})
                    </option>
                  ))}
                </select>
              </div>

              <fieldset className="m-0 mb-5 min-w-0 border-0 p-0">
                <legend className={cn(label, "p-0")}>Movement type</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {MOVEMENT_CHOICES.map((choice) => {
                    const active = movementType === choice.value;
                    return (
                      <label key={choice.value}
                        className={cn('relative flex min-h-[64px] cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-3 transition-colors',
                          active ? 'border-brand bg-brand-soft/60 ring-4 ring-brand/10' : 'border-line-strong bg-surface hover:bg-hover')}>
                        <input type="radio" name="stock-movement-type" value={choice.value} checked={active}
                          id={choice.value === 'replenishment' ? 'stock-movement-type' : undefined}
                          onChange={() => setMovementType(choice.value)} className="sr-only" />
                        <span aria-hidden="true"
                          className={cn('mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-[15px] font-semibold',
                            choice.sign === '+' ? 'bg-success-soft text-success-ink' : choice.sign === '−' ? 'bg-warn-soft text-warn-ink' : 'bg-tray text-ink-2')}>
                          {choice.sign}
                        </span>
                        <span className="min-w-0">
                          <span className={cn('block text-sm font-semibold', active ? 'text-brand-ink' : 'text-ink')}>{choice.title}</span>
                          <span className="block text-xs text-ink-3">{choice.hint}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              {movementType === 'adjustment' && (
                <fieldset className="m-0 mb-5 min-w-0 border-0 p-0">
                  <legend className={cn(label, "p-0")}>Direction</legend>
                  <div className="grid grid-cols-2 gap-1 rounded-lg bg-tray p-1">
                    {([['increase', 'Increase stock'], ['decrease', 'Decrease stock']] as const).map(([value, text]) => (
                      <label key={value}
                        className={cn('flex h-9 cursor-pointer items-center justify-center rounded-md text-[13px] font-medium transition-colors',
                          direction === value ? 'bg-surface text-ink shadow-card' : 'text-ink-2 hover:text-ink')}>
                        <input type="radio" name="stock-direction" value={value} checked={direction === value}
                          id={value === 'increase' ? 'stock-direction' : undefined}
                          onChange={() => setDirection(value)} className="sr-only" />
                        {text}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}

              <FormField id="stock-quantity" label="Quantity" type="number" min={0} step="any" inputMode="decimal"
                value={quantity} onChange={setQuantity} required placeholder="0" />

              {selectedProduct && (
                <div className="mb-5 grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-lg bg-tray px-4 py-3" aria-live="polite">
                  <div className="min-w-0">
                    <p className="m-0 text-xs font-medium text-ink-3">Current stock</p>
                    <p className="m-0 mt-0.5 truncate text-lg font-semibold tabular-nums text-ink">{stockQuantity(before, unit)}</p>
                  </div>
                  <div className="flex flex-col items-center">
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums',
                      !validQuantity ? 'bg-surface text-ink-3' : sign > 0 ? 'bg-success-soft text-success-ink' : 'bg-warn-soft text-warn-ink')}>
                      {validQuantity ? `${sign > 0 ? '+' : '−'}${magnitude.toLocaleString('en-NG')}` : '±0'}
                    </span>
                    <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8"
                      strokeLinecap="round" strokeLinejoin="round" className="mt-1 text-ink-3"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                  </div>
                  <div className="min-w-0 text-right">
                    <p className="m-0 text-xs font-medium text-ink-3">After this</p>
                    <p className={cn('m-0 mt-0.5 truncate text-lg font-semibold tabular-nums',
                      after < 0 ? 'text-danger' : validQuantity ? 'text-ink' : 'text-ink-3')}>{stockQuantity(after, unit)}</p>
                  </div>
                  {after < 0 && (
                    <p className="col-span-3 m-0 text-xs text-danger">This would take stock below zero.</p>
                  )}
                </div>
              )}

              <FormField
                id="stock-reason"
                label={movementType === 'adjustment' ? 'Reason (required)' : 'Reason'}
                value={reason}
                onChange={setReason}
                placeholder={movementType === 'adjustment' ? 'e.g. 2 bottles broken, recount after stock-take' : 'Optional note'}
              />

              <Button type="submit" loading={saving} className="w-full">
                Record movement
              </Button>
            </Card>
          </form>

          <Card padded={false} className="min-w-0 self-start overflow-hidden lg:col-span-2" aria-labelledby="recent-movements-title">
            <div className="px-4 pb-3 pt-4 sm:px-5">
              <h2 id="recent-movements-title" className="m-0 text-[15px] font-semibold text-ink">Recent movements</h2>
              {selectedProduct && <p className="m-0 mt-0.5 truncate text-[13px] text-ink-3">{selectedProduct.name}</p>}
            </div>
            {movements.length === 0 ? (
              <p className="m-0 px-4 pb-5 text-sm text-ink-3 sm:px-5">No movements recorded yet.</p>
            ) : (
              <ul className="m-0 list-none divide-y divide-line border-t border-line p-0">
                {movements.map((m) => (
                  <li key={m.id} className="flex items-start justify-between gap-3 px-4 py-3 sm:px-5">
                    <div className="min-w-0">
                      <p className="m-0 text-sm font-medium text-ink">
                        {HISTORY_LABELS[m.movementType] ?? MOVEMENT_LABELS[m.movementType as AdjustmentMovementType] ?? m.movementType}
                      </p>
                      <p className="m-0 mt-0.5 truncate text-xs text-ink-3">{when(m.createdAt)}{m.reason ? ` · ${m.reason}` : ''}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={cn('m-0 text-sm font-semibold tabular-nums', m.quantity >= 0 ? 'text-success-ink' : 'text-ink-2')}>
                        {m.quantity >= 0 ? '+' : '−'}
                        {Math.abs(m.quantity)}
                      </p>
                      {Number.isFinite(m.quantityBefore) && Number.isFinite(m.quantityAfter) && (
                        <p className="m-0 mt-0.5 text-xs tabular-nums text-ink-3">{m.quantityBefore} → {m.quantityAfter}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </Page>
  );
}
