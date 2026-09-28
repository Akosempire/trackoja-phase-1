// services/organization.service.ts
// Organization and merchant account management service

import { supabase } from '../config/supabase';
import type { Organization } from '../types';

export class OrganizationService {
  /**
   * Create a new organization (merchant account)
   */
  static async createOrganization(
    userId: string,
    organizationName: string,
    timezone: string = 'UTC',
    businessCategory: string = 'general_retail'
  ): Promise<Organization> {
    try {
      // Generate slug from organization name
      const slug = organizationName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

      const { data, error } = await supabase
        .from('organizations')
        .insert({
          name: organizationName,
          slug: `${slug}-${Date.now()}`,
          owner_id: userId,
          // Creating a tenant never grants product access. Commercial policy is
          // resolved later from an immutable plan version.
          billing_status: 'suspended',
          trial_ends_at: null,
          timezone,
          business_category: businessCategory,
        })
        .select()
        .single();

      if (error) throw error;
      if (!data) throw new Error('Failed to create organization');

      // Add owner to organization_members
      await supabase.from('organization_members').insert({
        org_id: data.id,
        user_id: userId,
        role: 'owner',
        accepted_at: new Date().toISOString(),
      });

      // Update user's current org
      await supabase.from('users').update({ current_org_id: data.id }).eq('id', userId);

      return {
        id: data.id,
        name: data.name,
        slug: data.slug,
        ownerId: data.owner_id,
        billingStatus: data.billing_status,
        timezone: data.timezone,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      };
    } catch (error) {
      console.error('Create organization error:', error);
      throw error;
    }
  }

  /**
   * Atomically creates or resumes the business and first store used by the
   * commercial onboarding flow. The database owns idempotency and deliberately
   * grants no trial or product access here.
   */
  static async createOnboardingBusiness(input: {
    businessName: string;
    storeName: string;
    businessCategory: string;
    billingEmail?: string;
    timezone?: string;
  }): Promise<{ orgId: string; storeId: string; state: string; resumed: boolean }> {
    const { data, error } = await supabase.rpc('create_onboarding_business', {
      p_business_name: input.businessName,
      p_store_name: input.storeName,
      p_business_category: input.businessCategory,
      p_billing_email: input.billingEmail?.trim() || null,
      p_timezone: input.timezone ?? 'Africa/Lagos',
      p_product_key: 'trackoja',
    });
    if (error) throw error;
    return {
      orgId: data.org_id,
      storeId: data.store_id,
      state: data.state,
      resumed: Boolean(data.resumed),
    };
  }

  /**
   * Get organization details
   */
  static async getOrganization(orgId: string): Promise<Organization> {
    try {
      const { data, error } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', orgId)
        .single();

      if (error) throw error;
      if (!data) throw new Error('Organization not found');

      return {
        id: data.id,
        name: data.name,
        slug: data.slug,
        ownerId: data.owner_id,
        billingEmail: data.billing_email ?? undefined,
        billingStatus: data.billing_status,
        trialEndsAt: data.trial_ends_at ?? undefined,
        subscriptionPlanId: data.subscription_plan_id ?? undefined,
        timezone: data.timezone,
        businessCategory: data.business_category ?? undefined,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      };
    } catch (error) {
      console.error('Get organization error:', error);
      throw error;
    }
  }

  /**
   * Update the business category for an org (owner only via RLS).
   */
  static async updateBusinessCategory(orgId: string, category: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('organizations')
        .update({ business_category: category })
        .eq('id', orgId);
      if (error) throw error;
    } catch (error) {
      console.error('Update business category error:', error);
      throw error;
    }
  }

  /**
   * Get all organizations for a user
   */
  static async getUserOrganizations(userId: string): Promise<Organization[]> {
    try {
      const { data, error } = await supabase
        .from('organizations')
        .select('*')
        .or(`owner_id.eq.${userId},id.in(
          select org_id from organization_members where user_id = '${userId}'
        )`);

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Get user organizations error:', error);
      throw error;
    }
  }

  /**
   * Update organization
   */
  static async updateOrganization(orgId: string, updates: Partial<Organization>) {
    try {
      const payload: Record<string, string> = {};
      if (updates.name !== undefined) payload.name = updates.name;
      if (updates.timezone !== undefined) payload.timezone = updates.timezone;
      if (updates.billingEmail !== undefined) payload.billing_email = updates.billingEmail;
      const { data, error } = await supabase
        .from('organizations')
        .update(payload)
        .eq('id', orgId)
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Update organization error:', error);
      throw error;
    }
  }
}
