import { Link } from 'react-router-dom';

interface OverviewMetricCardProps {
  label: string;
  value: string | null;
  detail?: string;
  to?: string;
  tone?: 'default' | 'warning' | 'danger';
  loading?: boolean;
}

/** The ZIP's home metric structure, with TrackOja's actual values and destinations. */
export function OverviewMetricCard({ label, value, detail, to, tone = 'default', loading }: OverviewMetricCardProps) {
  const content = (
    <>
      <header><h2>{label}</h2></header>
      {loading ? (
        <span className="overview-metric-skeleton" role="status" aria-label={`Loading ${label}`} />
      ) : (
        <>
          <strong className={`overview-metric-value${tone === 'default' ? '' : ` is-${tone}`}`}>{value ?? '—'}</strong>
          <p>{value === null ? 'Data unavailable' : detail}</p>
        </>
      )}
    </>
  );

  return to && !loading && value !== null ? (
    <Link className="ui-metric overview-metric" to={to}>{content}</Link>
  ) : (
    <article className="ui-metric overview-metric">{content}</article>
  );
}
