-- Migration: 069_platform_products_functions.sql
-- Description: Server-side authorisation and read/write functions for the
--   multi-product admin: overview, products, plans and pricing (with revision
--   history), businesses, and users. Every mutating function re-checks the
--   permission in the database, so hiding a UI control is never the control.
--   Also adds product attribution to subscription_transactions and enforces the
--   agreed seat limit at the database level.
-- Author: TrackOja Team
-- Date: 2026-09-26

-- ============================================================
-- PAYMENT PRODUCT ATTRIBUTION
-- ============================================================
-- Platform revenue must be attributable per product, and sandbox rows must be
-- excludable. Existing transactions belong to TrackOja.

ALTER TABLE public.subscription_transactions
  ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES public.platform_products(id) ON DELETE SET NULL;

ALTER TABLE public.subscription_transactions
  ADD COLUMN IF NOT EXISTS is_sandbox BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_subscription_txns_product
  ON public.subscription_transactions(product_id, created_at DESC);

UPDATE public.subscription_transactions st
SET product_id = p.id
FROM public.platform_products p
WHERE p.key = 'trackoja' AND st.product_id IS NULL;

COMMENT ON COLUMN public.subscription_transactions.product_id IS
  'Which product the payment was for. NULL only on legacy rows created before multi-product billing.';
COMMENT ON COLUMN public.subscription_transactions.is_sandbox IS
  'Test payment. Excluded from production revenue reporting.';

-- ============================================================
-- PERMISSION GATE
-- ============================================================

CREATE OR REPLACE FUNCTION public.require_platform_permission(p_permission TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.platform_user_has_permission(v_uid, p_permission) THEN
    RAISE EXCEPTION 'Permission denied: % required', p_permission;
  END IF;

  RETURN v_uid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.require_platform_permission(TEXT) TO authenticated;

COMMENT ON FUNCTION public.require_platform_permission(TEXT) IS
  'Canonical gate for platform-side functions. Returns the actor id or raises.';

-- ============================================================
-- OVERVIEW
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_platform_overview_v2(p_product_key TEXT DEFAULT NULL)
RETURNS TABLE (
  total_businesses BIGINT,
  active_subscriptions BIGINT,
  trialing_subscriptions BIGINT,
  past_due_subscriptions BIGINT,
  expiring_within_30d BIGINT,
  failed_payments_30d BIGINT,
  revenue_30d NUMERIC,
  sandbox_businesses BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_product_id UUID;
BEGIN
  PERFORM public.require_platform_permission('platform:view');

  IF p_product_key IS NOT NULL THEN
    SELECT id INTO v_product_id FROM public.platform_products WHERE key = p_product_key;
    IF v_product_id IS NULL THEN
      RAISE EXCEPTION 'Unknown product: %', p_product_key;
    END IF;
  END IF;

  RETURN QUERY
  WITH entitlements AS (
    SELECT op.*
    FROM public.organization_products op
    JOIN public.organizations o ON o.id = op.org_id
    WHERE o.is_sandbox = FALSE
      AND (v_product_id IS NULL OR op.product_id = v_product_id)
  )
  SELECT
    (SELECT COUNT(DISTINCT op.org_id) FROM entitlements op),
    (SELECT COUNT(*) FROM entitlements op WHERE op.status = 'active'),
    (SELECT COUNT(*) FROM entitlements op WHERE op.status = 'pending'),
    (SELECT COUNT(*) FROM entitlements op WHERE op.status = 'past_due'),
    (SELECT COUNT(*) FROM entitlements op
      WHERE op.status IN ('active', 'pending')
        AND op.expires_at IS NOT NULL
        AND op.expires_at BETWEEN now() AND now() + INTERVAL '30 days'),
    (SELECT COUNT(*) FROM public.subscription_transactions st
      WHERE st.is_sandbox = FALSE
        AND st.status = 'failed'
        AND st.created_at >= now() - INTERVAL '30 days'
        AND (v_product_id IS NULL OR st.product_id = v_product_id)),
    (SELECT COALESCE(SUM(st.amount), 0) FROM public.subscription_transactions st
      WHERE st.is_sandbox = FALSE
        AND st.status = 'success'
        AND st.created_at >= now() - INTERVAL '30 days'
        AND (v_product_id IS NULL OR st.product_id = v_product_id)),
    (SELECT COUNT(*) FROM public.organizations o WHERE o.is_sandbox = TRUE);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_platform_overview_v2(TEXT) TO authenticated;

-- ============================================================
-- PRODUCTS
-- ============================================================

CREATE OR REPLACE FUNCTION public.list_platform_products()
RETURNS TABLE (
  id UUID,
  key TEXT,
  name TEXT,
  tagline TEXT,
  description TEXT,
  status TEXT,
  visibility TEXT,
  features JSONB,
  onboarding_note TEXT,
  access_settings JSONB,
  plan_count BIGINT,
  business_count BIGINT,
  sort_order INTEGER,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_platform_permission('platform:view');

  RETURN QUERY
  SELECT
    p.id, p.key, p.name, p.tagline, p.description, p.status, p.visibility,
    p.features, p.onboarding_note, p.access_settings,
    (SELECT COUNT(*) FROM public.product_plans pp WHERE pp.product_id = p.id),
    (SELECT COUNT(*) FROM public.organization_products op
      WHERE op.product_id = p.id AND op.status IN ('active', 'pending')),
    p.sort_order, p.updated_at
  FROM public.platform_products p
  ORDER BY p.sort_order, p.name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_platform_products() TO authenticated;

CREATE OR REPLACE FUNCTION public.upsert_platform_product(
  p_key TEXT,
  p_name TEXT,
  p_tagline TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_status TEXT DEFAULT 'active',
  p_visibility TEXT DEFAULT 'public',
  p_onboarding_note TEXT DEFAULT NULL,
  p_access_settings JSONB DEFAULT NULL,
  p_sort_order INTEGER DEFAULT NULL
)
RETURNS public.platform_products
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := public.require_platform_permission('platform:manage_products');
  v_row public.platform_products;
BEGIN
  IF p_key IS NULL OR length(trim(p_key)) = 0 THEN
    RAISE EXCEPTION 'Product key is required';
  END IF;
  IF p_status NOT IN ('active', 'inactive', 'internal') THEN
    RAISE EXCEPTION 'Invalid product status: %', p_status;
  END IF;
  IF p_visibility NOT IN ('public', 'private', 'hidden') THEN
    RAISE EXCEPTION 'Invalid product visibility: %', p_visibility;
  END IF;

  INSERT INTO public.platform_products AS t
    (key, name, tagline, description, status, visibility, onboarding_note, access_settings, sort_order)
  VALUES
    (trim(p_key), p_name, p_tagline, p_description, p_status, p_visibility,
     p_onboarding_note, COALESCE(p_access_settings, '{}'::jsonb), COALESCE(p_sort_order, 0))
  ON CONFLICT (key) DO UPDATE SET
    name = EXCLUDED.name,
    tagline = EXCLUDED.tagline,
    description = EXCLUDED.description,
    status = EXCLUDED.status,
    visibility = EXCLUDED.visibility,
    onboarding_note = EXCLUDED.onboarding_note,
    access_settings = COALESCE(p_access_settings, t.access_settings),
    sort_order = COALESCE(p_sort_order, t.sort_order),
    updated_at = now()
  RETURNING * INTO v_row;

  INSERT INTO public.audit_logs (actor_id, resource_type, resource_id, action, status, details)
  VALUES (v_actor, 'platform_product', v_row.id, 'PRODUCT_SAVED', 'success',
          jsonb_build_object('key', v_row.key, 'status', v_row.status, 'visibility', v_row.visibility));

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_platform_product(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, INTEGER) TO authenticated;

-- ============================================================
-- PLANS AND PRICING
-- ============================================================

CREATE OR REPLACE FUNCTION public.list_product_plans(p_product_key TEXT DEFAULT NULL)
RETURNS TABLE (
  id UUID,
  product_id UUID,
  product_key TEXT,
  product_name TEXT,
  key TEXT,
  name TEXT,
  description TEXT,
  monthly_price NUMERIC,
  annual_price NUMERIC,
  currency TEXT,
  user_limit INTEGER,
  features JSONB,
  onboarding_note TEXT,
  status TEXT,
  is_default BOOLEAN,
  is_public BOOLEAN,
  sort_order INTEGER,
  subscriber_count BIGINT,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_platform_permission('platform:view');

  RETURN QUERY
  SELECT
    pp.id, pp.product_id, pr.key, pr.name, pp.key, pp.name, pp.description,
    pp.monthly_price, pp.annual_price, pp.currency, pp.user_limit, pp.features,
    pp.onboarding_note, pp.status, pp.is_default, pp.is_public, pp.sort_order,
    (SELECT COUNT(*) FROM public.organization_products op
      WHERE op.plan_id = pp.id AND op.status IN ('active', 'pending')),
    pp.updated_at
  FROM public.product_plans pp
  JOIN public.platform_products pr ON pr.id = pp.product_id
  WHERE p_product_key IS NULL OR pr.key = p_product_key
  ORDER BY pr.sort_order, pp.sort_order, pp.name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_product_plans(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.upsert_product_plan(
  p_product_key TEXT,
  p_plan_key TEXT,
  p_name TEXT,
  p_description TEXT DEFAULT NULL,
  p_monthly_price NUMERIC DEFAULT NULL,
  p_annual_price NUMERIC DEFAULT NULL,
  p_user_limit INTEGER DEFAULT NULL,
  p_features JSONB DEFAULT NULL,
  p_onboarding_note TEXT DEFAULT NULL,
  p_status TEXT DEFAULT 'active',
  p_is_default BOOLEAN DEFAULT FALSE,
  p_is_public BOOLEAN DEFAULT TRUE,
  p_sort_order INTEGER DEFAULT NULL,
  p_note TEXT DEFAULT NULL
)
RETURNS public.product_plans
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := public.require_platform_permission('platform:manage_plans');
  v_product_id UUID;
  v_existing public.product_plans;
  v_row public.product_plans;
  v_previous JSONB;
BEGIN
  IF p_status NOT IN ('active', 'inactive', 'draft', 'retired') THEN
    RAISE EXCEPTION 'Invalid plan status: %', p_status;
  END IF;
  IF p_monthly_price IS NOT NULL AND p_monthly_price < 0 THEN
    RAISE EXCEPTION 'Monthly price cannot be negative';
  END IF;
  IF p_annual_price IS NOT NULL AND p_annual_price < 0 THEN
    RAISE EXCEPTION 'Annual price cannot be negative';
  END IF;
  IF p_user_limit IS NOT NULL AND p_user_limit <> -1 AND p_user_limit < 1 THEN
    RAISE EXCEPTION 'User limit must be positive, -1 for unlimited, or NULL for custom';
  END IF;

  SELECT id INTO v_product_id FROM public.platform_products WHERE key = p_product_key;
  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'Unknown product: %', p_product_key;
  END IF;

  SELECT * INTO v_existing
  FROM public.product_plans
  WHERE product_id = v_product_id AND key = p_plan_key;

  IF v_existing.id IS NOT NULL THEN
    v_previous := jsonb_build_object(
      'name', v_existing.name,
      'monthly_price', v_existing.monthly_price,
      'annual_price', v_existing.annual_price,
      'user_limit', v_existing.user_limit,
      'status', v_existing.status,
      'features', v_existing.features
    );
  END IF;

  IF p_is_default THEN
    UPDATE public.product_plans SET is_default = FALSE
    WHERE product_id = v_product_id AND is_default = TRUE AND key <> p_plan_key;
  END IF;

  INSERT INTO public.product_plans AS t
    (product_id, key, name, description, monthly_price, annual_price, user_limit,
     features, onboarding_note, status, is_default, is_public, sort_order, created_by)
  VALUES
    (v_product_id, p_plan_key, p_name, p_description, p_monthly_price, p_annual_price,
     p_user_limit, COALESCE(p_features, '[]'::jsonb), p_onboarding_note, p_status,
     p_is_default, p_is_public, COALESCE(p_sort_order, 0), v_actor)
  ON CONFLICT (product_id, key) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    monthly_price = EXCLUDED.monthly_price,
    annual_price = EXCLUDED.annual_price,
    user_limit = EXCLUDED.user_limit,
    features = COALESCE(p_features, t.features),
    onboarding_note = EXCLUDED.onboarding_note,
    status = EXCLUDED.status,
    is_default = EXCLUDED.is_default,
    is_public = EXCLUDED.is_public,
    sort_order = COALESCE(p_sort_order, t.sort_order),
    updated_at = now()
  RETURNING * INTO v_row;

  -- Journal the change. Existing subscribers are unaffected: their agreed prices
  -- live on organization_products and are never rewritten by a plan edit.
  INSERT INTO public.product_plan_revisions
    (plan_id, product_id, changed_by, change_type, previous_values, new_values, note)
  VALUES (
    v_row.id,
    v_product_id,
    v_actor,
    CASE WHEN v_existing.id IS NULL THEN 'created' ELSE 'updated' END,
    v_previous,
    jsonb_build_object(
      'name', v_row.name,
      'monthly_price', v_row.monthly_price,
      'annual_price', v_row.annual_price,
      'user_limit', v_row.user_limit,
      'status', v_row.status,
      'features', v_row.features
    ),
    p_note
  );

  INSERT INTO public.audit_logs (actor_id, resource_type, resource_id, action, status, details)
  VALUES (v_actor, 'product_plan', v_row.id,
          CASE WHEN v_existing.id IS NULL THEN 'PLAN_CREATED' ELSE 'PLAN_UPDATED' END,
          'success',
          jsonb_build_object('product_key', p_product_key, 'plan_key', p_plan_key,
                             'previous', v_previous, 'note', p_note));

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_product_plan(TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, INTEGER, JSONB, TEXT, TEXT, BOOLEAN, BOOLEAN, INTEGER, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_plan_revisions(p_plan_id UUID, p_limit INTEGER DEFAULT 50)
RETURNS TABLE (
  id UUID,
  change_type TEXT,
  previous_values JSONB,
  new_values JSONB,
  note TEXT,
  changed_by_email TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_platform_permission('platform:view');

  RETURN QUERY
  SELECT r.id, r.change_type, r.previous_values, r.new_values, r.note,
         u.email, r.created_at
  FROM public.product_plan_revisions r
  LEFT JOIN public.users u ON u.id = r.changed_by
  WHERE r.plan_id = p_plan_id
  ORDER BY r.created_at DESC
  LIMIT COALESCE(p_limit, 50);
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_plan_revisions(UUID, INTEGER) TO authenticated;

-- ============================================================
-- BUSINESSES
-- ============================================================

CREATE OR REPLACE FUNCTION public.list_product_businesses(
  p_product_key TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 100,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  org_id UUID,
  name TEXT,
  slug TEXT,
  owner_email TEXT,
  business_category TEXT,
  billing_status TEXT,
  is_sandbox BOOLEAN,
  product_key TEXT,
  product_name TEXT,
  plan_key TEXT,
  plan_name TEXT,
  entitlement_status TEXT,
  agreed_user_limit INTEGER,
  seat_used BIGINT,
  expires_at TIMESTAMPTZ,
  trial_ends_at TIMESTAMPTZ,
  store_count BIGINT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_platform_permission('platform:manage_businesses');

  RETURN QUERY
  SELECT
    o.id,
    o.name,
    o.slug,
    u.email,
    COALESCE(o.business_category, 'general_retail'),
    o.billing_status,
    o.is_sandbox,
    pr.key,
    pr.name,
    pp.key,
    pp.name,
    op.status,
    op.agreed_user_limit,
    (SELECT COUNT(DISTINCT sm.user_id)
       FROM public.store_members sm
       JOIN public.stores s ON s.id = sm.store_id
      WHERE s.org_id = o.id AND sm.status = 'active' AND sm.user_id IS NOT NULL),
    op.expires_at,
    op.trial_ends_at,
    (SELECT COUNT(*) FROM public.stores s WHERE s.org_id = o.id),
    o.created_at
  FROM public.organizations o
  JOIN public.organization_products op ON op.org_id = o.id
  JOIN public.platform_products pr ON pr.id = op.product_id
  LEFT JOIN public.product_plans pp ON pp.id = op.plan_id
  LEFT JOIN public.users u ON u.id = o.owner_id
  WHERE (p_product_key IS NULL OR pr.key = p_product_key)
    AND (p_status IS NULL OR op.status = p_status)
    AND (
      p_search IS NULL
      OR o.name ILIKE '%' || p_search || '%'
      OR u.email ILIKE '%' || p_search || '%'
      OR o.slug ILIKE '%' || p_search || '%'
    )
  ORDER BY o.created_at DESC
  LIMIT COALESCE(p_limit, 100)
  OFFSET COALESCE(p_offset, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_product_businesses(TEXT, TEXT, TEXT, INTEGER, INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_platform_business(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  PERFORM public.require_platform_permission('platform:manage_businesses');

  SELECT jsonb_build_object(
    'organization', (
      SELECT jsonb_build_object(
        'id', o.id, 'name', o.name, 'slug', o.slug, 'billing_status', o.billing_status,
        'business_category', COALESCE(o.business_category, 'general_retail'),
        'is_sandbox', o.is_sandbox, 'trial_ends_at', o.trial_ends_at,
        'owner_email', u.email, 'owner_name',
          NULLIF(trim(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''),
        'created_at', o.created_at
      )
      FROM public.organizations o
      LEFT JOIN public.users u ON u.id = o.owner_id
      WHERE o.id = p_org_id
    ),
    'products', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_key', pr.key, 'product_name', pr.name,
        'plan_key', pp.key, 'plan_name', pp.name,
        'status', op.status, 'source', op.source,
        'agreed_user_limit', op.agreed_user_limit,
        'agreed_monthly_price', op.agreed_monthly_price,
        'currency', op.currency,
        'trial_ends_at', op.trial_ends_at,
        'expires_at', op.expires_at,
        'is_sandbox', op.is_sandbox
      ) ORDER BY pr.sort_order)
      FROM public.organization_products op
      JOIN public.platform_products pr ON pr.id = op.product_id
      LEFT JOIN public.product_plans pp ON pp.id = op.plan_id
      WHERE op.org_id = p_org_id
    ), '[]'::jsonb),
    'stores', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'status', s.status)
             ORDER BY s.created_at)
      FROM public.stores s WHERE s.org_id = p_org_id
    ), '[]'::jsonb),
    'staff', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'user_id', sm.user_id, 'email', su.email, 'role', r.name, 'status', sm.status,
        'store_name', s.name) ORDER BY sm.created_at)
      FROM public.store_members sm
      JOIN public.stores s ON s.id = sm.store_id
      LEFT JOIN public.roles r ON r.id = sm.role_id
      LEFT JOIN public.users su ON su.id = sm.user_id
      WHERE s.org_id = p_org_id
    ), '[]'::jsonb),
    'seat_used', (
      SELECT COUNT(DISTINCT sm.user_id)
      FROM public.store_members sm
      JOIN public.stores s ON s.id = sm.store_id
      WHERE s.org_id = p_org_id AND sm.status = 'active' AND sm.user_id IS NOT NULL
    ),
    'payments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'reference', st.reference, 'amount', st.amount, 'currency', st.currency,
        'status', st.status, 'created_at', st.created_at, 'paid_at', st.paid_at,
        'is_sandbox', st.is_sandbox) ORDER BY st.created_at DESC)
      FROM (
        SELECT * FROM public.subscription_transactions
        WHERE org_id = p_org_id ORDER BY created_at DESC LIMIT 20
      ) st
    ), '[]'::jsonb),
    'support_notes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', n.id, 'note_type', n.note_type, 'body', n.body,
        'admin_email', au.email, 'created_at', n.created_at) ORDER BY n.created_at DESC)
      FROM (
        SELECT * FROM public.platform_support_notes
        WHERE org_id = p_org_id ORDER BY created_at DESC LIMIT 20
      ) n
      LEFT JOIN public.users au ON au.id = n.admin_user_id
    ), '[]'::jsonb),
    'adjustments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id, 'adjustment_type', a.adjustment_type, 'reason', a.reason,
        'created_at', a.created_at) ORDER BY a.created_at DESC)
      FROM (
        SELECT * FROM public.subscription_adjustments
        WHERE org_id = p_org_id ORDER BY created_at DESC LIMIT 20
      ) a
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_platform_business(UUID) TO authenticated;

-- ============================================================
-- USERS AND ROLES
-- ============================================================

CREATE OR REPLACE FUNCTION public.list_platform_users(
  p_product_key TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
  user_id UUID,
  email TEXT,
  full_name TEXT,
  is_platform_admin BOOLEAN,
  platform_level TEXT,
  developer_mode BOOLEAN,
  org_id UUID,
  org_name TEXT,
  is_sandbox BOOLEAN,
  store_role TEXT,
  entitled_products JSONB,
  seat_limit INTEGER,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_product_id UUID;
BEGIN
  PERFORM public.require_platform_permission('platform:manage_users');

  IF p_product_key IS NOT NULL THEN
    SELECT id INTO v_product_id FROM public.platform_products WHERE key = p_product_key;
  END IF;

  RETURN QUERY
  SELECT
    u.id,
    u.email,
    NULLIF(trim(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''),
    u.is_platform_admin,
    pa.level,
    public.developer_mode_enabled(u.id),
    o.id,
    o.name,
    COALESCE(o.is_sandbox, FALSE),
    (SELECT r.name
       FROM public.store_members sm
       JOIN public.roles r ON r.id = sm.role_id
      WHERE sm.user_id = u.id AND sm.status = 'active'
      ORDER BY sm.created_at LIMIT 1),
    COALESCE((
      SELECT jsonb_agg(DISTINCT pr.key)
      FROM public.organization_products op
      JOIN public.platform_products pr ON pr.id = op.product_id
      WHERE op.org_id = o.id
        AND op.status IN ('active', 'pending')
        AND (v_product_id IS NULL OR op.product_id = v_product_id)
    ), '[]'::jsonb),
    (SELECT MAX(op.agreed_user_limit) FROM public.organization_products op
      WHERE op.org_id = o.id AND op.status IN ('active', 'pending')),
    u.last_login_at,
    u.created_at
  FROM public.users u
  LEFT JOIN public.platform_admins pa ON pa.user_id = u.id
  LEFT JOIN public.organizations o ON o.id = u.current_org_id
  WHERE (
      p_search IS NULL
      OR u.email ILIKE '%' || p_search || '%'
      OR COALESCE(u.first_name, '') ILIKE '%' || p_search || '%'
      OR COALESCE(u.last_name, '') ILIKE '%' || p_search || '%'
    )
    AND (
      v_product_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.organization_products op
        WHERE op.org_id = o.id AND op.product_id = v_product_id
      )
      OR u.is_platform_admin = TRUE
    )
  ORDER BY u.created_at DESC
  LIMIT COALESCE(p_limit, 100);
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_platform_users(TEXT, TEXT, INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_platform_admin_accounts()
RETURNS TABLE (
  user_id UUID,
  email TEXT,
  level TEXT,
  status TEXT,
  permissions JSONB,
  developer_mode BOOLEAN,
  granted_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_platform_permission('platform:manage_users');

  RETURN QUERY
  SELECT
    pa.user_id,
    u.email,
    pa.level,
    pa.status,
    COALESCE((
      SELECT jsonb_agg(pap.permission_key ORDER BY pap.permission_key)
      FROM public.platform_admin_permissions pap
      WHERE pap.user_id = pa.user_id
    ), '[]'::jsonb),
    public.developer_mode_enabled(pa.user_id),
    pa.granted_at
  FROM public.platform_admins pa
  JOIN public.users u ON u.id = pa.user_id
  ORDER BY pa.level, u.email;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_platform_admin_accounts() TO authenticated;

CREATE OR REPLACE FUNCTION public.set_platform_admin_permission(
  p_user_id UUID,
  p_permission_key TEXT,
  p_granted BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_level TEXT;
BEGIN
  v_actor := public.require_platform_permission('platform:manage_users');

  -- Only a super admin may hand out platform permissions.
  IF NOT public.is_platform_super_admin(v_actor) THEN
    RAISE EXCEPTION 'Permission denied: platform super admin required';
  END IF;

  IF p_user_id = v_actor AND p_granted = FALSE AND p_permission_key = 'platform:manage_users' THEN
    RAISE EXCEPTION 'You cannot remove your own ability to manage platform users';
  END IF;

  SELECT level INTO v_level FROM public.platform_admins WHERE user_id = p_user_id;
  IF v_level IS NULL THEN
    RAISE EXCEPTION 'Target user is not a platform admin';
  END IF;
  IF v_level = 'super_admin' THEN
    RAISE EXCEPTION 'Super admins hold every permission and cannot be edited individually';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.platform_permissions WHERE key = p_permission_key) THEN
    RAISE EXCEPTION 'Unknown permission: %', p_permission_key;
  END IF;

  IF p_granted THEN
    INSERT INTO public.platform_admin_permissions (user_id, permission_key, granted_by)
    VALUES (p_user_id, p_permission_key, v_actor)
    ON CONFLICT (user_id, permission_key) DO NOTHING;
  ELSE
    DELETE FROM public.platform_admin_permissions
    WHERE user_id = p_user_id AND permission_key = p_permission_key;
  END IF;

  INSERT INTO public.audit_logs (actor_id, resource_type, resource_id, action, status, details)
  VALUES (v_actor, 'platform_admin', p_user_id,
          CASE WHEN p_granted THEN 'PLATFORM_PERMISSION_GRANTED' ELSE 'PLATFORM_PERMISSION_REVOKED' END,
          'success', jsonb_build_object('permission', p_permission_key));

  RETURN jsonb_build_object('user_id', p_user_id, 'permission', p_permission_key, 'granted', p_granted);
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_platform_admin_permission(UUID, TEXT, BOOLEAN) TO authenticated;

-- ============================================================
-- SEAT LIMIT AND SUBSCRIPTION ENFORCEMENT
-- ============================================================
-- Billable seats are counted per business (distinct active members across all of
-- its stores) and capped by the agreed limit on its live entitlements. This is
-- the enforcement the UI cannot bypass: it lives on the store_members table.
-- Sandbox businesses are exempt so developer testing is not blocked.

CREATE OR REPLACE FUNCTION public.enforce_seat_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_is_sandbox BOOLEAN;
  v_limit INTEGER;
  v_used INTEGER;
  v_has_live_entitlement BOOLEAN;
BEGIN
  IF NEW.status <> 'active' OR NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT o.id, o.is_sandbox INTO v_org_id, v_is_sandbox
  FROM public.stores s
  JOIN public.organizations o ON o.id = s.org_id
  WHERE s.id = NEW.store_id;

  IF v_org_id IS NULL OR v_is_sandbox THEN
    RETURN NEW;
  END IF;

  SELECT
    EXISTS (
      SELECT 1 FROM public.organization_products op
      WHERE op.org_id = v_org_id
        AND (
          (op.status = 'active' AND (op.expires_at IS NULL OR op.expires_at > now()))
          OR (op.status = 'pending' AND (op.trial_ends_at IS NULL OR op.trial_ends_at > now()))
        )
    ),
    MAX(op.agreed_user_limit)
  INTO v_has_live_entitlement, v_limit
  FROM public.organization_products op
  WHERE op.org_id = v_org_id
    AND op.agreed_user_limit IS NOT NULL
    AND op.agreed_user_limit <> -1
    AND (
      (op.status = 'active' AND (op.expires_at IS NULL OR op.expires_at > now()))
      OR (op.status = 'pending' AND (op.trial_ends_at IS NULL OR op.trial_ends_at > now()))
    );

  IF NOT COALESCE(v_has_live_entitlement, FALSE) THEN
    RAISE EXCEPTION 'This business has no active subscription. Choose a plan before adding users.';
  END IF;

  IF v_limit IS NOT NULL THEN
    SELECT COUNT(DISTINCT sm.user_id) INTO v_used
    FROM public.store_members sm
    JOIN public.stores s ON s.id = sm.store_id
    WHERE s.org_id = v_org_id
      AND sm.status = 'active'
      AND sm.user_id IS NOT NULL
      AND sm.user_id <> NEW.user_id;

    IF v_used + 1 > v_limit THEN
      RAISE EXCEPTION 'Seat limit reached for this plan (%). Upgrade to add more users.', v_limit;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_seat_limit_on_store_members ON public.store_members;
CREATE TRIGGER enforce_seat_limit_on_store_members
  BEFORE INSERT ON public.store_members
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_seat_limit();

COMMENT ON FUNCTION public.enforce_seat_limit() IS
  'Server-side enforcement of the agreed per-plan seat limit and subscription state. Sandbox businesses are exempt.';
