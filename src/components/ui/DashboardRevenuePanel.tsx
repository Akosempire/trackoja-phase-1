import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Button } from './Button';
import { SegmentedControl } from './SegmentedControl';
import { StateBlock } from './StateBlock';
import { formatMoney, formatNumber } from '../../utils/format';
import { formatReportDateRange, getReportDateRange, REPORT_DATE_RANGE_PRESETS, type ReportDateRange } from '../../utils/report-date-ranges';
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

  return <section className="dashboard-revenue" aria-labelledby={id} aria-busy={!current}>
    <header className="dashboard-revenue-head"><h2 id={id}>{title}</h2><span className="badge">NGN</span></header>
    <div className="dashboard-revenue-total">
      {data ? <><strong>{formatMoney(data.total)}</strong><span>{formatNumber(data.count)} completed {data.count === 1 ? 'transaction' : 'transactions'}</span></>
        : !current ? <span className="skeleton dashboard-amount-skeleton" aria-label="Loading total" /> : <strong aria-label="Revenue unavailable">—</strong>}
    </div>
    <div className="dashboard-revenue-controls">
      <SegmentedControl label={`${title} period`} value={preset} options={REPORT_DATE_RANGE_PRESETS} onChange={setPreset} />
      <p className="dashboard-period">{formatReportDateRange(range)}</p>
    </div>
    {!current ? <div className="dashboard-revenue-loading" role="status" aria-label="Loading revenue"><span className="skeleton skeleton-text" /><span className="skeleton skeleton-text is-short" /></div> : current.error || !data ? (
      <StateBlock variant="error" title="Revenue unavailable" body="The selected period could not be loaded." actions={retryButton} />
    ) : <>
      {data.count === 0 ? <div className="dashboard-chart-empty"><div className="dashboard-chart-grid" aria-hidden="true" /><StateBlock compact title="No revenue in this period" body={emptyDescription} actions={emptyAction} /></div> : data.rows === null ? (
        <StateBlock compact variant="error" title="Breakdown unavailable" body="The revenue total is available, but its breakdown could not load." actions={retryButton} />
      ) : rows?.length ? <div className="dashboard-breakdown">
        <h3>{breakdownTitle}</h3>
        <ul className="dashboard-column-chart" aria-label={breakdownTitle}>{rows.map(row => <li key={row.key}>
          <div className="dashboard-column-track" aria-hidden="true"><span style={{ height: `${Math.abs(row.amount) / max * 100}%` }} /></div>
          <strong>{formatMoney(row.amount)}</strong><span className="dashboard-column-label">{row.label}</span>
        </li>)}</ul>
      </div> : <p className="section-sub">No breakdown is available for these transactions.</p>}
    </>}
    <p className="dashboard-revenue-note">{note}</p>
  </section>;
}
