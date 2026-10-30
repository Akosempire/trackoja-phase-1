import { useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Dialog } from '../../../components/ui/Dialog';
import { useToast } from '../../../components/ui/Toast';
import { inputClass } from '../../../components/kit';
import { RestockService } from '../../../services/restock.service';
import { formatMoney } from '../../../utils/format';
import { Labelled, NumberBox } from './shared';

/** Record money paid to a supplier: one delivery, or the oldest unpaid first. */
export function PayDialog({ open, onClose, onDone, storeId, supplierId, purchaseId, owed, supplierName }: {
  open: boolean; onClose: () => void; onDone: () => void; storeId: string; supplierId: string; purchaseId?: string | null; owed: number; supplierName: string;
}) {
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('transfer');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = Number(amount);
  async function pay() {
    setBusy(true); setError(null);
    try {
      const left = await RestockService.paySupplier(storeId, { supplierId, amount: n, purchaseId, method, reference });
      toast.success('Payment recorded', { description: left > 0 ? `You still owe ${formatMoney(left)}.` : `${supplierName} is fully paid.` });
      setAmount(''); setReference(''); onDone(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Not saved'); } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onClose={onClose} title={`Pay ${supplierName}`} description={`You owe ${formatMoney(owed)}${purchaseId ? ' on this delivery' : ''}. ${purchaseId ? '' : 'Payments clear the oldest deliveries first.'}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={pay} loading={busy} disabled={!(n > 0) || n > owed}>Record payment</Button></>}>
      <div className="flex flex-col gap-3">
        {error && <p className="m-0 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">{error}</p>}
        <Labelled label="Amount" hint={<button type="button" className="font-semibold text-brand" onClick={() => setAmount(String(owed))}>Pay all {formatMoney(owed)}</button>}>
          <NumberBox label="Amount" value={amount} onChange={setAmount} />
        </Labelled>
        <div className="grid grid-cols-2 gap-2">
          <Labelled label="Method">
            <select className={inputClass} value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="transfer">Transfer</option><option value="cash">Cash</option><option value="card">Card</option><option value="other">Other</option>
            </select>
          </Labelled>
          <Labelled label="Reference"><input className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" /></Labelled>
        </div>
      </div>
    </Dialog>
  );
}
