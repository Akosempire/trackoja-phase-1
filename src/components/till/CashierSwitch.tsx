import { useEffect, useState, type ReactNode } from 'react';
import { useToast } from '../ui/Toast';
import { cn } from '../kit';
import { CashierService, NeedsManagerPin, type ActingCashier } from '../../services/cashier.service';
import { PinDialog } from './PinDialog';

/**
 * "Cashier: Bayo ▾" on a shared device. Entering a staff PIN makes that person
 * the one working: their sales, their till actions, and only what their role
 * allows, until someone switches again.
 */
export function CashierSwitch({ storeId, accountName, className, onChange, trigger }: {
  storeId: string; accountName?: string; className?: string; onChange?: (c: ActingCashier | null) => void;
  /** Replace the "Cashier: Bayo ▾" chip with your own button (e.g. "Switch user" on the no-access page). */
  trigger?: (open: () => void) => ReactNode;
}) {
  const toast = useToast();
  const [current, setCurrent] = useState<ActingCashier | null>(null);
  const [open, setOpen] = useState(false);
  const [managerStep, setManagerStep] = useState(false);
  const done = (msg: string) => { setCurrent(null); onChange?.(null); setOpen(false); setManagerStep(false); toast.info(msg); };

  useEffect(() => { CashierService.current(storeId).then((c) => { setCurrent(c); onChange?.(c); }); }, [storeId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {trigger ? trigger(() => setOpen(true)) : <button type="button" onClick={() => setOpen(true)}
        className={cn('inline-flex h-8 max-w-[220px] items-center gap-1.5 rounded-full border border-line-strong bg-surface px-3 text-[13px] font-medium text-ink hover:bg-hover', className)}
        aria-label={`Cashier: ${current?.name ?? accountName ?? 'you'}. Switch cashier`}>
        <span className="text-ink-3">Cashier</span>
        <span className="truncate">{current?.name ?? accountName ?? 'You'}</span>
        <span aria-hidden="true" className="text-ink-3">▾</span>
      </button>}
      <PinDialog
        open={open && !managerStep} onClose={() => setOpen(false)} title="Switch user" submitLabel="Switch"
        description="Enter your staff PIN. Sales are recorded under your name, and this device can only do what your role allows until someone switches."
        onSubmit={async (pin) => {
          const r = await CashierService.identify(storeId, pin);
          if (!r.ok) return r.error;
          setCurrent(r.cashier); onChange?.(r.cashier); setOpen(false);
          toast.success(`${r.cashier.name} is now working on this device`);
          return null;
        }}
      >
        {current && (
          <button type="button" className="inline-flex min-h-[44px] items-center self-start text-[13px] font-medium text-brand-ink underline"
            onClick={async () => {
              try { await CashierService.clear(storeId); done('Back to the signed-in account'); }
              catch (e) { if (e instanceof NeedsManagerPin) setManagerStep(true); else toast.error('That did not work', { description: e instanceof Error ? e.message : 'Try again.' }); }
            }}>
            {current.name} is done. Use the signed-in account
          </button>
        )}
      </PinDialog>
      <PinDialog
        open={open && managerStep} onClose={() => { setManagerStep(false); setOpen(false); }} title="Manager approval" submitLabel="Approve"
        description={`${current?.name ?? 'This person'} is a cashier. A manager or the owner enters their PIN to hand the device back to the signed-in account.`}
        onSubmit={async (pin) => {
          const r = await CashierService.clearWithManagerPin(storeId, pin);
          if (!r.ok) return r.error;
          done(`Approved by ${r.approvedBy}. Back to the signed-in account`);
          return null;
        }}
      />
    </>
  );
}
