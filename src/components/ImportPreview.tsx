import { formatMoney } from '../utils/format';
import { Pill, cn } from './kit';
import type { BulkImportRow } from '../services/bulk-import.service';

/**
 * Rows read from an import file, with problem rows highlighted so they are easy
 * to find and fix in the spreadsheet. A table on wide screens, a stacked list on phones.
 */
export function ImportPreview({ rows }: { rows: BulkImportRow[] }) {
  const stock = (row: BulkImportRow) => (row.trackInventory ? row.stockQty.toLocaleString('en-NG') : 'Not tracked');
  const status = (row: BulkImportRow) => (row.errors.length === 0
    ? <Pill tone="success">Ready</Pill>
    : <span className="text-[13px] font-medium text-danger">{row.errors.join('; ')}</span>);

  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-line">
      <table className="hidden w-full border-collapse text-sm md:table">
        <caption className="sr-only">Import preview</caption>
        <thead>
          <tr className="bg-subtle text-left text-xs font-semibold uppercase tracking-[.06em] text-ink-3">
            <th scope="col" className="w-16 px-4 py-2.5 font-semibold">Row</th>
            <th scope="col" className="px-4 py-2.5 font-semibold">Name</th>
            <th scope="col" className="px-4 py-2.5 font-semibold">Category</th>
            <th scope="col" className="px-4 py-2.5 text-right font-semibold">Price</th>
            <th scope="col" className="px-4 py-2.5 text-right font-semibold">Stock</th>
            <th scope="col" className="px-4 py-2.5 font-semibold">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line border-t border-line">
          {rows.map((row) => {
            const bad = row.errors.length > 0;
            return (
              <tr key={row.rowNumber} className={cn(bad && 'bg-danger-soft/50')}>
                <td className={cn('border-l-[3px] px-4 py-3 align-top tabular-nums text-ink-3', bad ? 'border-danger' : 'border-transparent')}>{row.rowNumber}</td>
                <td className="px-4 py-3 align-top">
                  <span className={cn('block font-medium', row.name ? 'text-ink' : 'text-danger')}>{row.name || 'Missing name'}</span>
                  <span className={cn('block text-xs', row.sku ? 'text-ink-3' : 'text-danger')}>{row.sku ? `SKU ${row.sku}` : 'Missing SKU'}</span>
                </td>
                <td className="px-4 py-3 align-top text-ink-2">{row.categoryName || 'Uncategorised'}</td>
                <td className="px-4 py-3 text-right align-top tabular-nums text-ink">{formatMoney(row.sellingPrice)}</td>
                <td className="px-4 py-3 text-right align-top tabular-nums text-ink-2">{stock(row)}</td>
                <td className="px-4 py-3 align-top">{status(row)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <ul className="m-0 list-none divide-y divide-line p-0 md:hidden" aria-label="Import preview">
        {rows.map((row) => {
          const bad = row.errors.length > 0;
          return (
            <li key={row.rowNumber} className={cn('border-l-[3px] px-4 py-3', bad ? 'border-danger bg-danger-soft/50' : 'border-transparent')}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className={cn('m-0 truncate text-sm font-medium', row.name ? 'text-ink' : 'text-danger')}>{row.name || 'Missing name'}</p>
                  <p className="m-0 mt-0.5 truncate text-xs text-ink-3">
                    Row {row.rowNumber} · {row.sku ? `SKU ${row.sku}` : 'Missing SKU'} · {row.categoryName || 'Uncategorised'}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="m-0 text-sm font-semibold tabular-nums text-ink">{formatMoney(row.sellingPrice)}</p>
                  <p className="m-0 mt-0.5 text-xs tabular-nums text-ink-3">Stock {stock(row)}</p>
                </div>
              </div>
              {bad && <div className="mt-2">{status(row)}</div>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
