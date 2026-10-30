import { supabase } from '../config/supabase';

/**
 * Till sessions (supabase/migrations/20261030001000_till_sessions.sql): open
 * with a float, record cash in/out, close by counting the drawer. The close
 * stores the end-of-day report; history lists past sessions.
 */
export interface TillMovement { kind: 'in' | 'out'; amount: number; reason: string; at: string; by: string }
export interface TillNumbers {
  sessionId: string;
  storeId: string;
  status: 'open' | 'closed';
  openedAt: string;
  closedAt: string | null;
  openedBy: string;
  closedBy: string | null;
  openingFloat: number;
  salesCount: number;
  salesTotal: number;
  discounts: number;
  tax: number;
  byMethod: Record<string, number>;
  cashTaken: number;
  changeGiven: number;
  voidsCount: number;
  voidsTotal: number;
  refundsCount: number;
  refundsTotal: number;
  refundsCash: number;
  cashIn: number;
  cashOut: number;
  movements: TillMovement[];
  cashiers: { name: string; sales: number; total: number }[];
  expectedCash: number;
  countedCash: number | null;
  difference: number | null;
  notes: string | null;
}
export interface TillHistoryRow {
  id: string; status: 'open' | 'closed'; openedAt: string; closedAt: string | null; openedBy: string;
  openingFloat: number; expectedCash: number | null; countedCash: number | null; difference: number | null; salesTotal: number;
}

const num = (v: unknown) => Number(v ?? 0) || 0;
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export function mapTillNumbers(r: Record<string, any>): TillNumbers {
  const byMethod: Record<string, number> = {};
  for (const [k, v] of Object.entries(r.by_method ?? {})) byMethod[k] = num(v);
  return {
    sessionId: r.session_id, storeId: r.store_id, status: r.status, openedAt: r.opened_at, closedAt: r.closed_at ?? null,
    openedBy: r.opened_by ?? '', closedBy: r.closed_by ?? null, openingFloat: num(r.opening_float),
    salesCount: num(r.sales_count), salesTotal: num(r.sales_total), discounts: num(r.discounts), tax: num(r.tax), byMethod,
    cashTaken: num(r.cash_taken), changeGiven: num(r.change_given), voidsCount: num(r.voids_count), voidsTotal: num(r.voids_total),
    refundsCount: num(r.refunds_count), refundsTotal: num(r.refunds_total), refundsCash: num(r.refunds_cash),
    cashIn: num(r.cash_in), cashOut: num(r.cash_out),
    movements: (r.movements ?? []).map((m: Record<string, any>) => ({ kind: m.kind, amount: num(m.amount), reason: m.reason ?? '', at: m.at, by: m.by ?? '' })),
    cashiers: (r.cashiers ?? []).map((c: Record<string, any>) => ({ name: c.name ?? '', sales: num(c.sales), total: num(c.total) })),
    expectedCash: num(r.expected_cash), countedCash: numOrNull(r.counted_cash), difference: numOrNull(r.difference), notes: r.notes ?? null,
  };
}

function fail(error: { message?: string } | null): never {
  throw new Error(error?.message?.replace(/^.*?ERROR:\s*/, '') || 'Something went wrong. Try again.');
}

export class TillService {
  static async current(storeId: string): Promise<TillNumbers | null> {
    const { data, error } = await supabase.rpc('till_current', { p_store_id: storeId });
    if (error) fail(error);
    return data ? mapTillNumbers(data) : null;
  }
  static async open(storeId: string, openingFloat: number): Promise<TillNumbers> {
    const { data, error } = await supabase.rpc('till_open', { p_store_id: storeId, p_opening_float: openingFloat });
    if (error) fail(error);
    return mapTillNumbers(data);
  }
  static async cashMove(sessionId: string, kind: 'in' | 'out', amount: number, reason: string): Promise<TillNumbers> {
    const { data, error } = await supabase.rpc('till_cash_move', { p_session_id: sessionId, p_kind: kind, p_amount: amount, p_reason: reason });
    if (error) fail(error);
    return mapTillNumbers(data);
  }
  static async close(sessionId: string, countedCash: number, notes?: string): Promise<TillNumbers> {
    const { data, error } = await supabase.rpc('till_close', { p_session_id: sessionId, p_counted_cash: countedCash, p_notes: notes ?? null });
    if (error) fail(error);
    return mapTillNumbers(data);
  }
  static async report(sessionId: string): Promise<TillNumbers> {
    const { data, error } = await supabase.rpc('till_report', { p_session_id: sessionId });
    if (error) fail(error);
    return mapTillNumbers(data);
  }
  static async history(storeId: string): Promise<TillHistoryRow[]> {
    const { data, error } = await supabase.rpc('till_history', { p_store_id: storeId, p_limit: 60 });
    if (error) fail(error);
    return ((data as Record<string, any>[]) ?? []).map((r) => ({
      id: r.id, status: r.status, openedAt: r.opened_at, closedAt: r.closed_at ?? null, openedBy: r.opened_by ?? '',
      openingFloat: num(r.opening_float), expectedCash: numOrNull(r.expected_cash), countedCash: numOrNull(r.counted_cash),
      difference: numOrNull(r.difference), salesTotal: num(r.sales_total),
    }));
  }
  static async isRequired(storeId: string): Promise<boolean> {
    const { data } = await supabase.from('store_settings').select('require_open_till').eq('store_id', storeId).maybeSingle();
    return Boolean((data as { require_open_till?: boolean } | null)?.require_open_till);
  }
  static async setRequired(storeId: string, required: boolean): Promise<void> {
    const { error } = await supabase.rpc('till_set_required', { p_store_id: storeId, p_required: required });
    if (error) fail(error);
  }
}
