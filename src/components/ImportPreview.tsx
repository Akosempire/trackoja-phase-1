import { DataTable } from './ui/DataTable';
import { formatMoney } from '../utils/format';
import type { BulkImportRow } from '../services/bulk-import.service';

export function ImportPreview({ rows }: { rows: BulkImportRow[] }) {
  return <DataTable<BulkImportRow>
            caption="Import preview"
            rows={rows}
            rowKey={(row) => String(row.rowNumber)}
            stacked
            columns={[
              { key: 'row', header: 'Row', render: (row) => row.rowNumber },
              { key: 'name', header: 'Name', label: '', render: (row) => row.name || 'Missing name' },
              { key: 'sku', header: 'SKU', render: (row) => row.sku || 'Missing SKU' },
              { key: 'category', header: 'Category', render: (row) => row.categoryName || 'Uncategorised' },
              { key: 'price', header: 'Price', numeric: true, render: (row) => formatMoney(row.sellingPrice) },
              { key: 'stock', header: 'Stock', numeric: true, render: (row) => row.trackInventory ? row.stockQty : 'Not tracked' },
              { key: 'status', header: 'Status', render: (row) => row.errors.length === 0
                ? <span className="badge badge-success">Ready</span>
                : <span className="form-error">{row.errors.join('; ')}</span> },
            ]}
          />;
}
