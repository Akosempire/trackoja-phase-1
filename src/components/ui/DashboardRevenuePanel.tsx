import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Button } from './Button';
import { SegmentedControl } from './SegmentedControl';
import { StateBlock } from './StateBlock';
import { formatMoney, formatNumber } from '../../utils/format';
import { formatReportDateRange, getReportDateRange, REPORT_DATE_RANGE_PRESETS, type ReportDateRange } from '../../utils/report-date-ranges';
import type { ReportDateRangePreset } from '../../utils/report-date-ranges';

export interface DashboardRevenue {
  total: number;
  count: number;
  rows: { key: string; label: string; amount: number }[] | null;
}
export type RevenueLoader = (range: ReportDateRange) => Promise<DashboardRevenue>;

export function DashboardWelcome({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return <section className="dashboard-welcome rounded-xl border border-line bg-surface p-5 shadow-card">
    <div><h2 className="m-0 text-[15px] font-semibold text-ink">{title}</h2><p className="m-0 mt-1 text-sm text-ink-2">{description}</p></div>
    {actions && <div className="mt-4 flex flex-wrap gap-2">{actions}</div>}
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

  return <section className="dashboard-revenue min-w-0 rounded-xl border border-line bg-surface p-5 shadow-card" aria-labelledby={id} aria-busy={!current}>
    <header className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 id={id} className="m-0 text-[15px] font-semibold text-ink">{title}</h2>
        <p className="m-0 mt-0.5 text-[13px] text-ink-3">{formatReportDateRange(range)}</p>
      </div>
    </header>
    <div className="dashboard-revenue-total mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      {data ? <><strong className="text-[28px] font-semibold leading-9 tabular-nums text-ink">{formatMoney(data.total)}</strong><span className="text-[13px] text-ink-2">{formatNumber(data.count)} completed {data.count === 1 ? 'sale' : 'sales'}</span></>
        : !current ? <span className="skeleton dashboard-amount-skeleton inline-block h-9 w-40 animate-pulse rounded-md bg-tray" aria-label="Loading total" /> : <strong className="text-[28px] font-semibold text-ink-3" aria-label="Revenue unavailable">—</strong>}
    </div>
    <div className="mt-4"><SegmentedControl label={`${title} period`} value={preset} options={REPORT_DATE_RANGE_PRESETS} onChange={setPreset} /></div>
    <div className="mt-5">
    {!current ? <div className="space-y-3" role="status" aria-label="Loading revenue"><span className="block h-3 w-full animate-pulse rounded bg-tray" /><span className="block h-3 w-2/3 animate-pulse rounded bg-tray" /></div> : current.error || !data ? (
      <StateBlock variant="error" title="Revenue unavailable" body="The selected period could not be loaded." actions={retryButton} />
    ) : data.count === 0 ? <StateBlock compact title="No revenue in this period" body={emptyDescription} actions={emptyAction} /> : data.rows === null ? (
        <StateBlock compact variant="error" title="Breakdown unavailable" body="The revenue total is available, but its breakdown could not load." actions={retryButton} />
      ) : rows?.length ? <div>
        <h3 className="m-0 mb-3 text-[13px] font-semibold text-ink-2">{breakdownTitle}</h3>
        <ul className="m-0 list-none space-y-3 p-0" aria-label={breakdownTitle}>{rows.map(row => <li key={row.key}>
          <div className="flex items-baseline justify-between gap-3 text-sm"><span className="capitalize text-ink">{row.label}</span><strong className="font-semibold tabular-nums text-ink">{formatMoney(row.amount)}</strong></div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-tray" aria-hidden="true"><span className="block h-full rounded-full bg-brand" style={{ width: `${Math.max(2, Math.abs(row.amount) / max * 100)}%` }} /></div>
        </li>)}</ul>
      </div> : <p className="m-0 text-sm text-ink-3">No breakdown is available for these transactions.</p>}
    </div>
    <p className="m-0 mt-5 border-t border-line pt-3 text-xs text-ink-3">{note}</p>
  </section>;
}
