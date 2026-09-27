// services/subscription.service.ts
// Billing/subscriptions service (Phase 6)

import { supabase } from '../config/supabase';
import type { Subscription, SubscriptionPlan, SubscriptionTransaction } from '../types';

export interface CheckoutResult {
  authorizationUrl: string;
  reference: string;
}

/** A plan as the customer sees it: the published catalogue, not an admin view. */
export interface PublishedPlan {
  id: string;
  productKey: string;
  productName: string;
  key: string;
  name: string;
  description: string | null;
  monthlyPrice: number | null;
  annualPrice: number | null;
  currency: string;
  billingCycle: 'monthly' | 'annual' | 'custom';
  userLimit: number | null;
  storeLimit: number | null;
  features: { key: string; label: string; upcoming?: boolean }[];
  onboardingNote: string | null;
  setupFee: number | null;
  trialDays: number;
  isDefault: boolean;
  sortOrder: number;
  publishedAt: string | null;
  effectiveFrom: string | null;
}

/** The business's own entitlement, with real usage. */
export interface MyEntitlement {
  orgId: string;
  orgName: string;
  productKey: string;
  productName: string;
  planId: string | null;
  planKey: string | null;
  planName: string | null;
  status: string;
  source: string;
  agreedMonthlyPrice: number | null;
  agreedAnnualPrice: number | null;
  agreedUserLimit: number | null;
  agreedStoreLimit: number | null;
  billingCycle: string | null;
  currency: string;
  trialEndsAt: string | null;
  activatedAt: string | null;
  expiresAt: string | null;
  cancelledAt: string | null;
  seatsUsed: number;
  storesUsed: number;
  daysRemaining: number | null;
}

export class SubscriptionService {
  /**
   * The published plan catalogue — the same set the public pricing page and the
   * platform console's plans are built from. This replaced a read of the legacy
   * `subscription_plans` table, which held only Starter and could never offer
   * Standard or Premium.
   */
  static async getPublishedPlans(productKey = 'trackoja'): Promise<PublishedPlan[]> {
    try {
      const { data, error } = await supabase.rpc('list_published_plans', { p_product_key: productKey });
      if (error) throw error;
      return (data ?? []).map((row: any) => ({
        id: row.id,
        productKey: row.product_key,
        productName: row.product_name,
        key: row.key,
        name: row.name,
        description: row.description,
        monthlyPrice: row.monthly_price === null ? null : Number(row.monthly_price),
        annualPrice: row.annual_price === null ? null : Number(row.annual_price),
        currency: row.currency,
        billingCycle: row.billing_cycle ?? 'monthly',
        userLimit: row.user_limit === null ? null : Number(row.user_limit),
        storeLimit: row.store_limit === null ? null : Number(row.store_limit),
        features: row.features ?? [],
        onboardingNote: row.onboarding_note,
        setupFee: row.setup_fee === null ? null : Number(row.setup_fee),
        trialDays: Number(row.trial_days ?? 0),
        isDefault: Boolean(row.is_default),
        sortOrder: Number(row.sort_order ?? 0),
        publishedAt: row.published_at,
        effectiveFrom: row.effective_from,
      }));
    } catch (error) {
      console.error('Get published plans error:', error);
      throw error;
    }
  }

  /**
   * This business's entitlement and real usage.
   *
   * Returns null when the business holds no entitlement for the product, which
   * is different from holding one with no dates — the page shows "no plan" in
   * one case and a trial or renewal date in the other.
   */
  static async getMyEntitlement(productKey = 'trackoja'): Promise<MyEntitlement | null> {
    try {
      const { data, error } = await supabase.rpc('get_my_entitlement', { p_product_key: productKey });
      if (error) throw error;
      const row: any = Array.isArray(data) ? data[0] : data;
      if (!row?.org_id) return null;
      return {
        orgId: row.org_id,
        orgName: row.org_name,
        productKey: row.product_key,
        productName: row.product_name,
        planId: row.plan_id,
        planKey: row.plan_key,
        planName: row.plan_name,
        status: row.status,
        source: row.source,
        agreedMonthlyPrice: row.agreed_monthly_price === null ? null : Number(row.agreed_monthly_price),
        agreedAnnualPrice: row.agreed_annual_price === null ? null : Number(row.agreed_annual_price),
        agreedUserLimit: row.agreed_user_limit === null ? null : Number(row.agreed_user_limit),
        agreedStoreLimit: row.agreed_store_limit === null ? null : Number(row.agreed_store_limit),
        billingCycle: row.billing_cycle,
        currency: row.currency,
        trialEndsAt: row.trial_ends_at,
        activatedAt: row.activated_at,
        expiresAt: row.expires_at,
        cancelledAt: row.cancelled_at,
        seatsUsed: Number(row.seats_used ?? 0),
        storesUsed: Number(row.stores_used ?? 0),
        daysRemaining: row.days_remaining === null ? null : Number(row.days_remaining),
      };
    } catch (error) {
      console.error('Get my entitlement error:', error);
      throw error;
    }
  }

  /**
   * Start checkout for a **published plan**, by its product-plan id.
   *
   * `initiate_subscription_checkout` takes a legacy plan id, so it could only
   * ever reach the plans in that older table. This goes through
   * `start_plan_checkout`, which takes the published plan and keeps the legacy
   * row in step for the readers that still depend on it.
   */
  static async startPlanCheckout(
    planId: string,
    billingCycle: 'monthly' | 'annual',
    callbackUrl: string,
  ): Promise<CheckoutResult> {
    try {
      const { data: txn, error } = await supabase.rpc('start_plan_checkout', {
        p_plan_id: planId,
        p_billing_cycle: billingCycle,
      });
      if (error) throw error;

      const { data, error: invokeError } = await supabase.functions.invoke('paystack-initialize', {
        body: { reference: txn.reference, callbackUrl },
      });
      if (invokeError) throw invokeError;
      if (data?.error) throw new Error(data.error);

      return { authorizationUrl: data.authorizationUrl, reference: txn.reference };
    } catch (error) {
      console.error('Start plan checkout error:', error);
      throw error;
    }
  }

  /**
   * Active subscription plans available for purchase, cheapest first.
   *
   * @deprecated The legacy catalogue. Only Starter is active in it, so anything
   * customer-facing should use `getPublishedPlans`. Kept for callers that still
   * read the legacy `subscriptions` row.
   */
  static async getPlans(): Promise<SubscriptionPlan[]> {
    try {
      const { data, error } = await supabase
        .from('subscription_plans')
        .select('*')
        .eq('status', 'active')
        .order('price', { ascending: true });

      if (error) throw error;
      return (data ?? []).map((row) => this.mapPlan(row));
    } catch (error) {
      console.error('Get subscription plans error:', error);
      throw error;
    }
  }

  /**
   * The organization's current subscription, including its plan.
   */
  static async getOrgSubscription(orgId: string): Promise<Subscription | null> {
    try {
      const { data, error } = await supabase
        .from('subscriptions')
        .select('*, plan:subscription_plans(*)')
        .eq('org_id', orgId)
        .maybeSingle();

      if (error) throw error;
      return data ? this.mapSubscription(data) : null;
    } catch (error) {
      console.error('Get organization subscription error:', error);
      throw error;
    }
  }

  /**
   * Payment history for the organization, most recent first.
   */
  static async getTransactions(orgId: string): Promise<SubscriptionTransaction[]> {
    try {
      const { data, error } = await supabase
        .from('subscription_transactions')
        .select('*')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data ?? []).map((row) => this.mapTransaction(row));
    } catch (error) {
      console.error('Get subscription transactions error:', error);
      throw error;
    }
  }

  /**
   * Start a Paystack checkout for the given plan: records a pending
   * subscription_transactions row, then asks the paystack-initialize Edge
   * Function for a hosted checkout URL to redirect the user to.
   */
  static async initiateCheckout(orgId: string, planId: string, callbackUrl: string): Promise<CheckoutResult> {
    try {
      const { data: txn, error: rpcError } = await supabase.rpc('initiate_subscription_checkout', {
        p_org_id: orgId,
        p_plan_id: planId,
      });
      if (rpcError) throw rpcError;

      const { data, error } = await supabase.functions.invoke('paystack-initialize', {
        body: { reference: txn.reference, callbackUrl },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      return { authorizationUrl: data.authorizationUrl, reference: txn.reference };
    } catch (error) {
      console.error('Initiate subscription checkout error:', error);
      throw error;
    }
  }

  private static mapPlan(data: any): SubscriptionPlan {
    return {
      id: data.id,
      name: data.name,
      description: data.description,
      price: Number(data.price),
      currency: data.currency,
      billingInterval: data.billing_interval,
      trialDays: Number(data.trial_days),
      featureSet: data.feature_set,
      status: data.status,
    };
  }

  private static mapSubscription(data: any): Subscription {
    return {
      id: data.id,
      orgId: data.org_id,
      planId: data.plan_id,
      status: data.status,
      startDate: data.start_date,
      trialEnd: data.trial_end,
      currentPeriodStart: data.current_period_start,
      currentPeriodEnd: data.current_period_end,
      cancelAtPeriodEnd: data.cancel_at_period_end,
      endedAt: data.ended_at,
      plan: data.plan ? this.mapPlan(data.plan) : undefined,
    };
  }

  private static mapTransaction(data: any): SubscriptionTransaction {
    return {
      id: data.id,
      orgId: data.org_id,
      subscriptionId: data.subscription_id,
      planId: data.plan_id,
      reference: data.reference,
      amount: Number(data.amount),
      currency: data.currency,
      status: data.status,
      paidAt: data.paid_at,
      createdAt: data.created_at,
    };
  }
}
