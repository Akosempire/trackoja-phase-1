// services/device.service.ts
// Device registry, sessions, and transactions service (Phase 9)

import { supabase } from '../config/supabase';
import type {
  Device,
  CreateDeviceRequest,
  UpdateDeviceRequest,
  DeviceSession,
  DeviceTransaction,
  RecordDeviceTransactionRequest,
  DeviceTransactionStatus,
  OpayInitiatePaymentRequest,
  OpayInitiatePaymentResponse,
} from '../types';

export class DeviceService {
  /**
   * List registered devices for a store, most recently registered first.
   */
  static async getDevices(storeId: string): Promise<Device[]> {
    try {
      const { data, error } = await supabase
        .from('devices')
        .select('*')
        .eq('store_id', storeId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data ? data.map((d) => this.mapDeviceData(d)) : [];
    } catch (error) {
      console.error('Get devices error:', error);
      throw error;
    }
  }

  /**
   * Get a single device.
   */
  static async getDevice(deviceId: string): Promise<Device> {
    try {
      const { data, error } = await supabase.from('devices').select('*').eq('id', deviceId).single();

      if (error) throw error;
      if (!data) throw new Error('Device not found');

      return this.mapDeviceData(data);
    } catch (error) {
      console.error('Get device error:', error);
      throw error;
    }
  }

  /**
   * Register a new device for a store, enforcing devices:manage via RLS.
   */
  static async registerDevice(storeId: string, userId: string, request: CreateDeviceRequest): Promise<Device> {
    try {
      const { data, error } = await supabase
        .from('devices')
        .insert({
          store_id: storeId,
          name: request.name,
          type: request.type,
          provider: request.provider ?? null,
          serial_number: request.serialNumber ?? null,
          model: request.model ?? null,
          created_by: userId,
        })
        .select()
        .single();

      if (error) throw error;
      if (!data) throw new Error('Failed to register device');

      return this.mapDeviceData(data);
    } catch (error) {
      console.error('Register device error:', error);
      throw error;
    }
  }

  /**
   * Update a device, enforcing devices:manage via RLS. Decommissioning is a
   * status update (status = 'decommissioned'), not a delete.
   */
  static async updateDevice(deviceId: string, request: UpdateDeviceRequest): Promise<Device> {
    try {
      const updates: Record<string, unknown> = {};
      if (request.name !== undefined) updates.name = request.name;
      if (request.status !== undefined) updates.status = request.status;
      if (request.provider !== undefined) updates.provider = request.provider;
      if (request.serialNumber !== undefined) updates.serial_number = request.serialNumber;
      if (request.model !== undefined) updates.model = request.model;
      if (request.firmwareVersion !== undefined) updates.firmware_version = request.firmwareVersion;
      if (request.connectivity !== undefined) updates.connectivity = request.connectivity;

      const { data, error } = await supabase.from('devices').update(updates).eq('id', deviceId).select().single();

      if (error) throw error;
      if (!data) throw new Error('Failed to update device');

      return this.mapDeviceData(data);
    } catch (error) {
      console.error('Update device error:', error);
      throw error;
    }
  }

  /**
   * Start a device session for the current user. The database function
   * start_device_session enforces devices:view and that the device is not
   * decommissioned.
   */
  static async startDeviceSession(deviceId: string): Promise<DeviceSession> {
    try {
      const { data, error } = await supabase.rpc('start_device_session', {
        p_device_id: deviceId,
      });

      if (error) throw error;
      if (!data) throw new Error('Failed to start device session');

      return this.mapDeviceSessionData(data);
    } catch (error) {
      console.error('Start device session error:', error);
      throw error;
    }
  }

  /**
   * End an active device session. The database function end_device_session
   * requires the caller to be the session owner or hold devices:manage.
   */
  static async endDeviceSession(sessionId: string): Promise<DeviceSession> {
    try {
      const { data, error } = await supabase.rpc('end_device_session', {
        p_session_id: sessionId,
      });

      if (error) throw error;
      if (!data) throw new Error('Failed to end device session');

      return this.mapDeviceSessionData(data);
    } catch (error) {
      console.error('End device session error:', error);
      throw error;
    }
  }

  /**
   * List sessions for a device, most recently started first.
   */
  static async getDeviceSessions(deviceId: string): Promise<DeviceSession[]> {
    try {
      const { data, error } = await supabase
        .from('device_sessions')
        .select('*')
        .eq('device_id', deviceId)
        .order('started_at', { ascending: false });

      if (error) throw error;
      return data ? data.map((s) => this.mapDeviceSessionData(s)) : [];
    } catch (error) {
      console.error('Get device sessions error:', error);
      throw error;
    }
  }

  /**
   * Record a device-initiated transaction (payment request/confirmation,
   * refund, reconciliation, status check). The database function
   * record_device_transaction enforces devices:view and validates linked
   * session/sale references.
   */
  static async recordDeviceTransaction(request: RecordDeviceTransactionRequest): Promise<DeviceTransaction> {
    try {
      const { data, error } = await supabase.rpc('record_device_transaction', {
        p_device_id: request.deviceId,
        p_transaction_type: request.transactionType,
        p_amount: request.amount ?? null,
        p_currency: request.currency ?? 'NGN',
        p_session_id: request.sessionId ?? null,
        p_sale_id: request.saleId ?? null,
        p_sale_payment_id: request.salePaymentId ?? null,
        p_refund_id: request.refundId ?? null,
        p_external_ref: request.externalRef ?? null,
        p_metadata: request.metadata ?? null,
      });

      if (error) throw error;
      if (!data) throw new Error('Failed to record device transaction');

      return this.mapDeviceTransactionData(data);
    } catch (error) {
      console.error('Record device transaction error:', error);
      throw error;
    }
  }

  /**
   * Update a pending device transaction's status (one-way transition to
   * success/failed/cancelled), enforcing devices:view.
   */
  static async updateDeviceTransactionStatus(
    transactionId: string,
    status: DeviceTransactionStatus,
    options?: { externalRef?: string; metadata?: Record<string, unknown> }
  ): Promise<DeviceTransaction> {
    try {
      const { data, error } = await supabase.rpc('update_device_transaction_status', {
        p_transaction_id: transactionId,
        p_status: status,
        p_external_ref: options?.externalRef ?? null,
        p_metadata: options?.metadata ?? null,
      });

      if (error) throw error;
      if (!data) throw new Error('Failed to update device transaction status');

      return this.mapDeviceTransactionData(data);
    } catch (error) {
      console.error('Update device transaction status error:', error);
      throw error;
    }
  }

  /**
   * List transactions for a device, most recent first.
   */
  static async getDeviceTransactions(deviceId: string): Promise<DeviceTransaction[]> {
    try {
      const { data, error } = await supabase
        .from('device_transactions')
        .select('*')
        .eq('device_id', deviceId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data ? data.map((t) => this.mapDeviceTransactionData(t)) : [];
    } catch (error) {
      console.error('Get device transactions error:', error);
      throw error;
    }
  }

  /**
   * Start an OPay payment request on a registered OPay terminal via the
   * opay-initiate-payment Edge Function. Records a `payment_request`
   * device_transactions row with the (mocked, until OPAY_SECRET_KEY is
   * configured) OPay reference.
   */
  static async initiateOpayPayment(request: OpayInitiatePaymentRequest): Promise<OpayInitiatePaymentResponse> {
    try {
      const { data, error } = await supabase.functions.invoke('opay-initiate-payment', {
        body: {
          deviceId: request.deviceId,
          amount: request.amount,
          currency: request.currency ?? 'NGN',
          saleId: request.saleId ?? null,
          salePaymentId: request.salePaymentId ?? null,
          sessionId: request.sessionId ?? null,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      return {
        transaction: this.mapDeviceTransactionData(data.transaction),
        reference: data.reference,
        checkoutUrl: data.checkoutUrl,
      };
    } catch (error) {
      console.error('Initiate OPay payment error:', error);
      throw error;
    }
  }

  private static mapDeviceData(data: any): Device {
    return {
      id: data.id,
      storeId: data.store_id,
      name: data.name,
      type: data.type,
      provider: data.provider,
      serialNumber: data.serial_number,
      status: data.status,
      model: data.model,
      firmwareVersion: data.firmware_version,
      connectivity: data.connectivity,
      batteryLevel: data.battery_level !== null ? Number(data.battery_level) : undefined,
      lastSeenAt: data.last_seen_at,
      metadata: data.metadata ?? {},
      createdBy: data.created_by,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  private static mapDeviceSessionData(data: any): DeviceSession {
    return {
      id: data.id,
      deviceId: data.device_id,
      storeId: data.store_id,
      userId: data.user_id,
      sessionToken: data.session_token,
      status: data.status,
      startedAt: data.started_at,
      endedAt: data.ended_at,
      expiresAt: data.expires_at,
      lastHeartbeatAt: data.last_heartbeat_at,
      metadata: data.metadata ?? {},
    };
  }

  private static mapDeviceTransactionData(data: any): DeviceTransaction {
    return {
      id: data.id,
      deviceId: data.device_id,
      storeId: data.store_id,
      sessionId: data.session_id,
      saleId: data.sale_id,
      salePaymentId: data.sale_payment_id,
      refundId: data.refund_id,
      transactionType: data.transaction_type,
      amount: data.amount !== null ? Number(data.amount) : undefined,
      currency: data.currency,
      status: data.status,
      externalRef: data.external_ref,
      metadata: data.metadata ?? {},
      createdBy: data.created_by,
      createdAt: data.created_at,
      completedAt: data.completed_at,
    };
  }
}
