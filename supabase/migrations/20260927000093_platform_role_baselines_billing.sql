-- Migration: 093_platform_role_baselines_billing.sql
-- Description: Give the finance and technical roles the keys their definitions
--   already promise.
--
--   Migration 091 seeded a baseline per level so that appointing an admin does
--   not produce an account that can do nothing. Two of those baselines do not
--   match what the roles are for:
--
--     finance_operator  had view, view_payments and manage_subscriptions, but not
--                       manage_plans - yet the role is defined as handling
--                       "plans, payments, invoices, reconciliation and refunds".
--                       A finance operator could see and change subscriptions and
--                       could not touch the prices they are charged at, which is
--                       the one thing that role most obviously needs.
--
--     developer         had view and developer:access only, but the role is
--                       defined as covering "integrations, environment
--                       configuration, system health, logs and technical
--                       diagnostics". It could open the developer area and could
--                       not manage an integration or read a health signal.
--
--   A baseline is a starting point, not a ceiling: both levels can still be given
--   more keys individually, and neither gains anything here that its definition
--   does not already claim.
--
-- Author: TrackOja Team
-- Date: 2026-09-27

-- ============================================================
-- CORRECTED BASELINES
-- ============================================================

CREATE OR REPLACE FUNCTION public.platform_level_baseline(p_level TEXT)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_level
    WHEN 'super_admin'      THEN ARRAY[]::TEXT[]
    WHEN 'admin'            THEN ARRAY['platform:view', 'platform:manage_businesses', 'platform:support']
    WHEN 'support'          THEN ARRAY['platform:view', 'platform:support']
    WHEN 'finance_operator' THEN ARRAY[
      'platform:view',
      'platform:view_payments',
      'platform:manage_subscriptions',
      'platform:manage_plans'
    ]
    WHEN 'developer'        THEN ARRAY[
      'platform:view',
      'platform:view_health',
      'platform:manage_integrations',
      'developer:access'
    ]
    ELSE NULL
  END;
$$;

COMMENT ON FUNCTION public.platform_level_baseline(TEXT) IS
  'The permission keys a platform level starts with. Returns NULL for an unknown level so callers can reject it. A baseline is a starting point, not a ceiling.';

REVOKE ALL ON FUNCTION public.platform_level_baseline(TEXT) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- BRING EXISTING ACCOUNTS UP TO THEIR LEVEL'S BASELINE
-- ============================================================
-- Additive only, and only for keys the account does not already hold. It never
-- removes a grant: an account given an extra key by hand keeps it.
--
-- Adds nothing to admin or support, whose baselines are unchanged. Idempotent —
-- a second run inserts nothing.

INSERT INTO public.platform_admin_permissions (user_id, permission_key, granted_by)
SELECT pa.user_id, baseline.key, pa.user_id
FROM public.platform_admins pa
CROSS JOIN LATERAL unnest(public.platform_level_baseline(pa.level)) AS baseline(key)
WHERE pa.status = 'active'
  AND pa.level <> 'super_admin'
  AND NOT EXISTS (
    SELECT 1
    FROM public.platform_admin_permissions existing
    WHERE existing.user_id = pa.user_id
      AND existing.permission_key = baseline.key
  )
ON CONFLICT (user_id, permission_key) DO NOTHING;
