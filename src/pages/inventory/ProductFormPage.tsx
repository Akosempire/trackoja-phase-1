import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
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
import { VariantsEditor } from '../../components/VariantsEditor';
import { Card, Page, PageHeader, btn, cn, inputClass } from '../../components/kit';
import { ScanIcon } from '../../components/icons';
import { formatMoney } from '../../utils/format';
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
  // "Add product" from the register passes the unknown code it scanned
  const [barcode, setBarcode] = useState(() => { try { return new URLSearchParams(window.location.search).get('barcode') ?? ''; } catch { return ''; } });
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
  const [variantOptions, setVariantOptions] = useState<{ name: string; values: string[] }[] | null>(null);

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
        setVariantOptions(product.variantOptions ?? []);
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
  const cost = Number(costPrice) || 0;
  const price = Number(sellingPrice) || 0;
  const profit = price - cost;
  const marginPct = price > 0 && cost > 0 ? Math.round((profit / price) * 100) : null;
  const label = 'mb-1.5 block text-[13px] font-medium text-ink-2';
  const hint = 'mt-1 block text-xs text-ink-3';
  const section = (id: string, title: string, sub?: string) => (
    <div className="mb-4">
      <h2 className="m-0 text-[15px] font-semibold text-ink" id={id}>{title}</h2>
      {sub && <p className="m-0 mt-0.5 text-[13px] text-ink-3">{sub}</p>}
    </div>
  );
  const money = (id: string, value: string, set: (v: string) => void, required?: boolean) => (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-3">₦</span>
      <input id={id} className={cn(inputClass, 'pl-7 tabular-nums')} type="number" inputMode="decimal" min={0} step="any" value={value} onChange={(e) => set(e.target.value)} required={required} placeholder="0" disabled={readOnly} />
    </div>
  );

  return (
    <Page width="wide" className="product-form-page max-w-[1040px]">
      <PageHeader
        title={isNew ? 'Add product' : name || 'Edit product'}
        subtitle={isNew ? 'Name, price and stock are all you need to start selling it.' : 'Update this product’s details, pricing and stock.'}
        actions={!readOnly && <span className="hidden gap-2 lg:flex">
          <Button type="button" variant="outline" onClick={() => navigate('/inventory/products')}>Cancel</Button>
          <Button type="submit" form="product-form" loading={saving}>{isNew ? 'Add product' : 'Save changes'}</Button>
        </span>}
      />

      {error && <div className="mb-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">{error}</div>}

      <form id="product-form" className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-6" onSubmit={handleSubmit}>
        <fieldset disabled={readOnly} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0 lg:gap-6">
          <Card aria-labelledby="basic-title">
            {section('basic-title', 'Basics')}
            <FormField id="product-name" label="Product name" value={name} onChange={setName} required placeholder="e.g. Indomie Chicken 70g" />
            <div className="grid gap-x-4 sm:grid-cols-2">
              <div className="mb-4">
                <label className={label} htmlFor="product-category">Category</label>
                <select id="product-category" className={inputClass} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                  <option value="">Uncategorised</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <FormField id="product-description" label="Description (optional)" value={description} onChange={setDescription} placeholder="Shown on receipts and reports" />
            </div>
          </Card>

          <Card aria-labelledby="pricing-title">
            {section('pricing-title', 'Pricing', 'Cost price lets us show your real profit on every sale.')}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={label} htmlFor="product-cost-price">Cost price</label>
                {money('product-cost-price', costPrice, setCostPrice)}
                <span className={hint}>What you paid for one</span>
              </div>
              <div>
                <label className={label} htmlFor="product-selling-price">Selling price <span className="text-danger">*</span></label>
                {money('product-selling-price', sellingPrice, setSellingPrice, true)}
                <span className={hint}>What customers pay</span>
              </div>
            </div>
            {price > 0 && (
              <div className={cn('mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-sm', profit >= 0 ? 'bg-success-soft text-success-ink' : 'bg-danger-soft text-danger')} role="status">
                <span>{profit >= 0 ? 'You make' : 'You lose'} <strong className="tabular-nums">{formatMoney(Math.abs(profit))}</strong> on each one</span>
                {marginPct !== null && <span className="font-semibold tabular-nums">{marginPct}% margin</span>}
              </div>
            )}
            <div className="mt-4 max-w-48">
              <FormField id="product-tax-rate" label="Tax rate (%)" type="number" max={100} min={0} step="any" value={taxRate} onChange={setTaxRate} hint="Leave at 0 if no tax applies" />
            </div>
          </Card>

          <Card aria-labelledby="inventory-title">
            <div className="flex items-start justify-between gap-4">
              {section('inventory-title', 'Stock', 'We count it down with every sale and warn you before it runs out.')}
              <label className="flex shrink-0 cursor-pointer items-center gap-2 text-[13px] font-medium text-ink-2">
                <input type="checkbox" className="size-4 accent-[var(--color-accent)]" checked={trackInventory} onChange={(e) => setTrackInventory(e.target.checked)} />
                Track stock
              </label>
            </div>
            {trackInventory ? (
              <div className="grid gap-x-4 sm:grid-cols-2">
                <div className="mb-4">
                  <label className={label} htmlFor="product-unit">Sold by</label>
                  <select id="product-unit" className={inputClass} value={unit} onChange={(e) => setUnit(e.target.value)}>
                    {config.unitOptions.map((u) => <option key={u} value={u}>{u}</option>)}
                    {!config.unitOptions.includes(unit) && unit && <option value={unit}>{unit}</option>}
                  </select>
                </div>
                <FormField id="product-pieces" label="Pieces per unit (optional)" type="number" min={1} step="1" value={piecesPerUnit} onChange={setPiecesPerUnit} hint="e.g. 40 sachets in a carton" />
                {isNew && <FormField id="product-stock-qty" label="How many you have now" type="number" min={0} step="any" value={stockQty} onChange={setStockQty} />}
                <FormField id="product-reorder-level" label="Warn me when it drops to" type="number" min={0} step="any" value={reorderLevel} onChange={setReorderLevel} />
              </div>
            ) : (
              <p className="m-0 text-[13px] text-ink-3">Stock isn't tracked for this product (good for services or made-to-order items).</p>
            )}
          </Card>

          {config.attributeFields.length > 0 && (
            <Card aria-labelledby="attributes-title">
              {section('attributes-title', 'More details')}
              <div className="grid gap-x-4 sm:grid-cols-2">
                {config.attributeFields.map((field) => {
                  const val = attributes[field.key] ?? '';
                  const onChange = (v: string) => setAttributes((prev) => ({ ...prev, [field.key]: v }));
                  if (field.type === 'select') {
                    return (
                      <div className="mb-4" key={field.key}>
                        <label className={label} htmlFor={`attr-${field.key}`}>{field.label}</label>
                        <select id={`attr-${field.key}`} className={inputClass} value={val} onChange={(e) => onChange(e.target.value)}>
                          <option value="">Select…</option>
                          {field.options?.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                      </div>
                    );
                  }
                  return <FormField key={field.key} id={`attr-${field.key}`} label={field.label} type={field.type === 'date' ? 'date' : 'text'} value={val} onChange={onChange} placeholder={field.placeholder} />;
                })}
              </div>
            </Card>
          )}

          {!isNew && productId && variantOptions && (
            <VariantsEditor productId={productId} baseSku={sku} basePrice={Number(sellingPrice) || 0} initialOptions={variantOptions}
              trackInventory={trackInventory} readOnly={readOnly} onSaved={(total) => setStockQty(String(total))} />
          )}
        </fieldset>

        <fieldset disabled={readOnly} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0 lg:gap-6">
          <Card aria-labelledby="media-title">
            {section('media-title', 'Photo', 'Helps cashiers find it fast.')}
            <div className="flex items-center gap-4 lg:flex-col lg:items-stretch">
              {imageUrl
                ? <img src={imageUrl} alt="" className="size-24 shrink-0 rounded-xl object-cover lg:aspect-square lg:size-auto lg:w-full" />
                : <span className="inline-flex size-24 shrink-0 items-center justify-center rounded-xl bg-tray text-3xl font-semibold text-ink-3 lg:aspect-square lg:size-auto lg:w-full" aria-hidden="true">{(name || '?').charAt(0).toUpperCase()}</span>}
              {!readOnly && (
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" className="btn-sm" loading={uploadingImage} onClick={() => imageInputRef.current?.click()}>{imageUrl ? 'Replace photo' : 'Upload photo'}</Button>
                  {imageUrl && <Button type="button" variant="ghost" className="btn-sm" onClick={() => setImageUrl('')}>Remove</Button>}
                </div>
              )}
            </div>
            <input ref={imageInputRef} type="file" accept={PRODUCT_IMAGE_ACCEPT} onChange={handleImageChange} className="hidden" />
            <p className="m-0 mt-2 text-xs text-ink-3">PNG or JPG, up to 5 MB.</p>
          </Card>

          <Card aria-labelledby="identifiers-title">
            {section('identifiers-title', 'Codes')}
            <FormField id="product-sku" label="SKU" value={sku} onChange={setSku} hint="Short internal code, e.g. IND-070" />
            <label className={label} htmlFor="product-barcode">Barcode (optional)</label>
            <div className="flex gap-2">
              <input id="product-barcode" className={inputClass} type="text" inputMode="numeric" value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="Scan or type" />
              {!readOnly && <Button type="button" variant="outline" onClick={() => setScanning(true)} aria-label="Scan barcode"><ScanIcon width={17} height={17} /></Button>}
            </div>
            {scanning && <BarcodeScanner onDetect={(value) => { setBarcode(value); setScanning(false); }} onClose={() => setScanning(false)} />}
            {!isNew && productId && <Link className={cn(btn('outline', 'sm'), 'mt-4 w-full')} to={`/inventory/labels?ids=${productId}`}>Print labels</Link>}
          </Card>

          {!isNew && (
            <Card aria-labelledby="status-title">
              {section('status-title', 'Status')}
              <label className="sr-only" htmlFor="product-status">Status</label>
              <select id="product-status" className={inputClass} value={status} onChange={(e) => setStatus(e.target.value as 'active' | 'inactive' | 'archived')}>
                <option value="active">Active: shows at checkout</option>
                <option value="inactive">Inactive: hidden from checkout</option>
                <option value="archived">Archived</option>
              </select>
              {canDelete && !readOnly && (
                <button type="button" className="mt-4 text-[13px] font-semibold text-danger" onClick={handleDelete}>Delete product</button>
              )}
            </Card>
          )}
        </fieldset>

        {!readOnly && (
          <div className="sticky bottom-[calc(72px+env(safe-area-inset-bottom))] z-20 -mx-4 flex gap-2 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:hidden">
            <Button type="button" variant="outline" className="flex-1" onClick={() => navigate('/inventory/products')}>Cancel</Button>
            <Button type="submit" className="flex-[2]" loading={saving}>{isNew ? 'Add product' : 'Save changes'}</Button>
          </div>
        )}
      </form>
    </Page>
  );
}
