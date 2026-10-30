import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../../components/ui/Button';
import { PageLoader } from '../../components/ui/PageLoader';
import { StateBlock } from '../../components/ui/StateBlock';
import { Card, Page, btn, cn } from '../../components/kit';
import { StoreService } from '../../services/store.service';
import { TillService, type TillNumbers } from '../../services/till.service';
import { differenceTone } from '../../utils/cash-count';
import { formatMoney } from '../../utils/format';
import { APP_NAME } from '../../config/brand';

type Paper = '80mm' | '58mm' | 'a4';
const METHOD: Record<string, string> = { cash: 'Cash', transfer: 'Transfer', card: 'POS / card', credit: 'On credit', other: 'Other' };
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

/** /till/:sessionId: the end-of-day report for one till, printable on a receipt roll. */
export default function TillReportPage() {
  const { sessionId = '' } = useParams();
  const [params] = useSearchParams();
  const { profile } = useAuth();
  const [z, setZ] = useState<TillNumbers | null>(null);
  const [storeName, setStoreName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [paper, setPaper] = useState<Paper>(() => {
    try { const v = localStorage.getItem('trackoja-paper'); if (v === '58mm' || v === 'a4') return v; } catch { /* default */ }
    return '80mm';
  });

  useEffect(() => {
    TillService.report(sessionId).then(setZ).catch((e) => setError(e instanceof Error ? e.message : 'Report not found'));
    if (profile?.currentStoreId) StoreService.getStore(profile.currentStoreId).then((s) => setStoreName(s.name)).catch(() => undefined);
  }, [sessionId, profile?.currentStoreId]);

  if (error) return <Page width="form"><Card><StateBlock variant="error" title="Report not found" body={error} actions={<Link className={btn('outline')} to="/till/history">Till history</Link>} /></Card></Page>;
  if (!z) return <PageLoader />;
  const tone = z.difference === null ? null : differenceTone(z.difference);
  const row = 'flex justify-between gap-3';
  const print = () => {
    document.documentElement.dataset.paper = paper;
    try { localStorage.setItem('trackoja-paper', paper); } catch { /* fine */ }
    window.print();
  };

  return (
    <Page width="form">
      {params.get('closed') && tone && (
        <div className={cn('no-print mb-4 rounded-xl p-4', tone === 'exact' ? 'bg-success-soft' : tone === 'over' ? 'bg-warn-soft' : 'bg-danger-soft')} role="status">
          <p className="m-0 text-[15px] font-semibold text-ink">Till closed · {tone === 'exact' ? 'cash matches' : `${tone === 'over' ? 'over' : 'short'} by ${formatMoney(Math.abs(z.difference ?? 0))}`}</p>
          <p className="m-0 mt-0.5 text-[13px] text-ink-2">Print this report or keep it here. Open the till again for the next shift.</p>
        </div>
      )}
      <div className="no-print mb-6 flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={print}>Print</Button>
        <select aria-label="Paper size" className="h-10 rounded-md border border-line-strong bg-surface px-2 text-sm text-ink" value={paper} onChange={(e) => setPaper(e.target.value as Paper)}>
          <option value="80mm">80 mm roll</option><option value="58mm">58 mm roll</option><option value="a4">A4</option>
        </select>
        <Link className={btn('ghost')} to="/till/history">Till history</Link>
        <Link className={btn('ghost')} to="/till">Till</Link>
      </div>

      <article className="print-sheet mx-auto w-full max-w-[400px] rounded-xl border border-line bg-surface px-6 py-7 font-mono text-[13px] leading-5 text-ink shadow-card" aria-label="End of day report">
        <header className="mb-3 text-center">
          <p className="m-0 text-[15px] font-bold">{storeName || 'Till report'}</p>
          <p className="m-0">{z.status === 'closed' ? 'END OF DAY (Z) REPORT' : 'TILL SO FAR (X) REPORT'}</p>
        </header>
        <Section>
          <div className={row}><span>Opened</span><span>{when(z.openedAt)}</span></div>
          <div className={row}><span>By</span><span>{z.openedBy}</span></div>
          {z.closedAt && <div className={row}><span>Closed</span><span>{when(z.closedAt)}</span></div>}
          {z.closedBy && <div className={row}><span>By</span><span>{z.closedBy}</span></div>}
        </Section>
        <Section title="Sales">
          <div className={row}><span>Sales</span><span>{z.salesCount}</span></div>
          <div className={row}><span>Total</span><span>{formatMoney(z.salesTotal)}</span></div>
          {z.discounts > 0 && <div className={row}><span>Discounts</span><span>{formatMoney(z.discounts)}</span></div>}
          {z.tax > 0 && <div className={row}><span>Tax</span><span>{formatMoney(z.tax)}</span></div>}
          {Object.entries(z.byMethod).map(([m, v]) => <div key={m} className={row}><span>{METHOD[m] ?? m}</span><span>{formatMoney(v)}</span></div>)}
        </Section>
        {(z.voidsCount > 0 || z.refundsCount > 0) && (
          <Section title="Voids and refunds">
            <div className={row}><span>Voided ({z.voidsCount})</span><span>{formatMoney(z.voidsTotal)}</span></div>
            <div className={row}><span>Refunds ({z.refundsCount})</span><span>{formatMoney(z.refundsTotal)}</span></div>
          </Section>
        )}
        <Section title="Cash drawer">
          <div className={row}><span>Opening float</span><span>{formatMoney(z.openingFloat)}</span></div>
          <div className={row}><span>+ Cash taken</span><span>{formatMoney(z.cashTaken)}</span></div>
          <div className={row}><span>− Change given</span><span>{formatMoney(z.changeGiven)}</span></div>
          <div className={row}><span>+ Money in</span><span>{formatMoney(z.cashIn)}</span></div>
          <div className={row}><span>− Money out</span><span>{formatMoney(z.cashOut)}</span></div>
          <div className={row}><span>− Cash refunds</span><span>{formatMoney(z.refundsCash)}</span></div>
          <div className={cn(row, 'mt-1 font-bold')}><span>Expected</span><span>{formatMoney(z.expectedCash)}</span></div>
          {z.countedCash !== null && <div className={cn(row, 'font-bold')}><span>Counted</span><span>{formatMoney(z.countedCash)}</span></div>}
          {z.difference !== null && <div className={cn(row, 'font-bold')}><span>{tone === 'exact' ? 'Difference' : tone === 'over' ? 'Over' : 'Short'}</span><span>{formatMoney(Math.abs(z.difference))}</span></div>}
        </Section>
        {z.movements.length > 0 && (
          <Section title="Money in and out">
            {z.movements.map((m, i) => <div key={i} className={row}><span className="min-w-0 truncate">{m.kind === 'in' ? '+' : '−'} {m.reason}</span><span>{formatMoney(m.amount)}</span></div>)}
          </Section>
        )}
        {z.cashiers.length > 1 && (
          <Section title="By cashier">
            {z.cashiers.map((c) => <div key={c.name} className={row}><span>{c.name} ({c.sales})</span><span>{formatMoney(c.total)}</span></div>)}
          </Section>
        )}
        {z.notes && <Section title="Notes"><p className="m-0 whitespace-pre-wrap">{z.notes}</p></Section>}
        <footer className="mt-4 border-t border-dashed border-line pt-3 text-center text-ink-3"><p className="m-0">Printed from {APP_NAME}</p></footer>
      </article>
    </Page>
  );
}

function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-dashed border-line py-2.5">
      {title && <p className="m-0 mb-1 font-bold uppercase">{title}</p>}
      {children}
    </section>
  );
}
