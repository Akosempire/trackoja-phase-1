import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { ProductService } from '../../services/product.service';
import { CategoryService } from '../../services/category.service';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { PageLoader } from '../../components/ui/PageLoader';
import { BarcodeScanner } from '../../components/BarcodeScanner';
import type { ProductCategory } from '../../types';

export default function ProductFormPage() {
  const { productId } = useParams<{ productId: string }>();
  const isNew = !productId || productId === 'new';
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { hasPermission } = usePermissions();
  const storeId = profile?.currentStoreId;

  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [barcode, setBarcode] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [unit, setUnit] = useState('pcs');
  const [costPrice, setCostPrice] = useState('0');
  const [sellingPrice, setSellingPrice] = useState('0');
  const [taxRate, setTaxRate] = useState('0');
  const [trackInventory, setTrackInventory] = useState(true);
  const [stockQty, setStockQty] = useState('0');
  const [reorderLevel, setReorderLevel] = useState('0');
  const [status, setStatus] = useState<'active' | 'inactive' | 'archived'>('active');
  const [scanning, setScanning] = useState(false);

  const canUpdate = hasPermission('product:update');
  const canDelete = hasPermission('product:delete');

  useEffect(() => {
    if (!storeId) return;
    CategoryService.getCategories(storeId).then(setCategories).catch(() => {});
  }, [storeId]);

  useEffect(() => {
    if (isNew || !productId) return;
    setLoading(true);
    ProductService.getProduct(productId)
      .then((product) => {
        setName(product.name);
        setSku(product.sku);
        setBarcode(product.barcode ?? '');
        setDescription(product.description ?? '');
        setCategoryId(product.categoryId ?? '');
        setUnit(product.unit);
        setCostPrice(String(product.costPrice));
        setSellingPrice(String(product.sellingPrice));
        setTaxRate(String(product.taxRate));
        setTrackInventory(product.trackInventory);
        setStockQty(String(product.stockQty));
        setReorderLevel(String(product.reorderLevel));
        setStatus(product.status);
      })
      .catch((err) => setError(err.message ?? 'Failed to load product'))
      .finally(() => setLoading(false));
  }, [isNew, productId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storeId || !user) return;

    setSaving(true);
    setError(null);
    try {
      if (isNew) {
        const product = await ProductService.createProduct(storeId, user.id, {
          name,
          sku,
          barcode: barcode || undefined,
          description: description || undefined,
          categoryId: categoryId || undefined,
          unit,
          costPrice: Number(costPrice) || 0,
          sellingPrice: Number(sellingPrice) || 0,
          taxRate: Number(taxRate) || 0,
          trackInventory,
          stockQty: Number(stockQty) || 0,
          reorderLevel: Number(reorderLevel) || 0,
        });
        navigate(`/inventory/products/${product.id}`, { replace: true });
      } else if (productId) {
        await ProductService.updateProduct(productId, {
          name,
          sku,
          barcode: barcode || undefined,
          description: description || undefined,
          categoryId: categoryId || null,
          unit,
          costPrice: Number(costPrice) || 0,
          sellingPrice: Number(sellingPrice) || 0,
          taxRate: Number(taxRate) || 0,
          trackInventory,
          reorderLevel: Number(reorderLevel) || 0,
          status,
        });
        navigate('/inventory/products');
      }
    } catch (err: any) {
      setError(err.message ?? 'Failed to save product');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!productId || isNew) return;
    if (!confirm('Permanently delete this product? This cannot be undone.')) return;
    setError(null);
    try {
      await ProductService.deleteProduct(productId);
      navigate('/inventory/products');
    } catch (err: any) {
      setError(err.message ?? 'Failed to delete product');
    }
  };

  if (loading) return <PageLoader />;

  const readOnly = !isNew && !canUpdate;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{isNew ? 'Add product' : 'Edit product'}</h1>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <form className="card" onSubmit={handleSubmit}>
        <FormField id="product-name" label="Name" value={name} onChange={setName} required />
        <div className="auth-form-row">
          <FormField id="product-sku" label="SKU" value={sku} onChange={setSku} required />
          <FormField id="product-barcode" label="Barcode" value={barcode} onChange={setBarcode} placeholder="Optional" />
        </div>
        {!readOnly && (
          <div className="btn-row" style={{ marginBottom: 12 }}>
            <Button type="button" variant="ghost" className="btn-sm" onClick={() => setScanning(true)}>
              Scan barcode
            </Button>
          </div>
        )}
        {scanning && (
          <BarcodeScanner
            onDetect={(value) => {
              setBarcode(value);
              setScanning(false);
            }}
            onClose={() => setScanning(false)}
          />
        )}
        <FormField
          id="product-description"
          label="Description"
          value={description}
          onChange={setDescription}
          placeholder="Optional"
        />

        <div className="form-group">
          <label className="form-label" htmlFor="product-category">
            Category
          </label>
          <select
            id="product-category"
            className="select-input"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">Uncategorized</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="auth-form-row">
          <FormField id="product-cost-price" label="Cost price" type="number" value={costPrice} onChange={setCostPrice} />
          <FormField
            id="product-selling-price"
            label="Selling price"
            type="number"
            value={sellingPrice}
            onChange={setSellingPrice}
            required
          />
        </div>

        <div className="auth-form-row">
          <FormField id="product-unit" label="Unit" value={unit} onChange={setUnit} placeholder="pcs, kg, litre..." />
          <FormField id="product-tax-rate" label="Tax rate (%)" type="number" value={taxRate} onChange={setTaxRate} />
        </div>

        <div className="checkbox-row">
          <input
            id="track-inventory"
            type="checkbox"
            checked={trackInventory}
            onChange={(e) => setTrackInventory(e.target.checked)}
          />
          <label htmlFor="track-inventory">Track inventory for this product</label>
        </div>

        {trackInventory && (
          <div className="auth-form-row">
            {isNew && (
              <FormField id="product-stock-qty" label="Initial stock" type="number" value={stockQty} onChange={setStockQty} />
            )}
            <FormField
              id="product-reorder-level"
              label="Reorder level"
              type="number"
              value={reorderLevel}
              onChange={setReorderLevel}
            />
          </div>
        )}

        {!isNew && (
          <div className="form-group">
            <label className="form-label" htmlFor="product-status">
              Status
            </label>
            <select
              id="product-status"
              className="select-input"
              value={status}
              onChange={(e) => setStatus(e.target.value as 'active' | 'inactive' | 'archived')}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="archived">Archived</option>
            </select>
          </div>
        )}

        {!readOnly && (
          <div className="btn-row">
            <Button type="submit" loading={saving} className="btn-sm">
              {isNew ? 'Add product' : 'Save changes'}
            </Button>
            {!isNew && canDelete && (
              <Button type="button" variant="ghost" className="btn-sm" onClick={handleDelete}>
                Delete
              </Button>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
