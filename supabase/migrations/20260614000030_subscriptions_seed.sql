-- Migration: 030_subscriptions_seed.sql
-- Description: Phase 6 subscription plan catalog (NGN pricing).
--   feature_set values of -1 mean "unlimited". These limits are informational
--   only in Phase 6 - enforcement is a future phase (see PHASE_6_SUBSCRIPTIONS.md).
-- Author: TrackOja Team
-- Date: 2026-06-14

INSERT INTO public.subscription_plans (name, description, price, currency, billing_interval, trial_days, feature_set, status)
VALUES
  (
    'Free',
    'Get started with a single store.',
    0,
    'NGN',
    'monthly',
    0,
    '{"stores": 1, "products": 50, "customers": 50, "team_members": 2}'::jsonb,
    'active'
  ),
  (
    'Starter',
    'For growing businesses with multiple stores.',
    5000,
    'NGN',
    'monthly',
    14,
    '{"stores": 3, "products": 1000, "customers": 1000, "team_members": 10}'::jsonb,
    'active'
  ),
  (
    'Pro',
    'Unlimited stores, products, and team members.',
    15000,
    'NGN',
    'monthly',
    14,
    '{"stores": -1, "products": -1, "customers": -1, "team_members": -1}'::jsonb,
    'active'
  )
ON CONFLICT (name) DO NOTHING;
