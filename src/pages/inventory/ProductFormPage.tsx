import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { ProductService } from '../../services/product.service';
import { CategoryService } from '../../services/category.service';
import { StorageService, PRODUCT_IMAGE_ACCEPT, PRODUCT_IMAGE_MAX_BYTES } from '../../services/storage.service';
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
  const [imageUrl, setImageUrl] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [piecesPerUnit, setPiecesPerUnit] = useState('');
  const imageInputRef = useRef<HTMLInputElement>(null);

  const { config } = useBusinessContext();
  const [attributes, setAttributes] = useState<Record<string, string>>({});

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
        setImageUrl(product.imageUrl ?? '');
        setAttributes(product.attributes ?? {});
        setPiecesPerUnit(product.attributes?.pieces_per_unit ?? '');
      })
      .catch((err) => setError(err.message ?? 'Failed to load product'))
      .finally(() => setLoading(false));
  }, [isNew, productId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storeId || !user) return;

    setSaving(true);
    setError(null);
    const formAttributes = { ...attributes, ...(piecesPerUnit.trim() ? { pieces_per_unit: piecesPerUnit.trim() } : {}) };
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
          imageUrl: imageUrl || undefined,
          attributes: formAttributes,
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
          imageUrl: imageUrl || undefined,
          attributes: formAttributes,
        });
        navigate('/inventory/products');
      }
    } catch (err: any) {
      setError(err.message ?? 'Failed to save product');
    } finally {
      setSaving(false);
    }
  };

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !storeId) return;

    if (file.size > PRODUCT_IMAGE_MAX_BYTES) {
      setError('Image is too large. Maximum size is 5MB.');
      return;
    }

    setUploadingImage(true);
    setError(null);
    try {
      const url = await StorageService.uploadProductImage(storeId, file);
      setImageUrl(url);
    } catch (err: any) {
      setError(err.message ?? 'Failed to upload image');
    } finally {
      setUploadingImage(false);
      if (imageInputRef.current) imageInputRef.current.value = '';
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
    <div className="page page-form product-form-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{isNew ? 'Add product' : 'Edit product'}</h1>
          <p className="page-subtitle">
            {isNew
              ? 'Create a new product and configure its pricing, category and stock details.'
              : 'Update this product\u2019s details, pricing and stock.'}
          </p>
        </div>
        {!readOnly && (
          <div className="btn-row">
            <Button type="button" variant="outline" className="btn-sm" onClick={() => navigate('/inventory/products')}>
              Cancel
            </Button>
            <Button type="submit" form="product-form" loading={saving}>
              {isNew ? 'Add product' : 'Save changes'}
            </Button>
          </div>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <form id="product-form" className="product-form" onSubmit={handleSubmit}>
        <section className="product-form-section" aria-labelledby="media-title">
          <h2 className="product-form-section-title" id="media-title">Product media</h2>
          <p className="product-form-section-sub">A clear photo helps you recognise the product at a glance.</p>
          <div className="product-image-row">
            {imageUrl ? (
              <img src={imageUrl} alt="" className="product-image-preview" />
            ) : (
              <div className="product-image-placeholder">{(name || '?').charAt(0).toUpperCase()}</div>
            )}
            {!readOnly && (
              <div className="btn-row">
                <Button type="button" variant="outline" className="btn-sm" loading={uploadingImage} onClick={() => imageInputRef.current?.click()}>
                  {imageUrl ? 'Replace photo' : 'Upload photo'}
                </Button>
                {imageUrl && (
                  <Button type="button" variant="ghost" className="btn-sm" onClick={() => setImageUrl('')}>Remove</Button>
                )}
              </div>
            )}
            <input ref={imageInputRef} type="file" accept={PRODUCT_IMAGE_ACCEPT} onChange={handleImageChange} style={{ display: 'none' }} />
          </div>
          <p className="form-hint">PNG or JPG, up to 5 MB.</p>
        </section>

        <section className="product-form-section" aria-labelledby="basic-title">
          <h2 className="product-form-section-title" id="basic-title">Basic information</h2>
          <FormField id="product-name" label="Product name" value={name} onChange={setName} required placeholder="e.g. Indomie Chicken 70g" />
          <FormField id="product-description" label="Description (optional)" value={description} onChange={setDescription} placeholder="Short description shown on receipts and reports" />
          <div className="form-group">
            <label className="form-label" htmlFor="product-category">Category</label>
            <select id="product-category" className="select-input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Uncategorised</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </section>

        <section className="product-form-section" aria-labelledby="identifiers-title">
          <h2 className="product-form-section-title" id="identifiers-title">Product identifiers</h2>
          <div className="auth-form-row">
            <FormField id="product-sku" label="SKU" value={sku} onChange={setSku} hint="A short internal code, e.g. IND-070" />
            <div className="form-group">
              <label className="form-label" htmlFor="product-barcode">Barcode (optional)</label>
              <div className="barcode-row">
                <input id="product-barcode" className="form-input" type="text" value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="Scan or type" />
                {!readOnly && <Button type="button" variant="outline" className="btn-sm" onClick={() => setScanning(true)}>Scan</Button>}
              </div>
            </div>
          </div>
          {scanning && (
            <BarcodeScanner onDetect={(value) => { setBarcode(value); setScanning(false); }} onClose={() => setScanning(false)} />
          )}
        </section>

        <section className="product-form-section" aria-labelledby="pricing-title">
          <h2 className="product-form-section-title" id="pricing-title">Pricing</h2>
          <div className="auth-form-row">
            <div className="form-group">
              <label className="form-label" htmlFor="product-cost-price">Cost price</label>
              <div className="currency-input"><span>₦</span><input id="product-cost-price" className="form-input" type="number" min={0} step="any" value={costPrice} onChange={(e) => setCostPrice(e.target.value)} placeholder="0.00" /></div>
              <span className="form-hint">How much you paid for it</span>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="product-selling-price">Selling price <span className="required-mark">*</span></label>
              <div className="currency-input"><span>₦</span><input id="product-selling-price" className="form-input" type="number" min={0} step="any" value={sellingPrice} onChange={(e) => setSellingPrice(e.target.value)} required placeholder="0.00" /></div>
              <span className="form-hint">Price customers pay</span>
            </div>
          </div>
          <FormField id="product-tax-rate" label="Tax rate (%)" type="number" max={100} min={0} step="any" value={taxRate} onChange={setTaxRate} hint="Leave at 0 if no tax applies" />
        </section>

        <section className="product-form-section" aria-labelledby="inventory-title">
          <h2 className="product-form-section-title" id="inventory-title">Inventory</h2>
          <label className="toggle-row">
            <input type="checkbox" checked={trackInventory} onChange={(e) => setTrackInventory(e.target.checked)} />
            <span>Track inventory for this product</span>
          </label>
          {trackInventory && (
            <>
              <div className="auth-form-row">
                <div className="form-group">
                  <label className="form-label" htmlFor="product-unit">Unit</label>
                  <select id="product-unit" className="select-input" value={unit} onChange={(e) => setUnit(e.target.value)}>
                    {config.unitOptions.map((u) => <option key={u} value={u}>{u}</option>)}
                    {!config.unitOptions.includes(unit) && unit && <option value={unit}>{unit}</option>}
                  </select>
                </div>
                <FormField id="product-pieces" label="Product pcs/no" type="number" min={1} step="1" value={piecesPerUnit} onChange={setPiecesPerUnit} hint="Pieces or packs per unit" />
              </div>
              <div className="auth-form-row">
                {isNew && <FormField id="product-stock-qty" label="Initial stock" type="number" min={0} step="any" value={stockQty} onChange={setStockQty} hint="How many you have on hand" />}
                <FormField id="product-reorder-level" label="Reorder level" type="number" min={0} step="any" value={reorderLevel} onChange={setReorderLevel} hint="Alert when stock falls to this level" />
              </div>
            </>
          )}
        </section>

        {config.attributeFields.length > 0 && (
          <section className="product-form-section" aria-labelledby="attributes-title">
            <h2 className="product-form-section-title" id="attributes-title">Additional details</h2>
            {config.attributeFields.map((field) => {
              const val = attributes[field.key] ?? '';
              const onChange = (v: string) => setAttributes((prev) => ({ ...prev, [field.key]: v }));
              if (field.type === 'select') {
                return (
                  <div className="form-group" key={field.key}>
                    <label className="form-label" htmlFor={`attr-${field.key}`}>{field.label}</label>
                    <select id={`attr-${field.key}`} className="select-input" value={val} onChange={(e) => onChange(e.target.value)}>
                      <option value="">Select…</option>
                      {field.options?.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                  </div>
                );
              }
              return (
                <FormField key={field.key} id={`attr-${field.key}`} label={field.label} type={field.type === 'date' ? 'date' : 'text'} value={val} onChange={onChange} placeholder={field.placeholder} />
              );
            })}
          </section>
        )}

        {!isNew && (
          <section className="product-form-section" aria-labelledby="status-title">
            <h2 className="product-form-section-title" id="status-title">Status</h2>
            <div className="form-group">
              <label className="form-label" htmlFor="product-status">Status</label>
              <select id="product-status" className="select-input" value={status} onChange={(e) => setStatus(e.target.value as 'active' | 'inactive' | 'archived')}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="archived">Archived</option>
              </select>
            </div>
          </section>
        )}

        {!readOnly && (
          <div className="form-actions">
            <Button type="button" variant="outline" className="btn-sm" onClick={() => navigate('/inventory/products')}>Cancel</Button>
            {!isNew && canDelete && (
              <Button type="button" variant="danger" className="btn-sm" onClick={handleDelete}>Delete</Button>
            )}
            <Button type="submit" loading={saving}>{isNew ? 'Add product' : 'Save changes'}</Button>
          </div>
        )}
      </form>
    </div>
  );
}
