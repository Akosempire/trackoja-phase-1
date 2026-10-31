import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, Stat, cn } from '../../../components/kit';
import { usePlatform } from '../../../components/platform/PlatformContext';
import { PermissionDenied, PlatformPageHead, RefreshButton } from '../../../components/platform/PlatformPageHead';
import { StateBlock } from '../../../components/ui/StateBlock';
import { PLATFORM_AREAS } from '../../../config/platformAreas';
import { AccountService } from '../../../services/account.service';
import { duration, summarizeUsage, type UsageRow } from '../../../utils/usageArea';
import { formatDate } from '../../../utils/format';

const AREA = PLATFORM_AREAS.find((area) => area.id === 'usage')!;
const PERIODS = [7, 30, 90];

/**
 * Platform → Usage: active time in TrackOja from usage_daily (counted only
 * while a tab is visible and someone is active; platform staff not counted).
 */
export default function UsageArea() {
  const { can } = usePlatform();
  const allowed = can('platform:view');
  const [days, setDays] = useState(30);
  const [store, setStore] = useState<string | null>(null);
  const [rows, setRows] = useState<UsageRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setRows(null); setError(null);
    AccountService.platformUsage(days).then(setRows).catch((e) => setError(/get_platform_usage/.test(String(e?.message)) ? 'Run the 20261030004001 migration to start counting.' : String(e?.message || 'Could not load usage')));
  }, [days]);
  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  const shown = useMemo(() => (rows ?? []).filter((r) => !store || r.store_id === store), [rows, store]);
  const s = useMemo(() => summarizeUsage(shown), [shown]);
  const people = useMemo(() => {
    const per = new Map<string, { seconds: number; days: Set<string>; last: string }>();
    for (const r of shown) { const p = per.get(r.user_id) ?? { seconds: 0, days: new Set(), last: r.day }; p.seconds += r.seconds; p.days.add(r.day); if (r.day > p.last) p.last = r.day; per.set(r.user_id, p); }
    return [...per].map(([id, p], i) => ({ id, label: `Person ${i + 1}`, seconds: p.seconds, days: p.days.size, last: p.last })).sort((a, b) => b.seconds - a.seconds);
  }, [shown]);

  if (!allowed) return <PermissionDenied what="usage" permission="platform:view" />;
  const maxDay = Math.max(1, ...s.days.map((d) => d.seconds));
  const storeName = store ? s.stores.find((x) => x.id === store)?.name : null;

  return (
    <div className="flex flex-col gap-6">
      <PlatformPageHead area={AREA} description={storeName ? `Time in TrackOja at ${storeName}.` : 'Active time only: the tab is open and someone used it in the last 2 minutes. Platform staff are not counted.'}
        actions={<>
          <div className="inline-flex rounded-lg bg-tray p-1" role="group" aria-label="Period">
            {PERIODS.map((p) => (
              <button key={p} type="button" aria-pressed={days === p} onClick={() => setDays(p)}
                className={cn('h-8 rounded-md border-0 px-3 text-[13px] font-medium', days === p ? 'bg-surface text-ink shadow-card' : 'bg-transparent text-ink-3 hover:text-ink')}>{p} days</button>
            ))}
          </div>
          {store && <button type="button" className="h-8 rounded-md border-0 bg-transparent px-3 text-[13px] font-medium text-brand-ink" onClick={() => setStore(null)}>All stores</button>}
          <RefreshButton onClick={load} loading={rows === null && !error} />
        </>} />

      {error && <Card><StateBlock variant="error" title="Usage isn't available" body={error} /></Card>}
      {!error && rows === null && <Card><p className="m-0 text-sm text-ink-3">Loading…</p></Card>}

      {rows && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Total active time" value={duration(s.totalSeconds)} />
            <Stat label="Active people" value={s.people} />
            <Stat label="Average per person per day" value={duration(s.avgPerPersonDay)} hint="On days they used it" />
          </div>
          {!shown.length ? (
            <Card><StateBlock variant="empty" title="No time recorded yet" body="Time starts counting when people use TrackOja after this update." /></Card>
          ) : (
            <>
              <Card>
                <h2 className="m-0 text-[15px] font-semibold text-ink">Each day</h2>
                <p className="m-0 mt-0.5 text-[13px] text-ink-3">Bar = active time; number = people active</p>
                <div className="mt-4 flex h-40 items-end gap-1 overflow-x-auto" role="img" aria-label="Active time per day">
                  {s.days.map((d) => (
                    <div key={d.day} className="flex min-w-[12px] flex-1 flex-col items-center gap-1" title={`${formatDate(d.day)}: ${duration(d.seconds)}, ${d.people} people`}>
                      <span className="text-[10.5px] text-ink-3">{d.people}</span>
                      <div className="w-full rounded-t bg-brand/80" style={{ height: `${Math.max(4, (d.seconds / maxDay) * 110)}px` }} />
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex justify-between text-[11.5px] text-ink-3"><span>{formatDate(s.days[0].day)}</span><span>{formatDate(s.days[s.days.length - 1].day)}</span></div>
              </Card>
              <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
                <Card>
                  <h2 className="m-0 mb-3 text-[15px] font-semibold text-ink">Where time goes</h2>
                  <ul className="m-0 flex list-none flex-col gap-3 p-0">
                    {s.areas.slice(0, 12).map((a) => (
                      <li key={a.name} className="flex flex-col gap-1">
                        <div className="flex justify-between gap-3 text-sm"><span className="text-ink">{a.name}</span><span className="tabular-nums text-ink-2">{duration(a.seconds)} · {Math.round(a.share * 100)}%</span></div>
                        <div className="h-1.5 rounded-full bg-tray"><div className="h-1.5 rounded-full bg-brand" style={{ width: `${Math.max(2, a.share * 100)}%` }} /></div>
                      </li>
                    ))}
                  </ul>
                </Card>
                <Card padded={false} className="overflow-hidden">
                  <h2 className="m-0 px-5 pb-3 pt-5 text-[15px] font-semibold text-ink">{store ? 'People' : 'Stores'}</h2>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="border-y border-line text-left text-[12px] text-ink-3">
                        <th className="px-5 py-2 font-medium">{store ? 'Person' : 'Store'}</th><th className="px-3 py-2 text-right font-medium">Time</th>
                        <th className="px-3 py-2 text-right font-medium">{store ? 'Days' : 'People'}</th><th className="hidden px-5 py-2 text-right font-medium sm:table-cell">Last seen</th></tr></thead>
                      <tbody className="divide-y divide-line">
                        {store
                          ? people.map((p) => <tr key={p.id}><td className="px-5 py-2.5 text-ink">{p.label}</td><td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-ink-2">{duration(p.seconds)}</td><td className="px-3 py-2.5 text-right tabular-nums text-ink-2">{p.days}</td><td className="hidden px-5 py-2.5 text-right text-ink-2 sm:table-cell">{formatDate(p.last)}</td></tr>)
                          : s.stores.slice(0, 50).map((b) => (
                            <tr key={b.id}>
                              <td className="px-5 py-2.5"><button type="button" className="border-0 bg-transparent p-0 text-left font-medium text-brand-ink underline" onClick={() => setStore(b.id)}>{b.name}</button><span className="block text-[12px] text-ink-3">{b.business}</span></td>
                              <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-ink-2">{duration(b.seconds)}</td><td className="px-3 py-2.5 text-right tabular-nums text-ink-2">{b.people}</td><td className="hidden px-5 py-2.5 text-right text-ink-2 sm:table-cell">{formatDate(b.last)}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
