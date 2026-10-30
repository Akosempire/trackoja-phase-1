import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { usePermissions } from '../../../hooks/usePermissions';
import { CategoryService } from '../../../services/category.service';
import { RestockService, type StockCount, type StockCountLine } from '../../../services/restock.service';
import { BarcodeScanner } from '../../../components/BarcodeScanner';
import { Button } from '../../../components/ui/Button';
import { Dialog } from '../../../components/ui/Dialog';
import { PageLoader } from '../../../components/ui/PageLoader';
import { StateBlock } from '../../../components/ui/StateBlock';
import { useToast } from '../../../components/ui/Toast';
import { ScanIcon } from '../../../components/icons';
import { Card, CardHead, Empty, Page, PageHeader, Pill, cn, inputClass } from '../../../components/kit';
import { countDifference, countSummary, findByCode } from '../../../utils/restock';
import { formatDate, formatMoney } from '../../../utils/format';
import type { ProductCategory } from '../../../types';
import { Labelled, signedMoney } from './shared';
import { stockQuantity } from '../../../utils/business-activity';
import { RestockNav } from './RestockNav';

/**
 * /inventory/count: count the shelf, see what's different, fix it in one go.
 * Each count is saved as you type, so it survives a refresh or a phone call.
 * Applying moves stock by (counted - what the system had when the count
 * started), so sales made while you count aren't undone.
 */
export default function StockCountPage() {
  const { profile } = useAuth();
  const { hasPermission } = usePermissions();
  const toast = useToast();
  const storeId = profile?.currentStoreId ?? '';
  const [count, setCount] = useState<StockCount | null | undefined>(undefined);
  const [lines, setLines] = useState<StockCountLine[]>([]);
  const [past, setPast] = useState<StockCount[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [category, setCategory] = useState('');
  const [filter, setFilter] = useState<'all' | 'todo' | 'diff'>('all');
  const [search, setSearch] = useState('');
  const [scan, setScan] = useState(false);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const canAdjust = hasPermission('inventory:adjust');

  const load = useCallback(async () => {
    if (!storeId) return;
    const open = await RestockService.openCount(storeId).catch(() => null);
    setCount(open);
    setLines(open ? await RestockService.countLines(open.id) : []);
    setPast(await RestockService.pastCounts(storeId).catch(() => []));
  }, [storeId]);
  useEffect(() => { void load(); CategoryService.getCategories(storeId).then(setCategories).catch(() => setCategories([])); }, [load, storeId]);

  const summary = useMemo(() => countSummary(lines), [lines]);
  const shown = useMemo(() => {
    const s = search.trim().toLowerCase();
    return lines.filter((l) => (!s || l.name.toLowerCase().includes(s) || l.sku.toLowerCase().includes(s) || (l.barcode ?? '').toLowerCase() === s)
      && (filter === 'all' || (filter === 'todo' ? l.counted === null : countDifference(l).qty !== 0)));
  }, [lines, search, filter]);

  async function start() {
    setBusy(true);
    try { await RestockService.startCount(storeId, category || null); await load(); }
    catch (e) { toast.error('Count not started', { description: e instanceof Error ? e.message : '' }); }
    finally { setBusy(false); }
  }
  async function setCounted(l: StockCountLine, raw: string) {
    const v = raw.trim() === '' ? null : Number(raw);
    if (v !== null && (Number.isNaN(v) || v < 0)) return;
    setLines((ls) => ls.map((x) => (x.productId === l.productId ? { ...x, counted: v } : x)));
    try { await RestockService.setCounted(count!.id, l.productId, v); }
    catch (e) { toast.error('Not saved', { description: e instanceof Error ? e.message : '' }); }
  }
  async function apply() {
    setBusy(true);
    try {
      const r = await RestockService.applyCount(count!.id);
      toast.success('Stock updated', { description: `${r.changed} product${r.changed === 1 ? '' : 's'} corrected.` });
      setReview(false); await load();
    } catch (e) { toast.error('Not applied', { description: e instanceof Error ? e.message : '' }); }
    finally { setBusy(false); }
  }
  async function cancel() {
    if (!count) return;
    await RestockService.cancelCount(count.id).catch(() => undefined);
    await load();
  }
  const focusCode = (code: string) => {
    const l = findByCode(lines, code);
    if (!l) { toast.error('Not in this count', { description: code }); return; }
    setSearch(''); setFilter('all');
    setTimeout(() => { inputs.current[l.productId]?.focus(); inputs.current[l.productId]?.select(); }, 50);
  };

  if (count === undefined) return <PageLoader />;
  if (!hasPermission('inventory:view')) return <Page width="form"><Card><StateBlock variant="denied" title="You can't see stock" /></Card></Page>;

  return (
    <Page>
      <PageHeader title="Stock count" subtitle={count ? `${count.scopeLabel} · started ${formatDate(count.startedAt)}` : 'Count what is on the shelf and fix the numbers in one go'}
        actions={count && canAdjust ? <><Button variant="ghost" onClick={cancel}>Cancel count</Button><Button onClick={() => setReview(true)} disabled={!summary.counted}>Review & apply</Button></> : undefined} />
      <RestockNav />
      {!count ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-6">
          <Card>
            <CardHead title="Start a count" hint="Products tracked by batch are counted in Stock & Batches." />
            {canAdjust ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <Labelled label="What to count" className="flex-1">
                  <select className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)}>
                    <option value="">All products</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </Labelled>
                <Button onClick={start} loading={busy}>Start counting</Button>
              </div>
            ) : <p className="m-0 text-sm text-ink-3">Ask a manager to start a count.</p>}
          </Card>
          <Card padded={false} className="overflow-hidden">
            <div className="px-4 pt-4 sm:px-5"><CardHead title="Past counts" /></div>
            {past.length ? (
              <ul className="m-0 list-none divide-y divide-line border-t border-line p-0">
                {past.map((c) => <li key={c.id} className="flex items-center justify-between px-4 py-2.5 text-sm sm:px-5"><span>{c.scopeLabel}<span className="block text-xs text-ink-3">{formatDate(c.finishedAt ?? c.startedAt)}</span></span><Pill tone={c.status === 'applied' ? 'success' : 'neutral'}>{c.status === 'applied' ? 'Applied' : 'Cancelled'}</Pill></li>)}
              </ul>
            ) : <p className="m-0 border-t border-line px-4 py-4 text-sm text-ink-3 sm:px-5">None yet.</p>}
          </Card>
        </div>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-line bg-surface p-3 shadow-card"><p className="m-0 text-xs text-ink-3">Counted</p><p className="m-0 mt-1 text-lg font-semibold tabular-nums">{summary.counted} / {summary.total}</p></div>
            <div className="rounded-xl border border-line bg-surface p-3 shadow-card"><p className="m-0 text-xs text-ink-3">Different</p><p className="m-0 mt-1 text-lg font-semibold tabular-nums">{summary.changed}</p></div>
            <div className="rounded-xl border border-line bg-surface p-3 shadow-card"><p className="m-0 text-xs text-ink-3">Value change</p><p className={cn('m-0 mt-1 truncate text-lg font-semibold tabular-nums', summary.net < 0 ? 'text-danger' : 'text-ink')}>{signedMoney(summary.net, formatMoney)}</p></div>
          </div>
          <Card padded={false} className="overflow-hidden">
            <div className="flex flex-col gap-2 border-b border-line p-3 sm:flex-row sm:items-center sm:p-4">
              <div className="flex min-w-0 flex-1 gap-2">
                <input className={cn(inputClass, 'flex-1')} placeholder="Find a product or type a barcode" value={search} onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && search.trim()) focusCode(search); }} aria-label="Find a product" />
                <button type="button" onClick={() => setScan(true)} className="inline-flex h-10 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-3 text-sm font-semibold" aria-label="Scan"><ScanIcon width={18} height={18} /></button>
              </div>
              <div className="inline-flex gap-1 rounded-lg bg-tray p-1">
                {([['all', 'All'], ['todo', 'Not counted'], ['diff', 'Different']] as const).map(([k, l]) => (
                  <button key={k} onClick={() => setFilter(k)} className={cn('h-8 rounded-md px-3 text-[13px] font-medium', filter === k ? 'bg-surface text-ink shadow-card ring-1 ring-line' : 'text-ink-2')}>{l}</button>
                ))}
              </div>
            </div>
            {shown.length ? (
              <ul className="m-0 list-none divide-y divide-line p-0">
                {shown.map((l) => {
                  const d = countDifference(l);
                  return (
                    <li key={l.productId} className="flex items-center gap-3 px-3 py-2.5 sm:px-5">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">{l.name}</span>
                        <span className="block text-xs text-ink-3">System: {stockQuantity(l.expected, l.unit)}{d.qty !== 0 && <span className={d.qty < 0 ? 'text-danger' : 'text-success-ink'}> · {d.qty > 0 ? '+' : ''}{d.qty} ({signedMoney(d.value, formatMoney)})</span>}</span>
                      </span>
                      <span className="w-24 shrink-0"><input ref={(el) => { inputs.current[l.productId] = el; }} type="number" inputMode="decimal" min={0} step="any" disabled={!canAdjust}
                        defaultValue={l.counted ?? ''} key={`${l.productId}-${l.counted}`} aria-label={`Counted ${l.name}`} placeholder="Count"
                        onBlur={(e) => { if ((e.target.value === '' ? null : Number(e.target.value)) !== l.counted) void setCounted(l, e.target.value); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                        className={cn(inputClass, 'text-right tabular-nums', l.counted !== null && 'border-brand/60 bg-brand-soft/40')} /></span>
                    </li>
                  );
                })}
              </ul>
            ) : <div className="p-4"><Empty title={lines.length ? 'Nothing matches' : 'No products to count'} /></div>}
          </Card>
        </>
      )}
      {scan && <BarcodeScanner onClose={() => setScan(false)} onDetect={(c) => { setScan(false); focusCode(c); }} />}
      <Dialog open={review} onClose={() => setReview(false)} title="Apply this count?" wide
        description={`${summary.changed} product${summary.changed === 1 ? '' : 's'} will change. Products you didn't count stay as they are.`}
        footer={<><Button variant="ghost" onClick={() => setReview(false)}>Keep counting</Button><Button onClick={apply} loading={busy}>Apply to stock</Button></>}>
        <dl className="m-0 mb-3 grid grid-cols-3 gap-2 text-sm">
          <div><dt className="text-xs text-ink-3">Missing</dt><dd className="m-0 font-semibold text-danger tabular-nums">{formatMoney(summary.missingValue)}</dd></div>
          <div><dt className="text-xs text-ink-3">Extra found</dt><dd className="m-0 font-semibold tabular-nums">{formatMoney(summary.extraValue)}</dd></div>
          <div><dt className="text-xs text-ink-3">Net</dt><dd className="m-0 font-semibold tabular-nums">{signedMoney(summary.net, formatMoney)}</dd></div>
        </dl>
        <ul className="m-0 max-h-72 list-none divide-y divide-line overflow-y-auto p-0">
          {lines.filter((l) => countDifference(l).qty !== 0).map((l) => { const d = countDifference(l); return (
            <li key={l.productId} className="flex justify-between gap-3 py-2 text-sm"><span className="min-w-0 truncate">{l.name}</span><span className={cn('shrink-0 tabular-nums', d.qty < 0 ? 'text-danger' : 'text-success-ink')}>{l.expected} → {l.counted} ({d.qty > 0 ? '+' : ''}{d.qty})</span></li>
          ); })}
        </ul>
      </Dialog>
    </Page>
  );
}
