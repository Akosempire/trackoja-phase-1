import { useMemo, useState, type ReactNode } from 'react';

export interface DataTableColumn<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  /** Right-aligns and applies tabular figures. */
  numeric?: boolean;
  nowrap?: boolean;
  /**
   * Mobile label for the stacked layout. Defaults to the header when it is a
   * string; pass '' for a leading identity cell that should span the full row.
   */
  label?: string;
  /** Supplying this makes the column sortable using the built-in comparator. */
  sortValue?: (row: T) => string | number;
  className?: string;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  /**
   * Stable key per row. Receives the index as a fallback for rows the backend
   * does not give an id for.
   */
  rowKey: (row: T, index: number) => string;
  /** Visible caption; also the table's accessible name. */
  caption?: string;
  /**
   * Turns each row into a labelled card below 900px instead of scrolling the
   * table sideways. Use it for the directory screens; leave it off where a
   * horizontal scroll genuinely reads better.
   */
  stacked?: boolean;
  loading?: boolean;
  skeletonRows?: number;
  empty?: ReactNode;
  defaultSortKey?: string;
  defaultSortDirection?: 'asc' | 'desc';
  onRowClick?: (row: T) => void;
}

function headerText(header: ReactNode, fallback: string): string {
  return typeof header === 'string' ? header : fallback;
}

/**
 * Waya data table. Generalises the `.import-table` precedent: hairline rows,
 * quiet header, tabular figures for numbers, and the same data-label stacked
 * fallback on narrow screens.
 */
export function DataTable<T,>({
  columns,
  rows,
  rowKey,
  caption,
  stacked,
  loading,
  skeletonRows = 5,
  empty,
  defaultSortKey,
  defaultSortDirection = 'asc',
  onRowClick,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(defaultSortKey ?? null);
  const [direction, setDirection] = useState<'asc' | 'desc'>(defaultSortDirection);

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const column = columns.find((candidate) => candidate.key === sortKey);
    if (!column?.sortValue) return rows;
    const compare = column.sortValue;
    return [...rows].sort((a, b) => {
      const left = compare(a);
      const right = compare(b);
      if (left === right) return 0;
      const result =
        typeof left === 'number' && typeof right === 'number'
          ? left - right
          : String(left).localeCompare(String(right), undefined, { numeric: true });
      return direction === 'asc' ? result : -result;
    });
  }, [rows, columns, sortKey, direction]);

  function toggleSort(column: DataTableColumn<T>) {
    if (!column.sortValue) return;
    if (sortKey === column.key) {
      setDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(column.key);
    setDirection('asc');
  }

  const tableClasses = ['data-table', stacked ? 'is-stacked' : ''].filter(Boolean).join(' ');
  const columnCount = columns.length;

  return (
    <div className="data-table-wrap">
      <table className={tableClasses}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((column) => {
              const active = sortKey === column.key;
              return (
                <th
                  key={column.key}
                  scope="col"
                  className={[column.numeric ? 'is-numeric' : '', column.nowrap ? 'is-nowrap' : '']
                    .filter(Boolean)
                    .join(' ')}
                  aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  {column.sortValue ? (
                    <button type="button" className="data-table-sort" onClick={() => toggleSort(column)}>
                      {column.header}
                      <span aria-hidden="true">{active ? (direction === 'asc' ? '↑' : '↓') : '↕'}</span>
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading &&
            Array.from({ length: skeletonRows }).map((_, index) => (
              <tr key={`skeleton-${index}`}>
                {columns.map((column) => (
                  <td
                    key={column.key}
                    data-label={column.label ?? headerText(column.header, '')}
                    className={column.numeric ? 'is-numeric' : undefined}
                  >
                    <span className="skeleton skeleton-text" />
                  </td>
                ))}
              </tr>
            ))}

          {!loading && sorted.length === 0 && (
            <tr>
              <td colSpan={columnCount} data-label="">
                {empty ?? <span className="data-table-secondary">No records.</span>}
              </td>
            </tr>
          )}

          {!loading &&
            sorted.map((row, index) => (
              <tr
                key={rowKey(row, index)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                style={onRowClick ? { cursor: 'pointer' } : undefined}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    data-label={column.label ?? headerText(column.header, '')}
                    className={[
                      column.numeric ? 'is-numeric' : '',
                      column.nowrap ? 'is-nowrap' : '',
                      column.className ?? '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
