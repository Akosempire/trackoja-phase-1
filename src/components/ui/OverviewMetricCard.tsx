import { Link } from 'react-router-dom';

interface OverviewMetricCardProps {
  label: string;
  value: string | null;
  detail?: string;
  to?: string;
  tone?: 'default' | 'warning' | 'danger';
  loading?: boolean;
}

const TONE = { default: 'text-ink', warning: 'text-warn-ink', danger: 'text-danger' } as const;

/** A headline metric that, when it has a destination, opens the list behind it. */
export function OverviewMetricCard({ label, value, detail, to, tone = 'default', loading }: OverviewMetricCardProps) {
  const content = (
    <>
      <h2 className="m-0 text-[13px] font-medium text-ink-2">{label}</h2>
      {loading ? (
        <span className="mt-2 block h-7 w-24 animate-pulse rounded-md bg-tray" role="status" aria-label={`Loading ${label}`} />
      ) : (
        <>
          <strong className={`mt-2 block truncate text-[22px] font-semibold tabular-nums leading-7 sm:text-2xl ${value === null ? 'text-ink-3' : TONE[tone]}`}>{value ?? '—'}</strong>
          <p className="m-0 mt-1 text-xs text-ink-3">{value === null ? 'Data unavailable' : detail}</p>
        </>
      )}
    </>
  );
  const card = 'block min-w-0 rounded-xl border border-line bg-surface p-4 text-inherit no-underline shadow-card sm:p-5';

  return to && !loading && value !== null ? (
    <Link className={`${card} transition-colors hover:border-line-strong`} to={to}>{content}</Link>
  ) : (
    <article className={card}>{content}</article>
  );
}
