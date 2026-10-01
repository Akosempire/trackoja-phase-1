import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Button } from './Button';
import { StateBlock } from './StateBlock';
import { formatMoney, formatNumber } from '../../utils/format';
import { getReportDateRange, type ReportDateRange } from '../../utils/report-date-ranges';
import type { ReportDateRangePreset } from '../../utils/report-date-ranges';
import '../../styles/owner-dashboard.css';

export interface DashboardRevenue {
  total: number;
  count: number;
  rows: { key: string; label: string; amount: number }[] | null;
}
export type RevenueLoader = (range: ReportDateRange) => Promise<DashboardRevenue>;

export function DashboardWelcome({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return <section className="dashboard-welcome">
    <div><h2>{title}</h2><p>{description}</p></div>
    {actions && <div className="btn-row">{actions}</div>}
  </section>;
}

export function DashboardRevenuePanel({ load, title, breakdownTitle, note, emptyDescription, emptyAction, refreshKey = 0 }: {
  load: RevenueLoader; title: string; breakdownTitle: string; note: string; emptyDescription: string; emptyAction?: ReactNode; refreshKey?: number;
}) {
  const id = useId();
  const [preset, setPreset] = useState<ReportDateRangePreset>('last30');
  const [revision, setRevision] = useState(0);
  const range = useMemo(() => getReportDateRange(preset), [preset, revision, refreshKey]);
  const [result, setResult] = useState<{ load: RevenueLoader; range: ReportDateRange; data?: DashboardRevenue; error?: boolean }>();
  useEffect(() => {
    let current = true;
    load(range).then(data => {
      if (current) setResult({ load, range, data });
    }).catch(() => { if (current) setResult({ load, range, error: true }); });
    return () => { current = false; };
  }, [load, range]);
  const current = result?.load === load && result.range === range ? result : undefined;
  const data = current?.data;
  const retry = () => setRevision(value => value + 1);
  const retryButton = <Button variant="outline" className="btn-sm" onClick={retry}>Try again</Button>;
  const rows = data?.rows?.filter(row => Number.isFinite(row.amount)).sort((a, b) => b.amount - a.amount);
  const max = Math.max(1, ...(rows ?? []).map(row => Math.abs(row.amount)));
  const startLabel = range.from ? new Date(range.from).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' }) : '';
  const endLabel = range.to ? new Date(range.to).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' }) : '';
  const emptyHint = emptyDescription || (emptyAction ? 'No revenue in this period' : '');

  return <section className="dashboard-revenue" aria-labelledby={id} aria-busy={!current}>
    <header className="dashboard-revenue-head">
      <div>
        <h2 id={id}>{title}</h2>
        <div className="dashboard-revenue-total">
          <strong>{data ? formatMoney(data.total) : formatMoney(0)}</strong>
          <button type="button" className="dashboard-period" onClick={() => setPreset(value => value === 'last30' ? 'thisMonth' : 'last30')}>
            {preset === 'last30' ? 'Last 30 days' : 'This month'}
          </button>
        </div>
      </div>
      <div className="dashboard-currency-pill" aria-label="Currency">
        <span>NGN</span>
        <span>USD</span>
      </div>
    </header>
    {!current ? <div className="dashboard-revenue-loading" role="status" aria-label="Loading revenue"><span className="skeleton skeleton-text" /><span className="skeleton skeleton-text is-short" /></div> : current.error || !data ? (
      <StateBlock variant="error" title="Revenue unavailable" body="The selected period could not be loaded." actions={retryButton} />
    ) : <>
      <div className="dashboard-chart" aria-label={`${formatNumber(data.count)} completed ${data.count === 1 ? 'transaction' : 'transactions'}`}>
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
        <div className="dashboard-chart-baseline" />
        <div className="dashboard-chart-axis"><span>{startLabel}</span><span>{endLabel}</span></div>
      </div>
      {data.count === 0 ? (emptyHint ? <span className="sr-only">{emptyHint}</span> : null) : data.rows === null ? (
        <StateBlock compact variant="error" title="Breakdown unavailable" body="The revenue total is available, but its breakdown could not load." actions={retryButton} />
      ) : rows?.length ? <div className="dashboard-breakdown">
        <h3>{breakdownTitle}</h3>
        <ul>{rows.map(row => <li key={row.key}>
          <div><span>{row.label}</span><strong>{formatMoney(row.amount)}</strong></div>
          <div className="dashboard-bar" aria-hidden="true"><span style={{ width: `${Math.abs(row.amount) / max * 100}%` }} /></div>
        </li>)}</ul>
      </div> : <p className="section-sub">No breakdown is available for these transactions.</p>}
    </>}
    <p className="dashboard-revenue-note">{note}</p>
  </section>;
}
