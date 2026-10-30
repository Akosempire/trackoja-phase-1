import { supabase } from '../config/supabase';
import type { UsageRow } from '../utils/usageArea';

/** Settings → Privacy & data, the daily email, and time in the app. */
export interface BusinessDeletion { owner: boolean; name: string; requested_at: string | null; due_at: string | null }

export class AccountService {
  static async exportStoreData(storeId: string): Promise<Record<string, unknown>> {
    const { data, error } = await supabase.rpc('export_store_data', { p_store_id: storeId });
    if (error) throw error;
    return data as Record<string, unknown>;
  }
  static async getDeletion(orgId: string): Promise<BusinessDeletion | null> {
    const { data, error } = await supabase.rpc('get_business_deletion', { p_org_id: orgId });
    if (error) throw error;
    return (data as BusinessDeletion) ?? null;
  }
  static async requestDeletion(orgId: string, confirmName: string): Promise<string> {
    const { data, error } = await supabase.rpc('request_business_deletion', { p_org_id: orgId, p_confirm_name: confirmName });
    if (error) throw error;
    return data as string;
  }
  static async cancelDeletion(orgId: string): Promise<void> {
    const { error } = await supabase.rpc('cancel_business_deletion', { p_org_id: orgId });
    if (error) throw error;
  }
  static async deleteAccount(): Promise<void> {
    const { data, error } = await supabase.functions.invoke('delete-account', { body: { confirm: 'DELETE' } });
    if (error) {
      const context = (error as { context?: Response }).context;
      let payload: { error?: string } | null = null;
      try { payload = context?.json ? await context.json() : null; } catch { payload = null; }
      throw new Error(payload?.error || 'Your account could not be deleted. Try again.');
    }
    if (data?.error) throw new Error(data.error);
  }
  static async getDailyEmail(storeId: string): Promise<boolean> {
    const { data, error } = await supabase.rpc('get_daily_email', { p_store_id: storeId });
    if (error) throw error;
    return data !== false;
  }
  static async setDailyEmail(storeId: string, on: boolean): Promise<boolean> {
    const { data, error } = await supabase.rpc('set_daily_email', { p_store_id: storeId, p_on: on });
    if (error) throw error;
    return Boolean(data);
  }
  /** Best effort: never throws. */
  static addUsage(storeId: string, area: string, seconds: number): void {
    try { void supabase.rpc('usage_add', { p_store_id: storeId, p_area: area, p_seconds: Math.min(300, Math.round(seconds)) }).then(() => undefined, () => undefined); } catch { /* ignore */ }
  }
  static async platformUsage(days: number): Promise<UsageRow[]> {
    const { data, error } = await supabase.rpc('get_platform_usage', { p_days: days });
    if (error) throw error;
    return (data as UsageRow[]) ?? [];
  }
}
