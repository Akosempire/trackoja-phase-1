import { supabase } from '../config/supabase';

export interface MerchantAttempt {
  id: string;
  saleId: string;
  storeId: string;
  terminalId: string;
  terminalLastFour: string;
  expectedAmount: number;
  actualAmount: number | null;
  merchantReference: string;
  providerReference: string | null;
  status: 'created' | 'sending' | 'pending' | 'unresolved' | 'successful' | 'failed' | 'cancelled' | 'expired' | 'reconciliation_required';
  providerStatus: string | null;
  failureCode: string | null;
  initiatedAt: string;
  completedAt: string | null;
  environment: 'live' | 'sandbox';
  paymentMethod: string;
  actualPaymentMethod: 'card' | 'transfer' | null;
  initiatedBy: string;
  saleNumber?: string;
  customerName?: string | null;
  initiatorName?: string;
}

export interface MoniepointConnection {
  status: 'disconnected' | 'configured' | 'connected' | 'error';
  environment: 'live' | 'sandbox';
  authMode?: 'api_key' | 'client_credentials';
  erpEnabled: boolean;
  lastVerifiedAt?: string | null;
  amountUnitConfirmed?: boolean;
  approvalCodesConfirmed?: boolean;
}

export interface MoniepointTerminal {
  id: string;
  name: string;
  storeId: string;
  serialLastFour: string;
  status: string;
  isDefault: boolean;
  registerId: string | null;
  verifiedAt: string | null;
}

export interface MerchantRegister { id: string; name: string; status: string }

export function describeAttempt(attempt: MerchantAttempt): string {
  switch (attempt.failureCode) {
    case 'PROVIDER_REJECTED': return 'Moniepoint rejected the request. Check the connection before retrying.';
    case 'PROVIDER_DECLINED': return 'The payment was declined on the terminal. You can retry the same sale.';
    case 'PROVIDER_CANCELLED': return 'The customer cancelled this request on the terminal.';
    case 'CANCELLED_WITH_AMOUNT': return 'Moniepoint reports a cancelled request with an amount. Review it before taking another payment.';
    case 'SETTLEMENT_RPC_FAILED': return 'Moniepoint responded, but TrackOja could not reconcile the sale. Review required.';
    case 'SEND_OUTCOME_UNKNOWN': return 'The request may have reached the terminal. Check its status before taking another payment.';
    case 'STATUS_UNAVAILABLE': return 'Moniepoint status is unavailable. Do not collect another payment yet.';
    case 'PROVIDER_IDENTITY_MISMATCH': return 'The provider returned a different reference, terminal, or requested amount. Review required.';
    case 'AMOUNT_OR_REFERENCE_MISMATCH': return 'The provider amount or transaction reference does not match this sale. Review required.';
    case 'SALE_HAS_ANOTHER_PAYMENT': return 'Another payment attempt is linked to this sale. Review required.';
    case 'UNKNOWN_PAYMENT_METHOD': return 'Moniepoint returned an unknown payment method. Review required.';
    case 'FINALIZATION_FAILED': return 'Moniepoint may have collected payment, but TrackOja could not finish the sale. Review required.';
    case 'STATUS_NOT_DECISIVE': return 'The provider result is not enough to confirm payment. Check again later.';
    default: return attempt.status === 'pending' ? 'Complete the payment on the selected terminal.' :
      attempt.status === 'successful' ? 'Payment was verified by Moniepoint.' :
      'Check the transaction status before taking another payment.';
  }
}

function mapAttempt(row: Record<string, any>): MerchantAttempt {
  return {
    id: row.id, saleId: row.sale_id, storeId: row.store_id, terminalId: row.terminal_id,
    terminalLastFour: String(row.terminal_serial ?? '').slice(-4),
    expectedAmount: Number(row.expected_amount), actualAmount: row.actual_amount == null ? null : Number(row.actual_amount),
    merchantReference: row.merchant_reference, providerReference: row.provider_reference,
    status: row.status, providerStatus: row.provider_processing_status,
    failureCode: row.failure_code, initiatedAt: row.initiated_at, completedAt: row.completed_at,
    environment: row.environment, paymentMethod: row.payment_method,
    actualPaymentMethod: row.actual_payment_method ?? null, initiatedBy: row.initiated_by,
  };
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('merchant-moniepoint', { body });
  if (error) {
    const context = (error as { context?: Response }).context;
    if (context?.json) {
      try {
        const payload = await context.json();
        if (typeof payload?.error === 'string') throw new Error(payload.error);
      } catch (cause) {
        if (cause instanceof Error && cause.message !== 'Unexpected end of JSON input') throw cause;
      }
    }
    throw error;
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}

export class MerchantPaymentService {
  static async connection(storeId: string): Promise<MoniepointConnection> {
    const result = await invoke<{ connection: MoniepointConnection }>({ action: 'connection', storeId });
    return result.connection;
  }

  static async saveConnection(storeId: string, values: {
    authMode: 'api_key' | 'client_credentials'; apiKey?: string; clientId?: string;
    clientSecret?: string; erpEnabled: boolean;
  }): Promise<void> {
    await invoke({ action: 'save_connection', storeId, ...values });
  }

  static async testConnection(storeId: string): Promise<string> {
    const result = await invoke<{ status: string; message?: string }>({ action: 'test_connection', storeId });
    return result.message ?? `Connection status: ${result.status}`;
  }

  static async disconnect(storeId: string): Promise<void> {
    await invoke({ action: 'disconnect', storeId });
  }

  static async terminals(storeId: string): Promise<MoniepointTerminal[]> {
    const { data, error } = await supabase.from('devices')
      .select('id, name, store_id, serial_number, status, is_default_payment_terminal, register_id, provider_verified_at')
      .eq('store_id', storeId).eq('type', 'payment_terminal').eq('provider', 'moniepoint')
      .neq('status', 'decommissioned').order('name');
    if (error) throw error;
    return (data ?? []).map((row) => ({
      id: row.id, name: row.name, storeId: row.store_id,
      serialLastFour: String(row.serial_number ?? '').slice(-4), status: row.status,
      isDefault: !!row.is_default_payment_terminal, registerId: row.register_id ?? null,
      verifiedAt: row.provider_verified_at ?? null,
    }));
  }

  static async registers(storeId: string): Promise<MerchantRegister[]> {
    const { data, error } = await supabase.from('merchant_registers').select('id, name, status')
      .eq('store_id', storeId).order('name');
    if (error) throw error;
    return data ?? [];
  }

  static async addRegister(storeId: string, userId: string, name: string): Promise<void> {
    const { error } = await supabase.from('merchant_registers').insert({ store_id: storeId, name: name.trim(), created_by: userId });
    if (error) throw error;
  }

  static async assignRegister(terminalId: string, registerId: string | null): Promise<void> {
    const { error } = await supabase.from('devices').update({ register_id: registerId }).eq('id', terminalId);
    if (error) throw error;
  }

  static async setDefaultTerminal(terminalId: string): Promise<void> {
    const { error } = await supabase.rpc('set_default_moniepoint_terminal', { p_terminal_id: terminalId });
    if (error) throw error;
  }

  static async attempts(storeId: string): Promise<MerchantAttempt[]> {
    const { data, error } = await supabase.from('merchant_payment_attempts').select('*')
      .eq('store_id', storeId).order('initiated_at', { ascending: false }).limit(100);
    if (error) throw error;
    const attempts = (data ?? []).map(mapAttempt);
    if (attempts.length === 0) return attempts;
    const [sales, users] = await Promise.all([
      supabase.from('sales').select('id, sale_number, customer_name')
        .in('id', attempts.map((attempt) => attempt.saleId)),
      supabase.from('users').select('id, first_name, last_name')
        .in('id', [...new Set(attempts.map((attempt) => attempt.initiatedBy))]),
    ]);
    const byId = new Map((sales.data ?? []).map((sale) => [sale.id, sale]));
    const userById = new Map((users.data ?? []).map((row) => [row.id,
      [row.first_name, row.last_name].filter(Boolean).join(' ') || 'Staff member']));
    return attempts.map((attempt) => ({ ...attempt,
      saleNumber: byId.get(attempt.saleId)?.sale_number,
      customerName: byId.get(attempt.saleId)?.customer_name,
      initiatorName: userById.get(attempt.initiatedBy),
    }));
  }

  static async activeAttempts(storeId: string, userId: string): Promise<MerchantAttempt[]> {
    const { data, error } = await supabase.from('merchant_payment_attempts').select('*')
      .eq('store_id', storeId).eq('initiated_by', userId)
      .in('status', ['created', 'sending', 'pending', 'unresolved', 'reconciliation_required'])
      .order('initiated_at', { ascending: false }).limit(20);
    if (error) throw error;
    return (data ?? []).map(mapAttempt);
  }

  static async getAttempt(attemptId: string): Promise<MerchantAttempt> {
    const { data, error } = await supabase.from('merchant_payment_attempts').select('*')
      .eq('id', attemptId).single();
    if (error || !data) throw new Error('Payment attempt not found or access denied');
    return mapAttempt(data);
  }

  static async reconciliationAttempts(storeId: string): Promise<MerchantAttempt[]> {
    const { data, error } = await supabase.from('merchant_payment_attempts').select('*')
      .eq('store_id', storeId).in('status', ['unresolved', 'reconciliation_required', 'sending'])
      .order('initiated_at', { ascending: true }).limit(100);
    if (error) throw error;
    return (data ?? []).map(mapAttempt);
  }

  static async initiate(values: {
    storeId: string; terminalId: string; checkoutKey: string; requestKey: string;
    items: { productId: string; quantity: number }[]; customerId?: string;
    discountTotal: number; orderType?: string; tableNumber?: string;
  }): Promise<MerchantAttempt> {
    const result = await invoke<{ attempt: MerchantAttempt }>({ action: 'initiate', ...values });
    return result.attempt;
  }

  static async check(attemptId: string): Promise<{ attempt: MerchantAttempt; message?: string }> {
    return invoke({ action: 'check', attemptId });
  }
}
