import { useState } from 'react';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { useToast } from '../ui/Toast';
import { cn, inputClass } from '../kit';
import { SaleService } from '../../services/sale.service';
import { CashierService } from '../../services/cashier.service';

/**
 * Void a sale (rang wrongly, customer walked away). Stock goes back. People
 * without void permission can void with a manager's PIN.
 */
export function VoidSaleAction({ saleId, saleNumber, canVoid, onVoided }: { saleId: string; saleNumber: string; canVoid: boolean; onVoided: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (reason.trim().length < 3) { setError('Add a short reason'); return; }
    setBusy(true); setError(null);
    try {
      if (canVoid) {
        await SaleService.voidSale(saleId, reason.trim());
        toast.success(`Sale #${saleNumber} voided`);
      } else {
        const r = await CashierService.voidWithPin(saleId, reason.trim(), pin);
        setPin('');
        if (!r.ok) { setError(r.error); return; }
        toast.success(`Sale #${saleNumber} voided`, { description: `Approved by ${r.approvedBy}` });
      }
      setOpen(false); onVoided();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not void the sale');
    } finally { setBusy(false); }
  }

  return (
    <>
      <Button variant="ghost" onClick={() => { setReason(''); setPin(''); setError(null); setOpen(true); }}>Void</Button>
      <Dialog open={open} onClose={() => setOpen(false)} danger title={`Void sale #${saleNumber}?`}
        description="The sale is cancelled and its items go back into stock. This can't be undone."
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Keep sale</Button>
          <Button variant="danger" loading={busy} disabled={!canVoid && pin.length < 4} onClick={confirm}>Void sale</Button></>}>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">Reason
            <input className={inputClass} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Rang up twice" autoFocus />
          </label>
          {!canVoid && (
            <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">Manager's PIN
              <input className={cn(inputClass, 'tracking-[.4em]')} type="password" inputMode="numeric" autoComplete="off" maxLength={6}
                value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder="Ask a manager to enter it" />
            </label>
          )}
          {error && <p className="m-0 rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger" role="alert">{error}</p>}
        </div>
      </Dialog>
    </>
  );
}
