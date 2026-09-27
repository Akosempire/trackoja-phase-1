interface PaginationProps {
  page: number;
  pageSize: number;
  /**
   * Total rows when the endpoint reports one. Pass null when it does not —
   * `list_product_businesses` returns no count, and inventing one would be a
   * fabricated number in the interface.
   */
  total?: number | null;
  onPageChange: (page: number) => void;
  /** Label for the rows, e.g. "businesses". */
  noun?: string;
  /** When the total is unknown, whether a further page is believed to exist. */
  hasNext?: boolean;
}

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  noun = 'records',
  hasNext,
}: PaginationProps) {
  const knownTotal = typeof total === 'number' ? total : null;
  const pageCount = knownTotal === null ? null : Math.max(1, Math.ceil(knownTotal / pageSize));
  const first = (page - 1) * pageSize + 1;
  const last = knownTotal === null ? (page - 1) * pageSize + pageSize : Math.min(page * pageSize, knownTotal);

  const cannotGoBack = page <= 1;
  const cannotGoForward = knownTotal === null ? !hasNext : page >= (pageCount ?? 1);

  let status: string;
  if (knownTotal === 0) {
    status = `No ${noun}`;
  } else if (knownTotal === null) {
    // Say the count is not available rather than implying these are all of them.
    status = `Showing ${first.toLocaleString()}–${last.toLocaleString()} ${noun}`;
  } else {
    status = `Showing ${first.toLocaleString()}–${Math.min(last, knownTotal).toLocaleString()} of ${knownTotal.toLocaleString()} ${noun}`;
  }

  return (
    <div className="pager">
      <span className="pager-status">{status}</span>
      <div className="pager-controls">
        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={() => onPageChange(page - 1)}
          disabled={cannotGoBack}
        >
          <span className="btn-label">Previous</span>
        </button>
        <span className="pager-status">Page {page}</span>
        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={() => onPageChange(page + 1)}
          disabled={cannotGoForward}
        >
          <span className="btn-label">Next</span>
        </button>
      </div>
    </div>
  );
}
