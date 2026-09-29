-- Run against a disposable database after all migrations. Always rolls back.
BEGIN;
DO $$
DECLARE
  v_owner UUID := gen_random_uuid(); v_other UUID := gen_random_uuid(); v_extra UUID := gen_random_uuid();
  v_org UUID; v_store UUID; v_product UUID; v_version UUID; v_ent UUID;
  v_result JSONB; v_first JSONB; v_count INTEGER; v_denied BOOLEAN;
BEGIN
  INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES
    (v_owner, 'trial-verification-' || v_owner || '@example.invalid', '{}'),
    (v_other, 'trial-verification-' || v_other || '@example.invalid', '{}'),
    (v_extra, 'trial-verification-' || v_extra || '@example.invalid', '{}');
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  UPDATE public.platform_settings SET value = '"DISABLED"' WHERE key = 'billing.payment_system';
  UPDATE public.platform_settings SET value = 'true' WHERE key = 'billing.trial_enabled';
  UPDATE public.platform_settings SET value = '14' WHERE key = 'billing.default_trial_days';

  v_result := public.create_onboarding_business('Trial verification', 'Main branch', 'restaurant');
  v_org := (v_result->>'org_id')::uuid; v_store := (v_result->>'store_id')::uuid;
  SELECT id INTO v_product FROM public.platform_products WHERE key = 'trackoja';
  SELECT v.id INTO v_version FROM public.product_plan_versions v
    WHERE v.product_id = v_product AND v.status = 'active' AND v.effective_until IS NULL
    AND v.billing_cycle = 'monthly' ORDER BY v.amount_minor LIMIT 1;
  IF v_version IS NULL THEN RAISE EXCEPTION 'Verification requires a published monthly plan'; END IF;

  IF (public.resolve_my_trackoja_entry()->>'has_access')::boolean THEN RAISE EXCEPTION 'Access was granted before explicit activation'; END IF;
  v_first := public.start_product_trial(v_version);
  IF v_first->>'trial_days' <> '14' THEN RAISE EXCEPTION 'Central trial duration was ignored'; END IF;
  SELECT id INTO v_ent FROM public.organization_products WHERE org_id = v_org AND product_id = v_product
    AND status = 'trialing' AND source = 'trial' AND trial_started_at IS NOT NULL;
  IF v_ent IS NULL THEN RAISE EXCEPTION 'Trial entitlement was not recorded'; END IF;
  IF public.resolve_my_trackoja_entry()->>'merchant_destination' <> '/dashboard' THEN RAISE EXCEPTION 'Trial does not reach dashboard'; END IF;
  IF NOT public.product_entitlement_has_access(v_org, v_product) THEN RAISE EXCEPTION 'Trial has no access'; END IF;
  IF (public.get_my_commercial_access('trackoja_works')->>'has_access')::boolean THEN RAISE EXCEPTION 'Trial unlocked another product'; END IF;
  IF (SELECT org_id FROM public.get_my_entitlement()) <> v_org THEN RAISE EXCEPTION 'Wrong workspace entitlement'; END IF;
  v_result := public.start_product_trial(v_version);
  IF v_result->>'trial_ends_at' <> v_first->>'trial_ends_at' OR v_result->>'resumed' <> 'true' THEN RAISE EXCEPTION 'Repeated trial activation resets expiry'; END IF;
  SELECT count(*) INTO v_count FROM public.subscription_transactions WHERE org_id = v_org;
  IF v_count <> 0 THEN RAISE EXCEPTION 'A trial created payment records'; END IF;

  -- Starter has two seats: owner plus one team member; a third must fail.
  INSERT INTO public.store_members(store_id, user_id, role_id, status)
    SELECT v_store, v_other, role_id, 'active' FROM public.store_members WHERE store_id = v_store AND user_id = v_owner;
  v_denied := false;
  BEGIN
    INSERT INTO public.store_members(store_id, user_id, role_id, status)
      SELECT v_store, v_extra, role_id, 'active' FROM public.store_members WHERE store_id = v_store AND user_id = v_owner;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'Seat limit reached%' THEN RAISE; END IF;
    v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'Trial exceeded its seat limit'; END IF;

  v_denied := false;
  BEGIN PERFORM public.start_plan_version_checkout(v_version);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'Online subscription payments are not available%' THEN RAISE; END IF;
    v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'Disabled checkout was allowed'; END IF;

  UPDATE public.organization_products SET trial_ends_at = now() - interval '1 day', expires_at = now() - interval '1 day' WHERE id = v_ent;
  IF NOT public.product_entitlement_has_access(v_org, v_product) THEN RAISE EXCEPTION 'Disabled payments blocked an expired trial'; END IF;
  UPDATE public.platform_settings SET value = '"LIVE"' WHERE key = 'billing.payment_system';
  IF public.product_entitlement_has_access(v_org, v_product) THEN RAISE EXCEPTION 'Expired LIVE trial still has access'; END IF;
  IF public.user_has_permission(v_owner, v_store, 'product:create') THEN RAISE EXCEPTION 'Expired LIVE trial retains write permission'; END IF;
  IF EXISTS (SELECT 1 FROM public.get_user_active_store_ids(v_owner) id WHERE id = v_store) THEN RAISE EXCEPTION 'Expired LIVE trial retains store-scoped reads'; END IF;
  IF (public.resolve_my_trackoja_entry()->>'has_access')::boolean THEN RAISE EXCEPTION 'Legacy records bypassed explicit trial expiry'; END IF;

  -- Another authenticated principal cannot start or extend this business trial.
  PERFORM set_config('request.jwt.claim.sub', v_other::text, true);
  UPDATE public.users SET current_org_id = v_org WHERE id = v_other;
  v_denied := false;
  BEGIN PERFORM public.start_product_trial(v_version);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'Only the business owner%' THEN RAISE; END IF;
    v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'Another tenant could activate this trial'; END IF;
  v_denied := false;
  BEGIN PERFORM public.extend_product_trial(v_ent, 7, 'Unauthorised extension test');
  EXCEPTION WHEN OTHERS THEN v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'An ordinary user could extend trials'; END IF;

  -- Authorised extension is audited, and admin reads identify the entitlement.
  INSERT INTO public.platform_admins(user_id, level, status) VALUES (v_extra, 'super_admin', 'active');
  PERFORM set_config('request.jwt.claim.sub', v_extra::text, true);
  PERFORM public.extend_product_trial(v_ent, 7, 'Extend the verification trial');
  IF NOT public.product_entitlement_has_access(v_org, v_product) THEN RAISE EXCEPTION 'Extension did not restore access'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE action = 'PRODUCT_TRIAL_EXTENDED' AND resource_id = v_ent) THEN RAISE EXCEPTION 'Trial extension was not audited'; END IF;
  IF public.get_platform_business(v_org)->'products'->0->>'id' <> v_ent::text THEN RAISE EXCEPTION 'Admin cannot identify trial for extension'; END IF;
  IF (SELECT trialing_subscriptions FROM public.get_platform_overview_v2('trackoja')) < 1 THEN RAISE EXCEPTION 'Admin overview omitted explicit trials'; END IF;
  PERFORM public.list_platform_users(); PERFORM public.list_product_plans(); PERFORM public.list_platform_products();

  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  UPDATE public.organization_products SET status = 'active' , source = 'payment', expires_at = now() + interval '1 month' WHERE id = v_ent;
  v_denied := false;
  BEGIN PERFORM public.start_product_trial(v_version);
  EXCEPTION WHEN OTHERS THEN v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'A paid subscription was replaced by a trial'; END IF;
  IF NOT public.product_entitlement_has_access(v_org, v_product) THEN RAISE EXCEPTION 'Paid access changed'; END IF;
  RAISE NOTICE 'Trial activation, idempotency, product isolation, checkout gate, expiry, tenant/role restrictions and paid preservation passed';
END;
$$;
ROLLBACK;
