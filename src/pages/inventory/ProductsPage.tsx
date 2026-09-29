import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { ProductService } from '../../services/product.service';
import { CategoryService } from '../../services/category.service';
import { Button } from '../../components/ui/Button';
import { SearchInput } from '../../components/ui/SearchInput';
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
  const [categoryId, setCategoryId] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [scanning, setScanning] = useState(false);

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

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{itemPlural[0].toUpperCase()}{itemPlural.slice(1)}</h1>
          <p className="page-subtitle">{loading ? 'Loading inventory…' : `${products.length} ${products.length === 1 ? 'item' : 'items'}`}</p>
        </div>
        {canCreate && (
          <div className="btn-row product-page-actions">
            <Link className="btn btn-primary btn-sm" to="/inventory/products/new">Add {experience.terminology.lineItem.toLowerCase()}</Link>
            <Link className="btn btn-outline btn-sm" to="/inventory/products/bulk-import">Bulk import</Link>
          </div>
        )}
      </div>

      <div className="product-filters">
        <div className="control-row search-input-row">
          <SearchInput
            aria-label={`Search ${itemPlural}`}
            placeholder="Search by name, SKU, or barcode"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button type="button" variant="outline" onClick={() => setScanning(true)}>Scan</Button>
        </div>

        <select className="select-input" aria-label="Filter by category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        <label className="checkbox-row" htmlFor="low-stock-only">
          <input id="low-stock-only" type="checkbox" checked={lowStockOnly} onChange={(e) => setLowStockOnly(e.target.checked)} />
          Low stock only
        </label>
      </div>

      {scanning && (
        <BarcodeScanner
          onDetect={(value) => {
            setSearch(value);
            setScanning(false);
          }}
          onClose={() => setScanning(false)}
        />
      )}

      <SectionState
        loading={loading}
        error={error}
        onRetry={loadProducts}
        empty={products.length === 0}
        emptyTitle={search || categoryId || lowStockOnly ? 'No matching inventory' : `No ${itemPlural} yet`}
        emptyBody={search || categoryId || lowStockOnly ? 'Clear or change the filters to see more results.' : `Add the first ${experience.terminology.lineItem.toLowerCase()} to start tracking ${experience.terminology.stock.toLowerCase()}.`}
        emptyActions={!search && !categoryId && !lowStockOnly && canCreate ? <Link className="btn btn-primary btn-sm" to="/inventory/products/new">Add {experience.terminology.lineItem.toLowerCase()}</Link> : null}
      >
        <div className="list">
          {products.map((product) => {
            const isLowStock = product.trackInventory && product.stockQty <= product.reorderLevel;
            return (
              <Link key={product.id} to={`/inventory/products/${product.id}`} className="list-item">
                <div className="list-item-leading">
                  {product.imageUrl ? (
                    <img src={product.imageUrl} alt="" className="list-item-image" />
                  ) : (
                    <div className="list-item-image-placeholder">{product.name.charAt(0).toUpperCase()}</div>
                  )}
                  <div>
                    <p className="list-item-title">{product.name}</p>
                    <p className="list-item-subtitle">
                      SKU {product.sku}
                      {categoryName(product.categoryId) ? ` · ${categoryName(product.categoryId)}` : ''}
                    </p>
                  </div>
                </div>
                <div className="list-item-meta">
                  <span className={`badge ${isLowStock ? 'badge-warning' : 'badge-default'}`}>
                    {product.trackInventory ? `${product.stockQty} ${product.unit}` : 'No tracking'}
                  </span>
                  <span className="list-item-subtitle">{formatMoney(product.sellingPrice)}</span>
                </div>
              </Link>
            );
          })}
        </div>
      </SectionState>

      {canAdjust && (
        <div className="btn-row" style={{ marginTop: 16 }}>
          <Link className="btn btn-ghost btn-sm" to="/inventory/stock">Adjust stock</Link>
        </div>
      )}
    </div>
  );
}
