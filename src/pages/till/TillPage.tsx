import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { PageLoader } from '../../components/ui/PageLoader';
import { StateBlock } from '../../components/ui/StateBlock';
import { useToast } from '../../components/ui/Toast';
import { Card, CardHead, Page, PageHeader, Stat, btn, cn, inputClass } from '../../components/kit';
import { CashierSwitch } from '../../components/till/CashierSwitch';
import { TillService, type TillNumbers } from '../../services/till.service';
import { NGN_DENOMINATIONS, countTotal, differenceTone } from '../../utils/cash-count';
import { formatMoney } from '../../utils/format';

/**
 * /till: open the till with a float, see what should be in the drawer, record
 * money in or out, and close by counting the cash.
 */
export default function TillPage() {
  const { profile } = useAuth();
  const { hasPermission, loading: permsLoading } = usePermissions();
  const toast = useToast();
  const navigate = useNavigate();
  const storeId = profile?.currentStoreId;
  const canSell = hasPermission('sales:create');
  const canManage = hasPermission('store:update');

  const [till, setTill] = useState<TillNumbers | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [required, setRequired] = useState(false);

  const load = useCallback(() => {
    if (!storeId) { setLoading(false); return; }
    Promise.all([TillService.current(storeId), TillService.isRequired(storeId)])
      .then(([t, r]) => { setTill(t); setRequired(r); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the till'))
      .finally(() => setLoading(false));
  }, [storeId]);
  useEffect(load, [load]);

  if (permsLoading || loading) return <PageLoader />;
  if (!storeId || !canSell) {
    return <Page width="form"><Card><StateBlock variant="unavailable" title="Till not available" body="You need permission to sell in this branch to use the till." /></Card></Page>;
  }

  return (
    <Page width="form">
      <PageHeader title="Till" subtitle={till ? `Open since ${new Date(till.openedAt).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}` : 'Count the cash in and out of your drawer'}
        actions={<><CashierSwitch storeId={storeId} accountName={profile?.firstName || undefined} /><Link className={btn('outline', 'sm')} to="/till/history">History</Link></>} />
      {error && <p className="m-0 mb-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">{error}</p>}
      {till ? <OpenTill till={till} onChange={setTill} onClosed={(z) => navigate(`/till/${z.sessionId}?closed=1`)} toast={toast} />
        : <OpenForm storeId={storeId} onOpened={(t) => { setTill(t); toast.success('Till open', { description: 'Sales from now count toward this till.' }); }} />}
      {canManage && (
        <Card className="mt-4 flex items-center justify-between gap-3 lg:mt-6">
          <div className="min-w-0">
            <h2 className="m-0 text-[15px] font-semibold text-ink">Require an open till to sell</h2>
            <p className="m-0 mt-0.5 text-[13px] text-ink-3">When on, checkout is blocked until someone opens the till.</p>
          </div>
          <label className="relative inline-flex shrink-0 cursor-pointer items-center">
            <input type="checkbox" className="peer sr-only" checked={required} aria-label="Require an open till to sell"
              onChange={async (e) => {
                const next = e.target.checked; setRequired(next);
                try { await TillService.setRequired(storeId, next); toast.success(next ? 'Open till required' : 'Open till not required'); }
                catch (err) { setRequired(!next); toast.error('Not changed', { description: err instanceof Error ? err.message : undefined }); }
              }} />
            <span className="h-6 w-11 rounded-full bg-line-strong transition-colors after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:bg-brand peer-checked:after:translate-x-5 peer-focus-visible:ring-4 peer-focus-visible:ring-brand/20" />
          </label>
        </Card>
      )}
    </Page>
  );
}

function OpenForm({ storeId, onOpened }: { storeId: string; onOpened: (t: TillNumbers) => void }) {
  const [float, setFloat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card>
      <CardHead title="Open the till" hint="Count the cash in the drawer before the first sale. Use 0 if it's empty." />
      <form className="flex flex-col gap-4" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError(null);
        try { onOpened(await TillService.open(storeId, Number(float) || 0)); }
        catch (err) { setError(err instanceof Error ? err.message : 'Could not open the till'); }
        finally { setBusy(false); }
      }}>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">Cash in the drawer (₦)
          <input className={cn(inputClass, 'h-12 text-lg tabular-nums')} type="number" inputMode="decimal" min={0} step="0.01" value={float}
            onChange={(e) => setFloat(e.target.value)} placeholder="0" />
        </label>
        {error && <p className="m-0 rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger" role="alert">{error}</p>}
        <Button type="submit" loading={busy} className="w-full sm:w-auto sm:self-end">Open till</Button>
      </form>
    </Card>
  );
}

function OpenTill({ till, onChange, onClosed, toast }: {
  till: TillNumbers; onChange: (t: TillNumbers) => void; onClosed: (z: TillNumbers) => void; toast: ReturnType<typeof useToast>;
}) {
  const [move, setMove] = useState<'in' | 'out' | null>(null);
  const [closing, setClosing] = useState(false);
  const cards = (
    <div className="grid grid-cols-2 gap-3 lg:gap-4">
      <Stat label="Should be in the drawer" value={formatMoney(till.expectedCash)} hint={`Float ${formatMoney(till.openingFloat)}`} />
      <Stat label="Sales" value={formatMoney(till.salesTotal)} hint={`${till.salesCount} sale${till.salesCount === 1 ? '' : 's'}`} />
    </div>
  );
  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      {cards}
      <Card padded={false} className="overflow-hidden">
        <h2 className="m-0 px-4 pb-2 pt-4 text-[15px] font-semibold text-ink sm:px-5">Cash so far</h2>
        <dl className="m-0 divide-y divide-line border-t border-line text-sm">
          {[
            ['Opening float', till.openingFloat, ''],
            ['Cash taken', till.cashTaken, '+'],
            ['Change given', till.changeGiven, '−'],
            ['Money in', till.cashIn, '+'],
            ['Money out', till.cashOut, '−'],
            ['Cash refunds', till.refundsCash, '−'],
          ].map(([label, value, sign]) => (
            <div key={label as string} className="flex justify-between px-4 py-2.5 sm:px-5">
              <dt className="text-ink-2">{label}</dt><dd className="m-0 tabular-nums text-ink">{sign}{formatMoney(value as number)}</dd>
            </div>
          ))}
          <div className="flex justify-between bg-subtle px-4 py-3 font-semibold sm:px-5">
            <dt className="text-ink">Expected in drawer</dt><dd className="m-0 tabular-nums text-ink">{formatMoney(till.expectedCash)}</dd>
          </div>
        </dl>
      </Card>
      {till.movements.length > 0 && (
        <Card padded={false} className="overflow-hidden">
          <h2 className="m-0 px-4 pb-2 pt-4 text-[15px] font-semibold text-ink sm:px-5">Money in and out</h2>
          <ul className="m-0 list-none divide-y divide-line border-t border-line p-0">
            {till.movements.map((m, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm sm:px-5">
                <span className="min-w-0 truncate text-ink">{m.reason} <span className="text-ink-3">· {m.by}</span></span>
                <span className={cn('shrink-0 tabular-nums font-medium', m.kind === 'in' ? 'text-success-ink' : 'text-ink')}>{m.kind === 'in' ? '+' : '−'}{formatMoney(m.amount)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
        <Button variant="outline" onClick={() => setMove('in')}>Money in</Button>
        <Button variant="outline" onClick={() => setMove('out')}>Money out</Button>
        <Button className="col-span-2" onClick={() => setClosing(true)}>Close till</Button>
      </div>
      <MoveDialog kind={move} onClose={() => setMove(null)} onSave={async (amount, reason) => {
        onChange(await TillService.cashMove(till.sessionId, move!, amount, reason));
        toast.success(move === 'in' ? 'Money in recorded' : 'Money out recorded');
        setMove(null);
      }} />
      <CloseDialog open={closing} till={till} onClose={() => setClosing(false)} onClosed={onClosed} />
    </div>
  );
}

function MoveDialog({ kind, onClose, onSave }: { kind: 'in' | 'out' | null; onClose: () => void; onSave: (amount: number, reason: string) => Promise<void> }) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setAmount(''); setReason(''); setError(null); }, [kind]);
  return (
    <Dialog open={kind !== null} onClose={onClose} title={kind === 'in' ? 'Money into the drawer' : 'Money out of the drawer'}
      description={kind === 'in' ? 'For example, extra change from the bank.' : 'For example, paying a supplier or taking cash to the bank.'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={async () => {
        setBusy(true); setError(null);
        try { await onSave(Number(amount), reason); } catch (e) { setError(e instanceof Error ? e.message : 'Not saved'); } finally { setBusy(false); }
      }}>Save</Button></>}>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">Amount (₦)
          <input className={cn(inputClass, 'tabular-nums')} type="number" inputMode="decimal" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">Reason
          <input className={inputClass} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder={kind === 'out' ? 'Paid the delivery man' : 'Change from the bank'} />
        </label>
        {error && <p className="m-0 rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger" role="alert">{error}</p>}
      </div>
    </Dialog>
  );
}

function CloseDialog({ open, till, onClose, onClosed }: { open: boolean; till: TillNumbers; onClose: () => void; onClosed: (z: TillNumbers) => void }) {
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const [byNotes, setByNotes] = useState(false);
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setCounted(''); setNotes(''); setCounts({}); setError(null); } }, [open]);

  const countedValue = byNotes ? countTotal(counts) : Number(counted);
  const hasValue = byNotes ? Object.values(counts).some((v) => v !== '') : counted !== '';
  const diff = useMemo(() => Math.round((countedValue - till.expectedCash) * 100) / 100, [countedValue, till.expectedCash]);
  const tone = differenceTone(diff);

  return (
    <Dialog open={open} onClose={onClose} title="Close the till" description={`Count the cash in the drawer. It should be ${formatMoney(till.expectedCash)}.`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!hasValue} onClick={async () => {
        setBusy(true); setError(null);
        try { onClosed(await TillService.close(till.sessionId, countedValue, notes)); }
        catch (e) { setError(e instanceof Error ? e.message : 'Could not close the till'); } finally { setBusy(false); }
      }}>Close till</Button></>}>
      <div className="flex flex-col gap-3">
        <div className="flex gap-1 rounded-lg bg-tray p-1 text-[13px] font-medium" role="group" aria-label="How to count">
          {[['Total', false], ['Note by note', true]].map(([label, v]) => (
            <button key={label as string} type="button" aria-pressed={byNotes === v} onClick={() => setByNotes(v as boolean)}
              className={cn('h-8 flex-1 rounded-md', byNotes === v ? 'bg-surface text-ink shadow-card' : 'text-ink-2')}>{label}</button>
          ))}
        </div>
        {byNotes ? (
          <div className="grid grid-cols-2 gap-2">
            {NGN_DENOMINATIONS.map((d) => (
              <label key={d} className="flex items-center gap-2 text-sm text-ink">
                <span className="w-14 shrink-0 tabular-nums text-ink-2">₦{d.toLocaleString()}</span>
                <span aria-hidden="true" className="text-ink-3">×</span>
                <input className={cn(inputClass, 'h-9 tabular-nums')} type="number" inputMode="numeric" min={0} aria-label={`Number of ₦${d} notes`}
                  value={counts[d] ?? ''} onChange={(e) => setCounts((c) => ({ ...c, [d]: e.target.value }))} />
              </label>
            ))}
          </div>
        ) : (
          <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">Cash counted (₦)
            <input className={cn(inputClass, 'h-12 text-lg tabular-nums')} type="number" inputMode="decimal" min={0} value={counted} onChange={(e) => setCounted(e.target.value)} autoFocus />
          </label>
        )}
        {hasValue && (
          <div className={cn('flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-semibold',
            tone === 'exact' ? 'bg-success-soft text-success-ink' : tone === 'over' ? 'bg-warn-soft text-warn-ink' : 'bg-danger-soft text-danger')} role="status">
            <span className="tabular-nums">{byNotes ? `Counted ${formatMoney(countedValue)}` : 'Cash counted'}</span>
            <span className="tabular-nums">{tone === 'exact' ? 'Matches ✓' : `${tone === 'over' ? 'Over' : 'Short'} by ${formatMoney(Math.abs(diff))}`}</span>
          </div>
        )}
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">Notes (optional)
          <input className={inputClass} value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} placeholder={tone === 'short' ? 'What might explain it?' : ''} />
        </label>
        {error && <p className="m-0 rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger" role="alert">{error}</p>}
      </div>
    </Dialog>
  );
}
