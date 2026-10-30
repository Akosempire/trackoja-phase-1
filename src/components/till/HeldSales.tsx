import { useEffect, useState } from 'react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { formatMoney, formatRelative } from '../../utils/format';
import { readHeld, takeHeld, type HeldSale } from '../../utils/held-sales';
import { cn, inputClass } from '../kit';

/**
 * Hold / Held (n) in the current-sale header. Hold parks the cart on this
 * device so the next customer can be served; resume brings it back.
 */
export function HeldSales({ storeId, canHold, onHold, onResume, defaultLabel }: {
  storeId: string; canHold: boolean; defaultLabel: string;
  onHold: (label: string) => void; onResume: (sale: HeldSale) => void;
}) {
  const [held, setHeld] = useState<HeldSale[]>(() => readHeld(storeId));
  const [listOpen, setListOpen] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);
  const [label, setLabel] = useState('');

  useEffect(() => {
    const refresh = () => setHeld(readHeld(storeId));
    refresh();
    window.addEventListener('trackoja:held', refresh);
    window.addEventListener('storage', refresh);
    return () => { window.removeEventListener('trackoja:held', refresh); window.removeEventListener('storage', refresh); };
  }, [storeId]);

  return (
    <div className="flex items-center gap-1.5">
      <button type="button" disabled={!canHold} onClick={() => { setLabel(''); setHoldOpen(true); }}
        className="h-8 rounded-md px-2.5 text-[13px] font-medium text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-40">Hold</button>
      <button type="button" disabled={held.length === 0} onClick={() => setListOpen(true)}
        className={cn('inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium disabled:opacity-40', held.length ? 'bg-brand-soft text-brand-ink' : 'text-ink-2')}>
        Held{held.length > 0 && <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-semibold text-white">{held.length}</span>}
      </button>

      <Dialog open={holdOpen} onClose={() => setHoldOpen(false)} title="Hold this sale"
        description="It stays on this device until you resume it. Stock and money don't change yet."
        footer={<><Button variant="ghost" onClick={() => setHoldOpen(false)}>Cancel</Button>
          <Button onClick={() => { onHold(label.trim() || defaultLabel); setHoldOpen(false); }}>Hold sale</Button></>}>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">Name it (optional)
          <input className={inputClass} value={label} maxLength={60} placeholder={defaultLabel} onChange={(e) => setLabel(e.target.value)} autoFocus />
        </label>
      </Dialog>

      <Dialog open={listOpen} onClose={() => setListOpen(false)} title="Held sales" description="Resume one to finish it, or remove it.">
        <ul className="m-0 list-none divide-y divide-line p-0">
          {held.map((h) => (
            <li key={h.id} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="m-0 truncate text-sm font-semibold text-ink">{h.label}</p>
                <p className="m-0 text-[12.5px] text-ink-3">{h.lines.reduce((s, l) => s + l.quantity, 0)} items · {formatMoney(h.total)} · {formatRelative(h.heldAt)}</p>
              </div>
              <Button variant="ghost" className="btn-sm" onClick={() => { takeHeld(storeId, h.id); }}>Remove</Button>
              <Button className="btn-sm" onClick={() => { const s = takeHeld(storeId, h.id); if (s) onResume(s); setListOpen(false); }}>Resume</Button>
            </li>
          ))}
          {held.length === 0 && <li className="py-6 text-center text-sm text-ink-3">Nothing on hold.</li>}
        </ul>
      </Dialog>
    </div>
  );
}
