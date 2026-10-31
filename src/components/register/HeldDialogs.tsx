import { useEffect, useState } from 'react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { formatMoney, formatRelative } from '../../utils/format';
import { readHeld, takeHeld, type HeldSale } from '../../utils/held-sales';
import { inputClass } from '../kit';

/** Held sales on this device, kept fresh when another tab holds or resumes one. */
export function useHeld(storeId: string | undefined): HeldSale[] {
  const [held, setHeld] = useState<HeldSale[]>(() => (storeId ? readHeld(storeId) : []));
  useEffect(() => {
    if (!storeId) return;
    const refresh = () => setHeld(readHeld(storeId));
    refresh();
    window.addEventListener('trackoja:held', refresh);
    window.addEventListener('storage', refresh);
    return () => { window.removeEventListener('trackoja:held', refresh); window.removeEventListener('storage', refresh); };
  }, [storeId]);
  return held;
}

export function HoldDialog({ open, defaultLabel, onClose, onHold }: { open: boolean; defaultLabel: string; onClose: () => void; onHold: (label: string) => void }) {
  const [label, setLabel] = useState('');
  useEffect(() => { if (open) setLabel(''); }, [open]);
  return (
    <Dialog open={open} onClose={onClose} title="Hold this sale"
      description="It stays on this device until you resume it. Stock and money don't change yet."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => onHold(label.trim() || defaultLabel)}>Hold sale</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); onHold(label.trim() || defaultLabel); }}>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">Name it (optional)
          <input className={inputClass} value={label} maxLength={60} placeholder={defaultLabel} onChange={(e) => setLabel(e.target.value)} autoFocus />
        </label>
      </form>
    </Dialog>
  );
}

export function HeldListDialog({ open, storeId, held, onClose, onResume }: {
  open: boolean; storeId: string; held: HeldSale[]; onClose: () => void; onResume: (sale: HeldSale) => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title="Held sales" description="Resume one to finish it, or remove it.">
      <ul className="m-0 list-none divide-y divide-line p-0">
        {held.map((h) => (
          <li key={h.id} className="flex items-center gap-2 py-3">
            <div className="min-w-0 flex-1">
              <p className="m-0 truncate text-sm font-semibold text-ink">{h.label}</p>
              <p className="m-0 text-[12.5px] text-ink-3">{h.lines.reduce((s, l) => s + l.quantity, 0)} items · {formatMoney(h.total)} · {formatRelative(h.heldAt)}</p>
            </div>
            <Button variant="ghost" className="h-11" onClick={() => { takeHeld(storeId, h.id); }}>Remove</Button>
            <Button className="h-11" onClick={() => { const s = takeHeld(storeId, h.id); if (s) onResume(s); }}>Resume</Button>
          </li>
        ))}
        {held.length === 0 && <li className="py-6 text-center text-sm text-ink-3">Nothing on hold.</li>}
      </ul>
    </Dialog>
  );
}
