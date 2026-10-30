import { supabase } from '../config/supabase';

/**
 * Cashier PINs on a shared device. A PIN says who is selling; what the device
 * can do stays tied to the signed-in account. A manager's PIN can approve a
 * void or refund. PINs are hashed in the database and never read back.
 */
export interface ActingCashier { userId: string; name: string; expiresAt?: string }
type PinResult<T> = { ok: true } & T | { ok: false; error: string };

function fail(error: { message?: string } | null): never {
  throw new Error(error?.message?.replace(/^.*?ERROR:\s*/, '') || 'Something went wrong. Try again.');
}

export function isPin(value: string): boolean {
  return /^[0-9]{4,6}$/.test(value);
}

export class CashierService {
  static async current(storeId: string): Promise<ActingCashier | null> {
    const { data, error } = await supabase.rpc('current_cashier', { p_store_id: storeId });
    if (error) return null;
    return data ? { userId: data.user_id, name: data.name, expiresAt: data.expires_at } : null;
  }
  static async identify(storeId: string, pin: string): Promise<PinResult<{ cashier: ActingCashier }>> {
    const { data, error } = await supabase.rpc('identify_cashier', { p_store_id: storeId, p_pin: pin });
    if (error) return { ok: false, error: error.message?.replace(/^.*?ERROR:\s*/, '') || 'Could not check the PIN' };
    if (!data?.ok) return { ok: false, error: data?.error ?? 'That PIN is not right' };
    return { ok: true, cashier: { userId: data.user_id, name: data.name } };
  }
  static async clear(storeId: string): Promise<void> {
    const { error } = await supabase.rpc('clear_cashier', { p_store_id: storeId });
    if (error) fail(error);
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
