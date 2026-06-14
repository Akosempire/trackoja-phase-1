// services/subscription.service.ts
// Billing/subscriptions service (Phase 6)

import { supabase } from '../config/supabase';
import type { Subscription, SubscriptionPlan, SubscriptionTransaction } from '../types';

export interface CheckoutResult {
  authorizationUrl: string;
  reference: string;
}

export class SubscriptionService {
  /**
   * Active subscription plans available for purchase, cheapest first.
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
