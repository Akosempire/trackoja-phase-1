-- Include explicit trials in admin reporting and expose IDs for audited extensions.
BEGIN;

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
    (SELECT COUNT(*) FROM entitlements op WHERE (op.status = 'trialing' AND public.product_entitlement_has_access(op.org_id, op.product_id)) OR (op.status = 'pending' AND op.source = 'trial' AND op.trial_ends_at > now())),
    (SELECT COUNT(*) FROM entitlements op WHERE op.status = 'past_due'),
    (SELECT COUNT(*) FROM entitlements op
      WHERE op.status IN ('active', 'pending', 'trialing')
        AND op.expires_at IS NOT NULL
        AND op.expires_at BETWEEN now() AND now() + INTERVAL '30 days'),
    (SELECT COUNT(*) FROM public.subscription_transactions st
      WHERE st.is_sandbox = FALSE AND st.is_test_data = FALSE AND COALESCE(st.payment_mode, 'live') <> 'test'
        AND st.status = 'failed'
        AND st.created_at >= now() - INTERVAL '30 days'
        AND (v_product_id IS NULL OR st.product_id = v_product_id)),
    (SELECT COALESCE(SUM(st.amount), 0) FROM public.subscription_transactions st
      WHERE st.is_sandbox = FALSE AND st.is_test_data = FALSE AND COALESCE(st.payment_mode, 'live') <> 'test'
        AND st.status = 'success'
        AND st.created_at >= now() - INTERVAL '30 days'
        AND (v_product_id IS NULL OR st.product_id = v_product_id)),
    (SELECT COUNT(*) FROM public.organizations o WHERE o.is_sandbox = TRUE);
END;
$$;

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
      WHERE op.product_id = p.id AND op.status IN ('active', 'pending', 'trialing')),
    p.sort_order, p.updated_at
  FROM public.platform_products p
  ORDER BY p.sort_order, p.name;
END;
$$;

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
        AND public.product_entitlement_has_access(op.org_id, op.product_id)
        AND (v_product_id IS NULL OR op.product_id = v_product_id)
    ), '[]'::jsonb),
    (SELECT MAX(op.agreed_user_limit) FROM public.organization_products op
      WHERE op.org_id = o.id AND public.product_entitlement_has_access(op.org_id, op.product_id)),
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
  updated_at TIMESTAMPTZ,
  billing_cycle TEXT,
  setup_fee NUMERIC,
  trial_days INTEGER,
  store_limit INTEGER,
  published_at TIMESTAMPTZ,
  effective_from TIMESTAMPTZ
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
      WHERE op.plan_id = pp.id AND op.status IN ('active', 'pending', 'trialing')),
    pp.updated_at,
    pp.billing_cycle,
    pp.setup_fee,
    pp.trial_days,
    pp.store_limit,
    pp.published_at,
    pp.effective_from
  FROM public.product_plans pp
  JOIN public.platform_products pr ON pr.id = pp.product_id
  WHERE p_product_key IS NULL OR pr.key = p_product_key
  ORDER BY pr.sort_order, pp.sort_order, pp.name;
END;
$$;

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
        'billing_email', o.billing_email,
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
        'id', op.id, 'trial_started_at', op.trial_started_at, 'product_key', pr.key, 'product_name', pr.name,
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

COMMIT;
