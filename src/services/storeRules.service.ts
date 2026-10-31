import { supabase } from '../config/supabase';

/**
 * Store rules a manager sets: the biggest discount a cashier can give without
 * a manager's PIN. The database enforces it on every sale; this only reads and
 * saves the number.
 */
export class StoreRulesService {
  /** Percent of the sale, or null for no limit. */
  static async getDiscountLimit(storeId: string): Promise<number | null> {
    const { data, error } = await supabase.from('store_settings').select('discount_limit_percent').eq('store_id', storeId).maybeSingle();
    if (error) throw new Error(error.message);
    const v = (data as { discount_limit_percent?: number | string | null } | null)?.discount_limit_percent;
    return v === null || v === undefined ? null : Number(v);
  }
  static async setDiscountLimit(storeId: string, percent: number | null): Promise<number | null> {
    const { error } = await supabase.rpc('set_discount_limit', { p_store_id: storeId, p_percent: percent });
    if (error) throw new Error(error.message?.replace(/^.*?ERROR:\s*/, '') || 'Could not save');
    return percent;
  }
}

/** "", "10", "12.5" → number|null; anything else → undefined (invalid). */
export function parseDiscountLimit(text: string): number | null | undefined {
  const t = text.trim().replace(/%$/, '').trim();
  if (t === '') return null;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return undefined;
  const n = Number(t);
  return n >= 0 && n <= 100 ? n : undefined;
}
