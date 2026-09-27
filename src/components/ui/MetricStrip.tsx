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

/**
 * Counts at a glance.
 *
 * Smaller than a KPI card on purpose: these are context for the queue above,
 * not the point of the screen. A metric with somewhere to go is a button, so a
 * figure that raises a question can be followed up in one click.
 */
export function MetricStrip({ metrics }: { metrics: Metric[] }) {
  return (
    <div className="metric-strip">
      {metrics.map((metric) => {
        const valueClass = [
          'metric-value',
          metric.tone && metric.tone !== 'default' ? `is-${metric.tone}` : '',
        ]
          .filter(Boolean)
          .join(' ');

        const body = (
          <>
            <span className="metric-label">{metric.label}</span>
            <span className={valueClass}>{metric.value}</span>
            {metric.foot && <span className="metric-foot">{metric.foot}</span>}
          </>
        );

        return metric.onClick ? (
          <button type="button" className="metric" key={metric.id} onClick={metric.onClick}>
            {body}
          </button>
        ) : (
          <div className="metric" key={metric.id}>
            {body}
          </div>
        );
      })}
    </div>
  );
}
