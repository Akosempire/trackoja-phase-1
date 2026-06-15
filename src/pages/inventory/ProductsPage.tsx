import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { ProductService } from '../../services/product.service';
import { CategoryService } from '../../services/category.service';
import { Button } from '../../components/ui/Button';
import { PageLoader } from '../../components/ui/PageLoader';
import { BarcodeScanner } from '../../components/BarcodeScanner';
import type { Product, ProductCategory } from '../../types';

export default function ProductsPage() {
  const { profile } = useAuth();
  const { hasPermission, loading: permsLoading } = usePermissions();
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

  useEffect(() => {
    if (!storeId) return;
    setLoading(true);
    ProductService.getProducts(storeId, {
      search: search || undefined,
      categoryId: categoryId || undefined,
      lowStockOnly,
    })
      .then(setProducts)
      .catch((err) => setError(err.message ?? 'Failed to load products'))
      .finally(() => setLoading(false));
  }, [storeId, search, categoryId, lowStockOnly]);

  const categoryName = (id?: string) => categories.find((c) => c.id === id)?.name;

  if (permsLoading) return <PageLoader />;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Products</h1>
          <p className="page-subtitle">{products.length} item{products.length === 1 ? '' : 's'}</p>
        </div>
        {canCreate && (
          <Link to="/inventory/products/new">
            <Button className="btn-sm">Add product</Button>
          </Link>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="btn-row search-input">
        <div style={{ flex: 1, minWidth: 0 }}>
          <input
            className="form-input"
            placeholder="Search by name, SKU, or barcode"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button type="button" variant="ghost" className="btn-sm" onClick={() => setScanning(true)}>
          Scan
        </Button>
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

      <div className="form-group">
        <select className="select-input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="checkbox-row">
        <input
          id="low-stock-only"
          type="checkbox"
          checked={lowStockOnly}
          onChange={(e) => setLowStockOnly(e.target.checked)}
        />
        <label htmlFor="low-stock-only">Low stock only</label>
      </div>

      {loading ? (
        <PageLoader />
      ) : products.length === 0 ? (
        <div className="empty-state">No products found.</div>
      ) : (
        <div className="list">
          {products.map((product) => {
            const isLowStock = product.trackInventory && product.stockQty <= product.reorderLevel;
            return (
              <Link key={product.id} to={`/inventory/products/${product.id}`} className="list-item">
                <div>
                  <p className="list-item-title">{product.name}</p>
                  <p className="list-item-subtitle">
                    SKU {product.sku}
                    {categoryName(product.categoryId) ? ` · ${categoryName(product.categoryId)}` : ''}
                  </p>
                </div>
                <div className="list-item-meta">
                  <span className={`badge ${isLowStock ? 'badge-warning' : 'badge-default'}`}>
                    {product.trackInventory ? `${product.stockQty} ${product.unit}` : 'No tracking'}
                  </span>
                  <span className="list-item-subtitle">₦{product.sellingPrice.toLocaleString()}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {canAdjust && (
        <div className="btn-row" style={{ marginTop: 16 }}>
          <Link to="/inventory/stock">
            <Button variant="ghost" className="btn-sm">
              Adjust stock
            </Button>
          </Link>
        </div>
      )}
    </div>
  );
}
