import { useState } from 'react';
import { Button } from '../ui/Button';
import { Card, inputClass } from '../kit';
import { TillService, type TillNumbers } from '../../services/till.service';

/** "Open till to start selling", with the opening cash count right on the register. */
export function TillOpenCard({ storeId, onOpened }: { storeId: string; onOpened: (till: TillNumbers) => void }) {
  const [float, setFloat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function open(e: React.FormEvent) {
    e.preventDefault();
    const amount = Number(float.replace(/,/g, ''));
    if (!(amount >= 0) || float.trim() === '') { setError('Count the cash in the drawer and enter it (0 if empty)'); return; }
    setBusy(true); setError(null);
    try { onOpened(await TillService.open(storeId, amount)); }
    catch (x) { setError(x instanceof Error ? x.message : 'Could not open the till'); }
    finally { setBusy(false); }
  }
  return (
    <Card className="mb-4 border-warn/40 bg-warn-soft/40" aria-labelledby="till-open-title">
      <h2 id="till-open-title" className="m-0 text-[17px] font-semibold text-ink">Open till to start selling</h2>
      <p className="m-0 mt-1 text-sm text-ink-2">This shop counts the cash before selling. Count the drawer and enter the amount.</p>
      <form onSubmit={open} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm font-medium text-ink">Cash in the drawer (₦)
          <input className={`${inputClass} h-12 text-[17px]`} inputMode="decimal" value={float} onChange={(e) => setFloat(e.target.value.replace(/[^\d.,]/g, ''))} placeholder="Enter amount" aria-describedby={error ? 'till-open-error' : undefined} />
        </label>
        <Button type="submit" loading={busy} className="h-12 sm:w-40">Open till</Button>
      </form>
      {error && <p id="till-open-error" className="m-0 mt-2 text-[13px] text-danger" role="alert">{error}</p>}
    </Card>
  );
}
