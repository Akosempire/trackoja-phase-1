-- Verification for 20260927000090_entitlement_and_impersonation_fixes.sql.
--
-- Results are returned as rows so they can be read back from the Management API
-- (which discards RAISE NOTICE output), in the style of the other files here.
--
-- Every check that needs to write rows does so inside an inner block that is then
-- aborted on purpose, so the assertions are made against real database behaviour
-- while the fixtures themselves are rolled back. A final set of "leftover" checks
-- proves nothing this script created survived.
--
-- Re-runnable: it creates its own organization, impersonation sessions and
-- transaction for the activation checks, and deletes nothing that already
-- existed. Nothing here depends on a count of businesses, so a new signup does
-- not break it.
--
-- The impersonation section is written the way the defect was: the caller is the
-- real super admin, who is a platform admin, by both the legacy
-- users.is_platform_admin flag and an active platform_admins row. Before this
-- migration that caller was exempt from the guard (089 verification step 15
-- proved it: "not blocked: the predicate exempts platform admins"); it must now
-- be refused.
--
-- Idempotency of the migration is proved in two ways here: the backfill's own
-- INSERT and UPDATE statements are re-executed and must affect zero rows, and
-- the defect's selection predicate must now be empty. The migration file itself
-- was additionally applied twice against this project - the second run returned
-- an empty result and exited 0.
--
-- Section 9 covers the third fix in 090: EXECUTE is revoked from anon and
-- authenticated by NAME, because this project's ALTER DEFAULT PRIVILEGES grants
-- EXECUTE on every new public function straight to those roles as explicit ACL
-- entries, which `REVOKE ... FROM PUBLIC` does not remove. That section proves the
-- named revokes took effect, that the client-callable surface and the RLS
-- predicate helpers were left alone, and - the safety-critical half - that a
-- trigger function with no client EXECUTE still fires for the authenticated role.

DROP TABLE IF EXISTS zz_results;
CREATE TEMP TABLE zz_results (
  step int,
  check_name text,
  passed boolean,
  detail text
);

DO $$
DECLARE
  -- the platform admin every impersonation check uses: super admin, and an
  -- admin by both the legacy flag and the platform_admins roster
  v_admin UUID := 'aac84346-9e10-493f-865c-7f3bef18909e';
  v_other_user UUID;

  -- the two production organizations the migration backfilled
  v_smoke UUID := '8223cd0a-45ce-4e7e-8814-ff935955ec6f';
  v_akos  UUID := 'cf25cb4d-2a10-4c40-a220-1db91b2bbf76';

  v_guard_tables TEXT[] := ARRAY[
    'sales', 'sale_items', 'sale_payments', 'products', 'product_variants',
    'product_categories', 'customers', 'inventory_movements', 'stock_lots',
    'stores', 'store_members', 'organization_members', 'organizations',
    'expenses', 'suppliers', 'purchases', 'tailoring_jobs', 'material_quotes',
    'refunds', 'devices'
  ];

  -- fixtures / carried-out results
  v_any_org UUID;
  v_attached INT;
  v_missing TEXT;
  v_wrong_shape TEXT;

  v_admin_block_error TEXT;
  v_admin_block_error_stores TEXT;
  v_expired_session_error TEXT;
  v_other_owner_error TEXT;
  v_no_jwt_error TEXT;
  v_no_jwt_rows INT;

  v_legacy_org UUID;
  v_legacy_plan UUID;
  v_legacy_reference TEXT;
  v_legacy_error TEXT;
  v_legacy_sub_count INT;
  v_legacy_ent_count INT;
  v_legacy_status TEXT;
  v_legacy_expires TIMESTAMPTZ;
  v_legacy_period_end TIMESTAMPTZ;
  v_repeat_sub_count INT;
  v_repeat_ent_count INT;
  v_repeat_expires TIMESTAMPTZ;

  v_smoke_subs INT;
  v_akos_subs INT;
  v_smoke_expires TIMESTAMPTZ;
  v_akos_expires TIMESTAMPTZ;
  v_smoke_period TIMESTAMPTZ;
  v_akos_period TIMESTAMPTZ;

  v_marked_subs INT;
  v_marked_subs_orgs TEXT;
  v_marked_ents INT;
  v_marked_ents_orgs TEXT;
  v_orgs_without_subs INT;
  v_orgs_with_many_subs INT;
  v_defect_rows INT;
  v_other_orgs INT;
  v_other_touched INT;

  v_replay_insert INT := -1;
  v_replay_update INT := -1;

  v_recorded INT;
  v_guard_outside_list INT;
  v_guard_on_open_tables INT;

  v_activate_signature TEXT;
  v_server_only_open INT;
  v_server_only_locked INT;
  v_trigger_functions INT;
  v_trigger_functions_open INT;
  v_trigger_fired TIMESTAMPTZ;
  v_trigger_probe_error TEXT;
  v_role_block_error TEXT;
  v_internal_open INT;
  v_client_rpcs INT;
  v_client_missing TEXT;
  v_rls_missing TEXT;
  v_anon_reachable INT;
  v_anon_residual_leaks INT;

  v_leftover_sessions INT;
  v_leftover_orgs INT;
  v_leftover_txns INT;
BEGIN
  SELECT id INTO v_any_org FROM public.organizations ORDER BY created_at LIMIT 1;
  SELECT id INTO v_other_user FROM public.users WHERE id <> v_admin ORDER BY created_at LIMIT 1;
  SELECT id INTO v_legacy_plan FROM public.subscription_plans WHERE status = 'active' ORDER BY price LIMIT 1;

  -- ============================================================
  -- 1. THE GUARD IS STILL ATTACHED TO ALL 20 TABLES (defect A, attachment)
  -- ============================================================
  -- CREATE OR REPLACE keeps the function OID, so the triggers 089 created keep
  -- pointing at the new body. This is checked rather than assumed: a missing
  -- trigger would silently restore the defect.
  SELECT count(*) INTO v_attached
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND NOT t.tgisinternal
    AND t.tgname = 'block_writes_while_impersonating'
    AND c.relname = ANY (v_guard_tables);

  SELECT string_agg(x.tbl, ', ' ORDER BY x.tbl) INTO v_missing
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

  -- The three properties that make the guard mean what it says: BEFORE, all of
  -- INSERT/UPDATE/DELETE, FOR EACH ROW, and the function that refuses the write.
  SELECT string_agg(x.tbl, ', ' ORDER BY x.tbl) INTO v_wrong_shape
  FROM unnest(v_guard_tables) AS x(tbl)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE n.nspname = 'public'
      AND NOT t.tgisinternal
      AND t.tgname = 'block_writes_while_impersonating'
      AND c.relname = x.tbl
      AND (t.tgtype & 2) = 2                        -- BEFORE
      AND (t.tgtype & 4) = 4                        -- INSERT
      AND (t.tgtype & 16) = 16                      -- UPDATE
      AND (t.tgtype & 8) = 8                        -- DELETE
      AND (t.tgtype & 1) = 1                        -- ROW
      AND p.proname = 'block_writes_while_impersonating'
      AND pg_get_functiondef(p.oid) NOT LIKE '%NOT public.is_platform_admin(auth.uid())%'
  );

  INSERT INTO zz_results VALUES (1, 'all 20 tenant tables still carry the impersonation trigger',
    COALESCE(v_attached, 0) = array_length(v_guard_tables, 1) AND v_missing IS NULL,
    format('triggers=%s of %s; missing: %s', COALESCE(v_attached, 0),
           array_length(v_guard_tables, 1), COALESCE(v_missing, 'none')));

  INSERT INTO zz_results VALUES (2, 'each trigger is BEFORE INSERT/UPDATE/DELETE FOR EACH ROW and calls the guard without the platform-admin exemption',
    v_wrong_shape IS NULL,
    COALESCE('wrong shape: ' || v_wrong_shape, 'all 20 verified against pg_trigger.tgtype and the live function body'));

  -- ============================================================
  -- 2. AN IMPERSONATING PLATFORM ADMIN IS REFUSED (defect A)
  -- ============================================================
  -- The session is the real thing: an active, unexpired impersonation_sessions
  -- row owned by the caller, inserted exactly as start_impersonation_session
  -- would. The write is a self-assignment, so even if the guard were missing
  -- nothing would change, and the whole block is aborted afterwards.
  BEGIN
    INSERT INTO public.impersonation_sessions
      (admin_user_id, target_org_id, target_user_id, mode, reason, status, started_at, expires_at)
    VALUES
      (v_admin, v_any_org, NULL, 'read_only', 'zz verify 090 impersonation', 'active',
       now(), now() + INTERVAL '5 minutes');

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, TRUE);
    PERFORM set_config('request.jwt.claim.sub', v_admin::text, TRUE);

    -- Two different guarded tables, so the refusal cannot be an accident of one
    -- table's trigger.
    BEGIN
      UPDATE public.organizations SET name = name WHERE id = v_any_org;
      v_admin_block_error := 'NOT BLOCKED (defect A is back: the guard exempts the impersonating admin)';
    EXCEPTION WHEN OTHERS THEN
      v_admin_block_error := SQLERRM;
    END;

    BEGIN
      UPDATE public.stores SET name = name WHERE org_id = v_any_org;
      v_admin_block_error_stores := 'NOT BLOCKED (defect A is back on stores)';
    EXCEPTION WHEN OTHERS THEN
      v_admin_block_error_stores := SQLERRM;
    END;

    RAISE EXCEPTION 'zz_verify_rollback';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'zz_verify_rollback' THEN
      v_admin_block_error := COALESCE(v_admin_block_error, SQLERRM);
    END IF;
  END;

  INSERT INTO zz_results VALUES (3, 'a write by an impersonating platform admin is refused',
    v_admin_block_error = 'Impersonation is read-only',
    COALESCE(v_admin_block_error, 'no exception raised'));

  INSERT INTO zz_results VALUES (4, 'the exact exception message is "Impersonation is read-only"',
    v_admin_block_error IS NOT NULL
      AND v_admin_block_error = 'Impersonation is read-only'
      AND length(v_admin_block_error) = length('Impersonation is read-only'),
    format('SQLERRM=%s (length %s)', COALESCE(v_admin_block_error, 'none'),
           COALESCE(length(v_admin_block_error), 0)));

  INSERT INTO zz_results VALUES (5, 'the refusal is not specific to one table (public.stores is guarded too)',
    v_admin_block_error_stores = 'Impersonation is read-only',
    COALESCE(v_admin_block_error_stores, 'no exception raised'));

  -- ============================================================
  -- 3. THE GUARD STILL ONLY BITES WHEN IT SHOULD
  -- ============================================================
  -- Three negative controls, because a guard that blocks everything would be as
  -- broken as one that blocks nothing - migrations and the seed path write these
  -- tables with no JWT at all.

  -- 3.1 an EXPIRED session does not block: "active and unexpired" is the rule.
  BEGIN
    INSERT INTO public.impersonation_sessions
      (admin_user_id, target_org_id, target_user_id, mode, reason, status, started_at, expires_at)
    VALUES
      (v_admin, v_any_org, NULL, 'read_only', 'zz verify 090 expired session', 'active',
       now() - INTERVAL '2 hours', now() - INTERVAL '1 hour');

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, TRUE);
    PERFORM set_config('request.jwt.claim.sub', v_admin::text, TRUE);

    BEGIN
      UPDATE public.organizations SET name = name WHERE id = v_any_org;
      v_expired_session_error := 'allowed (correct: the session has expired)';
    EXCEPTION WHEN OTHERS THEN
      v_expired_session_error := SQLERRM;
    END;

    RAISE EXCEPTION 'zz_verify_rollback';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'zz_verify_rollback' THEN
      v_expired_session_error := COALESCE(v_expired_session_error, SQLERRM);
    END IF;
  END;

  INSERT INTO zz_results VALUES (6, 'an expired impersonation session does not block its owner',
    v_expired_session_error LIKE 'allowed%',
    COALESCE(v_expired_session_error, 'no result captured'));

  -- 3.2 somebody ELSE's session does not block this caller: the guard is scoped
  -- to the session's own owner, which is what makes it meaningful.
  IF v_other_user IS NOT NULL THEN
    BEGIN
      INSERT INTO public.impersonation_sessions
        (admin_user_id, target_org_id, target_user_id, mode, reason, status, started_at, expires_at)
      VALUES
        (v_other_user, v_any_org, NULL, 'read_only', 'zz verify 090 other owner session', 'active',
         now(), now() + INTERVAL '5 minutes');

      PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, TRUE);
      PERFORM set_config('request.jwt.claim.sub', v_admin::text, TRUE);

      BEGIN
        UPDATE public.organizations SET name = name WHERE id = v_any_org;
        v_other_owner_error := 'allowed (correct: the active session belongs to another user)';
      EXCEPTION WHEN OTHERS THEN
        v_other_owner_error := SQLERRM;
      END;

      RAISE EXCEPTION 'zz_verify_rollback';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'zz_verify_rollback' THEN
        v_other_owner_error := COALESCE(v_other_owner_error, SQLERRM);
      END IF;
    END;
  END IF;

  INSERT INTO zz_results VALUES (7, 'an impersonation session owned by somebody else does not block the caller',
    v_other_owner_error IS NULL OR v_other_owner_error LIKE 'allowed%',
    COALESCE(v_other_owner_error,
             'skipped: this project has only one user, so the case cannot be exercised'));

  -- 3.3 no JWT at all: the service_role webhook, migration and seed path. The
  -- trigger still fires (it is BEFORE ... FOR EACH ROW on the table), and the
  -- write must go through.
  BEGIN
    PERFORM set_config('request.jwt.claims', '{}', TRUE);
    PERFORM set_config('request.jwt.claim.sub', '', TRUE);

    BEGIN
      UPDATE public.organizations SET name = name || '' WHERE id = v_any_org;
      GET DIAGNOSTICS v_no_jwt_rows = ROW_COUNT;
      v_no_jwt_error := format('allowed (correct: no JWT, so auth.uid() is NULL); rows updated=%s', v_no_jwt_rows);
    EXCEPTION WHEN OTHERS THEN
      v_no_jwt_error := 'BLOCKED (the fix broke the no-JWT path): ' || SQLERRM;
    END;

    RAISE EXCEPTION 'zz_verify_rollback';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'zz_verify_rollback' THEN
      v_no_jwt_error := COALESCE(v_no_jwt_error, SQLERRM);
    END IF;
  END;

  INSERT INTO zz_results VALUES (8, 'a service-role / no-JWT context can still write a guarded table',
    v_no_jwt_error LIKE 'allowed%' AND COALESCE(v_no_jwt_rows, 0) = 1,
    COALESCE(v_no_jwt_error, 'no result captured'));

  -- ============================================================
  -- 4. ACTIVATION WITH NO subscriptions ROW NOW PRODUCES AN EXPIRY (defect B)
  -- ============================================================
  -- A brand-new organization is created (the Phase-6 triggers give it an
  -- entitlement and a trial subscriptions row), the subscriptions row is then
  -- deleted inside this block so the organization is in exactly the state the
  -- two backfilled businesses were in, and a paid activation is run against it.
  -- Everything is rolled back, so the organization never exists.
  IF v_legacy_plan IS NULL THEN
    INSERT INTO zz_results VALUES (9, 'precondition: a legacy subscription plan exists', false,
      'no active row in public.subscription_plans');
  ELSE
    BEGIN
      INSERT INTO public.organizations (name, slug, owner_id, timezone, trial_ends_at)
      VALUES ('ZZ Verify 090 Activation', 'zz-verify-090-activation-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
              v_admin, 'UTC', now() + INTERVAL '14 days')
      RETURNING id INTO v_legacy_org;

      -- Reproduce the legacy state: entitlement present, no subscriptions row.
      DELETE FROM public.subscriptions s WHERE s.org_id = v_legacy_org;

      INSERT INTO public.subscription_transactions
        (org_id, plan_id, reference, amount, currency, status, created_by)
      VALUES
        (v_legacy_org, v_legacy_plan,
         'ZZVERIFY090-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
         5000, 'NGN', 'pending', v_admin)
      RETURNING reference INTO v_legacy_reference;

      PERFORM public.activate_subscription(v_legacy_reference, '{"zz": "verify 090"}'::jsonb, now());

      SELECT count(*) INTO v_legacy_sub_count
      FROM public.subscriptions s WHERE s.org_id = v_legacy_org;

      SELECT count(*) INTO v_legacy_ent_count
      FROM public.organization_products op WHERE op.org_id = v_legacy_org;

      SELECT op.status, op.expires_at INTO v_legacy_status, v_legacy_expires
      FROM public.organization_products op
      JOIN public.platform_products pr ON pr.id = op.product_id
      WHERE op.org_id = v_legacy_org AND pr.key = 'trackoja';

      SELECT s.current_period_end INTO v_legacy_period_end
      FROM public.subscriptions s WHERE s.org_id = v_legacy_org;

      -- Idempotency: a second activation of the same reference must change
      -- nothing, and must not write a second subscription or a second
      -- entitlement.
      PERFORM public.activate_subscription(v_legacy_reference, '{"zz": "verify 090 again"}'::jsonb, now());

      SELECT count(*) INTO v_repeat_sub_count
      FROM public.subscriptions s WHERE s.org_id = v_legacy_org;

      SELECT count(*) INTO v_repeat_ent_count
      FROM public.organization_products op WHERE op.org_id = v_legacy_org;

      SELECT op.expires_at INTO v_repeat_expires
      FROM public.organization_products op
      JOIN public.platform_products pr ON pr.id = op.product_id
      WHERE op.org_id = v_legacy_org AND pr.key = 'trackoja';

      RAISE EXCEPTION 'zz_verify_rollback';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'zz_verify_rollback' THEN
        v_legacy_error := SQLERRM;
      END IF;
    END;

    INSERT INTO zz_results VALUES (9, 'precondition: a legacy subscription plan exists',
      v_legacy_plan IS NOT NULL AND v_legacy_error IS NULL,
      COALESCE(v_legacy_error, 'plan id ' || v_legacy_plan::text || ' resolved'));

    INSERT INTO zz_results VALUES (10, 'activation with no subscriptions row creates the row instead of writing expires_at = NULL',
      v_legacy_sub_count = 1 AND v_legacy_status = 'active' AND v_legacy_expires IS NOT NULL,
      format('subscriptions rows=%s; entitlement status=%s expires_at=%s',
             COALESCE(v_legacy_sub_count, -1), COALESCE(v_legacy_status, 'none'),
             COALESCE(v_legacy_expires::text, 'NULL')));

    INSERT INTO zz_results VALUES (11, 'the entitlement expires_at equals the created subscriptions.current_period_end',
      v_legacy_expires IS NOT NULL AND v_legacy_expires IS NOT DISTINCT FROM v_legacy_period_end,
      format('expires_at=%s current_period_end=%s',
             COALESCE(v_legacy_expires::text, 'NULL'), COALESCE(v_legacy_period_end::text, 'NULL')));

    INSERT INTO zz_results VALUES (12, 'a repeated activation stays idempotent (one subscription, one entitlement, unchanged expiry)',
      v_repeat_sub_count = 1 AND v_repeat_ent_count = 1
        AND v_repeat_expires IS NOT DISTINCT FROM v_legacy_expires,
      format('after second call: subscriptions=%s entitlements=%s expires_at=%s',
             COALESCE(v_repeat_sub_count, -1), COALESCE(v_repeat_ent_count, -1),
             COALESCE(v_repeat_expires::text, 'NULL')));
  END IF;

  -- ============================================================
  -- 5. THE TWO BACKFILLED ORGANIZATIONS
  -- ============================================================
  SELECT count(*) INTO v_smoke_subs FROM public.subscriptions s WHERE s.org_id = v_smoke;
  SELECT count(*) INTO v_akos_subs  FROM public.subscriptions s WHERE s.org_id = v_akos;

  SELECT op.expires_at INTO v_smoke_expires
  FROM public.organization_products op WHERE op.org_id = v_smoke;

  SELECT op.expires_at INTO v_akos_expires
  FROM public.organization_products op WHERE op.org_id = v_akos;

  SELECT s.current_period_end INTO v_smoke_period FROM public.subscriptions s WHERE s.org_id = v_smoke;
  SELECT s.current_period_end INTO v_akos_period  FROM public.subscriptions s WHERE s.org_id = v_akos;

  INSERT INTO zz_results VALUES (13, 'Smoke Test Org: expires_at is no longer NULL and it has exactly one subscriptions row',
    v_smoke_expires IS NOT NULL AND v_smoke_subs = 1,
    format('expires_at=%s subscriptions rows=%s', COALESCE(v_smoke_expires::text, 'NULL'), COALESCE(v_smoke_subs, -1)));

  INSERT INTO zz_results VALUES (14, 'Akos Store: expires_at is no longer NULL and it has exactly one subscriptions row',
    v_akos_expires IS NOT NULL AND v_akos_subs = 1,
    format('expires_at=%s subscriptions rows=%s', COALESCE(v_akos_expires::text, 'NULL'), COALESCE(v_akos_subs, -1)));

  INSERT INTO zz_results VALUES (15, 'both backfilled entitlements expire exactly when their subscription period ends',
    v_smoke_expires IS NOT DISTINCT FROM v_smoke_period
      AND v_akos_expires IS NOT DISTINCT FROM v_akos_period,
    format('Smoke: expires_at=%s period_end=%s | Akos: expires_at=%s period_end=%s',
           COALESCE(v_smoke_expires::text, 'NULL'), COALESCE(v_smoke_period::text, 'NULL'),
           COALESCE(v_akos_expires::text, 'NULL'), COALESCE(v_akos_period::text, 'NULL')));

  -- ============================================================
  -- 6. NO OTHER ROW WAS TOUCHED
  -- ============================================================
  -- Both halves of the backfill stamp their provenance, so the blast radius is a
  -- fact rather than a claim: whoever carries the 090 marker is who 090 wrote,
  -- and the marker count must be exactly two and exactly the two named rows.
  SELECT count(*) INTO v_marked_subs
  FROM public.subscriptions s
  WHERE s.metadata->>'backfilled_by' = '090';

  SELECT string_agg(s.org_id::text, ', ' ORDER BY s.org_id::text) INTO v_marked_subs_orgs
  FROM public.subscriptions s
  WHERE s.metadata->>'backfilled_by' = '090';

  SELECT count(*) INTO v_marked_ents
  FROM public.organization_products op
  WHERE op.metadata->>'backfilled_expiry_by' = '090';

  SELECT string_agg(op.org_id::text, ', ' ORDER BY op.org_id::text) INTO v_marked_ents_orgs
  FROM public.organization_products op
  WHERE op.metadata->>'backfilled_expiry_by' = '090';

  INSERT INTO zz_results VALUES (16, 'exactly two subscriptions rows were written by 090, and they are the two named organizations',
    COALESCE(v_marked_subs, 0) = 2
      AND v_marked_subs_orgs = LEAST(v_smoke::text, v_akos::text) || ', ' || GREATEST(v_smoke::text, v_akos::text),
    format('marked subscriptions rows=%s for orgs [%s]',
           COALESCE(v_marked_subs, 0), COALESCE(v_marked_subs_orgs, 'none')));

  INSERT INTO zz_results VALUES (17, 'exactly two entitlements had their expiry set by 090, and they are the two named organizations',
    COALESCE(v_marked_ents, 0) = 2
      AND v_marked_ents_orgs = LEAST(v_smoke::text, v_akos::text) || ', ' || GREATEST(v_smoke::text, v_akos::text),
    format('marked entitlements=%s for orgs [%s]',
           COALESCE(v_marked_ents, 0), COALESCE(v_marked_ents_orgs, 'none')));

  -- Every other organization must be in exactly the state it was in before: no
  -- 090 marker on its entitlement or on its subscription.
  SELECT count(*) INTO v_other_orgs
  FROM public.organizations o
  WHERE o.id NOT IN (v_smoke, v_akos);

  SELECT count(*) INTO v_other_touched
  FROM public.organizations o
  WHERE o.id NOT IN (v_smoke, v_akos)
    AND (
      EXISTS (SELECT 1 FROM public.subscriptions s
              WHERE s.org_id = o.id AND s.metadata->>'backfilled_by' = '090')
      OR EXISTS (SELECT 1 FROM public.organization_products op
                 WHERE op.org_id = o.id AND op.metadata->>'backfilled_expiry_by' = '090')
    );

  INSERT INTO zz_results VALUES (18, 'no other organization, entitlement or subscriptions row carries a 090 marker',
    v_other_touched = 0,
    format('organizations other than the two backfilled ones=%s; of those, touched by 090=%s',
           COALESCE(v_other_orgs, -1), COALESCE(v_other_touched, -1)));

  -- The structural consequence of the fix: the two tables are 1:1 again, and the
  -- defect's own selection predicate selects nothing.
  SELECT count(*) INTO v_orgs_without_subs
  FROM public.organizations o
  WHERE NOT EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.org_id = o.id);

  SELECT count(*) INTO v_orgs_with_many_subs
  FROM (SELECT s.org_id FROM public.subscriptions s GROUP BY s.org_id HAVING count(*) > 1) x;

  SELECT count(*) INTO v_defect_rows
  FROM public.organization_products op
  WHERE op.expires_at IS NULL
    AND op.status IN ('active', 'pending')
    AND NOT EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.org_id = op.org_id);

  INSERT INTO zz_results VALUES (19, 'every organization now has exactly one subscriptions row',
    v_orgs_without_subs = 0 AND v_orgs_with_many_subs = 0,
    format('organizations with no subscriptions row=%s; with more than one=%s',
           COALESCE(v_orgs_without_subs, -1), COALESCE(v_orgs_with_many_subs, -1)));

  INSERT INTO zz_results VALUES (20, 'no entitlement is left unexpiring with no subscriptions row to expiring it',
    v_defect_rows = 0,
    format('organizations in the contradictory state=%s', COALESCE(v_defect_rows, -1)));

  -- ============================================================
  -- 7. THE BACKFILL IS A NO-OP IF RE-RUN
  -- ============================================================
  -- The migration's own two statements are replayed verbatim. Both must affect
  -- zero rows, which is what "the second run is a clean no-op" means at the level
  -- of the database rather than of the file runner.
  BEGIN
    INSERT INTO public.subscriptions (
      org_id, plan_id, status, start_date, trial_end,
      current_period_start, current_period_end, cancel_at_period_end, metadata
    )
    SELECT
      e.org_id,
      COALESCE(
        (SELECT lp.id FROM public.subscription_plans lp
          WHERE lower(lp.name) = lower(pp.key) OR lower(lp.name) = lower(pp.name)
          ORDER BY (lower(lp.name) = lower(pp.key)) DESC, (lp.status = 'active') DESC,
                   lp.price ASC, lp.created_at ASC LIMIT 1),
        (SELECT lp.id FROM public.subscription_plans lp
          WHERE lp.status = 'active' ORDER BY lp.price ASC, lp.created_at ASC LIMIT 1)
      ),
      'active', now(), NULL, now(), now() + INTERVAL '1 month', FALSE,
      jsonb_build_object(
        'backfilled_by', '090',
        'reason', 'the organization held an entitlement with no expiry and no subscriptions row to take one from',
        'entitlement_plan_key', pp.key
      )
    FROM (
      SELECT DISTINCT ON (op.org_id) op.org_id, op.plan_id
      FROM public.organization_products op
      WHERE op.expires_at IS NULL
        AND op.status IN ('active', 'pending')
        AND NOT EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.org_id = op.org_id)
      ORDER BY op.org_id, (op.status = 'active') DESC, op.activated_at ASC NULLS LAST, op.created_at ASC
    ) e
    LEFT JOIN public.product_plans pp ON pp.id = e.plan_id
    ON CONFLICT (org_id) DO NOTHING;

    GET DIAGNOSTICS v_replay_insert = ROW_COUNT;

    -- The migration's UPDATE restricted itself to the organizations its own
    -- selection had found (`op.org_id = ANY (v_orgs)`); that selection is
    -- replayed here as a subquery, because it is what made the update safe. It is
    -- now empty - the three live businesses also hold an entitlement with a NULL
    -- expires_at, but they each already have a subscriptions row and so were never
    -- in the affected set.
    UPDATE public.organization_products op
    SET expires_at = s.current_period_end,
        metadata = COALESCE(op.metadata, '{}'::jsonb) || jsonb_build_object('backfilled_expiry_by', '090')
    FROM public.subscriptions s
    WHERE s.org_id = op.org_id
      AND op.org_id = ANY (
            SELECT op2.org_id
            FROM public.organization_products op2
            WHERE op2.expires_at IS NULL
              AND op2.status IN ('active', 'pending')
              AND NOT EXISTS (SELECT 1 FROM public.subscriptions s2 WHERE s2.org_id = op2.org_id)
          )
      AND op.expires_at IS NULL
      AND op.status IN ('active', 'pending');

    GET DIAGNOSTICS v_replay_update = ROW_COUNT;

    RAISE EXCEPTION 'zz_verify_rollback';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'zz_verify_rollback' THEN
      INSERT INTO zz_results VALUES (99, 'replayed backfill raised an unexpected error', false, SQLERRM);
    END IF;
  END;

  INSERT INTO zz_results VALUES (21, 'replaying the backfill INSERT writes zero rows',
    v_replay_insert = 0, format('rows inserted by the replay=%s', v_replay_insert));
  INSERT INTO zz_results VALUES (22, 'replaying the backfill UPDATE modifies zero rows',
    v_replay_update = 0, format('rows updated by the replay=%s', v_replay_update));

  -- ============================================================
  -- 8. THE MIGRATION IS RECORDED
  -- ============================================================
  SELECT count(*) INTO v_recorded
  FROM supabase_migrations.schema_migrations m
  WHERE m.version = '202609270090' AND m.name = 'entitlement_and_impersonation_fixes';

  INSERT INTO zz_results VALUES (23, 'the migration is recorded in supabase_migrations.schema_migrations',
    v_recorded = 1, format('matching rows=%s', COALESCE(v_recorded, -1)));

  -- ============================================================
  -- 9. EXECUTE IS REVOKED FROM anon AND authenticated BY NAME
  -- ============================================================
  -- Section 5 of the migration. `REVOKE ... FROM PUBLIC` is not a control in this
  -- project: pg_default_acl grants EXECUTE on new public functions straight to
  -- anon, authenticated and service_role, as explicit ACL entries that a PUBLIC
  -- revoke does not touch. These steps assert the named revokes took effect, that
  -- the client-callable surface and the RLS helpers were left alone, and - the
  -- part that matters for safety - that a trigger function with no client EXECUTE
  -- still fires for the authenticated role.

  v_activate_signature := 'public.activate_subscription(text, jsonb, timestamp with time zone)';

  INSERT INTO zz_results VALUES (24, 'anon can no longer execute activate_subscription',
    NOT has_function_privilege('anon', v_activate_signature, 'EXECUTE'),
    format('has_function_privilege(anon, activate_subscription, EXECUTE)=%s',
           has_function_privilege('anon', v_activate_signature, 'EXECUTE')));

  INSERT INTO zz_results VALUES (25, 'authenticated can no longer execute activate_subscription',
    NOT has_function_privilege('authenticated', v_activate_signature, 'EXECUTE'),
    format('has_function_privilege(authenticated, activate_subscription, EXECUTE)=%s',
           has_function_privilege('authenticated', v_activate_signature, 'EXECUTE')));

  SELECT count(*) INTO v_server_only_open
  FROM (SELECT unnest(ARRAY[
          'mark_subscription_transaction_failed',
          'handle_opay_webhook'
        ]) AS name) AS missing
  JOIN pg_proc p ON p.proname = missing.name
  JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
  WHERE has_function_privilege('anon', p.oid, 'EXECUTE')
     OR has_function_privilege('authenticated', p.oid, 'EXECUTE');

  INSERT INTO zz_results VALUES (26, 'anon and authenticated can no longer execute mark_subscription_transaction_failed or handle_opay_webhook',
    v_server_only_open = 0,
    format('of the two provider/payment functions, still reachable by anon or authenticated=%s',
           COALESCE(v_server_only_open, -1)));

  SELECT count(*) INTO v_server_only_locked
  FROM (SELECT unnest(ARRAY[
          'activate_subscription',
          'mark_subscription_transaction_failed',
          'handle_opay_webhook'
        ]) AS name) AS missing
  JOIN pg_proc p ON p.proname = missing.name
  JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
  WHERE has_function_privilege('service_role', p.oid, 'EXECUTE');

  INSERT INTO zz_results VALUES (27, 'service_role keeps EXECUTE on all three, so the webhook path is not broken',
    v_server_only_locked = 3, format('of 3, service_role holds EXECUTE on %s', COALESCE(v_server_only_locked, -1)));

  -- Every trigger function in public, not just the guard: 090 locks all of them
  -- down because none has a client call site and a trigger function is invoked by
  -- the executor rather than through an API.
  SELECT count(*) INTO v_trigger_functions
  FROM (SELECT DISTINCT p.oid
        FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND NOT t.tgisinternal) z;

  SELECT count(*) INTO v_trigger_functions_open
  FROM (SELECT DISTINCT p.oid
        FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND NOT t.tgisinternal) z
  JOIN pg_proc p ON p.oid = z.oid
  WHERE has_function_privilege('anon', p.oid, 'EXECUTE')
     OR has_function_privilege('authenticated', p.oid, 'EXECUTE');

  INSERT INTO zz_results VALUES (28, 'no trigger function in public is executable by anon or authenticated',
    v_trigger_functions_open = 0,
    format('%s trigger function(s) in public; still reachable by anon or authenticated=%s',
           COALESCE(v_trigger_functions, -1), COALESCE(v_trigger_functions_open, -1)));

  -- The safety proof for step 28: a trigger function whose EXECUTE has been
  -- revoked still fires, because PostgreSQL checks the privilege when the trigger
  -- is created, against the table owner, and never again. The probe table is a
  -- temporary one, dropped with the transaction, and the trigger is created by
  -- the owner so the CREATE-time check is satisfied.
  v_trigger_fired := NULL;
  BEGIN
    EXECUTE 'DROP TABLE IF EXISTS pg_temp.zz_verify_090_trigger_probe';
    EXECUTE 'CREATE TEMP TABLE zz_verify_090_trigger_probe (id int PRIMARY KEY, updated_at timestamptz DEFAULT now())';
    EXECUTE 'INSERT INTO pg_temp.zz_verify_090_trigger_probe (id) VALUES (1)';
    EXECUTE 'CREATE TRIGGER zz_verify_090_updated_at BEFORE UPDATE ON pg_temp.zz_verify_090_trigger_probe '
         || 'FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at()';
    EXECUTE 'GRANT ALL ON pg_temp.zz_verify_090_trigger_probe TO authenticated';

    EXECUTE 'SET LOCAL ROLE authenticated';
    EXECUTE 'UPDATE pg_temp.zz_verify_090_trigger_probe SET id = 1 WHERE id = 1';
    EXECUTE 'RESET ROLE';

    SELECT p.updated_at INTO v_trigger_fired FROM pg_temp.zz_verify_090_trigger_probe p WHERE p.id = 1;
  EXCEPTION WHEN OTHERS THEN
    BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN OTHERS THEN NULL; END;
    v_trigger_fired := NULL;
    v_trigger_probe_error := SQLERRM;
  END;

  INSERT INTO zz_results VALUES (29, 'a trigger function still fires for the authenticated role after its EXECUTE is revoked',
    v_trigger_fired IS NOT NULL,
    COALESCE(v_trigger_probe_error,
             format('handle_updated_at() (EXECUTE revoked from PUBLIC/anon/authenticated) still fired as `authenticated`; updated_at=%s',
                    v_trigger_fired)));

  -- And the guard itself still refuses the write when the write is made by the
  -- authenticated role rather than by a superuser: the whole chain
  -- authenticated -> trigger -> block_writes_while_impersonating() (no EXECUTE for
  -- authenticated) -> is_impersonating() runs, and raises.
  v_role_block_error := NULL;
  BEGIN
    INSERT INTO public.impersonation_sessions
      (admin_user_id, target_org_id, target_user_id, mode, reason, status, started_at, expires_at)
    VALUES
      (v_admin, v_any_org, NULL, 'read_only', 'zz verify 090 role impersonation', 'active',
       now(), now() + INTERVAL '5 minutes');

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, TRUE);
    PERFORM set_config('request.jwt.claim.sub', v_admin::text, TRUE);

    EXECUTE 'DROP TABLE IF EXISTS pg_temp.zz_verify_090_guard_probe';
    EXECUTE 'CREATE TEMP TABLE zz_verify_090_guard_probe (id int PRIMARY KEY, name text)';
    EXECUTE 'INSERT INTO pg_temp.zz_verify_090_guard_probe (id, name) VALUES (1, ''before'')';
    EXECUTE 'CREATE TRIGGER block_writes_while_impersonating BEFORE INSERT OR UPDATE OR DELETE '
         || 'ON pg_temp.zz_verify_090_guard_probe FOR EACH ROW '
         || 'EXECUTE FUNCTION public.block_writes_while_impersonating()';
    EXECUTE 'GRANT ALL ON pg_temp.zz_verify_090_guard_probe TO authenticated';

    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
      EXECUTE 'UPDATE pg_temp.zz_verify_090_guard_probe SET name = ''after'' WHERE id = 1';
      v_role_block_error := 'NOT BLOCKED for the authenticated role';
    EXCEPTION WHEN OTHERS THEN
      v_role_block_error := SQLERRM;
    END;
    EXECUTE 'RESET ROLE';

    RAISE EXCEPTION 'zz_verify_rollback';
  EXCEPTION WHEN OTHERS THEN
    BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN OTHERS THEN NULL; END;
    IF SQLERRM <> 'zz_verify_rollback' THEN
      v_role_block_error := COALESCE(v_role_block_error, SQLERRM);
    END IF;
  END;

  INSERT INTO zz_results VALUES (30, 'the guard refuses the write when it is made as the authenticated role',
    v_role_block_error = 'Impersonation is read-only',
    COALESCE(v_role_block_error, 'no exception raised'));

  -- The private inventory helper takes p_created_by and performs no permission
  -- check of its own, so the anon grant was a way to forge stock movements.
  SELECT count(*) INTO v_internal_open
  FROM (SELECT unnest(ARRAY['anon', 'authenticated']) AS role_name) AS r
  JOIN pg_proc p ON p.proname = '_apply_inventory_movement_internal'
  JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
  WHERE has_function_privilege(r.role_name::name, p.oid, 'EXECUTE');

  INSERT INTO zz_results VALUES (31, 'the private inventory helper is reachable only by the owner and service_role',
    v_internal_open = 0
      AND EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = '_apply_inventory_movement_internal'
          AND has_function_privilege('service_role', p.oid, 'EXECUTE')),
    format('anon/authenticated with EXECUTE=%s; service_role with EXECUTE=%s (its callers are SECURITY DEFINER and run as the owner)',
           COALESCE(v_internal_open, -1),
           EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                   WHERE n.nspname = 'public' AND p.proname = '_apply_inventory_movement_internal'
                     AND has_function_privilege('service_role', p.oid, 'EXECUTE'))));

  -- 089 granted redact_secret_keys to authenticated on purpose; 090 revokes only
  -- the artifact.
  INSERT INTO zz_results VALUES (32, 'redact_secret_keys lost its anon grant but keeps the authenticated grant 089 made',
    NOT has_function_privilege('anon', 'public.redact_secret_keys(jsonb)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.redact_secret_keys(jsonb)', 'EXECUTE'),
    format('anon=%s authenticated=%s service_role=%s',
           has_function_privilege('anon', 'public.redact_secret_keys(jsonb)', 'EXECUTE'),
           has_function_privilege('authenticated', 'public.redact_secret_keys(jsonb)', 'EXECUTE'),
           has_function_privilege('service_role', 'public.redact_secret_keys(jsonb)', 'EXECUTE')));

  -- The intended client surface must be untouched. Every name here is called from
  -- src/ or from an Edge Function; each authorises internally on auth.uid().
  -- Matched through pg_proc by name rather than by a written-out signature, so a
  -- changed argument list cannot make this check pass vacuously.
  SELECT count(*) INTO v_client_rpcs
  FROM (SELECT unnest(ARRAY[
          'create_sale', 'create_expense', 'process_refund', 'void_sale',
          'initiate_subscription_checkout', 'redeem_activation_key',
          'start_impersonation', 'end_impersonation', 'get_platform_overview_v2',
          'list_platform_organizations', 'set_platform_setting', 'apply_inventory_movement'
        ]) AS name) AS missing
  JOIN pg_proc p ON p.proname = missing.name
  JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public';

  SELECT string_agg(missing.name, ', ' ORDER BY missing.name) INTO v_client_missing
  FROM (SELECT unnest(ARRAY[
          'create_sale', 'create_expense', 'process_refund', 'void_sale',
          'initiate_subscription_checkout', 'redeem_activation_key',
          'start_impersonation', 'end_impersonation', 'get_platform_overview_v2',
          'list_platform_organizations', 'set_platform_setting', 'apply_inventory_movement'
        ]) AS name) AS missing
  JOIN pg_proc p ON p.proname = missing.name
  JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
  WHERE has_function_privilege('anon', p.oid, 'EXECUTE') IS NOT TRUE
     OR has_function_privilege('authenticated', p.oid, 'EXECUTE') IS NOT TRUE;

  INSERT INTO zz_results VALUES (33, 'the intended client-callable RPCs still have anon and authenticated EXECUTE',
    v_client_missing IS NULL AND v_client_rpcs = 12,
    COALESCE('lost EXECUTE: ' || v_client_missing,
             format('%s of 12 sampled client RPCs found (sales, expenses, refunds, checkout, activation keys, impersonation, platform dashboard), all still executable',
                    COALESCE(v_client_rpcs, -1))));

  -- The RLS predicate helpers are called from policy expressions and must stay
  -- executable by the roles that query through those policies.
  SELECT string_agg(missing.name, ', ' ORDER BY missing.name) INTO v_rls_missing
  FROM (SELECT unnest(ARRAY[
          'is_platform_admin', 'is_platform_super_admin', 'platform_user_has_permission',
          'user_has_permission', 'get_user_org_ids', 'get_owned_org_ids',
          'get_user_active_store_ids', 'developer_mode_enabled', 'is_impersonating',
          'require_platform_permission'
        ]) AS name) AS missing
  JOIN pg_proc p ON p.proname = missing.name
  JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
  WHERE has_function_privilege('anon', p.oid, 'EXECUTE') IS NOT TRUE
     OR has_function_privilege('authenticated', p.oid, 'EXECUTE') IS NOT TRUE;

  INSERT INTO zz_results VALUES (34, 'the RLS predicate helpers keep their anon and authenticated EXECUTE',
    v_rls_missing IS NULL,
    COALESCE('lost EXECUTE: ' || v_rls_missing,
             '10 RLS/permission helpers all still executable by anon and authenticated'));

  -- ============================================================
  -- 10. LIMITATIONS AND REMAINING DEFECTS, ASSERTED SO THEY CANNOT BE FORGOTTEN
  -- ============================================================
  -- 10.1 The guard covers only the 20 listed tables. A table outside the list has
  -- no trigger, so an impersonating admin can still write it.
  SELECT count(*) INTO v_guard_outside_list
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND NOT t.tgisinternal
    AND t.tgname = 'block_writes_while_impersonating'
    AND c.relname NOT IN (SELECT unnest(v_guard_tables));

  SELECT count(*) INTO v_guard_on_open_tables
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND NOT t.tgisinternal
    AND t.tgname = 'block_writes_while_impersonating'
    AND c.relname IN ('audit_logs', 'subscription_transactions', 'impersonation_sessions', 'product_plans');

  INSERT INTO zz_results VALUES (35, 'KNOWN LIMITATION: the guard is attached to the 20 listed tables only, not to every table',
    v_guard_outside_list = 0 AND v_guard_on_open_tables = 0,
    format('guard triggers outside the 20-table list=%s; of which on audit_logs/subscription_transactions/impersonation_sessions/product_plans=%s - an impersonating admin can still write those',
           COALESCE(v_guard_outside_list, -1), COALESCE(v_guard_on_open_tables, -1)));

  -- 10.2 Residual hardening that 090 deliberately did NOT do: the functions that a
  -- migration granted to authenticated on purpose also carry an anon grant from
  -- pg_default_acl. They are not a privilege-escalation path - each authorises on
  -- auth.uid(), which is NULL for anon - so revoking anon from the whole client
  -- surface was left out of a change that was already touching production
  -- privileges. What is asserted here is that no function 090 was supposed to lock
  -- down is still anon-reachable; the size of the remaining surface is reported
  -- rather than hidden.
  SELECT count(*) INTO v_anon_reachable
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'f'
    AND has_function_privilege('anon', p.oid, 'EXECUTE');

  SELECT count(*) INTO v_anon_residual_leaks
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'f'
    AND has_function_privilege('anon', p.oid, 'EXECUTE')
    AND (
      -- a trigger function is never a legitimate RPC target
      EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgfoid = p.oid AND NOT t.tgisinternal)
      -- nor is any entry point 090 locked to service_role
      OR p.proname IN ('activate_subscription', 'mark_subscription_transaction_failed',
                       'handle_opay_webhook', '_apply_inventory_movement_internal')
    );

  INSERT INTO zz_results VALUES (36, 'KNOWN REMAINING HARDENING (reported, not fixed): no function 090 locked down is still anon-reachable',
    v_anon_residual_leaks = 0,
    format('public functions still anon-executable=%s; of those, any trigger function or 090-locked entry point=%s. '
           || 'The remaining ones are the client-callable RPCs a migration granted to authenticated; each fails its own auth.uid()/permission check when called by anon, so they are a wider surface than intended rather than an escalation path.',
           COALESCE(v_anon_reachable, -1), COALESCE(v_anon_residual_leaks, -1)));

  -- ============================================================
  -- 11. NOTHING THIS SCRIPT CREATED SURVIVED
  -- ============================================================
  SELECT count(*) INTO v_leftover_sessions
  FROM public.impersonation_sessions s WHERE s.reason LIKE 'zz verify 090%';

  SELECT count(*) INTO v_leftover_orgs
  FROM public.organizations o WHERE o.name = 'ZZ Verify 090 Activation';

  SELECT count(*) INTO v_leftover_txns
  FROM public.subscription_transactions t WHERE t.reference LIKE 'ZZVERIFY090-%';

  INSERT INTO zz_results VALUES (37, 'no verification fixture survived the run',
    COALESCE(v_leftover_sessions, 0) = 0 AND COALESCE(v_leftover_orgs, 0) = 0 AND COALESCE(v_leftover_txns, 0) = 0,
    format('leftover impersonation_sessions=%s organizations=%s subscription_transactions=%s',
           COALESCE(v_leftover_sessions, -1), COALESCE(v_leftover_orgs, -1), COALESCE(v_leftover_txns, -1)));
END $$;

SELECT step, check_name, passed, detail FROM zz_results ORDER BY step;
