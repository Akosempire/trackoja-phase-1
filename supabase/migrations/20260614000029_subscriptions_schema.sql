-- Migration: 029_subscriptions_schema.sql
-- Description: Phase 6 subscriptions schema.
--   - subscription_plans: available billing tiers (price, interval, trial
--     length, informational feature_set).
--   - subscriptions: one row per organization tracking plan, lifecycle status,
--     and the current billing period.
--   - subscription_transactions: one row per Paystack checkout attempt,
--     written by initiate_subscription_checkout/activate_subscription/
--     mark_subscription_transaction_failed (031_subscriptions_functions.sql).
--   - organizations.subscription_plan_id gains an FK to subscription_plans.
-- Author: TrackOja Team
-- Date: 2026-06-14

-- ============================================================
-- SUBSCRIPTION PLANS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  price NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  currency TEXT NOT NULL DEFAULT 'NGN',
  billing_interval TEXT NOT NULL DEFAULT 'monthly' CHECK (billing_interval IN ('monthly', 'yearly')),
  trial_days INTEGER NOT NULL DEFAULT 0 CHECK (trial_days >= 0),
  feature_set JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS handle_updated_at_subscription_plans ON public.subscription_plans;
CREATE TRIGGER handle_updated_at_subscription_plans BEFORE UPDATE ON public.subscription_plans
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================
-- SUBSCRIPTIONS (one per organization)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES public.subscription_plans(id),
  status TEXT NOT NULL DEFAULT 'trialing' CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused', 'expired')),
  start_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  trial_end TIMESTAMP WITH TIME ZONE,
  current_period_start TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  current_period_end TIMESTAMP WITH TIME ZONE,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  ended_at TIMESTAMP WITH TIME ZONE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_plan ON public.subscriptions(plan_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON public.subscriptions(status);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS handle_updated_at_subscriptions ON public.subscriptions;
CREATE TRIGGER handle_updated_at_subscriptions BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================
-- SUBSCRIPTION TRANSACTIONS (one per Paystack checkout attempt)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.subscription_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  plan_id UUID NOT NULL REFERENCES public.subscription_plans(id),
  reference TEXT NOT NULL UNIQUE,
  amount NUMERIC(14,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'NGN',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed', 'abandoned')),
  paystack_data JSONB,
  paid_at TIMESTAMP WITH TIME ZONE,
  created_by UUID NOT NULL REFERENCES public.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscription_txns_org ON public.subscription_transactions(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscription_txns_status ON public.subscription_transactions(status);

ALTER TABLE public.subscription_transactions ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS handle_updated_at_subscription_transactions ON public.subscription_transactions;
CREATE TRIGGER handle_updated_at_subscription_transactions BEFORE UPDATE ON public.subscription_transactions
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================
-- ORGANIZATIONS: link to subscription_plans
-- ============================================================
ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS fk_organizations_subscription_plan;
ALTER TABLE public.organizations ADD CONSTRAINT fk_organizations_subscription_plan
  FOREIGN KEY (subscription_plan_id) REFERENCES public.subscription_plans(id) ON DELETE SET NULL;
