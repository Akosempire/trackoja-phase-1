import { ImportPreview } from '../../components/ImportPreview';
import { useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { ProductService } from '../../services/product.service';
import { CategoryService } from '../../services/category.service';
import { BulkImportService } from '../../services/bulk-import.service';
import { Button } from '../../components/ui/Button';
import { PageLoader } from '../../components/ui/PageLoader';
import { Card, Page, PageHeader, Pill, cn } from '../../components/kit';
import type { ReactNode } from 'react';
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

  const step = rows.length > 0 ? 3 : fileName ? 2 : 1;

  return (
    <Page>
      <PageHeader
        title="Bulk import products"
        subtitle="Add many products at once from an Excel or CSV file"
      />

      {error && <div className="mb-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">{error}</div>}

      <ol className="m-0 flex list-none flex-col gap-3 p-0 lg:gap-4" aria-label="Import steps">
        <ImportStep number={1} title="Download the template" state={step > 1 ? 'done' : 'current'}>
          <p className="m-0 mb-4 max-w-2xl text-sm text-ink-2">
            Fill in one row per product. Required columns are <strong className="font-semibold text-ink">Name</strong>,{' '}
            <strong className="font-semibold text-ink">SKU</strong> and <strong className="font-semibold text-ink">Selling Price</strong>.
            Category names that don't exist yet will be created automatically.
          </p>
          <Button type="button" variant="outline" onClick={handleDownloadTemplate}>
            <svg aria-hidden="true" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14" /></svg>
            Download Excel template
          </Button>
        </ImportStep>

        <ImportStep number={2} title="Upload your file" state={step > 2 ? 'done' : step === 2 ? 'current' : 'next'}>
          <div className="flex flex-col gap-3 rounded-lg border border-dashed border-line-strong bg-subtle px-4 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="m-0 truncate text-sm font-medium text-ink">{fileName || 'No file chosen yet'}</p>
              <p className="m-0 mt-0.5 text-xs text-ink-3">
                {parsing ? 'Reading your file…' : 'Accepts .xlsx, .xls, or .csv files exported from the template above.'}
              </p>
            </div>
            <Button type="button" variant={fileName ? 'outline' : 'primary'} className="shrink-0" loading={parsing}
              onClick={() => fileInputRef.current?.click()}>
              {fileName ? 'Choose another file' : 'Choose file'}
            </Button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFileChange}
            className="hidden"
            aria-label="Product file"
          />
        </ImportStep>

        <ImportStep number={3} title="Review and import" state={step === 3 ? 'current' : 'next'}>
          {!parsing && rows.length > 0 ? (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <Pill tone="success">{validRows.length} ready</Pill>
                {invalidRows.length > 0 && <Pill tone="danger">{invalidRows.length} with errors</Pill>}
                {newCategoryNames.length > 0 && <Pill tone="neutral">{newCategoryNames.length} new categories</Pill>}
              </div>
              {invalidRows.length > 0 && (
                <p className="m-0 mb-4 text-[13px] text-ink-2">
                  Rows with errors are highlighted and will be skipped. Fix them in your file and upload it again, or import the ready rows now.
                </p>
              )}

              <ImportPreview rows={rows} />

              <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
                <p className="m-0 text-xs text-ink-3 sm:mr-auto">
                  {newCategoryNames.length > 0 ? `New categories: ${newCategoryNames.join(', ')}` : 'All categories already exist.'}
                </p>
                <Button type="button" loading={importing} disabled={validRows.length === 0} onClick={handleImport}>
                  Import {validRows.length} product{validRows.length === 1 ? '' : 's'}
                </Button>
              </div>
            </>
          ) : (
            <p className="m-0 text-sm text-ink-3">{parsing ? 'Checking each row…' : 'Upload a file to see each row checked before anything is saved.'}</p>
          )}
        </ImportStep>
      </ol>
    </Page>
  );
}

function ImportStep({ number, title, state, children }: { number: number; title: string; state: 'done' | 'current' | 'next'; children: ReactNode }) {
  return (
    <li className="min-w-0" aria-current={state === 'current' ? 'step' : undefined}>
      <Card className={cn(state === 'next' && 'bg-subtle shadow-none')}>
        <div className="flex items-center gap-3">
          <span aria-hidden="true"
            className={cn('inline-flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold tabular-nums',
              state === 'done' && 'bg-success-soft text-success-ink',
              state === 'current' && 'bg-brand text-white',
              state === 'next' && 'border border-line-strong bg-surface text-ink-3')}>
            {state === 'done'
              ? <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
              : number}
          </span>
          <h2 className={cn('m-0 text-[15px] font-semibold leading-[22px]', state === 'next' ? 'text-ink-3' : 'text-ink')}>
            <span className="sr-only">Step {number}: </span>{title}
          </h2>
        </div>
        <div className="mt-3 min-w-0 sm:pl-11">{children}</div>
      </Card>
    </li>
  );
}
