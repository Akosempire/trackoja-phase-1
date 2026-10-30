import { useState } from 'react';
import { useToast } from '../ui/Toast';
import { CashierService } from '../../services/cashier.service';
import { PinDialog } from './PinDialog';

/**
 * Staff → "Set PIN" for one member. The PIN lets them switch to themselves on a
 * shared till device, and lets a manager approve voids and refunds there.
 */
export function StaffPinButton({ storeId, userId, name, hasPin, onChange }: {
  storeId: string; userId: string; name: string; hasPin: boolean; onChange: (hasPin: boolean) => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="h-9 rounded-md px-2.5 text-[13px] font-medium text-ink-2 hover:bg-hover hover:text-ink" aria-label={`${hasPin ? 'Change' : 'Set'} till PIN for ${name}`}>
        {hasPin ? 'Change PIN' : 'Set PIN'}
      </button>
      <PinDialog open={open} onClose={() => setOpen(false)} title={`Till PIN for ${name}`} submitLabel="Save PIN"
        description="4 to 6 digits. On a shared phone or tablet, this PIN shows who is selling. Tell them their PIN in person."
        onSubmit={async (pin) => {
          try { await CashierService.setPin(storeId, userId, pin); } catch (e) { return e instanceof Error ? e.message : 'Not saved'; }
          onChange(true); setOpen(false); toast.success(`PIN saved for ${name}`);
          return null;
        }}>
        {hasPin && (
          <button type="button" className="self-start text-[13px] font-medium text-danger underline"
            onClick={async () => {
              try { await CashierService.clearPin(storeId, userId); onChange(false); setOpen(false); toast.success(`PIN removed for ${name}`); }
              catch (e) { toast.error('Not removed', { description: e instanceof Error ? e.message : undefined }); }
            }}>Remove {name}'s PIN</button>
        )}
      </PinDialog>
    </>
  );
}
