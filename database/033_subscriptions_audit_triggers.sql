-- Migration: 033_subscriptions_audit_triggers.sql
-- Description: Phase 6 subscription triggers.
--   - New organizations get an initial subscriptions row on the Free plan,
--     status 'trialing', mirroring organizations.trial_ends_at.
--   - Subscription status changes and payment outcomes are written to
--     audit_logs, actor = organizations.owner_id (these tables are written by
--     SECURITY DEFINER functions / service_role, not the end user directly).
-- Author: TrackOja Team
-- Date: 2026-06-14

-- ============================================================
-- NEW ORGANIZATION -> INITIAL SUBSCRIPTION (Free plan, trialing)
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_organization_subscription()
RETURNS TRIGGER AS $$
DECLARE
  v_free_plan_id UUID;
BEGIN
  SELECT id INTO v_free_plan_id FROM public.subscription_plans WHERE name = 'Free';

  IF v_free_plan_id IS NOT NULL THEN
    INSERT INTO public.subscriptions (
      org_id, plan_id, status, trial_end, current_period_start, current_period_end
    ) VALUES (
      NEW.id, v_free_plan_id, 'trialing', NEW.trial_ends_at, now(), NEW.trial_ends_at
    )
    ON CONFLICT (org_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_organization_created_subscription ON public.organizations;
CREATE TRIGGER on_organization_created_subscription
  AFTER INSERT ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_organization_subscription();

-- ============================================================
-- SUBSCRIPTION STATUS CHANGE -> AUDIT LOG
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_subscription_status_audit()
RETURNS TRIGGER AS $$
DECLARE
  v_owner_id UUID;
BEGIN
  SELECT owner_id INTO v_owner_id FROM public.organizations WHERE id = NEW.org_id;

  INSERT INTO public.audit_logs (actor_id, org_id, action, resource_type, resource_id, changes)
  VALUES (
    v_owner_id,
    NEW.org_id,
    'SUBSCRIPTION_' || UPPER(NEW.status),
    'subscription',
    NEW.id,
    jsonb_build_object('from_status', OLD.status, 'to_status', NEW.status, 'plan_id', NEW.plan_id)
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_subscription_status_change ON public.subscriptions;
CREATE TRIGGER on_subscription_status_change
  AFTER UPDATE OF status ON public.subscriptions
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.handle_subscription_status_audit();

-- ============================================================
-- SUBSCRIPTION TRANSACTION STATUS CHANGE -> AUDIT LOG
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_subscription_transaction_status_audit()
RETURNS TRIGGER AS $$
DECLARE
  v_owner_id UUID;
BEGIN
  IF NEW.status NOT IN ('success', 'failed') THEN
    RETURN NEW;
  END IF;

  SELECT owner_id INTO v_owner_id FROM public.organizations WHERE id = NEW.org_id;

  INSERT INTO public.audit_logs (actor_id, org_id, action, resource_type, resource_id, changes)
  VALUES (
    v_owner_id,
    NEW.org_id,
    CASE NEW.status WHEN 'success' THEN 'PAYMENT_SUCCEEDED' ELSE 'PAYMENT_FAILED' END,
    'subscription_transaction',
    NEW.id,
    jsonb_build_object('from_status', OLD.status, 'to_status', NEW.status, 'reference', NEW.reference, 'amount', NEW.amount)
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_subscription_transaction_status_change ON public.subscription_transactions;
CREATE TRIGGER on_subscription_transaction_status_change
  AFTER UPDATE OF status ON public.subscription_transactions
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.handle_subscription_transaction_status_audit();
