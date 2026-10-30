import { useEffect, useState } from 'react';
import { useToast } from '../ui/Toast';
import { cn } from '../kit';
import { CashierService, type ActingCashier } from '../../services/cashier.service';
import { PinDialog } from './PinDialog';

/**
 * "Cashier: Bayo ▾" on a shared device. Entering a staff PIN makes that person
 * the cashier for this account's sales and till actions for 12 hours.
 */
export function CashierSwitch({ storeId, accountName, className, onChange }: {
  storeId: string; accountName?: string; className?: string; onChange?: (c: ActingCashier | null) => void;
}) {
  const toast = useToast();
  const [current, setCurrent] = useState<ActingCashier | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => { CashierService.current(storeId).then((c) => { setCurrent(c); onChange?.(c); }); }, [storeId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className={cn('inline-flex h-8 max-w-[220px] items-center gap-1.5 rounded-full border border-line-strong bg-surface px-3 text-[13px] font-medium text-ink hover:bg-hover', className)}
        aria-label={`Cashier: ${current?.name ?? accountName ?? 'you'}. Switch cashier`}>
        <span className="text-ink-3">Cashier</span>
        <span className="truncate">{current?.name ?? accountName ?? 'You'}</span>
        <span aria-hidden="true" className="text-ink-3">▾</span>
      </button>
      <PinDialog
        open={open} onClose={() => setOpen(false)} title="Switch cashier" submitLabel="Switch"
        description="Enter your staff PIN so your sales are recorded under your name. What this device can do doesn't change."
        onSubmit={async (pin) => {
          const r = await CashierService.identify(storeId, pin);
          if (!r.ok) return r.error;
          setCurrent(r.cashier); onChange?.(r.cashier); setOpen(false);
          toast.success(`${r.cashier.name} is now selling`);
          return null;
        }}
      >
        {current && (
          <button type="button" className="self-start text-[13px] font-medium text-brand-ink underline"
            onClick={async () => { await CashierService.clear(storeId).catch(() => undefined); setCurrent(null); onChange?.(null); setOpen(false); toast.info('Back to the signed-in account'); }}>
            {current.name} is done. Use the signed-in account
          </button>
        )}
      </PinDialog>
    </>
  );
}
