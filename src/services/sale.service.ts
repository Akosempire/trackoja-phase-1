// services/sale.service.ts
// Sales (checkout, receipts, sales history) service

import { supabase } from '../config/supabase';
import type {
  Sale,
  SaleItem,
  SalePayment,
  SaleStatus,
  CreateSaleRequest,
  Refund,
  ProcessRefundRequest,
  VerificationStatus,
  PendingSalePayment,
  RecentRefund,
} from '../types';

export interface SaleFilters {
  status?: SaleStatus;
  dateFrom?: string;
  dateTo?: string;
}

export class SaleService {
  /**
   * Complete a checkout. The database function create_sale atomically creates
   * the sale, its line items and payments, and the corresponding 'sale'
   * inventory movements, enforcing the sales:create permission and stock rules.
   */
  static async createSale(storeId: string, request: CreateSaleRequest): Promise<Sale> {
    try {
      const { data, error } = await supabase.rpc('create_sale', {
        p_store_id: storeId,
        p_items: request.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          discountAmount: item.discountAmount ?? 0,
        })),
        p_payments: request.payments.map((payment) => ({
          method: payment.method,
          amount: payment.amount,
          reference: payment.reference ?? null,
          verificationStatus: payment.pending ? 'pending' : 'verified',
        })),
        p_customer_name: request.customerName ?? null,
        p_customer_phone: request.customerPhone ?? null,
        p_discount_total: request.discountTotal ?? 0,
        p_notes: request.notes ?? null,
        p_customer_id: request.customerId ?? null,
      });

      if (error) throw error;
      if (!data) throw new Error('Failed to create sale');

      return this.getSale(data.id);
    } catch (error) {
      console.error('Create sale error:', error);
      throw error;
    }
  }

  /**
   * List sales for a store, most recent first.
   */
  static async getSales(storeId: string, filters?: SaleFilters): Promise<Sale[]> {
    try {
      let query = supabase
        .from('sales')
        .select('*')
        .eq('store_id', storeId)
        .order('created_at', { ascending: false });

      if (filters?.status) {
        query = query.eq('status', filters.status);
      }

      if (filters?.dateFrom) {
        query = query.gte('created_at', filters.dateFrom);
      }

      if (filters?.dateTo) {
        query = query.lte('created_at', filters.dateTo);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data ? data.map((s) => this.mapSaleData(s)) : [];
    } catch (error) {
      console.error('Get sales error:', error);
      throw error;
    }
  }

  /**
   * Get a single sale with its line items and payments.
   */
  static async getSale(saleId: string): Promise<Sale> {
    try {
      const { data, error } = await supabase
        .from('sales')
        .select('*, sale_items(*), sale_payments(*), refunds(*)')
        .eq('id', saleId)
        .single();

      if (error) throw error;
      if (!data) throw new Error('Sale not found');

      const sale = this.mapSaleData(data);
      sale.items = (data.sale_items ?? []).map((item: any) => this.mapSaleItemData(item));
      sale.payments = (data.sale_payments ?? []).map((payment: any) => this.mapSalePaymentData(payment));
      sale.refunds = (data.refunds ?? [])
        .map((refund: any) => this.mapRefundData(refund))
        .sort((a: Refund, b: Refund) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      return sale;
    } catch (error) {
      console.error('Get sale error:', error);
      throw error;
    }
  }

  /**
   * Void a completed sale. The database function void_sale reverses stock via
   * 'return' movements and marks the sale as voided, enforcing sales:void.
   */
  static async voidSale(saleId: string, reason: string): Promise<Sale> {
    try {
      const { data, error } = await supabase.rpc('void_sale', {
        p_sale_id: saleId,
        p_reason: reason,
      });

      if (error) throw error;
      if (!data) throw new Error('Failed to void sale');

      return this.getSale(data.id);
    } catch (error) {
      console.error('Void sale error:', error);
      throw error;
    }
  }

  /**
   * Process a full or partial refund against a completed sale. The database
   * function process_refund optionally returns items to stock and reverses a
   * proportional share of any credit/loyalty impact, enforcing sales:refund.
   */
  static async processRefund(saleId: string, request: ProcessRefundRequest): Promise<Refund> {
    try {
      const { data, error } = await supabase.rpc('process_refund', {
        p_sale_id: saleId,
        p_amount: request.amount,
        p_reason: request.reason,
        p_method: request.method,
        p_items: request.items && request.items.length > 0 ? request.items : null,
      });

      if (error) throw error;
      if (!data) throw new Error('Failed to process refund');

      return this.mapRefundData(data);
    } catch (error) {
      console.error('Process refund error:', error);
      throw error;
    }
  }

  /**
   * Mark a pending sale payment as verified or rejected, enforcing
   * sales:refund.
   */
  static async verifySalePayment(paymentId: string, status: 'verified' | 'rejected'): Promise<SalePayment> {
    try {
      const { data, error } = await supabase.rpc('verify_sale_payment', {
        p_payment_id: paymentId,
        p_status: status,
      });

      if (error) throw error;
      if (!data) throw new Error('Failed to update payment verification');

      return this.mapSalePaymentData(data);
    } catch (error) {
      console.error('Verify sale payment error:', error);
      throw error;
    }
  }

  /**
   * List sale payments awaiting verification across the store, most recent
   * first, enforcing sales:refund.
   */
  static async getPendingPayments(storeId: string): Promise<PendingSalePayment[]> {
    try {
      const { data, error } = await supabase.rpc('list_pending_sale_payments', {
        p_store_id: storeId,
      });

      if (error) throw error;
      return (data ?? []).map((row: any) => this.mapPendingPaymentData(row));
    } catch (error) {
      console.error('Get pending payments error:', error);
      throw error;
    }
  }

  /**
   * List the store's most recent refunds, enforcing sales:refund.
   */
  static async getRecentRefunds(storeId: string, limit?: number): Promise<RecentRefund[]> {
    try {
      const { data, error } = await supabase.rpc('list_recent_refunds', {
        p_store_id: storeId,
        p_limit: limit ?? 50,
      });

      if (error) throw error;
      return (data ?? []).map((row: any) => this.mapRecentRefundData(row));
    } catch (error) {
      console.error('Get recent refunds error:', error);
      throw error;
    }
  }

  private static mapSaleData(data: any): Sale {
    return {
      id: data.id,
      storeId: data.store_id,
      saleNumber: data.sale_number,
      status: data.status,
      customerId: data.customer_id,
      customerName: data.customer_name,
      customerPhone: data.customer_phone,
      subtotal: Number(data.subtotal),
      discountTotal: Number(data.discount_total),
      taxTotal: Number(data.tax_total),
      total: Number(data.total),
      amountPaid: Number(data.amount_paid),
      changeDue: Number(data.change_due),
      refundedAmount: Number(data.refunded_amount ?? 0),
      loyaltyPointsEarned: Number(data.loyalty_points_earned ?? 0),
      notes: data.notes,
      createdBy: data.created_by,
      createdAt: data.created_at,
      voidedAt: data.voided_at,
      voidedBy: data.voided_by,
      voidReason: data.void_reason,
    };
  }

  private static mapSaleItemData(data: any): SaleItem {
    return {
      id: data.id,
      saleId: data.sale_id,
      productId: data.product_id,
      productName: data.product_name,
      sku: data.sku,
      quantity: Number(data.quantity),
      unitPrice: Number(data.unit_price),
      taxRate: Number(data.tax_rate),
      taxAmount: Number(data.tax_amount),
      discountAmount: Number(data.discount_amount),
      lineTotal: Number(data.line_total),
      refundedQuantity: Number(data.refunded_quantity ?? 0),
      createdAt: data.created_at,
    };
  }

  private static mapSalePaymentData(data: any): SalePayment {
    return {
      id: data.id,
      saleId: data.sale_id,
      method: data.method,
      amount: Number(data.amount),
      reference: data.reference,
      verificationStatus: (data.verification_status ?? 'verified') as VerificationStatus,
      verifiedBy: data.verified_by,
      verifiedAt: data.verified_at,
      createdAt: data.created_at,
    };
  }

  private static mapRefundData(data: any): Refund {
    return {
      id: data.id,
      storeId: data.store_id,
      saleId: data.sale_id,
      amount: Number(data.amount),
      reason: data.reason,
      method: data.method,
      items: data.items ?? undefined,
      createdBy: data.created_by,
      createdAt: data.created_at,
    };
  }

  private static mapPendingPaymentData(data: any): PendingSalePayment {
    return {
      id: data.id,
      saleId: data.sale_id,
      saleNumber: data.sale_number,
      method: data.method,
      amount: Number(data.amount),
      reference: data.reference,
      createdAt: data.created_at,
    };
  }

  private static mapRecentRefundData(data: any): RecentRefund {
    return {
      id: data.id,
      saleId: data.sale_id,
      saleNumber: data.sale_number,
      amount: Number(data.amount),
      reason: data.reason,
      method: data.method,
      createdByEmail: data.created_by_email,
      createdAt: data.created_at,
    };
  }
}
