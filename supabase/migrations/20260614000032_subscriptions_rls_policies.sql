-- Migration: 032_subscriptions_rls_policies.sql
-- Description: Row Level Security policies for subscription_plans,
--   subscriptions, and subscription_transactions. Plans are readable by any
--   authenticated user (pricing/upgrade UI). subscriptions and
--   subscription_transactions are readable only by the owning organization's
--   owner. All writes happen via initiate_subscription_checkout/
--   activate_subscription/mark_subscription_transaction_failed and the
--   new-organization trigger (SECURITY DEFINER) - no INSERT/UPDATE/DELETE
--   policies are defined for authenticated users.
-- Author: TrackOja Team
-- Date: 2026-06-14

-- ============================================================
-- SUBSCRIPTION_PLANS
-- ============================================================
CREATE POLICY subscription_plans_select ON public.subscription_plans
  FOR SELECT
  TO authenticated
  USING (status = 'active');

-- ============================================================
-- SUBSCRIPTIONS
-- ============================================================
CREATE POLICY subscriptions_select ON public.subscriptions
  FOR SELECT
  USING (
    org_id IN (SELECT id FROM public.organizations WHERE owner_id = auth.uid())
  );

-- ============================================================
-- SUBSCRIPTION_TRANSACTIONS
-- ============================================================
CREATE POLICY subscription_transactions_select ON public.subscription_transactions
  FOR SELECT
  USING (
    org_id IN (SELECT id FROM public.organizations WHERE owner_id = auth.uid())
  );
