// services/subscription.service.ts
// Billing/subscriptions service (Phase 6)

import { supabase } from '../config/supabase';
import type { Subscription, SubscriptionPlan, SubscriptionTransaction } from '../types';

export interface CheckoutResult {
  authorizationUrl: string;
  reference: string;
}

export interface BillingAvailability {
  paymentSystem: 'DISABLED' | 'TEST' | 'LIVE';
  trialEnabled: boolean;
  trialDays: number;
}

export interface TrialActivation {
  planName: string;
  trialEndsAt: string;
  trialDays: number;
}

export interface CheckoutPreview {
  orgId: string;
  planVersionId: string;
  planId: string;
  version: number;
  planName: string;
  billingCycle: 'monthly' | 'annual';
  recurringAmountMinor: number;
  setupFeeMinor: number;
  amountDueMinor: number;
  currency: string;
  trialSupported: false;
  trialDays: 0;
  nextBillingDate: string | null;
  billingEmail: string | null;
  isFirstPurchase: boolean;
}

export interface OnboardingProgress {
  id: string;
  orgId: string | null;
  storeId: string | null;
  selectedPlanVersionId: string | null;
  state: string;
  businessCategory: string | null;
  checkoutReference: string | null;
}

export interface CommercialAccess {
  orgId: string | null;
  onboardingState: string;
  entitlementStatus: string | null;
  hasAccess: boolean;
  isTestData: boolean;
}

export interface BillingDocument {
  invoiceId: string;
  invoiceNumber: string;
  receiptId: string | null;
  receiptNumber: string | null;
  planName: string;
  billingCycle: string;
  totalMinor: number;
  currency: string;
  status: string;
  isTestData: boolean;
  issuedAt: string;
  paidAt: string | null;
  reference: string;
  billingEmail: string | null;
}

/** One invoice line as the database stored it. Amounts are minor units. */
export interface BillingDocumentLine {
  lineType: string;
  description: string;
  quantity: number;
  unitAmountMinor: number;
  totalAmountMinor: number;
}

/** The receipt issued for an invoice, when one was. */
export interface BillingDocumentReceipt {
  receiptNumber: string;
  amountMinor: number;
  currency: string;
  paymentMode: string;
  providerReference: string | null;
  isTestData: boolean;
  paidAt: string;
}

/**
 * A whole billing document: the invoice, its own lines, and its receipt or the
 * knowledge that there is none.
 *
 * This is what the printable page renders, so it carries the stored amounts in
 * minor units rather than a total alone — the lines and the totals have to come
 * from the same row or the page could contradict itself.
 */
export interface BillingDocumentDetail {
  invoiceNumber: string;
  status: string;
  isTestData: boolean;
  issuedAt: string;
  paidAt: string | null;
  currency: string;
  subtotalMinor: number;
  totalMinor: number;
  billingEmail: string | null;
  businessName: string | null;
  planName: string | null;
  billingCycle: string | null;
  reference: string | null;
  lines: BillingDocumentLine[];
  receipt: BillingDocumentReceipt | null;
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
  monthlyVersionId: string | null;
  annualVersionId: string | null;
  monthlyVersion: number | null;
  annualVersion: number | null;
  monthlySetupFee: number;
  annualSetupFee: number;
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
  static async getBillingAvailability(): Promise<BillingAvailability> {
    const { data, error } = await supabase.rpc('get_billing_availability');
    if (error) {
      console.error('Billing availability failed', error);
      throw new Error('Plan availability could not be loaded. Please try again.');
    }
    return { paymentSystem: ['DISABLED', 'TEST', 'LIVE'].includes(data?.payment_system) ? data.payment_system : 'DISABLED',
      trialEnabled: data?.trial_enabled === true, trialDays: Number(data?.trial_days ?? 0) };
  }

  static async startTrial(planVersionId: string): Promise<TrialActivation> {
    const { data, error } = await supabase.rpc('start_product_trial', { p_plan_version_id: planVersionId });
    if (error) {
      console.error('Trial activation failed', error);
      const message = /already used|existing subscription|payment history|Only the business owner|currently unavailable|not available for a trial/.test(error.message)
        ? error.message : 'Your trial could not be started. Please try again or contact support.';
      throw new Error(message);
    }
    return { planName: data.plan_name, trialEndsAt: data.trial_ends_at, trialDays: Number(data.trial_days) };
  }

  private static async requireLivePayments(): Promise<void> {
    const availability = await this.getBillingAvailability();
    if (availability.paymentSystem !== 'LIVE') throw new Error('Online subscription payments are not available yet. Start your free trial to continue.');
  }
  /**
   * The published plan catalogue — the same set the public pricing page and the
   * platform console's plans are built from. This replaced a read of the legacy
   * `subscription_plans` table, which held only Starter and could never offer
   * Standard or Premium.
   */
  static async getPublishedPlans(productKey = 'trackoja'): Promise<PublishedPlan[]> {
    try {
      const { data, error } = await supabase.rpc('list_published_plan_versions', { p_product_key: productKey });
      if (error) throw error;
      const grouped = new Map<string, PublishedPlan>();
      for (const row of data ?? []) {
        const current = grouped.get(row.plan_id) ?? {
        id: row.plan_id,
        productKey: row.product_key,
        productName: row.product_name,
        key: row.plan_key,
        name: row.display_name,
        description: row.description,
        monthlyPrice: null,
        annualPrice: null,
        currency: row.currency,
        billingCycle: 'monthly' as const,
        userLimit: row.limits?.users == null ? null : Number(row.limits.users),
        storeLimit: row.limits?.stores == null ? null : Number(row.limits.stores),
        features: row.features ?? [],
        onboardingNote: null,
        setupFee: 0,
        trialDays: 0,
        isDefault: Boolean(row.is_default),
        sortOrder: Number(row.sort_order ?? 0),
        publishedAt: row.effective_from,
        effectiveFrom: row.effective_from,
        monthlyVersionId: null,
        annualVersionId: null,
        monthlyVersion: null,
        annualVersion: null,
        monthlySetupFee: 0,
        annualSetupFee: 0,
        } satisfies PublishedPlan;
        const amount = Number(row.amount_minor) / 100;
        const setup = Number(row.setup_fee_minor) / 100;
        if (row.billing_cycle === 'annual') {
          current.annualPrice = amount;
          current.annualVersionId = row.plan_version_id;
          current.annualVersion = Number(row.version);
          current.annualSetupFee = setup;
        } else {
          current.monthlyPrice = amount;
          current.monthlyVersionId = row.plan_version_id;
          current.monthlyVersion = Number(row.version);
          current.monthlySetupFee = setup;
        }
        current.setupFee = Math.max(current.monthlySetupFee, current.annualSetupFee);
        grouped.set(row.plan_id, current);
      }
      return [...grouped.values()].sort((a, b) => a.sortOrder - b.sortOrder);
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
    planVersionId: string,
    callbackUrl: string,
  ): Promise<CheckoutResult> {
    await this.requireLivePayments();
    try {
      const { data: txn, error } = await supabase.rpc('start_plan_version_checkout', {
        p_plan_version_id: planVersionId,
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
      throw new Error("We couldn't start your payment. No payment has been taken. Please try again.");
    }
  }

  static async getCheckoutPreview(planVersionId: string): Promise<CheckoutPreview> {
    const { data, error } = await supabase.rpc('get_checkout_preview', { p_plan_version_id: planVersionId });
    if (error || !data) {
      console.error('Plan preview failed', error);
      throw new Error('We could not load this plan. Please choose it again or try later.');
    }
    return {
      orgId: data.org_id,
      planVersionId: data.plan_version_id,
      planId: data.plan_id,
      version: Number(data.version),
      planName: data.plan_name,
      billingCycle: data.billing_cycle,
      recurringAmountMinor: Number(data.recurring_amount_minor),
      setupFeeMinor: Number(data.setup_fee_minor),
      amountDueMinor: Number(data.amount_due_minor),
      currency: data.currency,
      trialSupported: false,
      trialDays: 0,
      nextBillingDate: data.next_billing_date,
      billingEmail: data.billing_email,
      isFirstPurchase: Boolean(data.is_first_purchase),
    };
  }

  static async getOnboarding(): Promise<OnboardingProgress> {
    const { data, error } = await supabase.rpc('get_my_onboarding', { p_product_key: 'trackoja' });
    if (error) throw error;
    return {
      id: data.id,
      orgId: data.org_id,
      storeId: data.store_id,
      selectedPlanVersionId: data.selected_plan_version_id,
      state: data.state,
      businessCategory: data.business_category,
      checkoutReference: data.checkout_reference,
    };
  }

  static async getCommercialAccess(): Promise<CommercialAccess> {
    const { data, error } = await supabase.rpc('get_my_commercial_access', { p_product_key: 'trackoja' });
    if (error) throw error;
    return {
      orgId: data.org_id,
      onboardingState: data.onboarding_state,
      entitlementStatus: data.entitlement_status,
      hasAccess: Boolean(data.has_access),
      isTestData: Boolean(data.is_test_data),
    };
  }

  static async verifyPayment(reference: string) {
    const { data, error } = await supabase.functions.invoke('paystack-verify', { body: { reference } });
    if (error || data?.error) {
      console.error('Payment verification failed', error ?? data.error);
      throw new Error('We could not confirm your payment yet. Please check again or contact support with your reference.');
    }
    return data as { settled: boolean; status: string; testData?: boolean; detail?: string };
  }

  static async getBillingDocuments(): Promise<BillingDocument[]> {
    const { data, error } = await supabase.rpc('list_my_billing_documents', { p_limit: 50 });
    if (error) throw error;
    return (data ?? []).map((row: any) => ({
      invoiceId: row.invoice_id,
      invoiceNumber: row.invoice_number,
      receiptId: row.receipt_id,
      receiptNumber: row.receipt_number,
      planName: row.plan_name,
      billingCycle: row.billing_cycle,
      totalMinor: Number(row.total_minor),
      currency: row.currency,
      status: row.status,
      isTestData: Boolean(row.is_test_data),
      issuedAt: row.issued_at,
      paidAt: row.paid_at,
      reference: row.reference,
      billingEmail: row.billing_email,
    }));
  }

  /**
   * One document by the number the customer was shown, or null when this
   * business has no such document.
   *
   * Null covers both "no document with that number" and "that document belongs
   * to another business", because the server answers both the same way so the
   * number cannot be probed. The page states the absence rather than inventing
   * an empty document.
   */
  static async getBillingDocument(documentNumber: string): Promise<BillingDocumentDetail | null> {
    const { data, error } = await supabase.rpc('get_my_billing_document', {
      p_document_number: documentNumber,
    });
    if (error) {
      console.error('Billing document failed', error);
      throw new Error('This document could not be loaded. Please try again.');
    }
    // SQL NULL, not an error: the number is unknown or belongs to another
    // business, and the server answers both the same way.
    if (!data) return null;
    const receipt = data.receipt;
    return {
      invoiceNumber: data.invoice_number,
      status: data.status,
      isTestData: Boolean(data.is_test_data),
      issuedAt: data.issued_at,
      paidAt: data.paid_at,
      currency: data.currency,
      subtotalMinor: Number(data.subtotal_minor),
      totalMinor: Number(data.total_minor),
      billingEmail: data.billing_email,
      businessName: data.business_name,
      planName: data.plan_name,
      billingCycle: data.billing_cycle,
      reference: data.reference,
      lines: (data.lines ?? []).map((line: any) => ({
        lineType: line.line_type,
        description: line.description,
        quantity: Number(line.quantity),
        unitAmountMinor: Number(line.unit_amount_minor),
        totalAmountMinor: Number(line.total_amount_minor),
      })),
      receipt: receipt
        ? {
            receiptNumber: receipt.receipt_number,
            amountMinor: Number(receipt.amount_minor),
            currency: receipt.currency,
            paymentMode: receipt.payment_mode,
            providerReference: receipt.provider_reference,
            isTestData: Boolean(receipt.is_test_data),
            paidAt: receipt.paid_at,
          }
        : null,
    };
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
    await this.requireLivePayments();
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
      throw new Error("We couldn't start your payment. No payment has been taken. Please try again.");
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
