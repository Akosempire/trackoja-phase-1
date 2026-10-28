export function PageLoader() {
  return (
    <div className="page-loader mx-auto w-full max-w-[1120px] px-4 pt-6 sm:px-6 lg:px-8 lg:pt-8" role="status" aria-label="Loading page" aria-busy="true">
      <div className="page-skeleton space-y-4" aria-hidden="true">
        <span className="skeleton block h-8 w-56 animate-pulse rounded-lg bg-tray" />
        <span className="skeleton block h-4 w-80 max-w-full animate-pulse rounded bg-tray" />
        <div className="grid grid-cols-2 gap-3 pt-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <span key={i} className="skeleton block h-24 animate-pulse rounded-xl bg-tray" />)}
        </div>
        {[0, 1, 2].map((i) => <span key={i} className="skeleton block h-14 animate-pulse rounded-xl bg-tray" />)}
      </div>
      <span className="sr-only">Loading page…</span>
    </div>
  );
}
