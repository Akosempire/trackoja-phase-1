-- Verification for 20260927000089_platform_owner_hardening.sql.
--
-- Results are returned as rows so they can be read back from the Management API
-- (which discards RAISE NOTICE output), in the style of the other files here.
-- Every check that needs to write rows does so inside an inner block that is then
-- aborted on purpose, so the assertions are made against real database behaviour
-- while the fixtures themselves are rolled back. A final set of "leftover" checks
-- proves nothing this script created survived.

DROP TABLE IF EXISTS zz_results;
CREATE TEMP TABLE zz_results (
  step int,
  check_name text,
  passed boolean,
  detail text
);

DO $$
DECLARE
  -- fixtures
  v_admin UUID;
  v_plain UUID;
  v_any_org UUID;

  -- guard table list, in the same order as the migration
  v_guard_tables TEXT[] := ARRAY[
    'sales', 'sale_items', 'sale_payments', 'products', 'product_variants',
    'product_categories', 'customers', 'inventory_movements', 'stock_lots',
    'stores', 'store_members', 'organization_members', 'organizations',
    'expenses', 'suppliers', 'purchases', 'tailoring_jobs', 'material_quotes',
    'refunds', 'devices'
  ];

  -- results carried out of the rolled-back blocks
  v_roster_only BOOLEAN;
  v_roster_legacy BOOLEAN;
  v_suspended_result BOOLEAN;
  v_roster_inserted BOOLEAN := FALSE;
  v_level_error TEXT;

  v_auth_priv BOOLEAN;
  v_anon_priv BOOLEAN;
  v_log_priv BOOLEAN;
  v_public_grants INT;
  v_forge_error TEXT;

  v_trigger_count INT;
  v_trigger_missing TEXT;
  v_block_error TEXT;
  v_admin_exempt_error TEXT;

  v_perm_count INT;
  v_perm_categories INT;
  v_bogus_category_error TEXT;

  v_setting_key TEXT;
  v_setting_value JSONB;
  v_support_note_id UUID;
  v_support_audit INT;
  v_setting_audit INT;
  v_setting_previous TEXT;
  v_setting_new TEXT;
  v_privileged_call_error TEXT;

  v_audit_rows INT;
  v_audit_total BIGINT;
  v_audit_org UUID;
  v_redact_password TEXT;
  v_redact_note TEXT;
  v_redact_nested TEXT;
  v_redact_list TEXT;
  v_redact_changes TEXT;
  v_redact_kept TEXT;
  v_fallback_error TEXT;
  v_denied_error TEXT;

  v_org UUID;
  v_legacy_plan UUID;
  v_product_plan_id UUID;
  v_expected_plan UUID;
  v_activate_reference TEXT;
  v_activate_error TEXT;
  v_ent_status TEXT;
  v_ent_source TEXT;
  v_ent_plan UUID;
  v_ent_monthly NUMERIC;
  v_ent_annual NUMERIC;
  v_ent_limit INT;
  v_ent_currency TEXT;
  v_ent_activated TIMESTAMPTZ;
  v_ent_expires TIMESTAMPTZ;
  v_ent_count INT;
  v_period_end TIMESTAMPTZ;

  v_billing_column INT;
  v_billing_check INT;
  v_plans_billing TEXT;
  v_plans_rows INT;
  v_new_signature INT;
  v_old_signature INT;
  v_cycle_error TEXT;
  v_cycle_saved TEXT;
  v_cycle_revision TEXT;

  v_rev NUMERIC;
  v_rev_count BIGINT;
  v_rev_plan NUMERIC;
  v_window_from TIMESTAMPTZ;
  v_window_to TIMESTAMPTZ;

  v_leftover_audit INT;
  v_leftover_notes INT;
  v_leftover_sessions INT;
  v_leftover_admins INT;

  -- legacy organization without a subscriptions row
  v_legacy_org UUID;
  v_legacy_reference TEXT;
  v_legacy_sub_count INT;
  v_legacy_status TEXT;
  v_legacy_expires TIMESTAMPTZ;
BEGIN
  -- ============================================================
  -- 0. FIXTURES
  -- ============================================================
  SELECT pa.user_id INTO v_admin
  FROM public.platform_admins pa
  WHERE pa.level = 'super_admin' AND pa.status = 'active'
  ORDER BY pa.granted_at
  LIMIT 1;

  IF v_admin IS NULL THEN
    SELECT u.id INTO v_admin FROM public.users u WHERE u.is_platform_admin = TRUE ORDER BY u.created_at LIMIT 1;
  END IF;

  SELECT u.id INTO v_plain
  FROM public.users u
  LEFT JOIN public.platform_admins pa ON pa.user_id = u.id
  WHERE COALESCE(u.is_platform_admin, FALSE) = FALSE
    AND pa.user_id IS NULL
  ORDER BY u.created_at
  LIMIT 1;

  SELECT o.id INTO v_any_org FROM public.organizations o ORDER BY o.created_at LIMIT 1;

  INSERT INTO zz_results VALUES (0, 'precondition: a platform super admin exists',
    v_admin IS NOT NULL, format('admin=%s', COALESCE(v_admin::text, 'none')));
  INSERT INTO zz_results VALUES (1, 'precondition: a user with no platform identity exists',
    v_plain IS NOT NULL, format('user=%s', COALESCE(v_plain::text, 'none')));

  IF v_admin IS NULL OR v_plain IS NULL OR v_any_org IS NULL THEN
    RETURN;
  END IF;

  -- ============================================================
  -- 1. is_platform_admin HONOURS platform_admins (defect 1)
  -- ============================================================
  -- The fixture row is inserted inside a block that is then aborted, so the
  -- "appointed through platform_admins only" case is exercised without leaving a
  -- platform admin behind.
  BEGIN
    INSERT INTO public.platform_admins (user_id, level, status, note)
    VALUES (v_plain, 'finance_operator', 'active', 'zz verify 089 roster-only');

    v_roster_inserted := TRUE;
    v_roster_only := public.is_platform_admin(v_plain);

    SELECT COALESCE(u.is_platform_admin, FALSE) INTO v_roster_legacy
    FROM public.users u WHERE u.id = v_plain;

    RAISE EXCEPTION 'zz_verify_rollback';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'zz_verify_rollback' THEN
      v_roster_only := NULL;
      v_level_error := SQLERRM;
    END IF;
  END;

  INSERT INTO zz_results VALUES (2, 'is_platform_admin() returns TRUE for a user who is only in platform_admins',
    v_roster_only IS TRUE AND v_roster_legacy IS FALSE,
    format('legacy users.is_platform_admin=%s, is_platform_admin()=%s', v_roster_legacy, v_roster_only));
  INSERT INTO zz_results VALUES (3, 'platform_admins.level accepts the new finance_operator value',
    v_roster_inserted, COALESCE(v_level_error, 'the finance_operator row was accepted'));

  -- A suspended admin must not gain read access: status is what the helper reads.
  BEGIN
    INSERT INTO public.platform_admins (user_id, level, status, note)
    VALUES (v_plain, 'finance_operator', 'suspended', 'zz verify 089 suspended');

    v_suspended_result := public.is_platform_admin(v_plain);

    RAISE EXCEPTION 'zz_verify_rollback';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'zz_verify_rollback' THEN
      v_suspended_result := NULL;
    END IF;
  END;

  INSERT INTO zz_results VALUES (4, 'is_platform_admin() stays FALSE for a suspended platform_admins row',
    v_suspended_result IS FALSE, format('is_platform_admin()=%s', v_suspended_result));

  -- A bogus level is still rejected: the CHECK was widened, not loosened.
  BEGIN
    INSERT INTO public.platform_admins (user_id, level, status, note)
    VALUES (v_plain, 'zz_bogus_level', 'active', 'zz verify 089 bogus');
    v_level_error := 'ACCEPTED (defect: the CHECK no longer restricts levels)';
  EXCEPTION WHEN OTHERS THEN
    v_level_error := SQLERRM;
  END;

  INSERT INTO zz_results VALUES (5, 'platform_admins.level still rejects an unknown level',
    v_level_error LIKE '%platform_admins_level_check%', v_level_error);

  -- ============================================================
  -- 2. AUDIT HELPERS ARE NOT PUBLIC ANY MORE (defect 3)
  -- ============================================================
  v_auth_priv := has_function_privilege('authenticated',
    'public.create_audit_log(uuid,uuid,uuid,text,text,uuid,text,jsonb,jsonb)', 'EXECUTE');
  v_anon_priv := has_function_privilege('anon',
    'public.create_audit_log(uuid,uuid,uuid,text,text,uuid,text,jsonb,jsonb)', 'EXECUTE');
  v_log_priv := has_function_privilege('authenticated',
    'public.log_activity(uuid,uuid,uuid,text,text,jsonb)', 'EXECUTE');

  SELECT count(*) INTO v_public_grants
  FROM pg_proc p,
       aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
  WHERE p.oid IN ('public.create_audit_log(uuid,uuid,uuid,text,text,uuid,text,jsonb,jsonb)'::regprocedure,
                  'public.log_activity(uuid,uuid,uuid,text,text,jsonb)'::regprocedure)
    AND a.grantee = 0
    AND a.privilege_type = 'EXECUTE';

  INSERT INTO zz_results VALUES (6, 'create_audit_log is not executable by authenticated',
    v_auth_priv IS FALSE, format('has_function_privilege(authenticated)=%s', v_auth_priv));
  INSERT INTO zz_results VALUES (7, 'create_audit_log is not executable by anon',
    v_anon_priv IS FALSE, format('has_function_privilege(anon)=%s', v_anon_priv));
  INSERT INTO zz_results VALUES (8, 'log_activity is not executable by authenticated',
    v_log_priv IS FALSE, format('has_function_privilege(authenticated)=%s', v_log_priv));
  INSERT INTO zz_results VALUES (9, 'neither helper carries a PUBLIC EXECUTE grant',
    v_public_grants = 0, format('PUBLIC EXECUTE grants found=%s', v_public_grants));

  -- The same call, made as the authenticated role, must be refused by the executor.
  BEGIN
    SET LOCAL ROLE authenticated;
    BEGIN
      PERFORM public.create_audit_log(v_admin, NULL, NULL, 'ZZ_FORGERY_ATTEMPT', 'audit_log',
                                      NULL, NULL, NULL, NULL);
      v_forge_error := 'ACCEPTED (defect: an authenticated caller can forge an audit row)';
    EXCEPTION WHEN OTHERS THEN
      v_forge_error := SQLERRM;
    END;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    v_forge_error := COALESCE(v_forge_error, SQLERRM);
  END;

  INSERT INTO zz_results VALUES (10, 'an authenticated call to create_audit_log is rejected at runtime',
    v_forge_error LIKE '%permission denied%', v_forge_error);

  -- ============================================================
  -- 3. THE INTERNAL CALLERS STILL WORK (defects 3 and 7)
  -- ============================================================
  -- add_support_note and set_platform_setting are SECURITY DEFINER functions that
  -- call create_audit_log internally. They are called here as the authenticated
  -- role, exactly as the dashboard calls them, and the audit rows they write are
  -- asserted after the role is handed back. The whole block is rolled back.
  SELECT s.key, s.value INTO v_setting_key, v_setting_value
  FROM public.platform_settings s
  WHERE s.key = 'billing.currency';

  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, TRUE);

    SET LOCAL ROLE authenticated;

    BEGIN
      SELECT n.id INTO v_support_note_id
      FROM public.add_support_note(v_any_org, 'zz verify 089 support note', 'support_action') n;

      PERFORM public.set_platform_setting(v_setting_key, v_setting_value);
    EXCEPTION WHEN OTHERS THEN
      v_privileged_call_error := SQLERRM;
    END;

    RESET ROLE;

    IF v_privileged_call_error IS NULL THEN
      SELECT count(*) INTO v_support_audit
      FROM public.audit_logs a
      WHERE a.action = 'SUPPORT_NOTE_ADDED'
        AND a.actor_id = v_admin
        AND a.org_id = v_any_org
        AND a.resource_id = v_support_note_id
        AND a.created_at > now() - INTERVAL '1 minute';

      SELECT count(*), max(a.changes->>'previous'), max(a.changes->>'new')
      INTO v_setting_audit, v_setting_previous, v_setting_new
      FROM public.audit_logs a
      WHERE a.action = 'PLATFORM_SETTING_UPDATED'
        AND a.actor_id = v_admin
        AND a.resource_name = 'billing.currency'
        AND a.created_at > now() - INTERVAL '1 minute';
    END IF;

    RAISE EXCEPTION 'zz_verify_rollback';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'zz_verify_rollback' THEN
      v_privileged_call_error := COALESCE(v_privileged_call_error, SQLERRM);
    END IF;
  END;

  INSERT INTO zz_results VALUES (11, 'internal create_audit_log callers still work after the REVOKE',
    v_privileged_call_error IS NULL AND COALESCE(v_support_audit, 0) = 1,
    COALESCE(v_privileged_call_error, format('SUPPORT_NOTE_ADDED audit rows=%s', v_support_audit)));
  INSERT INTO zz_results VALUES (12, 'set_platform_setting records the previous and the new value',
    COALESCE(v_setting_audit, 0) = 1 AND v_setting_previous = 'NGN' AND v_setting_new = 'NGN',
    format('PLATFORM_SETTING_UPDATED rows=%s previous=%s new=%s',
           v_setting_audit, v_setting_previous, v_setting_new));

  -- ============================================================
  -- 4. READ-ONLY IMPERSONATION IS GUARDED (defect 4)
  -- ============================================================
  SELECT count(*) INTO v_trigger_count
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND NOT t.tgisinternal
    AND t.tgname = 'block_writes_while_impersonating'
    AND c.relname = ANY (v_guard_tables);

  SELECT string_agg(x.tbl, ', ' ORDER BY x.tbl) INTO v_trigger_missing
  FROM unnest(v_guard_tables) AS x(tbl)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND NOT t.tgisinternal
      AND t.tgname = 'block_writes_while_impersonating'
      AND c.relname = x.tbl
  );

  INSERT INTO zz_results VALUES (13, 'every intended table carries the impersonation trigger',
    v_trigger_count = array_length(v_guard_tables, 1) AND v_trigger_missing IS NULL,
    format('triggers=%s of %s; missing: %s', v_trigger_count, array_length(v_guard_tables, 1),
           COALESCE(v_trigger_missing, 'none')));

  -- The guard is exercised end to end: a live impersonation session for a caller
  -- who is not a platform admin must make a tenant write fail with 'Impersonation
  -- is read-only'. The write is a self-assignment (name = name), so even if the
  -- guard were missing nothing would change.
  BEGIN
    INSERT INTO public.impersonation_sessions
      (admin_user_id, target_org_id, target_user_id, mode, reason, status, started_at, expires_at)
    VALUES
      (v_plain, v_any_org, NULL, 'read_only', 'zz verify 089 impersonation', 'active',
       now(), now() + INTERVAL '5 minutes'),
      (v_admin, v_any_org, NULL, 'read_only', 'zz verify 089 admin session', 'active',
       now(), now() + INTERVAL '5 minutes');

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_plain)::text, TRUE);

    BEGIN
      UPDATE public.organizations SET name = name WHERE id = v_any_org;
      v_block_error := 'NOT BLOCKED (defect: read-only impersonation is not enforced)';
    EXCEPTION WHEN OTHERS THEN
      v_block_error := SQLERRM;
    END;

    -- Known limitation, asserted here so it cannot be forgotten: the trigger's own
    -- predicate exempts platform admins, so an impersonating platform admin is not
    -- blocked by it.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, TRUE);

    BEGIN
      UPDATE public.organizations SET name = name WHERE id = v_any_org;
      v_admin_exempt_error := 'not blocked: the predicate exempts platform admins';
    EXCEPTION WHEN OTHERS THEN
      v_admin_exempt_error := SQLERRM;
    END;

    RAISE EXCEPTION 'zz_verify_rollback';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'zz_verify_rollback' THEN
      v_block_error := COALESCE(v_block_error, SQLERRM);
    END IF;
  END;

  INSERT INTO zz_results VALUES (14, 'the guard refuses a tenant write during an active impersonation session',
    v_block_error = 'Impersonation is read-only', v_block_error);
  INSERT INTO zz_results VALUES (15, 'KNOWN LIMITATION: an impersonating platform admin is exempted by the predicate',
    v_admin_exempt_error LIKE 'not blocked%', v_admin_exempt_error);

  -- ============================================================
  -- 5. NEW PERMISSION KEYS AND CATEGORIES (defects 5 and 6)
  -- ============================================================
  SELECT count(*) INTO v_perm_count
  FROM public.platform_permissions p
  WHERE p.key IN ('platform:view_payments', 'platform:manage_subscriptions',
                  'platform:manage_integrations', 'platform:view_health',
                  'platform:view_audit', 'platform:manage_tickets');

  SELECT count(*) INTO v_perm_categories
  FROM public.platform_permissions p
  WHERE p.key IN ('platform:view_payments', 'platform:manage_subscriptions',
                  'platform:manage_integrations', 'platform:view_health',
                  'platform:view_audit', 'platform:manage_tickets')
    AND p.category IN ('payments', 'integrations', 'health', 'audit', 'support');

  INSERT INTO zz_results VALUES (16, 'the six new permission keys exist',
    v_perm_count = 6, format('keys found=%s of 6', v_perm_count));
  INSERT INTO zz_results VALUES (17, 'platform_permissions.category accepts the new categories',
    v_perm_categories = 6, format('rows carrying a new category=%s of 6', v_perm_categories));

  BEGIN
    INSERT INTO public.platform_permissions (key, label, category)
    VALUES ('platform:zz_bogus', 'bogus', 'zz_bogus_category');
    v_bogus_category_error := 'ACCEPTED (defect: the category CHECK no longer restricts values)';
  EXCEPTION WHEN OTHERS THEN
    v_bogus_category_error := SQLERRM;
  END;

  INSERT INTO zz_results VALUES (18, 'platform_permissions.category still rejects an unknown category',
    v_bogus_category_error LIKE '%platform_permissions_category_check%', v_bogus_category_error);

  -- ============================================================
  -- 6. THE PLATFORM AUDIT BROWSER (defect 8)
  -- ============================================================
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, TRUE);

    INSERT INTO public.audit_logs
      (actor_id, org_id, action, resource_type, resource_name, status, changes, details)
    VALUES (
      v_admin, NULL, 'ZZ_VERIFY_REDACTION', 'zz_test', 'zz redaction probe', 'success',
      jsonb_build_object(
        'previous', jsonb_build_object('api_key', 'sk_live_zz_previous'),
        'new', jsonb_build_object('monthly_price', 4321)
      ),
      jsonb_build_object(
        'password', 'hunter2-zz',
        'note', 'keep-me',
        'nested', jsonb_build_object('authorization', 'Bearer zz-token'),
        'list', jsonb_build_array(jsonb_build_object('token', 'zz-list-token'))
      )
    );

    SELECT count(*),
           max(l.total_count),
           max(l.org_id::text)::uuid,
           max(l.details->>'password'),
           max(l.details->>'note'),
           max(l.details->'nested'->>'authorization'),
           max(l.details->'list'->0->>'token'),
           max(l.changes->'previous'->>'api_key'),
           max(l.changes->'new'->>'monthly_price')
    INTO v_audit_rows, v_audit_total, v_audit_org,
         v_redact_password, v_redact_note, v_redact_nested, v_redact_list,
         v_redact_changes, v_redact_kept
    FROM public.list_platform_audit_logs(p_actor_id => v_admin, p_action => 'ZZ_VERIFY_REDACTION') l;

    -- A platform admin holding only platform:support must also pass: reading a
    -- business's audit trail is a support action.
    INSERT INTO public.platform_admins (user_id, level, status, note)
    VALUES (v_plain, 'support', 'active', 'zz verify 089 support fallback');

    INSERT INTO public.platform_admin_permissions (user_id, permission_key, granted_by)
    VALUES (v_plain, 'platform:support', v_admin);

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_plain)::text, TRUE);

    BEGIN
      PERFORM 1 FROM public.list_platform_audit_logs(p_action => 'ZZ_VERIFY_REDACTION') l LIMIT 1;
      v_fallback_error := 'allowed';
    EXCEPTION WHEN OTHERS THEN
      v_fallback_error := SQLERRM;
    END;

    -- A caller with no platform identity at all must be refused.
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', '00000000-0000-0000-0000-0000000000ff')::text, TRUE);

    BEGIN
      PERFORM 1 FROM public.list_platform_audit_logs(p_action => 'ZZ_VERIFY_REDACTION') l LIMIT 1;
      v_denied_error := 'ALLOWED (defect: the audit browser has no permission gate)';
    EXCEPTION WHEN OTHERS THEN
      v_denied_error := SQLERRM;
    END;

    RAISE EXCEPTION 'zz_verify_rollback';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'zz_verify_rollback' THEN
      v_denied_error := COALESCE(v_denied_error, SQLERRM);
    END IF;
  END;

  INSERT INTO zz_results VALUES (19, 'list_platform_audit_logs returns platform-scoped rows with a total_count',
    v_audit_rows = 1 AND v_audit_org IS NULL AND COALESCE(v_audit_total, 0) >= 1,
    format('rows=%s org_id=%s total_count=%s', v_audit_rows,
           COALESCE(v_audit_org::text, 'NULL'), v_audit_total));
  INSERT INTO zz_results VALUES (20, 'credential-looking keys are redacted at the top level',
    v_redact_password = '***redacted***' AND v_redact_note = 'keep-me',
    format('password=%s note=%s', v_redact_password, v_redact_note));
  INSERT INTO zz_results VALUES (21, 'credential-looking keys are redacted inside nested objects and arrays',
    v_redact_nested = '***redacted***' AND v_redact_list = '***redacted***'
      AND v_redact_changes = '***redacted***' AND v_redact_kept = '4321',
    format('nested.authorization=%s list[0].token=%s changes.previous.api_key=%s changes.new.monthly_price=%s',
           v_redact_nested, v_redact_list, v_redact_changes, v_redact_kept));
  INSERT INTO zz_results VALUES (22, 'platform:support is accepted as a fallback gate',
    v_fallback_error = 'allowed', v_fallback_error);
  INSERT INTO zz_results VALUES (23, 'a caller with no platform identity is refused',
    v_denied_error LIKE '%Permission denied%', v_denied_error);

  -- ============================================================
  -- 7. A PAID TRANSACTION CREATES THE ENTITLEMENT (defect 2)
  -- ============================================================
  -- A throwaway business is created (which also gives it a subscriptions row and a
  -- pending entitlement through the 068 triggers), a pending transaction is
  -- recorded with product_id = NULL so the trackoja fallback is exercised, and the
  -- whole activation is then rolled back with the rest of the block.
  BEGIN
    PERFORM set_config('request.jwt.claims', NULL, TRUE);

    INSERT INTO public.organizations (name, slug, owner_id, timezone, trial_ends_at)
    VALUES ('ZZ Verify 089 Activation',
            'zz-verify-089-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
            v_admin, 'UTC', now() + INTERVAL '14 days')
    RETURNING id INTO v_org;

    SELECT pl.id INTO v_expected_plan
    FROM public.product_plans pl
    JOIN public.platform_products pr ON pr.id = pl.product_id
    WHERE pr.key = 'trackoja' AND pl.key = 'starter';

    SELECT sp.id INTO v_legacy_plan
    FROM public.subscription_plans sp
    WHERE sp.name = 'Starter' AND sp.status = 'active'
    LIMIT 1;

    INSERT INTO public.subscription_transactions
      (org_id, plan_id, reference, amount, currency, status, created_by, product_id, is_sandbox)
    VALUES
      (v_org, v_legacy_plan, 'ZZ089-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10),
       5000, 'NGN', 'pending', v_admin, NULL, FALSE)
    RETURNING reference INTO v_activate_reference;

    PERFORM public.activate_subscription(v_activate_reference, '{"zz": "verify"}'::jsonb, now());

    SELECT op.status, op.source, op.plan_id, op.agreed_monthly_price, op.agreed_annual_price,
           op.agreed_user_limit, op.currency, op.activated_at, op.expires_at
    INTO v_ent_status, v_ent_source, v_ent_plan, v_ent_monthly, v_ent_annual,
         v_ent_limit, v_ent_currency, v_ent_activated, v_ent_expires
    FROM public.organization_products op
    JOIN public.platform_products pr ON pr.id = op.product_id
    WHERE op.org_id = v_org AND pr.key = 'trackoja';

    SELECT s.current_period_end INTO v_period_end FROM public.subscriptions s WHERE s.org_id = v_org;

    -- Idempotency: a repeated delivery must change nothing and add no second row.
    PERFORM public.activate_subscription(v_activate_reference, '{"zz": "verify"}'::jsonb, now());

    SELECT count(*) INTO v_ent_count
    FROM public.organization_products op
    JOIN public.platform_products pr ON pr.id = op.product_id
    WHERE op.org_id = v_org AND pr.key = 'trackoja';

    RAISE EXCEPTION 'zz_verify_rollback';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'zz_verify_rollback' THEN
      v_activate_error := SQLERRM;
      v_ent_status := NULL;
    END IF;
  END;

  INSERT INTO zz_results VALUES (24, 'activate_subscription writes an active entitlement',
    v_ent_status = 'active' AND v_ent_source = 'payment' AND v_ent_activated IS NOT NULL,
    format('status=%s source=%s activated_at=%s [%s]', v_ent_status, v_ent_source, v_ent_activated,
           COALESCE(v_activate_error, 'no error')));
  INSERT INTO zz_results VALUES (25, 'the entitlement is attributed to the trackoja product and the starter plan',
    v_ent_plan = v_expected_plan,
    format('plan_id=%s expected_product_plan=%s', v_ent_plan, v_expected_plan));
  INSERT INTO zz_results VALUES (26, 'the agreed prices, seat limit and currency are snapshotted from product_plans',
    v_ent_monthly = 5000 AND v_ent_annual = 50000 AND v_ent_limit = 2 AND v_ent_currency = 'NGN',
    format('monthly=%s annual=%s user_limit=%s currency=%s',
           v_ent_monthly, v_ent_annual, v_ent_limit, v_ent_currency));
  INSERT INTO zz_results VALUES (27, 'expires_at follows the new subscriptions.current_period_end',
    v_ent_expires IS NOT NULL AND v_ent_expires = v_period_end,
    format('expires_at=%s current_period_end=%s', v_ent_expires, v_period_end));
  INSERT INTO zz_results VALUES (28, 'a repeated activation is idempotent (one entitlement, no duplicate)',
    v_ent_count = 1, format('entitlement rows=%s', v_ent_count));

  SELECT count(*) INTO v_ent_count FROM public.organizations o WHERE o.slug LIKE 'zz-verify-089-%';
  INSERT INTO zz_results VALUES (29, 'the activation fixture was rolled back (no leftover business)',
    v_ent_count = 0, format('leftover organizations=%s', v_ent_count));

  SELECT count(*) INTO v_ent_count FROM public.subscription_transactions t WHERE t.reference LIKE 'ZZ089-%';
  INSERT INTO zz_results VALUES (30, 'the activation fixture was rolled back (no leftover transaction)',
    v_ent_count = 0, format('leftover subscription_transactions=%s', v_ent_count));

  -- ============================================================
  -- 8. SANDBOX PAYMENTS ARE NOT REVENUE (defect 9)
  -- ============================================================
  v_window_from := now() - INTERVAL '1 minute';
  v_window_to := now() + INTERVAL '1 minute';

  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, TRUE);

    INSERT INTO public.subscription_transactions
      (org_id, plan_id, reference, amount, currency, status, created_by, product_id, is_sandbox, created_at)
    VALUES
      (v_any_org, v_legacy_plan, 'ZZ089-REVENUE-REAL', 111.11, 'NGN', 'success', v_admin, NULL, FALSE, now()),
      (v_any_org, v_legacy_plan, 'ZZ089-REVENUE-SANDBOX', 999.99, 'NGN', 'success', v_admin, NULL, TRUE, now());

    SELECT r.total_revenue, r.transaction_count INTO v_rev, v_rev_count
    FROM public.get_platform_revenue_summary(v_window_from, v_window_to) r;

    SELECT b.revenue INTO v_rev_plan
    FROM public.get_platform_revenue_by_plan(v_window_from, v_window_to) b
    WHERE b.plan_id = v_legacy_plan;

    RAISE EXCEPTION 'zz_verify_rollback';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'zz_verify_rollback' THEN
      v_rev := NULL;
    END IF;
  END;

  INSERT INTO zz_results VALUES (31, 'get_platform_revenue_summary excludes sandbox transactions',
    v_rev = 111.11 AND v_rev_count = 1,
    format('total_revenue=%s transaction_count=%s (a sandbox 999.99 row was inserted in the same window)',
           v_rev, v_rev_count));
  INSERT INTO zz_results VALUES (32, 'get_platform_revenue_by_plan excludes sandbox transactions',
    v_rev_plan = 111.11, format('starter revenue=%s', v_rev_plan));

  -- ============================================================
  -- 9. product_plans.billing_cycle (defect 10)
  -- ============================================================
  SELECT count(*) INTO v_billing_column
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'product_plans'
    AND c.column_name = 'billing_cycle' AND c.is_nullable = 'NO'
    AND c.column_default LIKE '%monthly%';

  SELECT count(*) INTO v_billing_check
  FROM pg_constraint con
  WHERE con.conrelid = 'public.product_plans'::regclass
    AND con.conname = 'product_plans_billing_cycle_check'
    AND pg_get_constraintdef(con.oid) LIKE '%custom%';

  SELECT count(*) INTO v_new_signature
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'upsert_product_plan'
    AND pg_get_function_identity_arguments(p.oid) LIKE '%p_billing_cycle%';

  SELECT count(*) INTO v_old_signature
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'upsert_product_plan'
    AND pg_get_function_identity_arguments(p.oid) NOT LIKE '%p_billing_cycle%';

  INSERT INTO zz_results VALUES (33, 'product_plans.billing_cycle exists, is NOT NULL and defaults to monthly',
    v_billing_column = 1, format('matching columns=%s', v_billing_column));
  INSERT INTO zz_results VALUES (34, 'product_plans.billing_cycle is constrained to monthly/annual/custom',
    v_billing_check = 1, format('matching constraints=%s', v_billing_check));
  INSERT INTO zz_results VALUES (35, 'upsert_product_plan has exactly one signature, the new one',
    v_new_signature = 1 AND v_old_signature = 0,
    format('signatures carrying p_billing_cycle=%s, old signature=%s', v_new_signature, v_old_signature));

  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, TRUE);

    SELECT count(*), max(l.billing_cycle) INTO v_plans_rows, v_plans_billing
    FROM public.list_product_plans(NULL) l;

    RAISE EXCEPTION 'zz_verify_rollback';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'zz_verify_rollback' THEN
      v_plans_billing := SQLERRM;
    END IF;
  END;

  INSERT INTO zz_results VALUES (36, 'list_product_plans returns billing_cycle',
    v_plans_rows > 0 AND v_plans_billing = 'monthly',
    format('rows=%s billing_cycle=%s', v_plans_rows, v_plans_billing));

  -- The cycle is validated and journalled. The edit is rolled back afterwards.
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, TRUE);

    BEGIN
      PERFORM public.upsert_product_plan(
        p_product_key => 'trackoja', p_plan_key => 'custom', p_name => 'Custom',
        p_status => 'active', p_billing_cycle => 'zz_bogus');
      v_cycle_error := 'ACCEPTED (defect: the billing cycle is not validated)';
    EXCEPTION WHEN OTHERS THEN
      v_cycle_error := SQLERRM;
    END;

    PERFORM public.upsert_product_plan(
      p_product_key => 'trackoja', p_plan_key => 'custom', p_name => 'Custom',
      p_status => 'active', p_sort_order => 4, p_billing_cycle => 'custom');

    SELECT pl.billing_cycle INTO v_cycle_saved
    FROM public.product_plans pl
    JOIN public.platform_products pr ON pr.id = pl.product_id
    WHERE pr.key = 'trackoja' AND pl.key = 'custom';

    SELECT r.new_values->>'billing_cycle' INTO v_cycle_revision
    FROM public.product_plan_revisions r
    JOIN public.product_plans pl ON pl.id = r.plan_id
    WHERE pl.key = 'custom' AND r.created_at > now() - INTERVAL '1 minute'
    ORDER BY r.created_at DESC
    LIMIT 1;

    RAISE EXCEPTION 'zz_verify_rollback';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'zz_verify_rollback' THEN
      v_cycle_error := COALESCE(v_cycle_error, SQLERRM);
    END IF;
  END;

  INSERT INTO zz_results VALUES (37, 'upsert_product_plan rejects an invalid billing cycle',
    v_cycle_error LIKE 'Invalid billing cycle%', v_cycle_error);
  INSERT INTO zz_results VALUES (38, 'upsert_product_plan saves the cycle and journals it in product_plan_revisions',
    v_cycle_saved = 'custom' AND v_cycle_revision = 'custom',
    format('saved=%s revision.new_values.billing_cycle=%s', v_cycle_saved, v_cycle_revision));

  -- ============================================================
  -- 10. NOTHING THE SCRIPT CREATED SURVIVED
  -- ============================================================
  SELECT count(*) INTO v_leftover_admins
  FROM public.platform_admins pa WHERE pa.note LIKE 'zz verify 089%';

  SELECT count(*) INTO v_leftover_audit
  FROM public.audit_logs a WHERE a.action LIKE 'ZZ%';

  SELECT count(*) INTO v_leftover_notes
  FROM public.platform_support_notes n WHERE n.body = 'zz verify 089 support note';

  SELECT count(*) INTO v_leftover_sessions
  FROM public.impersonation_sessions s WHERE s.reason LIKE 'zz verify 089%';

  INSERT INTO zz_results VALUES (39, 'no verification fixture survived the run',
    v_leftover_admins = 0 AND v_leftover_notes = 0 AND v_leftover_sessions = 0,
    format('leftover platform_admins=%s support_notes=%s impersonation_sessions=%s',
           v_leftover_admins, v_leftover_notes, v_leftover_sessions));
  INSERT INTO zz_results VALUES (40, 'no fabricated audit row survived the run',
    v_leftover_audit = 0, format('audit_logs rows with a ZZ action=%s', v_leftover_audit));

  -- ============================================================
  -- 11. KNOWN LIMITATION: AN ORGANIZATION WITH NO subscriptions ROW
  -- ============================================================
  -- activate_subscription now writes the entitlement, but it copies expires_at
  -- from subscriptions.current_period_end - and a legacy organization that
  -- predates the 033/068 triggers has no subscriptions row at all, so there is no
  -- period end to copy. The entitlement it produces is 'active' with
  -- expires_at = NULL, which enforce_seat_limit() reads as an entitlement that
  -- never expires. Two such organizations exist in this project today (both
  -- pre-Phase-6 test records, not the live businesses).
  --
  -- This is asserted rather than ignored so it cannot be forgotten. It is
  -- reported as an unfixed defect: closing it means creating the missing
  -- subscriptions row inside a payment webhook, which is a billing-lifecycle
  -- decision owned by 033/068 and initiate_subscription_checkout, not by this
  -- migration.
  BEGIN
    SELECT o.id INTO v_legacy_org
    FROM public.organizations o
    WHERE NOT EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.org_id = o.id)
    ORDER BY o.created_at
    LIMIT 1;

    IF v_legacy_org IS NOT NULL THEN
      BEGIN
        INSERT INTO public.subscription_transactions
          (org_id, plan_id, reference, amount, currency, status, created_by)
        VALUES
          (v_legacy_org, v_legacy_plan,
           'ZZPROBE-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
           5000, 'NGN', 'pending', v_admin)
        RETURNING reference INTO v_legacy_reference;

        PERFORM public.activate_subscription(v_legacy_reference, '{}'::jsonb, now());

        SELECT count(*) INTO v_legacy_sub_count
        FROM public.subscriptions s WHERE s.org_id = v_legacy_org;

        SELECT op.status, op.expires_at INTO v_legacy_status, v_legacy_expires
        FROM public.organization_products op
        JOIN public.platform_products pr ON pr.id = op.product_id
        WHERE op.org_id = v_legacy_org AND pr.key = 'trackoja';

        RAISE EXCEPTION 'zz_verify_rollback';
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'zz_verify_rollback' THEN
          v_legacy_status := NULL;
        END IF;
      END;
    END IF;
  END;

  SELECT count(*) INTO v_leftover_audit
  FROM public.subscription_transactions t WHERE t.reference LIKE 'ZZPROBE-%';

  INSERT INTO zz_results VALUES (41, 'KNOWN LIMITATION: an organization with no subscriptions row gets expires_at = NULL',
    v_legacy_org IS NULL
      OR (v_legacy_status = 'active' AND v_legacy_expires IS NULL AND v_legacy_sub_count = 0
          AND v_leftover_audit = 0),
    format('legacy org=%s; entitlement status=%s expires_at=%s; subscriptions rows created=%s; leftover probe transactions=%s',
           COALESCE(v_legacy_org::text, 'no such organization exists'),
           v_legacy_status, COALESCE(v_legacy_expires::text, 'NULL'),
           v_legacy_sub_count, v_leftover_audit));
END $$;

SELECT step, check_name, passed, detail FROM zz_results ORDER BY step;
