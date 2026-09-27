// Platform administration service: multi-product catalogue, plans and pricing,
// businesses, users, activation keys, support, settings, and developer mode.
//
// Follows the house conventions used by every other service in this folder: a
// class of static async methods that THROW on failure (never return
// { data, error }), snake_case rows mapped to camelCase by a private mapper, and
// supabase.rpc('name', { p_arg: value }) with p_-prefixed arguments.

import { supabase } from '../config/supabase';

// ------------------------------------------------------------------ types

export interface PlatformProduct {
  id: string;
  key: string;
  name: string;
  tagline: string | null;
  description: string | null;
  status: 'active' | 'inactive' | 'internal';
  visibility: 'public' | 'private' | 'hidden';
  features: { key: string; label: string; upcoming?: boolean }[];
  onboardingNote: string | null;
  accessSettings: Record<string, unknown>;
  planCount: number;
  businessCount: number;
  sortOrder: number;
  updatedAt: string | null;
}

export interface ProductPlan {
  id: string;
  productId: string;
  productKey: string;
  productName: string;
  key: string;
  name: string;
  description: string | null;
  monthlyPrice: number | null;
  annualPrice: number | null;
  currency: string;
  userLimit: number | null;
  features: { key: string; label: string; upcoming?: boolean }[];
  onboardingNote: string | null;
  /**
   * Which cycle this plan is sold on. Added by migration 089. It must be sent
   * back on every save: `upsert_product_plan` writes whatever it is given, and
   * its parameter defaults to 'monthly', so omitting it silently resets an
   * annual or custom plan to monthly.
   */
  billingCycle: 'monthly' | 'annual' | 'custom';
  status: 'active' | 'inactive' | 'draft' | 'retired';
  isDefault: boolean;
  isPublic: boolean;
  sortOrder: number;
  subscriberCount: number;
  updatedAt: string | null;
}

export interface PlanRevision {
  id: string;
  changeType: string;
  previousValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  note: string | null;
  changedByEmail: string | null;
  createdAt: string;
}

export interface PlatformOverviewV2 {
  totalBusinesses: number;
  activeSubscriptions: number;
  trialingSubscriptions: number;
  pastDueSubscriptions: number;
  expiringWithin30d: number;
  failedPayments30d: number;
  revenue30d: number;
  sandboxBusinesses: number;
}

export interface ProductBusiness {
  orgId: string;
  name: string;
  slug: string;
  ownerEmail: string | null;
  businessCategory: string;
  billingStatus: string;
  isSandbox: boolean;
  productKey: string;
  productName: string;
  planKey: string | null;
  planName: string | null;
  entitlementStatus: string;
  agreedUserLimit: number | null;
  seatUsed: number;
  expiresAt: string | null;
  trialEndsAt: string | null;
  storeCount: number;
  createdAt: string;
}

export interface PlatformUserRow {
  userId: string;
  email: string;
  fullName: string | null;
  isPlatformAdmin: boolean;
  platformLevel: string | null;
  developerMode: boolean;
  orgId: string | null;
  orgName: string | null;
  isSandbox: boolean;
  storeRole: string | null;
  entitledProducts: string[];
  seatLimit: number | null;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface PlatformAdminAccount {
  userId: string;
  email: string;
  level: string;
  status: string;
  permissions: string[];
  developerMode: boolean;
  grantedAt: string;
}

export interface ActivationKeyRow {
  id: string;
  keyCodeMasked: string;
  productKey: string;
  productName: string;
  planName: string | null;
  orgId: string | null;
  orgName: string | null;
  status: string;
  validFrom: string | null;
  validUntil: string | null;
  userLimit: number | null;
  redeemedAt: string | null;
  isSandbox: boolean;
  createdAt: string;
}

export interface SupportNote {
  id: string;
  noteType: string;
  body: string;
  adminEmail: string | null;
  productKey: string | null;
  isSandbox: boolean;
  createdAt: string;
}

export interface SubscriptionAdjustment {
  id: string;
  orgId: string;
  orgName: string | null;
  adjustmentType: string;
  reason: string;
  previousValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  performedByEmail: string | null;
  isSandbox: boolean;
  createdAt: string;
}

export interface PlatformSetting {
  key: string;
  value: unknown;
  description: string | null;
  category: string;
  updatedAt: string | null;
}

export interface NotificationTemplate {
  id: string;
  key: string;
  name: string;
  channel: string;
  subject: string | null;
  body: string;
  status: string;
  updatedAt: string | null;
}

export interface MyPlatformAccess {
  isPlatformAdmin: boolean;
  isSuperAdmin: boolean;
  developerMode: boolean;
  permissions: string[];
}

export interface DeveloperStatus {
  isPlatformAdmin: boolean;
  isSuperAdmin: boolean;
  developerMode: boolean;
  grantedAt: string | null;
  expiresAt: string | null;
  activeSessionId: string | null;
}

export interface DeveloperGrant {
  userId: string;
  email: string;
  status: string;
  level: string;
  grantedByEmail: string | null;
  grantedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  reason: string | null;
}

export interface ImpersonationInfo {
  sessionId: string;
  orgId: string;
  orgName: string;
  expiresAt: string;
  secondsRemaining: number;
  reason: string;
}

export interface SandboxBusiness {
  orgId: string;
  name: string;
  slug: string;
  ownerEmail: string | null;
  createdAt: string;
}

export interface BusinessDetail {
  organization: Record<string, unknown> | null;
  products: Record<string, unknown>[];
  stores: Record<string, unknown>[];
  staff: Record<string, unknown>[];
  payments: Record<string, unknown>[];
  supportNotes: Record<string, unknown>[];
  adjustments: Record<string, unknown>[];
  seatUsed: number;
}

// ------------------------------------------------------------- the service

export interface PlatformAuditLog {
  id: string;
  actorEmail: string | null;
  orgId: string | null;
  orgName: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  resourceName: string | null;
  status: string | null;
  changes: Record<string, unknown> | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface PlatformAuditPage {
  entries: PlatformAuditLog[];
  total: number;
}

/** A platform admin account as the roster screen needs it. */
export interface PlatformAdminAccountV2 {
  userId: string;
  email: string;
  fullName: string | null;
  level: string;
  status: string;
  /** The keys this account effectively holds. A level is a label; these are the capability. */
  permissions: string[];
  permissionCount: number;
  developerMode: boolean;
  grantedByEmail: string | null;
  grantedAt: string;
  revokedAt: string | null;
  note: string | null;
}

/** The five platform levels, and what each one starts with. */
export const PLATFORM_LEVELS = [
  {
    level: 'super_admin',
    label: 'Platform owner',
    summary: 'Holds every permission implicitly. The only level that can appoint admins, change levels, revoke access or grant developer mode.',
  },
  {
    level: 'admin',
    label: 'Platform admin',
    summary: 'Starts with the platform overview, businesses and support. Everything else must be granted key by key.',
  },
  {
    level: 'support',
    label: 'Support agent',
    summary: 'Starts with the platform overview and support, so customer records and notes are reachable but nothing commercial is.',
  },
  {
    level: 'finance_operator',
    label: 'Finance operator',
    summary: 'Starts with the platform overview plus payment visibility and subscription changes.',
  },
  {
    level: 'developer',
    label: 'Developer / technical operator',
    summary: 'Starts with the platform overview and developer mode. The level itself grants nothing else.',
  },
] as const;

export class PlatformAdminService {
  // ------------------------------------------------------- my access

  /**
   * Effective platform permissions for the signed-in user. Used to hide admin
   * areas the user cannot use; the server re-checks every action regardless.
   */
  static async getMyAccess(): Promise<MyPlatformAccess> {
    try {
      const { data, error } = await supabase.rpc('get_my_platform_permissions');
      if (error) throw error;
      const row: any = Array.isArray(data) ? data[0] : data;
      return {
        isPlatformAdmin: Boolean(row?.is_platform_admin),
        isSuperAdmin: Boolean(row?.is_super_admin),
        developerMode: Boolean(row?.developer_mode),
        permissions: row?.permissions ?? [],
      };
    } catch (error) {
      console.error('Get my platform permissions error:', error);
      throw error;
    }
  }

  // ---------------------------------------------------------- overview

  static async getOverview(productKey?: string): Promise<PlatformOverviewV2> {
    try {
      const { data, error } = await supabase.rpc('get_platform_overview_v2', {
        p_product_key: productKey ?? null,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return {
        totalBusinesses: Number(row?.total_businesses ?? 0),
        activeSubscriptions: Number(row?.active_subscriptions ?? 0),
        trialingSubscriptions: Number(row?.trialing_subscriptions ?? 0),
        pastDueSubscriptions: Number(row?.past_due_subscriptions ?? 0),
        expiringWithin30d: Number(row?.expiring_within_30d ?? 0),
        failedPayments30d: Number(row?.failed_payments_30d ?? 0),
        revenue30d: Number(row?.revenue_30d ?? 0),
        sandboxBusinesses: Number(row?.sandbox_businesses ?? 0),
      };
    } catch (error) {
      console.error('Get platform overview error:', error);
      throw error;
    }
  }

  // ---------------------------------------------------------- products

  static async listProducts(): Promise<PlatformProduct[]> {
    try {
      const { data, error } = await supabase.rpc('list_platform_products');
      if (error) throw error;
      return (data ?? []).map((row: any) => ({
        id: row.id,
        key: row.key,
        name: row.name,
        tagline: row.tagline,
        description: row.description,
        status: row.status,
        visibility: row.visibility,
        features: row.features ?? [],
        onboardingNote: row.onboarding_note,
        accessSettings: row.access_settings ?? {},
        planCount: Number(row.plan_count ?? 0),
        businessCount: Number(row.business_count ?? 0),
        sortOrder: Number(row.sort_order ?? 0),
        updatedAt: row.updated_at,
      }));
    } catch (error) {
      console.error('List platform products error:', error);
      throw error;
    }
  }

  static async saveProduct(input: {
    key: string;
    name: string;
    tagline?: string | null;
    description?: string | null;
    status?: string;
    visibility?: string;
    onboardingNote?: string | null;
    accessSettings?: Record<string, unknown>;
    sortOrder?: number;
  }): Promise<void> {
    try {
      const { error } = await supabase.rpc('upsert_platform_product', {
        p_key: input.key,
        p_name: input.name,
        p_tagline: input.tagline ?? null,
        p_description: input.description ?? null,
        p_status: input.status ?? 'active',
        p_visibility: input.visibility ?? 'public',
        p_onboarding_note: input.onboardingNote ?? null,
        p_access_settings: input.accessSettings ?? null,
        p_sort_order: input.sortOrder ?? null,
      });
      if (error) throw error;
    } catch (error) {
      console.error('Save platform product error:', error);
      throw error;
    }
  }

  // ------------------------------------------------------- plans/pricing

  static async listPlans(productKey?: string): Promise<ProductPlan[]> {
    try {
      const { data, error } = await supabase.rpc('list_product_plans', {
        p_product_key: productKey ?? null,
      });
      if (error) throw error;
      return (data ?? []).map((row: any) => ({
        id: row.id,
        productId: row.product_id,
        productKey: row.product_key,
        productName: row.product_name,
        key: row.key,
        name: row.name,
        description: row.description,
        monthlyPrice: row.monthly_price === null ? null : Number(row.monthly_price),
        annualPrice: row.annual_price === null ? null : Number(row.annual_price),
        currency: row.currency,
        userLimit: row.user_limit === null ? null : Number(row.user_limit),
        features: row.features ?? [],
        onboardingNote: row.onboarding_note,
        // Present since migration 089 appended it to list_product_plans.
        billingCycle: row.billing_cycle ?? 'monthly',
        status: row.status,
        isDefault: Boolean(row.is_default),
        isPublic: Boolean(row.is_public),
        sortOrder: Number(row.sort_order ?? 0),
        subscriberCount: Number(row.subscriber_count ?? 0),
        updatedAt: row.updated_at,
      }));
    } catch (error) {
      console.error('List product plans error:', error);
      throw error;
    }
  }

  static async savePlan(input: {
    productKey: string;
    planKey: string;
    name: string;
    description?: string | null;
    monthlyPrice?: number | null;
    annualPrice?: number | null;
    userLimit?: number | null;
    features?: { key: string; label: string; upcoming?: boolean }[];
    onboardingNote?: string | null;
    billingCycle?: 'monthly' | 'annual' | 'custom';
    status?: string;
    isDefault?: boolean;
    isPublic?: boolean;
    sortOrder?: number;
    note?: string | null;
  }): Promise<void> {
    try {
      /*
       * `upsert_product_plan` writes whatever cycle it is given, and its
       * parameter defaults to 'monthly'. A caller that simply does not know about
       * the column would therefore rewrite an annual or custom plan as monthly on
       * any unrelated edit, so the stored value is read back and preserved unless
       * the caller deliberately asks for a change. A plan that does not exist yet
       * legitimately starts on monthly.
       */
      let billingCycle = input.billingCycle;
      if (!billingCycle) {
        const existing = await PlatformAdminService.listPlans(input.productKey);
        billingCycle = existing.find((plan) => plan.key === input.planKey)?.billingCycle ?? 'monthly';
      }

      const { error } = await supabase.rpc('upsert_product_plan', {
        p_product_key: input.productKey,
        p_plan_key: input.planKey,
        p_name: input.name,
        p_description: input.description ?? null,
        p_monthly_price: input.monthlyPrice ?? null,
        p_annual_price: input.annualPrice ?? null,
        p_user_limit: input.userLimit ?? null,
        p_features: input.features ?? null,
        p_onboarding_note: input.onboardingNote ?? null,
        p_status: input.status ?? 'active',
        p_is_default: input.isDefault ?? false,
        p_is_public: input.isPublic ?? true,
        p_sort_order: input.sortOrder ?? null,
        p_note: input.note ?? null,
        p_billing_cycle: billingCycle,
      });
      if (error) throw error;
    } catch (error) {
      console.error('Save product plan error:', error);
      throw error;
    }
  }

  static async listPlanRevisions(planId: string, limit = 50): Promise<PlanRevision[]> {
    try {
      const { data, error } = await supabase.rpc('list_plan_revisions', {
        p_plan_id: planId,
        p_limit: limit,
      });
      if (error) throw error;
      return (data ?? []).map((row: any) => ({
        id: row.id,
        changeType: row.change_type,
        previousValues: row.previous_values,
        newValues: row.new_values,
        note: row.note,
        changedByEmail: row.changed_by_email,
        createdAt: row.created_at,
      }));
    } catch (error) {
      console.error('List plan revisions error:', error);
      throw error;
    }
  }

  // ------------------------------------------------------- businesses

  static async listBusinesses(filters: {
    productKey?: string;
    search?: string;
    status?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<ProductBusiness[]> {
    try {
      const { data, error } = await supabase.rpc('list_product_businesses', {
        p_product_key: filters.productKey ?? null,
        p_search: filters.search ?? null,
        p_status: filters.status ?? null,
        p_limit: filters.limit ?? 100,
        p_offset: filters.offset ?? 0,
      });
      if (error) throw error;
      return (data ?? []).map((row: any) => ({
        orgId: row.org_id,
        name: row.name,
        slug: row.slug,
        ownerEmail: row.owner_email,
        businessCategory: row.business_category ?? 'general_retail',
        billingStatus: row.billing_status,
        isSandbox: Boolean(row.is_sandbox),
        productKey: row.product_key,
        productName: row.product_name,
        planKey: row.plan_key,
        planName: row.plan_name,
        entitlementStatus: row.entitlement_status,
        agreedUserLimit: row.agreed_user_limit === null ? null : Number(row.agreed_user_limit),
        seatUsed: Number(row.seat_used ?? 0),
        expiresAt: row.expires_at,
        trialEndsAt: row.trial_ends_at,
        storeCount: Number(row.store_count ?? 0),
        createdAt: row.created_at,
      }));
    } catch (error) {
      console.error('List product businesses error:', error);
      throw error;
    }
  }

  static async getBusiness(orgId: string): Promise<BusinessDetail> {
    try {
      const { data, error } = await supabase.rpc('get_platform_business', {
        p_org_id: orgId,
      });
      if (error) throw error;
      const row: any = data ?? {};
      return {
        organization: row.organization ?? null,
        products: row.products ?? [],
        stores: row.stores ?? [],
        staff: row.staff ?? [],
        payments: row.payments ?? [],
        supportNotes: row.support_notes ?? [],
        adjustments: row.adjustments ?? [],
        seatUsed: Number(row.seat_used ?? 0),
      };
    } catch (error) {
      console.error('Get platform business error:', error);
      throw error;
    }
  }

  // ------------------------------------------------------------ users

  static async listUsers(filters: { productKey?: string; search?: string; limit?: number } = {}): Promise<
    PlatformUserRow[]
  > {
    try {
      const { data, error } = await supabase.rpc('list_platform_users', {
        p_product_key: filters.productKey ?? null,
        p_search: filters.search ?? null,
        p_limit: filters.limit ?? 100,
      });
      if (error) throw error;
      return (data ?? []).map((row: any) => ({
        userId: row.user_id,
        email: row.email,
        fullName: row.full_name,
        isPlatformAdmin: Boolean(row.is_platform_admin),
        platformLevel: row.platform_level,
        developerMode: Boolean(row.developer_mode),
        orgId: row.org_id,
        orgName: row.org_name,
        isSandbox: Boolean(row.is_sandbox),
        storeRole: row.store_role,
        entitledProducts: row.entitled_products ?? [],
        seatLimit: row.seat_limit === null ? null : Number(row.seat_limit),
        lastLoginAt: row.last_login_at,
        createdAt: row.created_at,
      }));
    } catch (error) {
      console.error('List platform users error:', error);
      throw error;
    }
  }

  static async listAdminAccounts(): Promise<PlatformAdminAccount[]> {
    try {
      const { data, error } = await supabase.rpc('list_platform_admin_accounts');
      if (error) throw error;
      return (data ?? []).map((row: any) => ({
        userId: row.user_id,
        email: row.email,
        level: row.level,
        status: row.status,
        permissions: row.permissions ?? [],
        developerMode: Boolean(row.developer_mode),
        grantedAt: row.granted_at,
      }));
    } catch (error) {
      console.error('List platform admin accounts error:', error);
      throw error;
    }
  }

  static async setAdminPermission(userId: string, permissionKey: string, granted: boolean): Promise<void> {
    try {
      const { error } = await supabase.rpc('set_platform_admin_permission', {
        p_user_id: userId,
        p_permission_key: permissionKey,
        p_granted: granted,
      });
      if (error) throw error;
    } catch (error) {
      console.error('Set platform admin permission error:', error);
      throw error;
    }
  }

  // --------------------------------------------------------- activation

  static async listActivationKeys(filters: { productKey?: string; status?: string; limit?: number } = {}): Promise<
    ActivationKeyRow[]
  > {
    try {
      const { data, error } = await supabase.rpc('list_activation_keys', {
        p_product_key: filters.productKey ?? null,
        p_status: filters.status ?? null,
        p_limit: filters.limit ?? 50,
      });
      if (error) throw error;
      return (data ?? []).map((row: any) => ({
        id: row.id,
        keyCodeMasked: row.key_code_masked,
        productKey: row.product_key,
        productName: row.product_name,
        planName: row.plan_name,
        orgId: row.org_id,
        orgName: row.org_name,
        status: row.status,
        validFrom: row.valid_from,
        validUntil: row.valid_until,
        userLimit: row.user_limit === null ? null : Number(row.user_limit),
        redeemedAt: row.redeemed_at,
        isSandbox: Boolean(row.is_sandbox),
        createdAt: row.created_at,
      }));
    } catch (error) {
      console.error('List activation keys error:', error);
      throw error;
    }
  }

  static async issueActivationKey(input: {
    productKey: string;
    planKey?: string | null;
    orgId?: string | null;
    validDays?: number;
    paymentReference?: string | null;
    isSandbox?: boolean;
  }): Promise<{ id: string; keyCode: string }> {
    try {
      const { data, error } = await supabase.rpc('issue_activation_key', {
        p_product_key: input.productKey,
        p_plan_key: input.planKey ?? null,
        p_org_id: input.orgId ?? null,
        p_valid_days: input.validDays ?? 365,
        p_payment_reference: input.paymentReference ?? null,
        p_is_sandbox: input.isSandbox ?? false,
      });
      if (error) throw error;
      const row: any = Array.isArray(data) ? data[0] : data;
      return { id: row?.id, keyCode: row?.key_code };
    } catch (error) {
      console.error('Issue activation key error:', error);
      throw error;
    }
  }

  static async revokeActivationKey(keyId: string, reason: string): Promise<void> {
    try {
      const { error } = await supabase.rpc('revoke_activation_key', {
        p_key_id: keyId,
        p_reason: reason,
      });
      if (error) throw error;
    } catch (error) {
      console.error('Revoke activation key error:', error);
      throw error;
    }
  }

  // ----------------------------------------------- payments/adjustments

  static async recordAdjustment(input: {
    orgId: string;
    adjustmentType: string;
    productKey?: string | null;
    newPlanKey?: string | null;
    newExpiresAt?: string | null;
    newUserLimit?: number | null;
    reason: string;
  }): Promise<void> {
    try {
      const { error } = await supabase.rpc('record_subscription_adjustment', {
        p_org_id: input.orgId,
        p_adjustment_type: input.adjustmentType,
        p_product_key: input.productKey ?? null,
        p_new_plan_key: input.newPlanKey ?? null,
        p_new_expires_at: input.newExpiresAt ?? null,
        p_new_user_limit: input.newUserLimit ?? null,
        p_reason: input.reason,
      });
      if (error) throw error;
    } catch (error) {
      console.error('Record subscription adjustment error:', error);
      throw error;
    }
  }

  static async listAdjustments(orgId?: string, limit = 100): Promise<SubscriptionAdjustment[]> {
    try {
      const { data, error } = await supabase.rpc('list_subscription_adjustments', {
        p_org_id: orgId ?? null,
        p_limit: limit,
      });
      if (error) throw error;
      return (data ?? []).map((row: any) => ({
        id: row.id,
        orgId: row.org_id,
        orgName: row.org_name,
        adjustmentType: row.adjustment_type,
        reason: row.reason,
        previousValues: row.previous_values,
        newValues: row.new_values,
        performedByEmail: row.performed_by_email,
        isSandbox: Boolean(row.is_sandbox),
        createdAt: row.created_at,
      }));
    } catch (error) {
      console.error('List subscription adjustments error:', error);
      throw error;
    }
  }

  // ---------------------------------------------------------- support

  static async addSupportNote(input: {
    orgId: string;
    body: string;
    noteType?: string;
    productKey?: string | null;
  }): Promise<void> {
    try {
      const { error } = await supabase.rpc('add_support_note', {
        p_org_id: input.orgId,
        p_body: input.body,
        p_note_type: input.noteType ?? 'note',
        p_product_key: input.productKey ?? null,
      });
      if (error) throw error;
    } catch (error) {
      console.error('Add support note error:', error);
      throw error;
    }
  }

  static async listSupportNotes(orgId: string, limit = 50): Promise<SupportNote[]> {
    try {
      const { data, error } = await supabase.rpc('list_support_notes', {
        p_org_id: orgId,
        p_limit: limit,
      });
      if (error) throw error;
      return (data ?? []).map((row: any) => ({
        id: row.id,
        noteType: row.note_type,
        body: row.body,
        adminEmail: row.admin_email,
        productKey: row.product_key,
        isSandbox: Boolean(row.is_sandbox),
        createdAt: row.created_at,
      }));
    } catch (error) {
      console.error('List support notes error:', error);
      throw error;
    }
  }

  // --------------------------------------------------------- settings

  static async listSettings(): Promise<PlatformSetting[]> {
    try {
      const { data, error } = await supabase.rpc('list_platform_settings');
      if (error) throw error;
      return (data ?? []).map((row: any) => ({
        key: row.key,
        value: row.value,
        description: row.description,
        category: row.category,
        updatedAt: row.updated_at,
      }));
    } catch (error) {
      console.error('List platform settings error:', error);
      throw error;
    }
  }

  static async setSetting(key: string, value: unknown): Promise<void> {
    try {
      const { error } = await supabase.rpc('set_platform_setting', {
        p_key: key,
        p_value: value,
      });
      if (error) throw error;
    } catch (error) {
      console.error('Set platform setting error:', error);
      throw error;
    }
  }

  static async listNotificationTemplates(): Promise<NotificationTemplate[]> {
    try {
      const { data, error } = await supabase.rpc('list_notification_templates');
      if (error) throw error;
      return (data ?? []).map((row: any) => ({
        id: row.id,
        key: row.key,
        name: row.name,
        channel: row.channel,
        subject: row.subject,
        body: row.body,
        status: row.status,
        updatedAt: row.updated_at,
      }));
    } catch (error) {
      console.error('List notification templates error:', error);
      throw error;
    }
  }

  static async upsertNotificationTemplate(input: {
    key: string;
    name: string;
    channel: string;
    subject?: string | null;
    body: string;
    status?: string;
  }): Promise<void> {
    try {
      const { error } = await supabase.rpc('upsert_notification_template', {
        p_key: input.key,
        p_name: input.name,
        p_channel: input.channel,
        p_subject: input.subject ?? null,
        p_body: input.body,
        p_status: input.status ?? 'active',
      });
      if (error) throw error;
    } catch (error) {
      console.error('Upsert notification template error:', error);
      throw error;
    }
  }

  // --------------------------------------------------- developer mode

  static async getDeveloperStatus(): Promise<DeveloperStatus> {
    try {
      const { data, error } = await supabase.rpc('get_my_developer_status');
      if (error) throw error;
      const row: any = Array.isArray(data) ? data[0] : data;
      return {
        isPlatformAdmin: Boolean(row?.is_platform_admin),
        isSuperAdmin: Boolean(row?.is_super_admin),
        developerMode: Boolean(row?.developer_mode),
        grantedAt: row?.granted_at ?? null,
        expiresAt: row?.expires_at ?? null,
        activeSessionId: row?.active_session_id ?? null,
      };
    } catch (error) {
      console.error('Get developer status error:', error);
      throw error;
    }
  }

  static async startDeveloperSession(): Promise<void> {
    try {
      const { error } = await supabase.rpc('start_developer_session');
      if (error) throw error;
    } catch (error) {
      console.error('Start developer session error:', error);
      throw error;
    }
  }

  static async endDeveloperSession(): Promise<void> {
    try {
      const { error } = await supabase.rpc('end_developer_session');
      if (error) throw error;
    } catch (error) {
      console.error('End developer session error:', error);
      throw error;
    }
  }

  static async grantDeveloperMode(userId: string, reason: string, validDays = 30): Promise<void> {
    try {
      const { error } = await supabase.rpc('grant_developer_mode', {
        p_user_id: userId,
        p_reason: reason,
        p_valid_days: validDays,
      });
      if (error) throw error;
    } catch (error) {
      console.error('Grant developer mode error:', error);
      throw error;
    }
  }

  static async revokeDeveloperMode(userId: string, reason: string): Promise<void> {
    try {
      const { error } = await supabase.rpc('revoke_developer_mode', {
        p_user_id: userId,
        p_reason: reason,
      });
      if (error) throw error;
    } catch (error) {
      console.error('Revoke developer mode error:', error);
      throw error;
    }
  }

  static async listDeveloperGrants(): Promise<DeveloperGrant[]> {
    try {
      const { data, error } = await supabase.rpc('list_developer_grants');
      if (error) throw error;
      return (data ?? []).map((row: any) => ({
        userId: row.user_id,
        email: row.email,
        status: row.status,
        level: row.level,
        grantedByEmail: row.granted_by_email,
        grantedAt: row.granted_at,
        expiresAt: row.expires_at,
        revokedAt: row.revoked_at,
        reason: row.reason,
      }));
    } catch (error) {
      console.error('List developer grants error:', error);
      throw error;
    }
  }

  /** Redacted diagnostics. The RPC strips secrets and masks emails. */
  static async getDiagnostics(orgId: string): Promise<Record<string, unknown>> {
    try {
      const { data, error } = await supabase.rpc('get_developer_diagnostics', {
        p_org_id: orgId,
      });
      if (error) throw error;
      return (data ?? {}) as Record<string, unknown>;
    } catch (error) {
      console.error('Get developer diagnostics error:', error);
      throw error;
    }
  }

  static async createSandboxBusiness(name: string, ownerEmail?: string): Promise<{ orgId: string; name: string }> {
    try {
      const { data, error } = await supabase.rpc('create_sandbox_business', {
        p_name: name,
        p_owner_email: ownerEmail ?? null,
      });
      if (error) throw error;
      const row: any = Array.isArray(data) ? data[0] : data;
      return { orgId: row?.id, name: row?.name };
    } catch (error) {
      console.error('Create sandbox business error:', error);
      throw error;
    }
  }

  static async listSandboxBusinesses(): Promise<SandboxBusiness[]> {
    try {
      const { data, error } = await supabase.rpc('list_sandbox_businesses');
      if (error) throw error;
      return (data ?? []).map((row: any) => ({
        orgId: row.org_id,
        name: row.name,
        slug: row.slug,
        ownerEmail: row.owner_email,
        createdAt: row.created_at,
      }));
    } catch (error) {
      console.error('List sandbox businesses error:', error);
      throw error;
    }
  }

  static async startImpersonation(orgId: string, reason: string, minutes = 15): Promise<void> {
    try {
      const { error } = await supabase.rpc('start_impersonation', {
        p_org_id: orgId,
        p_reason: reason,
        p_minutes: minutes,
      });
      if (error) throw error;
    } catch (error) {
      console.error('Start impersonation error:', error);
      throw error;
    }
  }

  static async endImpersonation(sessionId?: string): Promise<void> {
    try {
      const { error } = await supabase.rpc('end_impersonation', {
        p_session_id: sessionId ?? null,
      });
      if (error) throw error;
    } catch (error) {
      console.error('End impersonation error:', error);
      throw error;
    }
  }

  static async getActiveImpersonation(): Promise<ImpersonationInfo | null> {
    try {
      const { data, error } = await supabase.rpc('get_active_impersonation');
      if (error) throw error;
      const row: any = Array.isArray(data) ? data[0] : data;
      if (!row?.session_id) return null;
      return {
        sessionId: row.session_id,
        orgId: row.org_id,
        orgName: row.org_name,
        expiresAt: row.expires_at,
        secondsRemaining: Number(row.seconds_remaining ?? 0),
        reason: row.reason,
      };
    } catch (error) {
      console.error('Get active impersonation error:', error);
      throw error;
    }
  }

  // -------------------------------------------------------- audit logs

  /**
   * Platform-wide audit trail.
   *
   * Audit rows with no organisation (every platform-scoped action) are hidden
   * from tenants by RLS and reachable only through this SECURITY DEFINER
   * function. Secrets inside `changes`/`details` are redacted server-side.
   */
  static async listAuditLogs(filters: {
    actorId?: string;
    orgId?: string;
    action?: string;
    resourceType?: string;
    status?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<PlatformAuditPage> {
    try {
      const { data, error } = await supabase.rpc('list_platform_audit_logs', {
        p_actor_id: filters.actorId ?? null,
        p_org_id: filters.orgId ?? null,
        p_action: filters.action ?? null,
        p_resource_type: filters.resourceType ?? null,
        p_status: filters.status ?? null,
        p_from: filters.from ?? null,
        p_to: filters.to ?? null,
        p_limit: filters.limit ?? 50,
        p_offset: filters.offset ?? 0,
      });
      if (error) throw error;
      const rows = (data ?? []) as any[];
      return {
        entries: rows.map((row) => ({
          id: row.id,
          actorEmail: row.actor_email,
          orgId: row.org_id,
          orgName: row.org_name,
          action: row.action,
          resourceType: row.resource_type,
          resourceId: row.resource_id,
          resourceName: row.resource_name,
          status: row.status,
          changes: row.changes,
          details: row.details,
          createdAt: row.created_at,
        })),
        total: Number(rows[0]?.total_count ?? rows.length),
      };
    } catch (error) {
      console.error('List platform audit logs error:', error);
      throw error;
    }
  }

  // ------------------------------------------------- platform admin roster

  /**
   * The platform admin roster.
   *
   * Unlike the older `list_platform_admin_accounts`, this reports the effective
   * permission count — which for a non-owner is exactly the keys granted to them,
   * since a level is a label and the grants are the capability.
   */
  static async listPlatformAdminAccountsV2(): Promise<PlatformAdminAccountV2[]> {
    try {
      const { data, error } = await supabase.rpc('list_platform_admin_accounts_v2');
      if (error) throw error;
      return (data ?? []).map((row: any) => ({
        userId: row.user_id,
        email: row.email,
        fullName: row.full_name,
        level: row.level,
        status: row.status,
        permissions: row.permissions ?? [],
        permissionCount: Number(row.permission_count ?? 0),
        developerMode: Boolean(row.developer_mode),
        grantedByEmail: row.granted_by_email,
        grantedAt: row.granted_at,
        revokedAt: row.revoked_at,
        note: row.note,
      }));
    } catch (error) {
      console.error('List platform admin roster error:', error);
      throw error;
    }
  }

  /** Appoints a platform admin. The server seeds the level's baseline permissions. */
  static async grantPlatformAdmin(userId: string, level: string, note?: string): Promise<void> {
    try {
      const { error } = await supabase.rpc('grant_platform_admin', {
        p_user_id: userId,
        p_level: level,
        p_note: note ?? null,
      });
      if (error) throw error;
    } catch (error) {
      console.error('Grant platform admin error:', error);
      throw error;
    }
  }

  /**
   * Changes a platform admin's level. Permissions are reseeded for the new level
   * — cleared when moving to owner, since that level implies every key.
   */
  static async setPlatformAdminLevel(userId: string, level: string, note?: string): Promise<void> {
    try {
      const { error } = await supabase.rpc('set_platform_admin_level', {
        p_user_id: userId,
        p_level: level,
        p_note: note ?? null,
      });
      if (error) throw error;
    } catch (error) {
      console.error('Set platform admin level error:', error);
      throw error;
    }
  }

  /**
   * Revokes platform access: permissions, developer mode, active developer
   * sessions and both legacy platform flags. A reason is required.
   */
  static async revokePlatformAdmin(userId: string, reason: string): Promise<void> {
    try {
      const { error } = await supabase.rpc('revoke_platform_admin', {
        p_user_id: userId,
        p_reason: reason,
      });
      if (error) throw error;
    } catch (error) {
      console.error('Revoke platform admin error:', error);
      throw error;
    }
  }
}
