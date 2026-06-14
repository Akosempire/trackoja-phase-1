-- Migration: 031_subscriptions_functions.sql
-- Description: Phase 6 subscription checkout/activation functions.
--   - initiate_subscription_checkout (authenticated, org owner only): starts
--     a Paystack checkout by recording a pending subscription_transactions row.
--   - activate_subscription (service_role only, called by the paystack-webhook
--     Edge Function on 'charge.success'): marks the transaction successful and
--     activates the org's subscription for the plan's billing period.
--   - mark_subscription_transaction_failed (service_role only, called by the
--     paystack-webhook Edge Function on 'charge.failed'): marks the
--     transaction failed.
-- Author: TrackOja Team
-- Date: 2026-06-14

-- ============================================================
-- INITIATE_SUBSCRIPTION_CHECKOUT
-- ============================================================
CREATE OR REPLACE FUNCTION public.initiate_subscription_checkout(
  p_org_id UUID,
  p_plan_id UUID
)
RETURNS public.subscription_transactions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org public.organizations;
  v_plan public.subscription_plans;
  v_txn public.subscription_transactions;
  v_reference TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_org FROM public.organizations WHERE id = p_org_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  IF v_org.owner_id != auth.uid() THEN
    RAISE EXCEPTION 'Only the organization owner can manage billing';
  END IF;

  SELECT * INTO v_plan FROM public.subscription_plans WHERE id = p_plan_id AND status = 'active';
  IF v_plan IS NULL THEN
    RAISE EXCEPTION 'Plan not found or inactive';
  END IF;

  v_reference := 'sub_' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.subscription_transactions (
    org_id, plan_id, reference, amount, currency, status, created_by
  ) VALUES (
    p_org_id, p_plan_id, v_reference, v_plan.price, v_plan.currency, 'pending', auth.uid()
  )
  RETURNING * INTO v_txn;

  RETURN v_txn;
END;
$$;

GRANT EXECUTE ON FUNCTION public.initiate_subscription_checkout(UUID, UUID) TO authenticated;

-- ============================================================
-- ACTIVATE_SUBSCRIPTION (service_role only - called by paystack-webhook)
-- ============================================================
CREATE OR REPLACE FUNCTION public.activate_subscription(
  p_reference TEXT,
  p_paystack_data JSONB,
  p_paid_at TIMESTAMP WITH TIME ZONE
)
RETURNS public.subscriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_txn public.subscription_transactions;
  v_plan public.subscription_plans;
  v_subscription public.subscriptions;
  v_period_end TIMESTAMP WITH TIME ZONE;
BEGIN
  SELECT * INTO v_txn FROM public.subscription_transactions WHERE reference = p_reference FOR UPDATE;
  IF v_txn IS NULL THEN
    RAISE EXCEPTION 'Transaction not found for reference %', p_reference;
  END IF;

  -- Idempotent: if already processed, return the existing subscription unchanged.
  IF v_txn.status = 'success' THEN
    SELECT * INTO v_subscription FROM public.subscriptions WHERE org_id = v_txn.org_id;
    RETURN v_subscription;
  END IF;

  SELECT * INTO v_plan FROM public.subscription_plans WHERE id = v_txn.plan_id;
  IF v_plan IS NULL THEN
    RAISE EXCEPTION 'Plan not found for transaction %', p_reference;
  END IF;

  v_period_end := CASE v_plan.billing_interval
    WHEN 'yearly' THEN now() + INTERVAL '1 year'
    ELSE now() + INTERVAL '1 month'
  END;

  UPDATE public.subscriptions
  SET
    plan_id = v_plan.id,
    status = 'active',
    trial_end = NULL,
    current_period_start = now(),
    current_period_end = v_period_end,
    cancel_at_period_end = FALSE,
    ended_at = NULL
  WHERE org_id = v_txn.org_id
  RETURNING * INTO v_subscription;

  UPDATE public.organizations
  SET subscription_plan_id = v_plan.id, billing_status = 'active', trial_ends_at = NULL
  WHERE id = v_txn.org_id;

  UPDATE public.subscription_transactions
  SET status = 'success', subscription_id = v_subscription.id, paystack_data = p_paystack_data, paid_at = p_paid_at
  WHERE id = v_txn.id;

  RETURN v_subscription;
END;
$$;

REVOKE ALL ON FUNCTION public.activate_subscription(TEXT, JSONB, TIMESTAMP WITH TIME ZONE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_subscription(TEXT, JSONB, TIMESTAMP WITH TIME ZONE) TO service_role;

-- ============================================================
-- MARK_SUBSCRIPTION_TRANSACTION_FAILED (service_role only - called by paystack-webhook)
-- ============================================================
CREATE OR REPLACE FUNCTION public.mark_subscription_transaction_failed(
  p_reference TEXT,
  p_paystack_data JSONB
)
RETURNS public.subscription_transactions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_txn public.subscription_transactions;
BEGIN
  SELECT * INTO v_txn FROM public.subscription_transactions WHERE reference = p_reference FOR UPDATE;
  IF v_txn IS NULL THEN
    RAISE EXCEPTION 'Transaction not found for reference %', p_reference;
  END IF;

  IF v_txn.status != 'pending' THEN
    RETURN v_txn;
  END IF;

  UPDATE public.subscription_transactions
  SET status = 'failed', paystack_data = p_paystack_data
  WHERE id = v_txn.id
  RETURNING * INTO v_txn;

  RETURN v_txn;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_subscription_transaction_failed(TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_subscription_transaction_failed(TEXT, JSONB) TO service_role;
