// services/platform.service.ts
// Platform dashboard service (Phase 7) - cross-organization reads for
// platform admins (users.is_platform_admin = true).

import { supabase } from '../config/supabase';
import type {
  PlatformOverview,
  PlatformOrganization,
  PlatformRevenueSummary,
  PlatformRevenueByPlan,
  PlatformSystemHealth,
  PlatformRecentError,
} from '../types';

export class PlatformService {
  /**
   * Org/store/user counts and growth.
   */
  static async getOverview(): Promise<PlatformOverview> {
    try {
      const { data, error } = await supabase.rpc('get_platform_overview');

      if (error) throw error;

      const row = Array.isArray(data) ? data[0] : data;
      return this.mapOverview(row);
    } catch (error) {
      console.error('Get platform overview error:', error);
      throw error;
    }
  }

  /**
   * Per-organization billing/subscription summary, most recent first.
   */
  static async listOrganizations(): Promise<PlatformOrganization[]> {
    try {
      const { data, error } = await supabase.rpc('list_platform_organizations');

      if (error) throw error;
      return data ? data.map((row: any) => this.mapOrganization(row)) : [];
    } catch (error) {
      console.error('List platform organizations error:', error);
      throw error;
    }
  }

  /**
   * Paystack revenue totals for a date range.
   */
  static async getRevenueSummary(dateFrom: string, dateTo: string): Promise<PlatformRevenueSummary> {
    try {
      const { data, error } = await supabase.rpc('get_platform_revenue_summary', {
        p_date_from: dateFrom,
        p_date_to: dateTo,
      });

      if (error) throw error;

      const row = Array.isArray(data) ? data[0] : data;
      return this.mapRevenueSummary(row);
    } catch (error) {
      console.error('Get platform revenue summary error:', error);
      throw error;
    }
  }

  /**
   * Paystack revenue grouped by plan for a date range.
   */
  static async getRevenueByPlan(dateFrom: string, dateTo: string): Promise<PlatformRevenueByPlan[]> {
    try {
      const { data, error } = await supabase.rpc('get_platform_revenue_by_plan', {
        p_date_from: dateFrom,
        p_date_to: dateTo,
      });

      if (error) throw error;
      return data ? data.map((row: any) => this.mapRevenueByPlan(row)) : [];
    } catch (error) {
      console.error('Get platform revenue by plan error:', error);
      throw error;
    }
  }

  /**
   * Failure counters for the last 24h plus current past-due/suspended org counts.
   */
  static async getSystemHealth(): Promise<PlatformSystemHealth> {
    try {
      const { data, error } = await supabase.rpc('get_platform_system_health');

      if (error) throw error;

      const row = Array.isArray(data) ? data[0] : data;
      return this.mapSystemHealth(row);
    } catch (error) {
      console.error('Get platform system health error:', error);
      throw error;
    }
  }

  /**
   * Most recent failed/attempted audit log entries, across all organizations.
   */
  static async getRecentErrors(limit?: number): Promise<PlatformRecentError[]> {
    try {
      const { data, error } = await supabase.rpc('list_platform_recent_errors', {
        p_limit: limit ?? 20,
      });

      if (error) throw error;
      return data ? data.map((row: any) => this.mapRecentError(row)) : [];
    } catch (error) {
      console.error('Get platform recent errors error:', error);
      throw error;
    }
  }

  private static mapOverview(data: any): PlatformOverview {
    return {
      totalOrganizations: Number(data?.total_organizations ?? 0),
      newOrganizations30d: Number(data?.new_organizations_30d ?? 0),
      totalStores: Number(data?.total_stores ?? 0),
      activeStores: Number(data?.active_stores ?? 0),
      totalUsers: Number(data?.total_users ?? 0),
      trialingSubscriptions: Number(data?.trialing_subscriptions ?? 0),
      activeSubscriptions: Number(data?.active_subscriptions ?? 0),
      pastDueOrganizations: Number(data?.past_due_organizations ?? 0),
    };
  }

  private static mapOrganization(data: any): PlatformOrganization {
    return {
      orgId: data.org_id,
      name: data.name,
      slug: data.slug,
      ownerEmail: data.owner_email,
      billingStatus: data.billing_status,
      planName: data.plan_name,
      subscriptionStatus: data.subscription_status,
      storeCount: Number(data.store_count),
      createdAt: data.created_at,
    };
  }

  private static mapRevenueSummary(data: any): PlatformRevenueSummary {
    return {
      totalRevenue: Number(data?.total_revenue ?? 0),
      transactionCount: Number(data?.transaction_count ?? 0),
      successfulCount: Number(data?.successful_count ?? 0),
      failedCount: Number(data?.failed_count ?? 0),
    };
  }

  private static mapRevenueByPlan(data: any): PlatformRevenueByPlan {
    return {
      planId: data.plan_id,
      planName: data.plan_name,
      revenue: Number(data.revenue),
      transactionCount: Number(data.transaction_count),
    };
  }

  private static mapSystemHealth(data: any): PlatformSystemHealth {
    return {
      failedAuditEvents24h: Number(data?.failed_audit_events_24h ?? 0),
      failedTransactions24h: Number(data?.failed_transactions_24h ?? 0),
      pastDueOrganizations: Number(data?.past_due_organizations ?? 0),
      suspendedOrganizations: Number(data?.suspended_organizations ?? 0),
    };
  }

  private static mapRecentError(data: any): PlatformRecentError {
    return {
      id: data.id,
      orgId: data.org_id,
      orgName: data.org_name,
      actorEmail: data.actor_email,
      action: data.action,
      resourceType: data.resource_type,
      resourceName: data.resource_name,
      status: data.status,
      createdAt: data.created_at,
    };
  }
}
