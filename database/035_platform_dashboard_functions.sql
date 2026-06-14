-- Migration: 035_platform_dashboard_functions.sql
-- Description: Phase 7 platform dashboard read functions.
--   All functions are SECURITY DEFINER / STABLE and require
--   is_platform_admin(auth.uid()) (034_platform_admin_schema.sql). Because
--   they run as the table owner they bypass RLS, enabling safe cross-org
--   aggregate reads for the Platform Owner dashboard.
--   - get_platform_overview: org/store/user counts and growth.
--   - list_platform_organizations: per-org billing/subscription summary.
--   - get_platform_revenue_summary: Paystack revenue totals for a date range.
--   - get_platform_revenue_by_plan: Paystack revenue grouped by plan.
--   - get_platform_system_health: failure counters for the last 24h.
--   - list_platform_recent_errors: recent failed/attempted audit log rows.
-- Author: TrackOja Team
-- Date: 2026-06-14

-- ============================================================
-- GET_PLATFORM_OVERVIEW
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_platform_overview()
RETURNS TABLE (
  total_organizations BIGINT,
  new_organizations_30d BIGINT,
  total_stores BIGINT,
  active_stores BIGINT,
  total_users BIGINT,
  trialing_subscriptions BIGINT,
  active_subscriptions BIGINT,
  past_due_organizations BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Permission denied: platform admin required';
  END IF;

  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM public.organizations) AS total_organizations,
    (SELECT COUNT(*) FROM public.organizations WHERE created_at >= now() - INTERVAL '30 days') AS new_organizations_30d,
    (SELECT COUNT(*) FROM public.stores) AS total_stores,
    (SELECT COUNT(*) FROM public.stores WHERE status = 'active') AS active_stores,
    (SELECT COUNT(*) FROM public.users) AS total_users,
    (SELECT COUNT(*) FROM public.subscriptions WHERE status = 'trialing') AS trialing_subscriptions,
    (SELECT COUNT(*) FROM public.subscriptions WHERE status = 'active') AS active_subscriptions,
    (SELECT COUNT(*) FROM public.organizations WHERE billing_status = 'past_due') AS past_due_organizations;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_platform_overview() TO authenticated;

-- ============================================================
-- LIST_PLATFORM_ORGANIZATIONS
-- ============================================================
CREATE OR REPLACE FUNCTION public.list_platform_organizations()
RETURNS TABLE (
  org_id UUID,
  name TEXT,
  slug TEXT,
  owner_email TEXT,
  billing_status TEXT,
  plan_name TEXT,
  subscription_status TEXT,
  store_count BIGINT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Permission denied: platform admin required';
  END IF;

  RETURN QUERY
  SELECT
    o.id AS org_id,
    o.name,
    o.slug,
    u.email AS owner_email,
    o.billing_status,
    sp.name AS plan_name,
    s.status AS subscription_status,
    (SELECT COUNT(*) FROM public.stores st WHERE st.org_id = o.id) AS store_count,
    o.created_at
  FROM public.organizations o
  LEFT JOIN public.users u ON u.id = o.owner_id
  LEFT JOIN public.subscriptions s ON s.org_id = o.id
  LEFT JOIN public.subscription_plans sp ON sp.id = s.plan_id
  ORDER BY o.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_platform_organizations() TO authenticated;

-- ============================================================
-- GET_PLATFORM_REVENUE_SUMMARY
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_platform_revenue_summary(
  p_date_from TIMESTAMPTZ,
  p_date_to TIMESTAMPTZ
)
RETURNS TABLE (
  total_revenue NUMERIC,
  transaction_count BIGINT,
  successful_count BIGINT,
  failed_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Permission denied: platform admin required';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(SUM(t.amount) FILTER (WHERE t.status = 'success'), 0) AS total_revenue,
    COUNT(*) AS transaction_count,
    COUNT(*) FILTER (WHERE t.status = 'success') AS successful_count,
    COUNT(*) FILTER (WHERE t.status = 'failed') AS failed_count
  FROM public.subscription_transactions t
  WHERE t.created_at >= p_date_from
    AND t.created_at < p_date_to;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_platform_revenue_summary(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

-- ============================================================
-- GET_PLATFORM_REVENUE_BY_PLAN
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_platform_revenue_by_plan(
  p_date_from TIMESTAMPTZ,
  p_date_to TIMESTAMPTZ
)
RETURNS TABLE (
  plan_id UUID,
  plan_name TEXT,
  revenue NUMERIC,
  transaction_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Permission denied: platform admin required';
  END IF;

  RETURN QUERY
  SELECT
    sp.id AS plan_id,
    sp.name AS plan_name,
    COALESCE(SUM(t.amount), 0) AS revenue,
    COUNT(*) AS transaction_count
  FROM public.subscription_transactions t
  JOIN public.subscription_plans sp ON sp.id = t.plan_id
  WHERE t.status = 'success'
    AND t.created_at >= p_date_from
    AND t.created_at < p_date_to
  GROUP BY sp.id, sp.name
  ORDER BY SUM(t.amount) DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_platform_revenue_by_plan(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

-- ============================================================
-- GET_PLATFORM_SYSTEM_HEALTH
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_platform_system_health()
RETURNS TABLE (
  failed_audit_events_24h BIGINT,
  failed_transactions_24h BIGINT,
  past_due_organizations BIGINT,
  suspended_organizations BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Permission denied: platform admin required';
  END IF;

  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM public.audit_logs WHERE status = 'failed' AND created_at >= now() - INTERVAL '24 hours') AS failed_audit_events_24h,
    (SELECT COUNT(*) FROM public.subscription_transactions WHERE status = 'failed' AND created_at >= now() - INTERVAL '24 hours') AS failed_transactions_24h,
    (SELECT COUNT(*) FROM public.organizations WHERE billing_status = 'past_due') AS past_due_organizations,
    (SELECT COUNT(*) FROM public.organizations WHERE billing_status = 'suspended') AS suspended_organizations;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_platform_system_health() TO authenticated;

-- ============================================================
-- LIST_PLATFORM_RECENT_ERRORS
-- ============================================================
CREATE OR REPLACE FUNCTION public.list_platform_recent_errors(
  p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
  id UUID,
  org_id UUID,
  org_name TEXT,
  actor_email TEXT,
  action TEXT,
  resource_type TEXT,
  resource_name TEXT,
  status TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Permission denied: platform admin required';
  END IF;

  RETURN QUERY
  SELECT
    a.id,
    a.org_id,
    o.name AS org_name,
    u.email AS actor_email,
    a.action,
    a.resource_type,
    a.resource_name,
    a.status,
    a.created_at
  FROM public.audit_logs a
  LEFT JOIN public.organizations o ON o.id = a.org_id
  LEFT JOIN public.users u ON u.id = a.actor_id
  WHERE a.status IN ('failed', 'attempted')
  ORDER BY a.created_at DESC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_platform_recent_errors(INTEGER) TO authenticated;
