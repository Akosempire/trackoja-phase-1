export function PageLoader() {
  return (
    <div className="page-loader" role="status" aria-label="Loading page" aria-busy="true">
      <div className="page-skeleton" aria-hidden="true">
        <span className="skeleton skeleton-heading" />
        <span className="skeleton skeleton-subtitle" />
        <div className="skeleton-metrics"><span className="skeleton" /><span className="skeleton" /><span className="skeleton" /></div>
        <span className="skeleton skeleton-row" /><span className="skeleton skeleton-row" /><span className="skeleton skeleton-row" />
      </div>
      <span className="sr-only">Loading page…</span>
    </div>
  );
}
