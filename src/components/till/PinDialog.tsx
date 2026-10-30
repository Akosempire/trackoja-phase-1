import { useEffect, useState, type ReactNode } from 'react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { cn } from '../kit';
import { isPin } from '../../services/cashier.service';

/**
 * A 4–6 digit PIN entry with an on-screen keypad (big targets for a counter
 * phone). onSubmit returns an error to show, or null when it worked.
 */
export function PinDialog({ open, onClose, title, description, submitLabel = 'Continue', onSubmit, children }: {
  open: boolean; onClose: () => void; title: string; description?: ReactNode; submitLabel?: string;
  onSubmit: (pin: string) => Promise<string | null>; children?: ReactNode;
}) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setPin(''); setError(null); } }, [open]);

  const press = (d: string) => setPin((p) => (p.length < 6 ? p + d : p));
  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!isPin(pin)) { setError('Enter the 4 to 6 digit PIN'); return; }
    setBusy(true); setError(null);
    const err = await onSubmit(pin).catch((x) => (x instanceof Error ? x.message : 'Something went wrong'));
    setBusy(false);
    if (err) { setError(err); setPin(''); }
  }

  return (
    <Dialog open={open} onClose={onClose} title={title} description={description}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {children}
        <input
          type="password" inputMode="numeric" autoComplete="off" aria-label="PIN" value={pin} maxLength={6}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
          className="h-14 w-full rounded-lg border border-line-strong bg-surface text-center text-2xl tracking-[.5em] text-ink focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15"
        />
        {error && <p className="m-0 rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger" role="alert">{error}</p>}
        <div className="grid grid-cols-3 gap-2" aria-hidden="true">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k, i) => k === '' ? <span key={i} /> : (
            <button key={k} type="button" tabIndex={-1}
              onClick={() => (k === '⌫' ? setPin((p) => p.slice(0, -1)) : press(k))}
              className={cn('h-12 rounded-lg border border-line bg-subtle text-lg font-semibold text-ink active:bg-hover')}>{k}</button>
          ))}
        </div>
        <Button type="submit" loading={busy} disabled={!isPin(pin)}>{submitLabel}</Button>
      </form>
    </Dialog>
  );
}
