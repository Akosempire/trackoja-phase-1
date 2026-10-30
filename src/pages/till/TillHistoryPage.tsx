import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { PageLoader } from '../../components/ui/PageLoader';
import { Card, Empty, Page, PageHeader, Pill, btn, cn } from '../../components/kit';
import { TillService, type TillHistoryRow } from '../../services/till.service';
import { differenceTone } from '../../utils/cash-count';
import { formatMoney } from '../../utils/format';

/** /till/history: every till session, newest first, with its over/short. */
export default function TillHistoryPage() {
  const { profile } = useAuth();
  const storeId = profile?.currentStoreId;
  const [rows, setRows] = useState<TillHistoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (storeId) TillService.history(storeId).then(setRows).catch((e) => setError(e instanceof Error ? e.message : 'Could not load')); }, [storeId]);
  if (!rows && !error) return <PageLoader />;
  const date = (iso: string) => new Date(iso).toLocaleString('en-NG', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    <Page width="form">
      <PageHeader title="Till history" subtitle="Each shift's sales and whether the cash matched" actions={<Link className={btn('outline', 'sm')} to="/till">Till</Link>} />
      {error && <p className="m-0 mb-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">{error}</p>}
      {rows && rows.length === 0 ? <Empty title="No tills yet" body="Open the till before your first sale of the day. Each shift shows up here." action={<Link className={btn('primary')} to="/till">Open till</Link>} /> : (
        <Card padded={false} className="overflow-hidden">
          <ul className="m-0 list-none divide-y divide-line p-0">
            {(rows ?? []).map((r) => {
              const tone = r.difference === null ? null : differenceTone(r.difference);
              return (
                <li key={r.id}>
                  <Link to={`/till/${r.id}`} className="flex items-center gap-3 px-4 py-3 text-inherit no-underline hover:bg-subtle sm:px-5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{date(r.openedAt)}</span>
                      <span className="mt-0.5 block truncate text-[12.5px] text-ink-3">{r.openedBy} · sales {formatMoney(r.salesTotal)}</span>
                    </span>
                    {r.status === 'open' ? <Pill tone="success">Open</Pill> : (
                      <span className={cn('shrink-0 text-right text-[13px] font-semibold tabular-nums',
                        tone === 'exact' ? 'text-success-ink' : tone === 'over' ? 'text-warn-ink' : 'text-danger')}>
                        {tone === 'exact' ? 'Matched' : `${tone === 'over' ? 'Over' : 'Short'} ${formatMoney(Math.abs(r.difference ?? 0))}`}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </Page>
  );
}
