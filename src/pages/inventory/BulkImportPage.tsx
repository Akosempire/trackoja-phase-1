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

export default function BulkImportPage() {
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
  const [result, setResult] = useState<{ created: number; failed: number } | null>(null);

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
    setResult(null);
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
      setResult({ created: created.length, failed: invalidRows.length });
      setRows([]);
      setFileName('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err: any) {
      setError(err.message ?? 'Failed to import products');
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
      {result && (
        <div className="alert alert-success">
          Imported {result.created} product{result.created === 1 ? '' : 's'} successfully.
          {result.failed > 0 && ` ${result.failed} row${result.failed === 1 ? '' : 's'} were skipped due to errors.`}
        </div>
      )}

      <div className="card">
        <p className="list-item-title" style={{ marginBottom: 8 }}>
          1. Download the template
        </p>
        <p className="page-subtitle" style={{ marginBottom: 12 }}>
          Fill in one row per product. Required columns are Name, SKU, and Selling Price. Category names that don't
          exist yet will be created automatically.
        </p>
        <Button type="button" variant="ghost" className="btn-sm btn-outline" onClick={handleDownloadTemplate}>
          Download Excel template
        </Button>
      </div>

      <div className="card">
        <p className="list-item-title" style={{ marginBottom: 8 }}>
          2. Upload your file
        </p>
        <p className="page-subtitle" style={{ marginBottom: 12 }}>
          Accepts .xlsx, .xls, or .csv files exported from the template above.
        </p>
        <div className="btn-row">
          <Button type="button" variant="ghost" className="btn-sm btn-outline" onClick={() => fileInputRef.current?.click()}>
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
          <p className="list-item-title" style={{ marginBottom: 8 }}>
            3. Review and import
          </p>
          <div className="btn-row" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 6 }}>
            <span className="badge badge-success">{validRows.length} ready</span>
            {invalidRows.length > 0 && <span className="badge badge-danger">{invalidRows.length} with errors</span>}
            {newCategoryNames.length > 0 && (
              <span className="badge badge-default">{newCategoryNames.length} new categories</span>
            )}
          </div>

          <div style={{ overflowX: 'auto', marginBottom: 12 }}>
            <table className="import-table">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Name</th>
                  <th>SKU</th>
                  <th>Category</th>
                  <th>Price</th>
                  <th>Stock</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.rowNumber}>
                    <td>{row.rowNumber}</td>
                    <td>{row.name || '—'}</td>
                    <td>{row.sku || '—'}</td>
                    <td>{row.categoryName || '—'}</td>
                    <td>₦{row.sellingPrice.toLocaleString()}</td>
                    <td>{row.trackInventory ? row.stockQty : '—'}</td>
                    <td>
                      {row.errors.length === 0 ? (
                        <span className="badge badge-success">OK</span>
                      ) : (
                        <span className="badge badge-danger" title={row.errors.join(', ')}>
                          {row.errors[0]}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Button type="button" loading={importing} disabled={validRows.length === 0} onClick={handleImport}>
            Import {validRows.length} product{validRows.length === 1 ? '' : 's'}
          </Button>
        </div>
      )}

      <div className="btn-row" style={{ marginTop: 16 }}>
        <Link to="/inventory/products">
          <Button variant="ghost" className="btn-sm">
            Back to products
          </Button>
        </Link>
      </div>
    </div>
  );
}
