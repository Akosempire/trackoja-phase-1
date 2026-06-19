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
          billing_status: 'trial',
          trial_ends_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
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
        billingStatus: data.billing_status,
        timezone: data.timezone,
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
      const { data, error } = await supabase
        .from('organizations')
        .update({
          name: updates.name,
          timezone: updates.timezone,
          billing_email: updates.billingEmail,
        })
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
