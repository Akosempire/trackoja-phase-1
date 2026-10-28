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
    status = `${noun[0].toUpperCase()}${noun.slice(1)}`;
  } else {
    status = `Showing ${first.toLocaleString()}–${Math.min(last, knownTotal).toLocaleString()} of ${knownTotal.toLocaleString()} ${noun}`;
  }

  return (
    <div className="pager mt-4 flex flex-wrap items-center justify-between gap-3">
      <span className="pager-status text-[13px] text-ink-3">{status}</span>
      <div className="pager-controls flex items-center gap-2">
        <button
          type="button"
          className="btn btn-outline btn-sm inline-flex h-8 items-center rounded-md border border-line-strong bg-surface px-3 text-[13px] font-semibold text-ink disabled:opacity-40"
          onClick={() => onPageChange(page - 1)}
          disabled={cannotGoBack}
        >
          <span className="btn-label">Previous</span>
        </button>
        <span className="pager-status text-[13px] text-ink-2">Page {page}</span>
        <button
          type="button"
          className="btn btn-outline btn-sm inline-flex h-8 items-center rounded-md border border-line-strong bg-surface px-3 text-[13px] font-semibold text-ink disabled:opacity-40"
          onClick={() => onPageChange(page + 1)}
          disabled={cannotGoForward}
        >
          <span className="btn-label">Next</span>
        </button>
      </div>
    </div>
  );
}
