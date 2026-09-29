-- Route, entitlement and seat decisions share the same trial policy.
BEGIN;

CREATE OR REPLACE FUNCTION public.resolve_my_trackoja_entry()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user UUID := auth.uid();
  v_profile public.users%ROWTYPE;
  v_is_platform_admin BOOLEAN := false;
  v_product UUID;
  v_org UUID;
  v_store UUID;
  v_org_count INTEGER := 0;
  v_role TEXT;
  v_progress public.onboarding_progress%ROWTYPE;
  v_entitlement public.organization_products%ROWTYPE;
  v_has_access BOOLEAN := false;
  v_merchant_kind TEXT;
  v_merchant_destination TEXT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT * INTO v_profile FROM public.users WHERE id = v_user;
  IF v_profile.id IS NULL THEN RAISE EXCEPTION 'User profile is not ready'; END IF;
  v_is_platform_admin := COALESCE(v_profile.is_platform_admin, false);

  SELECT id INTO v_product FROM public.platform_products WHERE key = 'trackoja';
  IF v_product IS NULL THEN RAISE EXCEPTION 'TrackOja product is not configured'; END IF;

  SELECT count(DISTINCT o.id) INTO v_org_count
  FROM public.organizations o
  LEFT JOIN public.organization_members om ON om.org_id = o.id AND om.user_id = v_user
  WHERE o.owner_id = v_user OR om.user_id = v_user;

  SELECT o.id INTO v_org
  FROM public.organizations o
  LEFT JOIN public.organization_members om ON om.org_id = o.id AND om.user_id = v_user
  WHERE o.id = v_profile.current_org_id AND (o.owner_id = v_user OR om.user_id = v_user);

  IF v_org IS NULL AND v_org_count = 1 THEN
    SELECT o.id INTO v_org
    FROM public.organizations o
    LEFT JOIN public.organization_members om ON om.org_id = o.id AND om.user_id = v_user
    WHERE o.owner_id = v_user OR om.user_id = v_user
    ORDER BY o.created_at
    LIMIT 1;
  ELSIF v_org IS NULL AND v_org_count > 1 THEN
    RETURN jsonb_build_object(
      'kind', CASE WHEN v_is_platform_admin THEN 'platform_admin' ELSE 'workspace_selection_required' END,
      'destination', CASE WHEN v_is_platform_admin THEN '/platform' ELSE '/workspace' END,
      'merchant_kind', 'workspace_selection_required',
      'merchant_destination', '/workspace',
      'has_access', false,
      'current_org_id', NULL,
      'current_store_id', NULL,
      'organization_count', v_org_count,
      'is_invited_user', false
    );
  END IF;

  IF v_org IS NULL THEN
    SELECT * INTO v_progress
    FROM public.onboarding_progress
    WHERE user_id = v_user AND product_id = v_product
    ORDER BY created_at DESC
    LIMIT 1;

    v_merchant_kind := CASE WHEN v_progress.id IS NULL THEN 'new_user' ELSE 'onboarding_in_progress' END;
    RETURN jsonb_build_object(
      'kind', CASE WHEN v_is_platform_admin THEN 'platform_admin' ELSE v_merchant_kind END,
      'destination', CASE WHEN v_is_platform_admin THEN '/platform' ELSE '/onboarding' END,
      'merchant_kind', v_merchant_kind,
      'merchant_destination', '/onboarding',
      'has_access', false,
      'current_org_id', NULL,
      'current_store_id', NULL,
      'organization_count', 0,
      'is_invited_user', false,
      'onboarding_state', COALESCE(v_progress.state, 'account_ready')
    );
  END IF;

  SELECT om.role INTO v_role
  FROM public.organization_members om
  WHERE om.org_id = v_org AND om.user_id = v_user;

  IF v_role IS NULL AND EXISTS (
    SELECT 1 FROM public.organizations WHERE id = v_org AND owner_id = v_user
  ) THEN
    v_role := 'owner';
  END IF;

  SELECT sm.store_id INTO v_store
  FROM public.store_members sm
  JOIN public.stores s ON s.id = sm.store_id
  WHERE sm.user_id = v_user AND sm.status = 'active' AND s.org_id = v_org
  ORDER BY sm.accepted_at NULLS LAST, sm.created_at
  LIMIT 1;

  IF v_store IS NULL AND v_role = 'owner' THEN
    SELECT id INTO v_store
    FROM public.stores
    WHERE org_id = v_org AND status = 'active'
    ORDER BY created_at
    LIMIT 1;
  END IF;

  UPDATE public.users
  SET current_org_id = v_org,
      current_store_id = CASE
        WHEN current_store_id IN (
          SELECT s.id
          FROM public.stores s
          WHERE s.org_id = v_org
            AND (
              v_role = 'owner'
              OR EXISTS (
                SELECT 1 FROM public.store_members sm
                WHERE sm.store_id = s.id AND sm.user_id = v_user AND sm.status = 'active'
              )
            )
        ) THEN current_store_id
        ELSE v_store
      END
  WHERE id = v_user;

  SELECT current_store_id INTO v_store FROM public.users WHERE id = v_user;

  SELECT * INTO v_entitlement
  FROM public.organization_products
  WHERE org_id = v_org AND product_id = v_product;

  v_has_access := public.product_entitlement_has_access(v_org, v_product);

  IF NOT v_has_access AND v_entitlement.trial_started_at IS NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.subscriptions s
      WHERE s.org_id = v_org
        AND (
          (s.status = 'active' AND (s.current_period_end IS NULL OR s.current_period_end > now()))
          OR (s.status = 'trialing' AND s.trial_end IS NOT NULL AND s.trial_end > now())
        )
    ) INTO v_has_access;
  END IF;

  IF NOT v_has_access AND v_entitlement.trial_started_at IS NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.organizations o
      WHERE o.id = v_org
        AND (
          o.billing_status = 'active'
          OR (o.billing_status = 'trial' AND o.trial_ends_at IS NOT NULL AND o.trial_ends_at > now())
        )
    ) INTO v_has_access;
  END IF;

  SELECT * INTO v_progress
  FROM public.onboarding_progress
  WHERE user_id = v_user AND product_id = v_product
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_has_access THEN
    v_merchant_kind := CASE WHEN v_role = 'owner' THEN 'existing_user' ELSE 'invited_user' END;
    v_merchant_destination := '/dashboard';
  ELSIF v_progress.id IS NOT NULL
    AND v_progress.org_id = v_org
    AND v_progress.state <> 'onboarding_completed'
    AND v_role = 'owner' THEN
    v_merchant_kind := 'onboarding_in_progress';
    v_merchant_destination := '/onboarding';
  ELSE
    v_merchant_kind := CASE WHEN v_role = 'owner' THEN 'billing_action_required' ELSE 'access_restricted' END;
    v_merchant_destination := '/billing';
  END IF;

  RETURN jsonb_build_object(
    'kind', CASE WHEN v_is_platform_admin THEN 'platform_admin' ELSE v_merchant_kind END,
    'destination', CASE WHEN v_is_platform_admin THEN '/platform' ELSE v_merchant_destination END,
    'merchant_kind', v_merchant_kind,
    'merchant_destination', v_merchant_destination,
    'has_access', v_has_access,
    'current_org_id', v_org,
    'current_store_id', v_store,
    'organization_count', v_org_count,
    'role', v_role,
    'is_invited_user', v_role <> 'owner',
    'onboarding_state', v_progress.state,
    'entitlement_status', v_entitlement.status
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_commercial_access(p_product_key TEXT DEFAULT 'trackoja')
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org UUID; v_product UUID; v_ent public.organization_products%ROWTYPE; v_state TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT current_org_id INTO v_org FROM public.users WHERE id = auth.uid();
  SELECT id INTO v_product FROM public.platform_products WHERE key = p_product_key;
  SELECT state INTO v_state FROM public.onboarding_progress WHERE user_id = auth.uid() AND product_id = v_product;
  SELECT * INTO v_ent FROM public.organization_products WHERE org_id = v_org AND product_id = v_product;
  RETURN jsonb_build_object(
    'org_id', v_org, 'onboarding_state', COALESCE(v_state, 'account_ready'),
    'entitlement_status', v_ent.status,
    'has_access', public.product_entitlement_has_access(v_org, v_product),
    'is_test_data', COALESCE((v_ent.metadata->>'is_test_data')::BOOLEAN, false)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_entitlement(p_product_key TEXT DEFAULT 'trackoja')
RETURNS TABLE (
  org_id UUID,
  org_name TEXT,
  product_key TEXT,
  product_name TEXT,
  plan_id UUID,
  plan_key TEXT,
  plan_name TEXT,
  status TEXT,
  source TEXT,
  agreed_monthly_price NUMERIC,
  agreed_annual_price NUMERIC,
  agreed_user_limit INTEGER,
  agreed_store_limit INTEGER,
  billing_cycle TEXT,
  currency TEXT,
  trial_ends_at TIMESTAMPTZ,
  activated_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  seats_used BIGINT,
  stores_used BIGINT,
  days_remaining INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_org_id UUID;
  v_org_name TEXT;
  v_product public.platform_products;
  v_ent public.organization_products;
  v_plan public.product_plans;
  v_seats BIGINT;
  v_stores BIGINT;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_product_key IS NULL OR btrim(p_product_key) = '' THEN
    RAISE EXCEPTION 'Unknown product: %', COALESCE(p_product_key, '(none)');
  END IF;

  SELECT pr.* INTO v_product
  FROM public.platform_products pr
  WHERE pr.key = btrim(p_product_key);

  IF v_product.id IS NULL THEN
    RAISE EXCEPTION 'Unknown product: %', p_product_key;
  END IF;

  -- Use the selected workspace, not whichever owned business was created first.
  SELECT o.id, o.name INTO v_org_id, v_org_name
  FROM public.users u JOIN public.organizations o ON o.id = u.current_org_id
  WHERE u.id = v_actor AND (o.owner_id = v_actor OR EXISTS (
    SELECT 1 FROM public.organization_members om WHERE om.org_id = o.id AND om.user_id = v_actor));

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No business is linked to your account';
  END IF;

  SELECT op.* INTO v_ent
  FROM public.organization_products op
  WHERE op.org_id = v_org_id
    AND op.product_id = v_product.id;

  -- No entitlement for this product: an empty set, deliberately. See the note
  -- above - the caller must be able to tell this apart from a plan with no dates.
  IF v_ent.id IS NULL THEN
    RETURN;
  END IF;

  SELECT pp.* INTO v_plan
  FROM public.product_plans pp
  WHERE pp.id = v_ent.plan_id;

  -- enforce_seat_limit's own count, minus the <> NEW.user_id term that excludes
  -- the not-yet-existing row the trigger is about to insert.
  SELECT COUNT(DISTINCT sm.user_id) INTO v_seats
  FROM public.store_members sm
  JOIN public.stores s ON s.id = sm.store_id
  WHERE s.org_id = v_org_id
    AND sm.status = 'active'
    AND sm.user_id IS NOT NULL;

  SELECT COUNT(*) INTO v_stores
  FROM public.stores s
  WHERE s.org_id = v_org_id;

  RETURN QUERY
  SELECT
    v_org_id,
    v_org_name,
    v_product.key,
    v_product.name,
    v_ent.plan_id,
    v_plan.key,
    v_plan.name,
    v_ent.status,
    v_ent.source,
    v_ent.agreed_monthly_price,
    v_ent.agreed_annual_price,
    v_ent.agreed_user_limit,
    -- The store cap the plan sells, not a column on the entitlement: 063 gave
    -- organization_products no agreed_store_limit, and adding one is a schema
    -- change outside this migration's brief.
    v_plan.store_limit,
    COALESCE(v_ent.metadata->>'billing_cycle', v_plan.billing_cycle, 'monthly'),
    v_ent.currency,
    v_ent.trial_ends_at,
    v_ent.activated_at,
    v_ent.expires_at,
    v_ent.cancelled_at,
    COALESCE(v_seats, 0),
    COALESCE(v_stores, 0),
    -- Whole days: floor, so a date 0.5 days away is 0 (due today) and 0.5 days
    -- past is -1. NULL only when the entitlement has neither date at all.
    CASE
      WHEN COALESCE(v_ent.expires_at, v_ent.trial_ends_at) IS NULL THEN NULL
      ELSE floor(EXTRACT(EPOCH FROM (COALESCE(v_ent.expires_at, v_ent.trial_ends_at) - now())) / 86400)::INTEGER
    END;
END;
$$;

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

  PERFORM 1 FROM public.organizations WHERE id = v_org_id FOR UPDATE;

  IF EXISTS (SELECT 1 FROM public.organizations WHERE id = v_org_id AND owner_id = NEW.user_id)
    AND NOT EXISTS (SELECT 1 FROM public.store_members sm JOIN public.stores s ON s.id = sm.store_id
      WHERE s.org_id = v_org_id AND sm.user_id = NEW.user_id AND sm.status = 'active') THEN
    RETURN NEW;
  END IF;

  SELECT
    EXISTS (
      SELECT 1 FROM public.organization_products op
      WHERE op.org_id = v_org_id AND op.product_id = (SELECT id FROM public.platform_products WHERE key = 'trackoja')
        AND (
          (op.status = 'active' AND (op.expires_at IS NULL OR op.expires_at > now()))
          OR (op.status = 'trialing' AND public.product_entitlement_has_access(op.org_id, op.product_id))
          OR (op.status = 'pending' AND op.trial_ends_at > now())
        )
    ),
    MAX(NULLIF(op.agreed_user_limit, -1))
  INTO v_has_live_entitlement, v_limit
  FROM public.organization_products op
  WHERE op.org_id = v_org_id AND op.product_id = (SELECT id FROM public.platform_products WHERE key = 'trackoja')
    AND (
      (op.status = 'active' AND (op.expires_at IS NULL OR op.expires_at > now()))
      OR (op.status = 'trialing' AND public.product_entitlement_has_access(op.org_id, op.product_id))
          OR (op.status = 'pending' AND op.trial_ends_at > now())
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

-- A trial end is enforced at request time; no background sweep is required.
-- The existing role and tenant checks remain mandatory.
CREATE OR REPLACE FUNCTION public.user_has_permission(p_user_id UUID, p_store_id UUID, p_permission_name TEXT)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.store_members sm
    JOIN public.role_permissions rp ON rp.role_id = sm.role_id
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE sm.user_id = p_user_id AND sm.store_id = p_store_id
      AND sm.status = 'active' AND p.name = p_permission_name
  ) AND NOT EXISTS (
    SELECT 1 FROM public.organization_products op
    JOIN public.platform_products pp ON pp.id = op.product_id AND pp.key = 'trackoja'
    JOIN public.stores s ON s.org_id = op.org_id
    WHERE s.id = p_store_id AND op.source = 'trial' AND op.trial_started_at IS NOT NULL
      AND NOT public.product_entitlement_has_access(op.org_id, op.product_id)
  );
$$;
-- Store-scoped RLS reads also honour explicit trial expiry. Billing and workspace
-- selection still use organization membership so owners can renew or seek help.
CREATE OR REPLACE FUNCTION public.get_user_active_store_ids(p_user_id UUID)
RETURNS SETOF UUID LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT sm.store_id FROM public.store_members sm JOIN public.stores s ON s.id = sm.store_id
  WHERE sm.user_id = p_user_id AND sm.status = 'active' AND NOT EXISTS (
    SELECT 1 FROM public.organization_products op JOIN public.platform_products pp ON pp.id = op.product_id
    WHERE op.org_id = s.org_id AND pp.key = 'trackoja' AND op.trial_started_at IS NOT NULL
      AND op.source = 'trial' AND NOT public.product_entitlement_has_access(op.org_id, op.product_id)
  );
$$;
COMMIT;
