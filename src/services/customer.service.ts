// services/customer.service.ts
// Customer directory, credit, and loyalty service (Phase 4)

import { supabase } from '../config/supabase';
import type {
  Customer,
  CustomerCreditTransaction,
  CustomerLoyaltyTransaction,
  CreateCustomerRequest,
  UpdateCustomerRequest,
} from '../types';

export interface CustomerFilters {
  search?: string;
  isActive?: boolean;
}

export class CustomerService {
  /**
   * Create a new customer
   */
  static async createCustomer(
    storeId: string,
    userId: string,
    request: CreateCustomerRequest
  ): Promise<Customer> {
    try {
      const { data, error } = await supabase
        .from('customers')
        .insert({
          store_id: storeId,
          name: request.name,
          phone: request.phone,
          email: request.email,
          address: request.address,
          notes: request.notes,
          credit_limit: request.creditLimit ?? 0,
          created_by: userId,
        })
        .select()
        .single();

      if (error) throw error;
      if (!data) throw new Error('Failed to create customer');

      return this.mapCustomerData(data);
    } catch (error) {
      console.error('Create customer error:', error);
      throw error;
    }
  }

  /**
   * List customers for a store, with optional filters
   */
  static async getCustomers(storeId: string, filters?: CustomerFilters): Promise<Customer[]> {
    try {
      let query = supabase.from('customers').select('*').eq('store_id', storeId);

      if (filters?.isActive !== undefined) {
        query = query.eq('is_active', filters.isActive);
      }

      if (filters?.search) {
        query = query.or(`name.ilike.%${filters.search}%,phone.ilike.%${filters.search}%,email.ilike.%${filters.search}%`);
      }

      query = query.order('name', { ascending: true });

      const { data, error } = await query;

      if (error) throw error;
      return data ? data.map((c) => this.mapCustomerData(c)) : [];
    } catch (error) {
      console.error('Get customers error:', error);
      throw error;
    }
  }

  /**
   * Get a single customer
   */
  static async getCustomer(customerId: string): Promise<Customer> {
    try {
      const { data, error } = await supabase.from('customers').select('*').eq('id', customerId).single();

      if (error) throw error;
      if (!data) throw new Error('Customer not found');

      return this.mapCustomerData(data);
    } catch (error) {
      console.error('Get customer error:', error);
      throw error;
    }
  }

  /**
   * Update a customer. balance and loyalty_points cannot be set here - use
   * recordCreditPayment/adjustCustomerCredit/adjustCustomerLoyalty instead.
   */
  static async updateCustomer(customerId: string, request: UpdateCustomerRequest): Promise<Customer> {
    try {
      const updates: Record<string, unknown> = {};
      if (request.name !== undefined) updates.name = request.name;
      if (request.phone !== undefined) updates.phone = request.phone;
      if (request.email !== undefined) updates.email = request.email;
      if (request.address !== undefined) updates.address = request.address;
      if (request.notes !== undefined) updates.notes = request.notes;
      if (request.creditLimit !== undefined) updates.credit_limit = request.creditLimit;
      if (request.isActive !== undefined) updates.is_active = request.isActive;

      const { data, error } = await supabase
        .from('customers')
        .update(updates)
        .eq('id', customerId)
        .select()
        .single();

      if (error) throw error;
      if (!data) throw new Error('Failed to update customer');

      return this.mapCustomerData(data);
    } catch (error) {
      console.error('Update customer error:', error);
      throw error;
    }
  }

  /**
   * Permanently delete a customer
   */
  static async deleteCustomer(customerId: string): Promise<void> {
    try {
      const { error } = await supabase.from('customers').delete().eq('id', customerId);

      if (error) throw error;
    } catch (error) {
      console.error('Delete customer error:', error);
      throw error;
    }
  }

  /**
   * Record a payment against a customer's outstanding balance.
   */
  static async recordCreditPayment(customerId: string, amount: number, notes?: string): Promise<Customer> {
    try {
      const { data, error } = await supabase.rpc('adjust_customer_credit', {
        p_customer_id: customerId,
        p_amount: amount,
        p_type: 'payment',
        p_notes: notes ?? null,
      });

      if (error) throw error;
      if (!data) throw new Error('Failed to record credit payment');

      return this.mapCustomerData(data);
    } catch (error) {
      console.error('Record credit payment error:', error);
      throw error;
    }
  }

  /**
   * Apply a manual balance adjustment (positive or negative) to a customer.
   */
  static async adjustCustomerCredit(customerId: string, amount: number, notes?: string): Promise<Customer> {
    try {
      const { data, error } = await supabase.rpc('adjust_customer_credit', {
        p_customer_id: customerId,
        p_amount: amount,
        p_type: 'adjustment',
        p_notes: notes ?? null,
      });

      if (error) throw error;
      if (!data) throw new Error('Failed to adjust customer credit');

      return this.mapCustomerData(data);
    } catch (error) {
      console.error('Adjust customer credit error:', error);
      throw error;
    }
  }

  /**
   * Redeem or manually adjust a customer's loyalty points balance.
   */
  static async adjustCustomerLoyalty(
    customerId: string,
    points: number,
    type: 'redeem' | 'adjustment',
    notes?: string
  ): Promise<Customer> {
    try {
      const { data, error } = await supabase.rpc('adjust_customer_loyalty', {
        p_customer_id: customerId,
        p_points: points,
        p_type: type,
        p_notes: notes ?? null,
      });

      if (error) throw error;
      if (!data) throw new Error('Failed to adjust customer loyalty points');

      return this.mapCustomerData(data);
    } catch (error) {
      console.error('Adjust customer loyalty error:', error);
      throw error;
    }
  }

  /**
   * List a customer's credit ledger entries, most recent first.
   */
  static async getCreditTransactions(customerId: string): Promise<CustomerCreditTransaction[]> {
    try {
      const { data, error } = await supabase
        .from('customer_credit_transactions')
        .select('*')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data ? data.map((t) => this.mapCreditTransactionData(t)) : [];
    } catch (error) {
      console.error('Get credit transactions error:', error);
      throw error;
    }
  }

  /**
   * List a customer's loyalty ledger entries, most recent first.
   */
  static async getLoyaltyTransactions(customerId: string): Promise<CustomerLoyaltyTransaction[]> {
    try {
      const { data, error } = await supabase
        .from('customer_loyalty_transactions')
        .select('*')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data ? data.map((t) => this.mapLoyaltyTransactionData(t)) : [];
    } catch (error) {
      console.error('Get loyalty transactions error:', error);
      throw error;
    }
  }

  private static mapCustomerData(data: any): Customer {
    return {
      id: data.id,
      storeId: data.store_id,
      name: data.name,
      phone: data.phone,
      email: data.email,
      address: data.address,
      notes: data.notes,
      creditLimit: Number(data.credit_limit),
      balance: Number(data.balance),
      loyaltyPoints: Number(data.loyalty_points),
      isActive: data.is_active,
      createdBy: data.created_by,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  private static mapCreditTransactionData(data: any): CustomerCreditTransaction {
    return {
      id: data.id,
      storeId: data.store_id,
      customerId: data.customer_id,
      type: data.type,
      amount: Number(data.amount),
      balanceBefore: Number(data.balance_before),
      balanceAfter: Number(data.balance_after),
      sourceType: data.source_type,
      sourceId: data.source_id,
      notes: data.notes,
      createdBy: data.created_by,
      createdAt: data.created_at,
    };
  }

  private static mapLoyaltyTransactionData(data: any): CustomerLoyaltyTransaction {
    return {
      id: data.id,
      storeId: data.store_id,
      customerId: data.customer_id,
      type: data.type,
      points: Number(data.points),
      pointsBefore: Number(data.points_before),
      pointsAfter: Number(data.points_after),
      sourceType: data.source_type,
      sourceId: data.source_id,
      notes: data.notes,
      createdBy: data.created_by,
      createdAt: data.created_at,
    };
  }
}
