import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../../contexts/AuthContext';
import { usePermissions } from '../../../hooks/usePermissions';
import { RestockService, REORDER_KEY, type LowStockRow } from '../../../services/restock.service';
import { Button } from '../../../components/ui/Button';
import { PageLoader } from '../../../components/ui/PageLoader';
import { Card, Empty, Page, PageHeader, Pill, cn } from '../../../components/kit';
import { lowStockState } from '../../../utils/restock';
import { stockQuantity } from '../../../utils/business-activity';
import { formatDate, formatMoney } from '../../../utils/format';
import { RestockNav } from './RestockNav';

/**
 * /inventory/low-stock: products at or below their reorder level, most urgent
 * first. Reorder starts a delivery with the ticked products, the suggested
 * quantities and their usual supplier.
 */
export default function LowStockPage() {
  const { profile } = useAuth();
  const { hasPermission } = usePermissions();
  const navigate = useNavigate();
  const storeId = profile?.currentStoreId ?? '';
  const [rows, setRows] = useState<LowStockRow[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!storeId) return;
    RestockService.lowStock(storeId).then((r) => { setRows(r); setPicked(new Set(r.map((x) => x.productId))); }).catch((e) => { setError(e.message); setRows([]); });
  }, [storeId]);
  if (!rows) return <PageLoader />;

  function reorder() {
    const chosen = rows!.filter((r) => picked.has(r.productId));
    // one supplier at a time: the most common usual supplier among the ticked
    const tally = new Map<string, number>();
    chosen.forEach((r) => r.supplierId && tally.set(r.supplierId, (tally.get(r.supplierId) ?? 0) + 1));
    const supplierId = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    try {
      sessionStorage.setItem(REORDER_KEY, JSON.stringify({ supplierId, lines: chosen.map((r) => ({ productId: r.productId, quantity: r.suggestedQty, unitCost: r.lastUnitCost })) }));
    } catch { /* storage blocked: open an empty delivery */ }
    navigate('/inventory/receive');
  }
  const canReorder = hasPermission('purchase:create') && hasPermission('inventory:adjust');
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <Page>
      <PageHeader title="Low stock" subtitle={rows.length ? `${rows.length} product${rows.length === 1 ? '' : 's'} at or below reorder level` : 'Products at or below their reorder level'}
        actions={canReorder && rows.length ? <Button onClick={reorder} disabled={!picked.size}>Reorder {picked.size ? `(${picked.size})` : ''}</Button> : undefined} />
      <RestockNav />
      {error && <p className="mb-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">{error}</p>}
      <Card padded={false} className="overflow-hidden">
        {rows.length ? (
          <ul className="m-0 list-none divide-y divide-line p-0">
            {rows.map((r) => {
              const state = lowStockState(r.stockQty, r.reorderLevel);
              return (
                <li key={r.productId} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  {canReorder && <input type="checkbox" className="size-4 shrink-0" checked={picked.has(r.productId)} onChange={() => toggle(r.productId)} aria-label={`Reorder ${r.name}`} />}
                  <Link to={`/inventory/products/${r.productId}`} className="min-w-0 flex-1 text-inherit no-underline">
                    <span className="block truncate text-sm font-medium text-ink">{r.name}</span>
                    <span className="block truncate text-xs text-ink-3">{stockQuantity(r.stockQty, r.unit)} left · reorder at {r.reorderLevel}{r.supplierName ? ` · ${r.supplierName}` : ''}{r.lastPurchasedOn ? ` · last ${formatDate(r.lastPurchasedOn)}` : ''}</span>
                  </Link>
                  <span className="hidden shrink-0 text-right text-xs text-ink-3 sm:block">Order {r.suggestedQty}<span className="block">{formatMoney(r.suggestedQty * r.lastUnitCost)}</span></span>
                  <Pill tone={state === 'out' ? 'danger' : 'warn'}>{state === 'out' ? 'Out' : 'Low'}</Pill>
                </li>
              );
            })}
          </ul>
        ) : <div className="p-4"><Empty title="Nothing is running low" body="Set a reorder level on a product to be warned before it runs out." /></div>}
      </Card>
      <p className={cn('mt-3 text-xs text-ink-3', !rows.length && 'hidden')}>Suggested order tops each product back up to twice its reorder level.</p>
    </Page>
  );
}
