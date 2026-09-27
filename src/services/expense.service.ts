// Expenses and suppliers.
//
// House conventions: static methods that THROW, snake_case rows mapped by a private
// mapper, and supabase.rpc('name', { p_arg }) with p_-prefixed arguments.

import { supabase } from '../config/supabase';

export interface Expense {
  id: string;
  description: string;
  category: string;
  amount: number;
  currency: string;
  spentOn: string;
  paymentMethod: string | null;
  supplierId: string | null;
  supplierName: string | null;
  reference: string | null;
  recordedByEmail: string | null;
  createdAt: string;
}

export interface ExpenseSummaryRow {
  category: string;
  total: number;
  entryCount: number;
  share: number;
}

export interface Supplier {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  paymentTerms: string | null;
  status: string;
  expenseTotal: number;
}

export interface ExpenseFilters {
  from?: string;
  to?: string;
  category?: string;
  limit?: number;
}

/** Categories offered in the form. Free text is still accepted by the database. */
export const EXPENSE_CATEGORIES = [
  'stock',
  'rent',
  'utilities',
  'transport',
  'salaries',
  'marketing',
  'maintenance',
  'other',
];

export class ExpenseService {
  static async list(storeId: string, filters: ExpenseFilters = {}): Promise<Expense[]> {
    try {
      const { data, error } = await supabase.rpc('list_expenses', {
        p_store_id: storeId,
        p_from: filters.from ?? null,
        p_to: filters.to ?? null,
        p_category: filters.category ?? null,
        p_limit: filters.limit ?? 100,
      });

      if (error) throw error;

      return (data ?? []).map((row: any) => ({
        id: row.id,
        description: row.description,
        category: row.category,
        amount: Number(row.amount ?? 0),
        currency: row.currency,
        spentOn: row.spent_on,
        paymentMethod: row.payment_method,
        supplierId: row.supplier_id,
        supplierName: row.supplier_name,
        reference: row.reference,
        recordedByEmail: row.recorded_by_email,
        createdAt: row.created_at,
      }));
    } catch (error) {
      console.error('List expenses error:', error);
      throw error;
    }
  }

  /**
   * Record an expense. The database validates the amount, the description, that the
   * date is not in the future, and that any supplier belongs to this store, so the
   * rules hold whichever screen calls it.
   */
  static async create(input: {
    storeId: string;
    description: string;
    amount: number;
    category?: string;
    spentOn?: string | null;
    paymentMethod?: string | null;
    supplierId?: string | null;
    reference?: string | null;
    notes?: string | null;
  }): Promise<void> {
    try {
      const { error } = await supabase.rpc('create_expense', {
        p_store_id: input.storeId,
        p_description: input.description,
        p_amount: input.amount,
        p_category: input.category ?? 'other',
        p_spent_on: input.spentOn ?? null,
        p_payment_method: input.paymentMethod ?? null,
        p_supplier_id: input.supplierId ?? null,
        p_reference: input.reference ?? null,
        p_notes: input.notes ?? null,
      });
      if (error) throw error;
    } catch (error) {
      console.error('Create expense error:', error);
      throw error;
    }
  }

  static async remove(expenseId: string): Promise<void> {
    try {
      const { error } = await supabase.rpc('delete_expense', { p_expense_id: expenseId });
      if (error) throw error;
    } catch (error) {
      console.error('Delete expense error:', error);
      throw error;
    }
  }

  static async summary(storeId: string, from?: string, to?: string): Promise<ExpenseSummaryRow[]> {
    try {
      const { data, error } = await supabase.rpc('expense_summary', {
        p_store_id: storeId,
        p_from: from ?? null,
        p_to: to ?? null,
      });
      if (error) throw error;

      return (data ?? []).map((row: any) => ({
        category: row.category,
        total: Number(row.total ?? 0),
        entryCount: Number(row.entry_count ?? 0),
        share: Number(row.share ?? 0),
      }));
    } catch (error) {
      console.error('Expense summary error:', error);
      throw error;
    }
  }

  static async listSuppliers(storeId: string, includeInactive = false): Promise<Supplier[]> {
    try {
      const { data, error } = await supabase.rpc('list_suppliers', {
        p_store_id: storeId,
        p_include_inactive: includeInactive,
      });
      if (error) throw error;

      return (data ?? []).map((row: any) => ({
        id: row.id,
        name: row.name,
        contactName: row.contact_name,
        phone: row.phone,
        email: row.email,
        paymentTerms: row.payment_terms,
        status: row.status,
        expenseTotal: Number(row.expense_total ?? 0),
      }));
    } catch (error) {
      console.error('List suppliers error:', error);
      throw error;
    }
  }

  static async createSupplier(input: {
    storeId: string;
    name: string;
    contactName?: string | null;
    phone?: string | null;
    paymentTerms?: string | null;
  }): Promise<void> {
    try {
      const { error } = await supabase.rpc('create_supplier', {
        p_store_id: input.storeId,
        p_name: input.name,
        p_contact_name: input.contactName ?? null,
        p_phone: input.phone ?? null,
        p_email: null,
        p_address: null,
        p_payment_terms: input.paymentTerms ?? null,
        p_notes: null,
      });
      if (error) throw error;
    } catch (error) {
      console.error('Create supplier error:', error);
      throw error;
    }
  }
}
