import { PinDialog } from '../till/PinDialog';
import { OVERRIDE_TITLES, OverrideService, type OverrideAction, type OverrideApproval } from '../../services/override.service';

/**
 * "Manager PIN" for something a cashier can't do alone. The approval is
 * checked and recorded by the database with both names.
 */
export function ManagerPinDialog({ open, storeId, action, reason, context, onClose, onApproved }: {
  open: boolean; storeId: string; action: OverrideAction; reason?: string;
  context?: Record<string, unknown>; onClose: () => void; onApproved: (a: OverrideApproval) => void;
}) {
  return (
    <PinDialog
      open={open} onClose={onClose} title={OVERRIDE_TITLES[action]} submitLabel="Approve"
      description={reason ?? 'A manager or owner enters their PIN to approve this. Both names are recorded.'}
      onSubmit={async (pin) => {
        try {
          const approval = await OverrideService.request(storeId, action, pin, context);
          onApproved(approval);
          return null;
        } catch (e) {
          return e instanceof Error ? e.message : 'That PIN is not right';
        }
      }}
    />
  );
}
