import { ImportPreview } from '../../components/ImportPreview';
import { SectionHead } from '../../components/ui/SectionHead';
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { ProductService } from '../../services/product.service';
import { CategoryService } from '../../services/category.service';
import { BulkImportService } from '../../services/bulk-import.service';
import { Button } from '../../components/ui/Button';
import { PageLoader } from '../../components/ui/PageLoader';
import type { BulkImportRow } from '../../services/bulk-import.service';
import type { CreateProductRequest, ProductCategory } from '../../types';
import { useToast } from '../../components/ui/Toast';

export default function BulkImportPage() {
  const toast = useToast();
  const { user, profile } = useAuth();
  const { hasPermission, loading: permsLoading } = usePermissions();
  const storeId = profile?.currentStoreId;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canCreate = hasPermission('product:create');

  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [existingSkus, setExistingSkus] = useState<Set<string>>(new Set());
  const [loadingInit, setLoadingInit] = useState(true);

  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<BulkImportRow[]>([]);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!storeId) return;
    Promise.all([CategoryService.getCategories(storeId), ProductService.getProducts(storeId)])
      .then(([cats, products]) => {
        setCategories(cats);
        setExistingSkus(new Set(products.map((p) => p.sku.toLowerCase())));
      })
      .catch((err) => setError(err.message ?? 'Failed to load store data'))
      .finally(() => setLoadingInit(false));
  }, [storeId]);

  if (permsLoading || loadingInit) return <PageLoader />;
  if (!canCreate) return <Navigate to="/inventory/products" replace />;

  const handleDownloadTemplate = async () => {
    try {
      await BulkImportService.downloadTemplate();
    } catch (err: any) {
      setError(err.message ?? 'Failed to generate template');
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setError(null);
    setParsing(true);
    try {
      const parsed = await BulkImportService.parseFile(file);
      if (parsed.length === 0) {
        setError('No rows found in this file. Use the template and fill in at least one product.');
        setRows([]);
        return;
      }
      setRows(BulkImportService.validateRows(parsed, existingSkus));
    } catch (err: any) {
      setError(err.message ?? 'Failed to read file. Make sure it is a valid .xlsx, .xls, or .csv file.');
      setRows([]);
    } finally {
      setParsing(false);
    }
  };

  const validRows = rows.filter((r) => r.errors.length === 0);
  const invalidRows = rows.filter((r) => r.errors.length > 0);

  const categoryByName = new Map(categories.map((c) => [c.name.toLowerCase(), c]));
  const newCategoryNames = Array.from(
    new Set(
      validRows
        .map((r) => r.categoryName)
        .filter((name): name is string => !!name && !categoryByName.has(name.toLowerCase()))
        .map((name) => name.trim())
    )
  );

  const handleImport = async () => {
    if (!storeId || !user || validRows.length === 0) return;

    setImporting(true);
    setError(null);
    const toastId = toast.loading(`Importing ${validRows.length} products…`, { dedupeKey: 'bulk-import' });
    try {
      // Create any new categories referenced by the file, then resolve names -> ids
      const resolvedCategories = new Map(categoryByName);
      for (const name of newCategoryNames) {
        const created = await CategoryService.createCategory(storeId, user.id, { name });
        resolvedCategories.set(created.name.toLowerCase(), created);
      }

      const requests: CreateProductRequest[] = validRows.map((row) => ({
        name: row.name,
        sku: row.sku,
        barcode: row.barcode,
        description: row.description,
        categoryId: row.categoryName ? resolvedCategories.get(row.categoryName.toLowerCase())?.id : undefined,
        unit: row.unit,
        costPrice: row.costPrice,
        sellingPrice: row.sellingPrice,
        taxRate: row.taxRate,
        trackInventory: row.trackInventory,
        stockQty: row.stockQty,
        reorderLevel: row.reorderLevel,
      }));

      const created = await ProductService.bulkCreateProducts(storeId, user.id, requests);
      toast.update(toastId, {
        variant: invalidRows.length ? 'warning' : 'success',
        message: `Imported ${created.length} product${created.length === 1 ? '' : 's'}`,
        description: invalidRows.length ? `${invalidRows.length} invalid row${invalidRows.length === 1 ? ' was' : 's were'} skipped.` : undefined,
      });
      setRows([]);
      setFileName('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err: any) {
      const message = err.message ?? 'Failed to import products';
      setError(message);
      toast.update(toastId, { variant: 'error', message: 'Products were not imported', description: message });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Bulk import products</h1>
          <p className="page-subtitle">Add many products at once from an Excel or CSV file</p>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="card">
        <SectionHead title={<>1. Download the template</>} />
        <p className="page-subtitle" style={{ marginBottom: 'var(--space-12)' }}>
          Fill in one row per product. Required columns are Name, SKU, and Selling Price. Category names that don't
          exist yet will be created automatically.
        </p>
        <Button type="button" variant="outline" className="btn-sm" onClick={handleDownloadTemplate}>
          Download Excel template
        </Button>
      </div>

      <div className="card">
        <SectionHead title={<>2. Upload your file</>} />
        <p className="page-subtitle" style={{ marginBottom: 'var(--space-12)' }}>
          Accepts .xlsx, .xls, or .csv files exported from the template above.
        </p>
        <div className="btn-row">
          <Button type="button" variant="outline" className="btn-sm" onClick={() => fileInputRef.current?.click()}>
            Choose file
          </Button>
          {fileName && <span className="page-subtitle">{fileName}</span>}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />
      </div>

      {parsing && <PageLoader />}

      {!parsing && rows.length > 0 && (
        <div className="card">
          <SectionHead title={<>3. Review and import</>} />
          <div className="btn-row" style={{ marginBottom: 'var(--space-12)', flexWrap: 'wrap', gap: 'var(--space-6)' }}>
            <span className="badge badge-success">{validRows.length} ready</span>
            {invalidRows.length > 0 && <span className="badge badge-danger">{invalidRows.length} with errors</span>}
            {newCategoryNames.length > 0 && (
              <span className="badge badge-default">{newCategoryNames.length} new categories</span>
            )}
          </div>

          <ImportPreview rows={rows} />

          <Button type="button" loading={importing} disabled={validRows.length === 0} onClick={handleImport}>
            Import {validRows.length} product{validRows.length === 1 ? '' : 's'}
          </Button>
        </div>
      )}

      <div className="btn-row" style={{ marginTop: 'var(--space-16)' }}>
        <Link className="btn btn-ghost btn-sm" to="/inventory/products">Back to products</Link>
      </div>
    </div>
  );
}
