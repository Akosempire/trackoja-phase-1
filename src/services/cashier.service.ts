import { supabase } from '../config/supabase';

import { refreshPermissions } from '../hooks/usePermissions';

/**
 * Cashier PINs on a shared device. A PIN switches who is working: sales are
 * recorded under that person AND the device can only do what their role
 * allows, until someone switches again. Going back to the signed-in account
 * needs that person to be a manager/owner, or a manager's PIN. A manager's PIN
 * can also approve a void or refund. PINs are hashed and never read back.
 */
export interface ActingCashier { userId: string; name: string; role?: string | null; expiresAt?: string }
type PinResult<T> = { ok: true } & T | { ok: false; error: string };

function fail(error: { message?: string } | null): never {
  throw new Error(error?.message?.replace(/^.*?ERROR:\s*/, '') || 'Something went wrong. Try again.');
}

export class NeedsManagerPin extends Error {
  constructor() { super('A manager or the owner needs to approve this with their PIN'); }
}

export function isPin(value: string): boolean {
  return /^[0-9]{4,6}$/.test(value);
}

export class CashierService {
  static async current(storeId: string): Promise<ActingCashier | null> {
    const { data, error } = await supabase.rpc('current_cashier', { p_store_id: storeId });
    if (error) return null;
    return data ? { userId: data.user_id, name: data.name, role: data.role ?? null, expiresAt: data.expires_at } : null;
  }
  static async identify(storeId: string, pin: string): Promise<PinResult<{ cashier: ActingCashier }>> {
    const { data, error } = await supabase.rpc('identify_cashier', { p_store_id: storeId, p_pin: pin });
    if (error) return { ok: false, error: error.message?.replace(/^.*?ERROR:\s*/, '') || 'Could not check the PIN' };
    if (!data?.ok) return { ok: false, error: data?.error ?? 'That PIN is not right' };
    refreshPermissions();
    return { ok: true, cashier: { userId: data.user_id, name: data.name, role: data.role ?? null } };
  }
  /** Back to the signed-in account. Throws NeedsManagerPin when a manager must approve. */
  static async clear(storeId: string, approvalId?: string): Promise<void> {
    const { error } = await supabase.rpc('clear_cashier', { p_store_id: storeId, ...(approvalId ? { p_approval_id: approvalId } : {}) });
    if (error) {
      if (/manager or the owner/i.test(error.message ?? '')) throw new NeedsManagerPin();
      fail(error);
    }
    refreshPermissions();
  }
  /** Back to the signed-in account with a manager's or the owner's PIN. */
  static async clearWithManagerPin(storeId: string, pin: string): Promise<PinResult<{ approvedBy: string }>> {
    const { data, error } = await supabase.rpc('request_manager_override', { p_store_id: storeId, p_action: 'exit_register', p_pin: pin, p_context: {} });
    if (error) return { ok: false, error: error.message?.replace(/^.*?ERROR:\s*/, '') || 'Could not check the PIN' };
    if (!data?.ok) return { ok: false, error: data?.error ?? 'That PIN is not right' };
    await CashierService.clear(storeId, data.approval_id);
    return { ok: true, approvedBy: data.approver_name };
  }
  static async pinStatus(storeId: string): Promise<Set<string>> {
    const { data, error } = await supabase.rpc('staff_pin_status', { p_store_id: storeId });
    if (error) return new Set();
    return new Set((data as string[]) ?? []);
  }
  static async setPin(storeId: string, userId: string, pin: string): Promise<void> {
    const { error } = await supabase.rpc('set_staff_pin', { p_store_id: storeId, p_user_id: userId, p_pin: pin });
    if (error) fail(error);
  }
  static async clearPin(storeId: string, userId: string): Promise<void> {
    const { error } = await supabase.rpc('clear_staff_pin', { p_store_id: storeId, p_user_id: userId });
    if (error) fail(error);
  }
  static async voidWithPin(saleId: string, reason: string, pin: string): Promise<PinResult<{ approvedBy: string }>> {
    const { data, error } = await supabase.rpc('void_sale_with_pin', { p_sale_id: saleId, p_reason: reason, p_pin: pin });
    if (error) return { ok: false, error: error.message?.replace(/^.*?ERROR:\s*/, '') || 'Could not void the sale' };
    return data?.ok ? { ok: true, approvedBy: data.approved_by } : { ok: false, error: data?.error ?? 'That PIN is not right' };
  }
  static async refundWithPin(saleId: string, input: { amount: number; reason: string; method: string; items?: { saleItemId: string; quantity: number }[] }, pin: string): Promise<PinResult<{ approvedBy: string }>> {
    const { data, error } = await supabase.rpc('process_refund_with_pin', {
      p_sale_id: saleId, p_amount: input.amount, p_reason: input.reason, p_method: input.method,
      p_items: input.items?.length ? input.items : null, p_pin: pin,
    });
    if (error) return { ok: false, error: error.message?.replace(/^.*?ERROR:\s*/, '') || 'Could not refund' };
    return data?.ok ? { ok: true, approvedBy: data.approved_by } : { ok: false, error: data?.error ?? 'That PIN is not right' };
  }
}
