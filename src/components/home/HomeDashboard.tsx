import type { ReactNode } from 'react';
import '../../styles/home-dashboard.css';

/**
 * Waya home-dashboard primitives, ported from the settings-dashboard reference.
 * Everything here is presentational: it receives real, already-loaded data and
 * renders the Waya home layout (metric cards + chart/status panels). No component
 * in this file fetches, and none invents a figure when its input is empty.
 */

export type HomeTone = 'users' | 'orders' | 'activation' | 'success' | 'pending' | 'failed';

export interface HomeMetric {
  label: string;
  value: string;
  /** When present, a week-over-week style change line. Omit when unknown. */
  change?: { delta: string; direction: 'up' | 'down' | 'flat' };
}

export interface HomeSeries {
  label: string;
  unit: string;
  tone: HomeTone;
  values: number[];
}

export interface HomeSlice {
  label: string;
  value: string;
  percent: number;
  tone: HomeTone;
}

export interface HomeBar {
  label: string;
  amount: string;
  percent: string;
  /** 0..100, the filled width of the bar. */
  width: number;
}

const TONE_TO_SERIES: Record<HomeTone, string> = {
  users: 'is-users',
  orders: 'is-orders',
  activation: 'is-activation',
  success: 'is-success',
  pending: 'is-pending',
  failed: 'is-failed',
};

export function HomeMetricCard({ metric }: { metric: HomeMetric }) {
  const dirClass = metric.change
    ? metric.change.direction === 'down'
      ? 'is-down'
      : metric.change.direction === 'flat'
        ? 'is-flat'
        : ''
    : '';
  return (
    <article className="hd-metric">
      <div className="hd-metric-head">
        <h2>{metric.label}</h2>
      </div>
      <strong>{metric.value}</strong>
      {metric.change && (
        <p>
          <span className={`hd-change ${dirClass}`}>
            {metric.change.direction === 'down' ? '↓' : metric.change.direction === 'flat' ? '→' : '↑'} {metric.change.delta}
          </span>{' '}
          from last week
        </p>
      )}
    </article>
  );
}

function linePoints(values: number[], width: number, height: number, min: number, max: number) {
  const span = Math.max(1, max - min);
  const stepX = values.length > 1 ? width / (values.length - 1) : 0;
  return values
    .map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / span) * height;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
}

export function HomeLineChart({
  series,
  labels,
  yLabels,
}: {
  series: HomeSeries[];
  labels: string[];
  yLabels: string[];
}) {
  const width = 640;
  const height = 230;
  const all = series.flatMap((s) => s.values);
  const min = all.length ? Math.min(...all) : 0;
  const max = all.length ? Math.max(...all) : 1;

  return (
    <div className="hd-chart">
      <div className="hd-chart-y">
        {yLabels.map((y) => (
          <span key={y}>{y}</span>
        ))}
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={series.map((s) => s.label).join(' and ')}>
        {series.map((s) => (
          <path
            key={s.label}
            className={`hd-chart-line ${TONE_TO_SERIES[s.tone]}`}
            d={linePoints(s.values, width, height, min, max)}
          />
        ))}
      </svg>
      <div className="hd-chart-labels">
        {labels.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
    </div>
  );
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function donutArc(startPercent: number, endPercent: number) {
  const start = polarToCartesian(21, 21, 15.9, (startPercent / 100) * 360);
  const end = polarToCartesian(21, 21, 15.9, (endPercent / 100) * 360);
  const large = endPercent - startPercent > 50 ? 1 : 0;
  return `M${start.x} ${start.y} A15.9 15.9 0 ${large} 1 ${end.x} ${end.y}`;
}

export function HomeDonut({ slices }: { slices: HomeSlice[] }) {
  let cursor = 0;
  return (
    <>
      <div className="hd-donut-wrap">
        <svg className="hd-donut" viewBox="0 0 42 42" role="img" aria-label="Distribution">
          {slices.map((slice) => {
            const start = cursor;
            cursor += slice.percent;
            const d = donutArc(start, Math.min(100, cursor));
            return (
              <path
                key={slice.label}
                className={`hd-donut-slice ${TONE_TO_SERIES[slice.tone]}`}
                d={d}
              />
            );
          })}
        </svg>
      </div>
      <dl className="hd-status-list">
        {slices.map((slice) => (
          <div key={slice.label}>
            <dt>
              <i className={TONE_TO_SERIES[slice.tone]} />
              {slice.label}
            </dt>
            <dd>
              {slice.value} ({slice.percent}%)
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}

export function HomeBars({
  total,
  change,
  bars,
}: {
  total: string;
  change?: string;
  bars: HomeBar[];
}) {
  return (
    <>
      <strong className="hd-bars-total">{total}</strong>
      {change && (
        <p className="hd-bars-change">
          <span className="hd-change">↑ {change}</span> from last week
        </p>
      )}
      <div className="hd-bars">
        {bars.map((bar) => (
          <div className="hd-bar" key={bar.label}>
            <div>
              <span>{bar.label}</span>
              <strong>
                {bar.amount} ({bar.percent})
              </strong>
            </div>
            <i>
              <b style={{ width: `${Math.min(100, Math.max(0, bar.width))}%` }} />
            </i>
          </div>
        ))}
      </div>
    </>
  );
}

export function HomePanel({
  title,
  subtitle,
  legend,
  children,
}: {
  title: string;
  subtitle?: string;
  legend?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="hd-panel">
      <div className="hd-panel-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {legend && <div className="hd-legend">{legend}</div>}
      </div>
      {children}
    </section>
  );
}

export function HomeDashboardSkeleton({ metricCount = 4, panelCount = 4 }: { metricCount?: number; panelCount?: number }) {
  return (
    <div aria-label="Loading dashboard" aria-busy="true">
      <div className="hd-metrics">
        {Array.from({ length: metricCount }, (_, i) => (
          <div className="hd-metric hd-skeleton-card" key={`m${i}`}>
            <i />
            <b />
            <span />
          </div>
        ))}
      </div>
      <div className="hd-grid">
        {Array.from({ length: panelCount }, (_, i) => (
          <div className="hd-panel hd-skeleton-panel" key={`p${i}`}>
            <i />
            <b />
            <span />
          </div>
        ))}
      </div>
    </div>
  );
}
