// services/report.service.ts
// Read-only reporting service (Phase 5)

import { supabase } from '../config/supabase';
import type {
  SalesSummary,
  PaymentMethodBreakdown,
  TopProduct,
  InventoryValuation,
  CustomerBalancesSummary,
} from '../types';

export class ReportService {
  /**
   * Revenue/discount/tax/transaction totals for a date range.
   */
  static async getSalesSummary(storeId: string, dateFrom: string, dateTo: string): Promise<SalesSummary> {
    try {
      const { data, error } = await supabase.rpc('get_sales_summary', {
        p_store_id: storeId,
        p_date_from: dateFrom,
        p_date_to: dateTo,
      });

      if (error) throw error;

      const row = Array.isArray(data) ? data[0] : data;
      return this.mapSalesSummary(row);
    } catch (error) {
      console.error('Get sales summary error:', error);
      throw error;
    }
  }

  /**
   * Per payment-method totals for a date range.
   */
  static async getSalesByPaymentMethod(
    storeId: string,
    dateFrom: string,
    dateTo: string
  ): Promise<PaymentMethodBreakdown[]> {
    try {
      const { data, error } = await supabase.rpc('get_sales_by_payment_method', {
        p_store_id: storeId,
        p_date_from: dateFrom,
        p_date_to: dateTo,
      });

      if (error) throw error;
      return data ? data.map((row: any) => this.mapPaymentMethodBreakdown(row)) : [];
    } catch (error) {
      console.error('Get sales by payment method error:', error);
      throw error;
    }
  }

  /**
   * Top products by revenue for a date range.
   */
  static async getTopProducts(
    storeId: string,
    dateFrom: string,
    dateTo: string,
    limit?: number
  ): Promise<TopProduct[]> {
    try {
      const { data, error } = await supabase.rpc('get_top_products', {
        p_store_id: storeId,
        p_date_from: dateFrom,
        p_date_to: dateTo,
        p_limit: limit ?? 10,
      });

      if (error) throw error;
      return data ? data.map((row: any) => this.mapTopProduct(row)) : [];
    } catch (error) {
      console.error('Get top products error:', error);
      throw error;
    }
  }

  /**
   * Point-in-time stock valuation snapshot.
   */
  static async getInventoryValuation(storeId: string): Promise<InventoryValuation> {
    try {
      const { data, error } = await supabase.rpc('get_inventory_valuation', {
        p_store_id: storeId,
      });

      if (error) throw error;

      const row = Array.isArray(data) ? data[0] : data;
      return this.mapInventoryValuation(row);
    } catch (error) {
      console.error('Get inventory valuation error:', error);
      throw error;
    }
  }

  /**
   * Point-in-time customer receivables/loyalty snapshot.
   */
  static async getCustomerBalancesSummary(storeId: string): Promise<CustomerBalancesSummary> {
    try {
      const { data, error } = await supabase.rpc('get_customer_balances_summary', {
        p_store_id: storeId,
      });

      if (error) throw error;

      const row = Array.isArray(data) ? data[0] : data;
      return this.mapCustomerBalancesSummary(row);
    } catch (error) {
      console.error('Get customer balances summary error:', error);
      throw error;
    }
  }

  private static mapSalesSummary(data: any): SalesSummary {
    return {
      totalRevenue: Number(data?.total_revenue ?? 0),
      discountTotal: Number(data?.discount_total ?? 0),
      taxTotal: Number(data?.tax_total ?? 0),
      transactionCount: Number(data?.transaction_count ?? 0),
      voidedCount: Number(data?.voided_count ?? 0),
      averageSale: Number(data?.average_sale ?? 0),
    };
  }

  private static mapPaymentMethodBreakdown(data: any): PaymentMethodBreakdown {
    return {
      method: data.method,
      amount: Number(data.amount),
      transactionCount: Number(data.transaction_count),
    };
  }

  private static mapTopProduct(data: any): TopProduct {
    return {
      productId: data.product_id,
      productName: data.product_name,
      sku: data.sku,
      quantitySold: Number(data.quantity_sold),
      revenue: Number(data.revenue),
    };
  }

  private static mapInventoryValuation(data: any): InventoryValuation {
    return {
      productCount: Number(data?.product_count ?? 0),
      totalStockQty: Number(data?.total_stock_qty ?? 0),
      totalCostValue: Number(data?.total_cost_value ?? 0),
      totalRetailValue: Number(data?.total_retail_value ?? 0),
      lowStockCount: Number(data?.low_stock_count ?? 0),
    };
  }

  private static mapCustomerBalancesSummary(data: any): CustomerBalancesSummary {
    return {
      totalReceivables: Number(data?.total_receivables ?? 0),
      customersWithBalance: Number(data?.customers_with_balance ?? 0),
      totalLoyaltyPoints: Number(data?.total_loyalty_points ?? 0),
    };
  }
}
