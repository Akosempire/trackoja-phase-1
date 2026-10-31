import { supabase } from '../config/supabase';

/**
 * Manager PIN overrides at the register: a manager or owner enters their PIN
 * so a cashier can do something they normally can't (a void, a big discount,
 * leaving the register…). The database checks the PIN and the approver's
 * role, and records both names (request_manager_override).
 */
export type OverrideAction = 'void' | 'refund' | 'discount' | 'price_override' | 'remove_after_payment' | 'open_drawer' | 'exit_register';

export interface OverrideApproval { approvalId: string; approverName: string }

export const OVERRIDE_TITLES: Record<OverrideAction, string> = {
  void: 'Approve void',
  refund: 'Approve refund',
  discount: 'Approve discount',
  price_override: 'Approve price change',
  remove_after_payment: 'Approve removing an item',
  open_drawer: 'Approve opening the drawer',
  exit_register: 'Leave the register',
};

export class OverrideNotAvailable extends Error {}

const clean = (m?: string) => m?.replace(/^.*?ERROR:\s*/, '') || 'Could not check the PIN';

export class OverrideService {
  static async request(storeId: string, action: OverrideAction, pin: string, context: Record<string, unknown> = {}): Promise<OverrideApproval> {
    const { data, error } = await supabase.rpc('request_manager_override', {
      p_store_id: storeId, p_action: action, p_pin: pin, p_context: context,
    });
    if (error) {
      // the database hasn't got overrides yet (older migration)
      if (/request_manager_override|function .* does not exist|PGRST202/i.test(`${error.message} ${(error as { code?: string }).code ?? ''}`)) {
        throw new OverrideNotAvailable('Manager approval needs a database update. Ask the owner to update TrackOja.');
      }
      throw new Error(clean(error.message));
    }
    if (data && data.ok === false) throw new Error(data.error ?? 'That PIN is not right');
    if (!data?.approval_id) throw new Error('That PIN is not right');
    return { approvalId: data.approval_id, approverName: data.approver_name ?? 'Manager' };
  }
}
