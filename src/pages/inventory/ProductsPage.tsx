import { useWorkspaceState } from '../../hooks/useWorkspaceState';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { ProductService } from '../../services/product.service';
import { CategoryService } from '../../services/category.service';
import { Card, Page, PageHeader, Pill, Stat, btn, cn, inputClass } from '../../components/kit';
import { ScanIcon, SearchIcon } from '../../components/icons';
import { stockQuantity } from '../../utils/business-activity';
import { PageLoader } from '../../components/ui/PageLoader';
import { SectionState } from '../../components/ui/StateBlock';
import { getBusinessExperience } from '../../config/businessExperience';
import { formatMoney } from '../../utils/format';
import { lineItemPlural } from '../../utils/business-language';
import { BarcodeScanner } from '../../components/BarcodeScanner';
import type { Product, ProductCategory } from '../../types';

export default function ProductsPage() {
  const { profile } = useAuth();
  const { hasPermission, loading: permsLoading } = usePermissions();
  const { category } = useBusinessContext();
  const experience = getBusinessExperience(category);
  const itemPlural = lineItemPlural(experience.terminology.lineItem);
  const [searchParams, setSearchParams] = useSearchParams();
  const storeId = profile?.currentStoreId;

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useWorkspaceState('products-category', '');
  const [lowStockOnly, setLowStockOnly] = useWorkspaceState('products-low-stock', false);
  const [scanning, setScanning] = useState(false);
  const [stockFilter, setStockFilter] = useState<'all' | 'out'>('all');
  // "Print labels": pick products, then print their barcode labels
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const navigate = useNavigate();
  const togglePick = (id: string) => setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const canCreate = hasPermission('product:create');
  const canAdjust = hasPermission('inventory:adjust');

  useEffect(() => {
    if (!storeId) return;
    CategoryService.getCategories(storeId).then(setCategories).catch(() => {});
  }, [storeId]);

  const loadProducts = useCallback(async () => {
    if (!storeId) {
      setLoading(false);
      setError('Choose a business workspace to view its inventory.');
      return;
    }
    setLoading(true);
    setError(null);
    setProducts([]);
    try {
      setProducts(await ProductService.getProducts(storeId, {
        search: search || undefined,
        categoryId: categoryId || undefined,
        lowStockOnly,
      }));
    } catch (err) {
      setError((err as Error)?.message ?? 'Failed to load products');
    } finally {
      setLoading(false);
    }
  }, [storeId, search, categoryId, lowStockOnly]);

  useEffect(() => { void loadProducts(); }, [loadProducts]);

  const categoryName = (id?: string) => categories.find((c) => c.id === id)?.name;

  useEffect(() => {
    if (searchParams.get('scan') !== '1') return;
    setScanning(true);
    const next = new URLSearchParams(searchParams);
    next.delete('scan');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  if (permsLoading) return <PageLoader />;

  const tracked = products.filter((p) => p.trackInventory);
  const outCount = tracked.filter((p) => p.stockQty <= 0).length;
  const lowCount = tracked.filter((p) => p.stockQty > 0 && p.stockQty <= p.reorderLevel).length;
  const stockValue = tracked.reduce((sum, p) => sum + Math.max(p.stockQty, 0) * p.costPrice, 0);
  const shown = stockFilter === 'out' ? products.filter((p) => p.trackInventory && p.stockQty <= 0) : products;
  const title = `${itemPlural[0].toUpperCase()}${itemPlural.slice(1)}`;
  const filtered = Boolean(search || categoryId || lowStockOnly || stockFilter === 'out');

  const stockBadge = (product: Product) => {
    if (!product.trackInventory) return <span className="text-xs text-ink-3">Not tracked</span>;
    const tone = product.stockQty <= 0 ? 'danger' : product.stockQty <= product.reorderLevel ? 'warn' : 'neutral';
    return <Pill tone={tone}>{stockQuantity(product.stockQty, product.unit)}</Pill>;
  };
  const margin = (product: Product) => product.sellingPrice > 0 && product.costPrice > 0
    ? Math.round(((product.sellingPrice - product.costPrice) / product.sellingPrice) * 100) : null;

  return (
    <Page>
      <PageHeader
        title={title}
        subtitle={loading ? 'Loading inventory…' : `${products.length} ${products.length === 1 ? 'item' : 'items'}`}
        actions={<>
          {canAdjust && <Link className={btn('outline')} to="/inventory/restock">Restock</Link>}
          <button type="button" className={btn(picking ? 'soft' : 'outline')} aria-pressed={picking} onClick={() => { setPicking(!picking); setPicked([]); }}>{picking ? 'Cancel labels' : 'Print labels'}</button>
          {canAdjust && <Link className={btn('outline')} to="/inventory/stock">Adjust stock</Link>}
          {canCreate && <Link className={btn('outline')} to="/inventory/products/bulk-import">Import</Link>}
          {canCreate && <Link className={btn('primary')} to="/inventory/products/new">Add {experience.terminology.lineItem.toLowerCase()}</Link>}
        </>}
      />

      {!loading && !error && products.length > 0 && !filtered && (
        <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Inventory summary">
          <Stat label="Items" value={products.length.toLocaleString('en-NG')} />
          <Stat label="Stock value (cost)" value={formatMoney(stockValue)} />
          <Stat label="Running low" value={lowCount} tone={lowCount ? 'warn' : undefined} />
          <Stat label="Out of stock" value={outCount} tone={outCount ? 'danger' : undefined} />
        </section>
      )}

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 gap-2">
          <div className="relative min-w-0 flex-1">
            <SearchIcon width={17} height={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
            <input type="search" className={cn(inputClass, 'pl-9')} aria-label={`Search ${itemPlural}`} placeholder="Search name, SKU or barcode"
              value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <button type="button" className={btn('outline')} onClick={() => setScanning(true)} aria-label="Scan a barcode to search"><ScanIcon width={17} height={17} /><span className="hidden sm:inline">Scan</span></button>
        </div>
        <div className="flex gap-2 overflow-x-auto">
          <select className={cn(inputClass, 'w-auto min-w-40')} aria-label="Filter by category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <div className="inline-flex shrink-0 rounded-lg bg-tray p-1" role="group" aria-label="Stock filter">
            {([['all', 'All'], ['low', 'Low stock'], ['out', 'Out of stock']] as const).map(([key, label]) => {
              const active = key === 'low' ? lowStockOnly : key === 'out' ? stockFilter === 'out' : !lowStockOnly && stockFilter !== 'out';
              return (
                <button key={key} type="button" aria-pressed={active}
                  className={cn('h-8 whitespace-nowrap rounded-md px-3 text-[13px] font-medium', active ? 'bg-surface text-ink shadow-card' : 'text-ink-2')}
                  onClick={() => { setLowStockOnly(key === 'low'); setStockFilter(key === 'out' ? 'out' : 'all'); }}>
                  {label}
                </button>
              );
            })}
          </div>
          <label className="sr-only" htmlFor="low-stock-only">
            <input id="low-stock-only" type="checkbox" checked={lowStockOnly} onChange={(e) => setLowStockOnly(e.target.checked)} />
            Low stock only
          </label>
        </div>
      </div>

      {scanning && (
        <BarcodeScanner onDetect={(value) => { setSearch(value); setScanning(false); }} onClose={() => setScanning(false)} />
      )}

      <SectionState
        loading={loading}
        error={error}
        onRetry={loadProducts}
        empty={shown.length === 0}
        emptyTitle={filtered ? 'No matching inventory' : `No ${itemPlural} yet`}
        emptyBody={filtered ? 'Clear or change the filters to see more results.' : `Add the first ${experience.terminology.lineItem.toLowerCase()} to start tracking ${experience.terminology.stock.toLowerCase()}.`}
        emptyActions={!filtered && canCreate ? <Link className={btn('primary', 'sm')} to="/inventory/products/new">Add {experience.terminology.lineItem.toLowerCase()}</Link> : undefined}
      >
        <Card padded={false} className="overflow-hidden">
          <div className="hidden grid-cols-[minmax(0,2.4fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1.1fr)] gap-4 border-b border-line bg-subtle px-5 py-2.5 text-xs font-semibold uppercase tracking-[.06em] text-ink-3 md:grid">
            <span>{experience.terminology.lineItem}</span><span>Category</span><span className="text-right">Price</span><span className="text-right">Margin</span><span className="text-right">In stock</span>
          </div>
          <ul className="m-0 list-none divide-y divide-line p-0">
            {shown.map((product) => {
              const m = margin(product);
              return (
                <li key={product.id} className="flex items-center">
                  {picking && (
                    <label className="flex h-full shrink-0 cursor-pointer items-center pl-4 sm:pl-5">
                      <input type="checkbox" className="size-5 accent-brand" checked={picked.includes(product.id)} onChange={() => togglePick(product.id)} aria-label={`Pick ${product.name} for labels`} />
                    </label>
                  )}
                  <Link to={`/inventory/products/${product.id}`} onClick={(e) => { if (picking) { e.preventDefault(); togglePick(product.id); } }}
                    className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3 text-inherit no-underline transition-colors hover:bg-subtle sm:px-5 md:grid-cols-[minmax(0,2.4fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1.1fr)]">
                    <span className="flex min-w-0 items-center gap-3">
                      {product.imageUrl
                        ? <img src={product.imageUrl} alt="" className="size-10 shrink-0 rounded-lg object-cover" />
                        : <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-tray text-sm font-semibold text-ink-3" aria-hidden="true">{product.name.charAt(0).toUpperCase()}</span>}
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-ink">{product.name}</span>
                        <span className="block truncate text-xs text-ink-3">SKU {product.sku}<span className="md:hidden">{categoryName(product.categoryId) ? ` · ${categoryName(product.categoryId)}` : ''}</span></span>
                      </span>
                    </span>
                    <span className="hidden truncate text-sm text-ink-2 md:block">{categoryName(product.categoryId) ?? '—'}</span>
                    <span className="text-right text-sm font-semibold tabular-nums text-ink md:font-medium">{formatMoney(product.sellingPrice)}</span>
                    <span className="hidden text-right text-sm tabular-nums text-ink-2 md:block">{m === null ? '—' : `${m}%`}</span>
                    <span className="col-start-2 row-start-2 text-right md:col-auto md:row-auto">{stockBadge(product)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      </SectionState>

      {picking && (
        <div className="sticky bottom-[calc(76px+env(safe-area-inset-bottom))] z-20 mt-4 flex items-center justify-between gap-3 rounded-xl border border-line bg-surface p-3 shadow-card lg:bottom-4">
          <span className="text-sm text-ink-2">{picked.length ? `${picked.length} picked` : 'Tick the products to label'}</span>
          <button type="button" className={btn('primary')} disabled={!picked.length} onClick={() => navigate(`/inventory/labels?ids=${picked.join(',')}`)}>Print labels</button>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[13px]">
        <Link className="tap font-semibold text-brand-ink no-underline" to="/inventory/categories">Manage categories</Link>
        <Link className="tap font-semibold text-brand-ink no-underline" to="/inventory/lots">Batches and expiry</Link>
      </div>
    </Page>
  );
}
