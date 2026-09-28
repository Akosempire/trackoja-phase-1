-- A platform administrator may also own or belong to a customer business.
-- Keep the default platform destination and the commercially enforced merchant
-- destination separate so switching between the two areas cannot redirect-loop.

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

  v_has_access := COALESCE(
    v_entitlement.status = 'active'
      AND (v_entitlement.expires_at IS NULL OR v_entitlement.expires_at > now()),
    false
  );

  IF NOT v_has_access THEN
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

  IF NOT v_has_access THEN
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

REVOKE ALL ON FUNCTION public.resolve_my_trackoja_entry() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_my_trackoja_entry() TO authenticated, service_role;
