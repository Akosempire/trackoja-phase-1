-- Verification pass, second attempt: results are returned as rows so they can be
-- read back from the Management API (which discards RAISE NOTICE output).

DROP TABLE IF EXISTS zz_results;
CREATE TEMP TABLE zz_results (
  step int,
  check_name text,
  passed boolean,
  detail text
);

DO $$
DECLARE
  v_org uuid;
  v_store uuid;
  v_role uuid;
  v_owner uuid;
  v_entitlements int;
  v_works int;
  v_plan text;
  v_limit int;
  v_status text;
  v_seated int;
  v_inserted int := 0;
  v_blocked_at int := 0;
  v_msg text;
  v_user uuid;
  v_counter int := 0;
  v_sandbox_msg text;
BEGIN
  SELECT id INTO v_owner FROM public.users ORDER BY created_at LIMIT 1;
  IF v_owner IS NULL THEN
    INSERT INTO zz_results VALUES (0, 'precondition: a user exists', false, 'no users');
    RETURN;
  END IF;

  -- ============================================================
  -- 1. CROSS-PRODUCT ISOLATION
  -- ============================================================
  INSERT INTO public.organizations (name, slug, owner_id, timezone, trial_ends_at)
  VALUES ('ZZ Verify Isolation', 'zz-verify-isolation', v_owner, 'UTC', now() + interval '14 days')
  RETURNING id INTO v_org;

  SELECT count(*) INTO v_entitlements FROM public.organization_products WHERE org_id = v_org;

  SELECT count(*) INTO v_works
  FROM public.organization_products op
  JOIN public.platform_products p ON p.id = op.product_id
  WHERE op.org_id = v_org AND p.key = 'trackoja_works';

  SELECT pp.key, op.agreed_user_limit, op.status
  INTO v_plan, v_limit, v_status
  FROM public.organization_products op
  LEFT JOIN public.product_plans pp ON pp.id = op.plan_id
  WHERE op.org_id = v_org;

  INSERT INTO zz_results VALUES (1, 'signup creates exactly one entitlement',
    v_entitlements = 1, format('entitlements=%s', v_entitlements));
  INSERT INTO zz_results VALUES (2, 'signup grants NO TrackOja Works entitlement',
    v_works = 0, format('trackoja_works rows=%s', v_works));
  INSERT INTO zz_results VALUES (3, 'default tier is starter',
    v_plan = 'starter', format('plan=%s status=%s', coalesce(v_plan,'none'), coalesce(v_status,'none')));
  INSERT INTO zz_results VALUES (4, 'starter seat limit is 2 (owner/admin + 1 user)',
    v_limit = 2, format('agreed_user_limit=%s', v_limit));

  -- ============================================================
  -- 2. SEAT LIMIT ENFORCEMENT
  -- ============================================================
  INSERT INTO public.stores (org_id, name, slug, created_by, currency, timezone)
  VALUES (v_org, 'ZZ Verify Store', 'zz-verify-store', v_owner, 'NGN', 'UTC')
  RETURNING id INTO v_store;

  SELECT id INTO v_role FROM public.roles WHERE name = 'cashier' AND is_system LIMIT 1;

  FOR v_user IN SELECT id FROM public.users WHERE id <> v_owner ORDER BY created_at LOOP
    v_counter := v_counter + 1;
    BEGIN
      INSERT INTO public.store_members (store_id, user_id, role_id, status)
      VALUES (v_store, v_user, v_role, 'active');
      v_inserted := v_inserted + 1;
    EXCEPTION WHEN OTHERS THEN
      v_blocked_at := v_counter;
      v_msg := SQLERRM;
      EXIT;
    END;
  END LOOP;

  SELECT count(DISTINCT user_id) INTO v_seated
  FROM public.store_members WHERE store_id = v_store AND status = 'active';

  INSERT INTO zz_results VALUES (5, 'database refuses seats beyond the plan limit',
    v_seated <= 2 AND v_blocked_at > 0,
    format('seated=%s, refused on attempt #%s', v_seated, v_blocked_at));
  INSERT INTO zz_results VALUES (6, 'refusal names the seat limit',
    coalesce(v_msg,'') LIKE '%Seat limit reached%',
    coalesce(v_msg, 'no exception raised'));

  -- ============================================================
  -- 3. SANDBOX-ONLY OVERRIDE
  -- ============================================================
  BEGIN
    PERFORM public.assert_sandbox_override(v_org);
    v_sandbox_msg := 'ACCEPTED (bad: override allowed on a real business)';
  EXCEPTION WHEN OTHERS THEN
    v_sandbox_msg := SQLERRM;
  END;

  INSERT INTO zz_results VALUES (7, 'developer override refused on a real business',
    v_sandbox_msg LIKE '%sandbox%' OR v_sandbox_msg LIKE '%Developer mode%',
    v_sandbox_msg);

  -- ============================================================
  -- 4. PRICING EDIT DOES NOT MOVE AN AGREED PRICE
  -- ============================================================
  DECLARE
    v_before numeric;
    v_after numeric;
  BEGIN
    SELECT agreed_monthly_price INTO v_before
    FROM public.organization_products WHERE org_id = v_org;

    UPDATE public.product_plans SET monthly_price = 99999
    WHERE key = 'starter'
      AND product_id = (SELECT id FROM public.platform_products WHERE key = 'trackoja');

    SELECT agreed_monthly_price INTO v_after
    FROM public.organization_products WHERE org_id = v_org;

    -- put the real price back
    UPDATE public.product_plans SET monthly_price = 5000
    WHERE key = 'starter'
      AND product_id = (SELECT id FROM public.platform_products WHERE key = 'trackoja');

    INSERT INTO zz_results VALUES (8, 'editing a plan price leaves the agreed price untouched',
      v_before = v_after, format('agreed price before=%s after=%s', v_before, v_after));
  END;

  -- ============================================================
  -- CLEAN UP
  -- ============================================================
  DELETE FROM public.organizations WHERE id = v_org;
END $$;

SELECT step, check_name, passed, detail FROM zz_results ORDER BY step;
