import type { ReactNode } from 'react';

export interface Metric {
  id: string;
  label: string;
  value: ReactNode;
  /** The time range or basis, so a count is never ambiguous. */
  foot?: ReactNode;
  tone?: 'default' | 'danger' | 'warning' | 'muted';
  /** Makes the metric a control that opens the list behind it. */
  onClick?: () => void;
}

const VALUE_TONE = { default: 'text-ink', danger: 'text-danger', warning: 'text-warn-ink', muted: 'text-ink-3' } as const;

/**
 * Counts at a glance.
 *
 * Smaller than a KPI card on purpose: these are context for the queue above,
 * not the point of the screen. A metric with somewhere to go is a button, so a
 * figure that raises a question can be followed up in one click.
 */
export function MetricStrip({ metrics }: { metrics: Metric[] }) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line shadow-card sm:grid-cols-3 lg:grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
      {metrics.map((metric) => {
        const body = (
          <>
            <span className="block truncate text-[13px] font-medium text-ink-2">{metric.label}</span>
            <span className={`mt-1 block truncate text-xl font-semibold tabular-nums leading-7 ${VALUE_TONE[metric.tone ?? 'default']}`}>{metric.value}</span>
            {metric.foot && <span className="mt-0.5 block text-xs text-ink-3">{metric.foot}</span>}
          </>
        );
        const cell = 'flex min-w-0 flex-col items-stretch justify-start bg-surface px-4 py-3.5 text-left';

        return metric.onClick ? (
          <button type="button" className={`${cell} cursor-pointer transition-colors hover:bg-subtle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand`} key={metric.id} onClick={metric.onClick}>
            {body}
          </button>
        ) : (
          <div className={cell} key={metric.id}>
            {body}
          </div>
        );
      })}
    </div>
  );
}
