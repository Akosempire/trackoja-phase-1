// services/store.service.ts
// Store management service

import { supabase } from '../config/supabase';
import type { Store, StoreSettings, CreateStoreRequest } from '../types';

export class StoreService {
  /**
   * Create a new store
   */
  static async createStore(
    orgId: string,
    userId: string,
    request: CreateStoreRequest & { roleId?: string }
  ): Promise<Store> {
    try {
      // Generate slug from store name
      const slug = request.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

      // Create store
      const { data: storeData, error: storeError } = await supabase
        .from('stores')
        .insert({
          org_id: orgId,
          name: request.name,
          slug: `${slug}-${Date.now()}`, // Ensure uniqueness
          address: request.address,
          city: request.city,
          state: request.state,
          postal_code: request.postalCode,
          phone: request.phone,
          email: request.email,
          created_by: userId,
          status: 'active',
          timezone: 'UTC',
          currency: 'NGN',
        })
        .select()
        .single();

      if (storeError) throw storeError;
      if (!storeData) throw new Error('Failed to create store');

      // Get owner role
      const { data: ownerRole, error: roleError } = await supabase
        .from('roles')
        .select('id')
        .eq('name', 'owner')
        .eq('is_system', true)
        .single();

      if (roleError || !ownerRole) {
        throw new Error('Failed to get owner role');
      }

      // Add creator as store member with owner role
      await supabase.from('store_members').insert({
        store_id: storeData.id,
        user_id: userId,
        role_id: ownerRole.id,
        status: 'active',
        accepted_at: new Date().toISOString(),
      });

      // Create store settings
      await supabase.from('store_settings').insert({
        store_id: storeData.id,
      });

      // Update user's current store
      await supabase.from('users').update({ current_store_id: storeData.id }).eq('id', userId);

      return {
        id: storeData.id,
        orgId: storeData.org_id,
        name: storeData.name,
        slug: storeData.slug,
        address: storeData.address,
        city: storeData.city,
        state: storeData.state,
        postalCode: storeData.postal_code,
        country: storeData.country,
        phone: storeData.phone,
        email: storeData.email,
        status: storeData.status,
        timezone: storeData.timezone,
        currency: storeData.currency,
        createdBy: storeData.created_by,
        createdAt: storeData.created_at,
        updatedAt: storeData.updated_at,
      };
    } catch (error) {
      console.error('Create store error:', error);
      throw error;
    }
  }

  /**
   * Get store details
   */
  static async getStore(storeId: string): Promise<Store> {
    try {
      const { data, error } = await supabase
        .from('stores')
        .select('*')
        .eq('id', storeId)
        .single();

      if (error) throw error;
      if (!data) throw new Error('Store not found');

      return this.mapStoreData(data);
    } catch (error) {
      console.error('Get store error:', error);
      throw error;
    }
  }

  /**
   * Get all stores for an organization
   */
  static async getOrgStores(orgId: string): Promise<Store[]> {
    try {
      const { data, error } = await supabase
        .from('stores')
        .select('*')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data ? data.map((s) => this.mapStoreData(s)) : [];
    } catch (error) {
      console.error('Get organization stores error:', error);
      throw error;
    }
  }

  /**
   * Get all stores for a user
   */
  static async getUserStores(userId: string): Promise<Store[]> {
    try {
      const { data, error } = await supabase
        .from('stores')
        .select(
          `*,
           store_members!inner(
             user_id
           )
        `
        )
        .eq('store_members.user_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data ? data.map((s) => this.mapStoreData(s)) : [];
    } catch (error) {
      console.error('Get user stores error:', error);
      throw error;
    }
  }

  /**
   * Set the user's active store (drives the global store switcher). Writing to
   * users.current_store_id triggers the STORE_SWITCHED audit log entry - see
   * database/011_audit_log_triggers.sql.
   */
  static async setCurrentStore(userId: string, storeId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('users')
        .update({ current_store_id: storeId })
        .eq('id', userId);

      if (error) throw error;
    } catch (error) {
      console.error('Set current store error:', error);
      throw error;
    }
  }

  /**
   * Update store
   */
  static async updateStore(storeId: string, updates: Partial<Store>) {
    try {
      const { data, error } = await supabase
        .from('stores')
        .update({
          name: updates.name,
          address: updates.address,
          city: updates.city,
          state: updates.state,
          postal_code: updates.postalCode,
          phone: updates.phone,
          email: updates.email,
          status: updates.status,
          timezone: updates.timezone,
        })
        .eq('id', storeId)
        .select()
        .single();

      if (error) throw error;
      return this.mapStoreData(data);
    } catch (error) {
      console.error('Update store error:', error);
      throw error;
    }
  }

  /**
   * Delete store
   */
  static async deleteStore(storeId: string) {
    try {
      const { error } = await supabase.from('stores').delete().eq('id', storeId);
      if (error) throw error;
    } catch (error) {
      console.error('Delete store error:', error);
      throw error;
    }
  }

  /**
   * Get the settings row for a store (loyalty config, receipt format, etc.)
   */
  static async getStoreSettings(storeId: string): Promise<StoreSettings> {
    try {
      const { data, error } = await supabase
        .from('store_settings')
        .select('*')
        .eq('store_id', storeId)
        .single();

      if (error) throw error;
      if (!data) throw new Error('Store settings not found');

      return this.mapStoreSettingsData(data);
    } catch (error) {
      console.error('Get store settings error:', error);
      throw error;
    }
  }

  private static mapStoreSettingsData(data: any): StoreSettings {
    return {
      id: data.id,
      storeId: data.store_id,
      allowNegativeStock: data.allow_negative_stock,
      requireCustomerForSale: data.require_customer_for_sale,
      autoPrintReceipt: data.auto_print_receipt,
      receiptFormat: data.receipt_format,
      loyaltyEnabled: data.loyalty_enabled,
      loyaltyEarnRate: Number(data.loyalty_earn_rate),
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  private static mapStoreData(data: any): Store {
    return {
      id: data.id,
      orgId: data.org_id,
      name: data.name,
      slug: data.slug,
      address: data.address,
      city: data.city,
      state: data.state,
      postalCode: data.postal_code,
      country: data.country,
      phone: data.phone,
      email: data.email,
      status: data.status,
      timezone: data.timezone,
      currency: data.currency,
      createdBy: data.created_by,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }
}
