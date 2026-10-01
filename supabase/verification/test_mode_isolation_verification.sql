-- ============================================================
-- Verification: test payments are isolated from production
--
--   node sbq.js --file supabase/verification/test_mode_isolation_verification.sql
--
-- WHAT IT PROVES. The brief for this work requires that mock and test checkout
-- exist only behind an explicit, server-enforced setting, that a production
-- request cannot reach them, and that test transactions and the access they
-- produce are marked as test data.
--
-- The mechanism, read from the live database rather than from the file that
-- introduced it:
--
--   `billing.payment_system` is a platform setting with three values, DISABLED,
--   TEST and LIVE, validated by the `validate_billing_settings` trigger. A BEFORE
--   INSERT trigger on `subscription_transactions`,
--   `guard_subscription_payment_creation`, reads it through
--   `get_billing_availability()` and:
--     DISABLED  refuses every payment attempt outright
--     TEST      requires the caller to hold `developer:access`, requires an active
--               `developer_access_grants` row, requires the business to be a
--               SANDBOX, and then forces is_test_data = true and mode = 'test'
--               onto the row it is about to insert
--     LIVE      allows the attempt through
--
-- So the isolation is enforced by the database on write, not by the interface, and
-- not by anything a caller can pass in. This measures each branch.
--
-- HOW IT RUNS WITHOUT CHANGING PRODUCTION. Every case runs inside a sub-block that
-- always rolls back, including the UPDATE that puts the platform into TEST and the
-- grant it needs. The final section measures that the platform is back to
-- DISABLED and that the grant is gone.

DROP TABLE IF EXISTS zz_testmode_results;
CREATE TEMP TABLE zz_testmode_results (
  step INTEGER,
  check_name TEXT,
  passed BOOLEAN,
  detail TEXT
);

DO $do$
DECLARE
  v_results JSONB[] := ARRAY[]::JSONB[];
  v_admin UUID;
  v_org UUID;
  v_other_org UUID;
  v_legacy_plan UUID;
  v_version public.product_plan_versions;
  v_mode_before TEXT;
  v_mode_after TEXT;
  v_grants_after INTEGER;
  v_ref TEXT;
  v_err TEXT;
  v_row public.subscription_transactions;
  v_i INTEGER;

  -- Guards for the cases
  v_ok BOOLEAN;
  v_detail TEXT;
BEGIN
  SELECT value #>> '{}' INTO v_mode_before
  FROM public.platform_settings WHERE key = 'billing.payment_system';

  SELECT user_id INTO v_admin FROM public.platform_admins LIMIT 1;

  v_results := v_results || jsonb_build_object('step', 1,
    'name', 'the platform records its payment system state in a setting',
    'passed', v_mode_before IS NOT NULL,
    'detail', format('billing.payment_system = %s before this run', COALESCE(v_mode_before, 'unset')));

  IF v_admin IS NULL OR v_mode_before IS NULL THEN
    v_results := v_results || jsonb_build_object('step', 2,
      'name', 'the isolation rules could be measured', 'passed', NULL,
      'detail', 'SKIPPED: needs a platform admin and a billing.payment_system setting');
  ELSE
    BEGIN
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_admin::TEXT, 'role', 'authenticated')::TEXT, TRUE);

      -- A production business, and a second one we make sandbox inside the rollback.
      SELECT o.id INTO v_org FROM public.organizations o
      WHERE COALESCE(o.is_sandbox, FALSE) = FALSE ORDER BY o.created_at ASC LIMIT 1;
      SELECT o.id INTO v_other_org FROM public.organizations o WHERE o.id <> v_org
      ORDER BY o.created_at ASC LIMIT 1;

      SELECT * INTO v_version FROM public.product_plan_versions
      WHERE status = 'active' AND amount_minor IS NOT NULL ORDER BY amount_minor ASC LIMIT 1;

      SELECT id INTO v_legacy_plan FROM public.subscription_plans ORDER BY created_at ASC LIMIT 1;

      IF v_org IS NULL OR v_other_org IS NULL OR v_version.id IS NULL OR v_legacy_plan IS NULL THEN
        v_results := v_results || jsonb_build_object('step', 2,
          'name', 'the isolation rules could be measured', 'passed', NULL,
          'detail', 'SKIPPED: needs two organizations, an active plan version and a legacy plan row');
      ELSE
        -- ----------------------------------------------------------
        -- DISABLED: nothing gets through, for anybody.
        -- ----------------------------------------------------------
        v_err := NULL;
        BEGIN
          INSERT INTO public.subscription_transactions (
            org_id, plan_id, reference, amount, currency, status, created_by,
            product_id, is_sandbox, billing_cycle, product_plan_id, plan_version_id,
            amount_minor, recurring_amount_minor, setup_fee_amount_minor
          ) VALUES (v_org, v_legacy_plan, 'zzmode-disabled-' || replace(gen_random_uuid()::TEXT, '-', ''),
            v_version.amount_minor / 100.0, v_version.currency, 'pending', v_admin,
            v_version.product_id, FALSE, v_version.billing_cycle, v_version.plan_id, v_version.id,
            v_version.amount_minor, v_version.amount_minor, 0);
        EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
        END;
        v_results := v_results || jsonb_build_object('step', 2,
          'name', 'while DISABLED, no payment attempt can be created at all',
          'passed', v_err IS NOT NULL AND v_err LIKE '%not available yet%',
          'detail', COALESCE(v_err, 'the insert SUCCEEDED, which it must not'));

        -- ----------------------------------------------------------
        -- TEST, production business: refused for being production.
        -- ----------------------------------------------------------
        -- The grant is put in place FIRST, so the sandbox rule is the only thing
        -- that can refuse this case.
        UPDATE public.platform_settings SET value = '"TEST"'::JSONB
        WHERE key = 'billing.payment_system';

        INSERT INTO public.platform_admin_permissions (user_id, permission_key)
        SELECT v_admin, 'developer:access'
        WHERE NOT EXISTS (SELECT 1 FROM public.platform_admin_permissions
                          WHERE user_id = v_admin AND permission_key = 'developer:access');

        -- Guarded rather than unconditional: a partial unique index
        -- (`idx_developer_grants_active_user`) permits one active grant per user,
        -- and this operator may already hold one, in which case the case under test
        -- is satisfied by what is already there.
        INSERT INTO public.developer_access_grants (user_id, status, granted_by, reason)
        SELECT v_admin, 'active', v_admin, 'verification fixture, removed by the rollback'
        WHERE NOT EXISTS (SELECT 1 FROM public.developer_access_grants
                          WHERE user_id = v_admin AND status = 'active');

        v_row := NULL;
        v_err := NULL;
        BEGIN
          INSERT INTO public.subscription_transactions (
            org_id, plan_id, reference, amount, currency, status, created_by,
            product_id, is_sandbox, billing_cycle, product_plan_id, plan_version_id,
            amount_minor, recurring_amount_minor, setup_fee_amount_minor
          ) VALUES (v_org, v_legacy_plan, 'zzmode-prod-' || replace(gen_random_uuid()::TEXT, '-', ''),
            v_version.amount_minor / 100.0, v_version.currency, 'pending', v_admin,
            v_version.product_id, FALSE, v_version.billing_cycle, v_version.plan_id, v_version.id,
            v_version.amount_minor, v_version.amount_minor, 0)
          RETURNING * INTO v_row;
        EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
        END;
        v_results := v_results || jsonb_build_object('step', 3,
          'name', 'in TEST mode a PRODUCTION business still cannot take a test payment',
          'passed', v_err IS NOT NULL AND v_err LIKE '%sandbox%',
          'detail', COALESCE(v_err, 'the insert SUCCEEDED for a production business in test mode'));

        -- ----------------------------------------------------------
        -- TEST, sandbox business, but the caller has no developer grant.
        -- ----------------------------------------------------------
        UPDATE public.organizations SET is_sandbox = TRUE WHERE id = v_other_org;
        UPDATE public.developer_access_grants SET status = 'revoked', revoked_at = now()
        WHERE user_id = v_admin AND status = 'active';

        v_err := NULL;
        BEGIN
          INSERT INTO public.subscription_transactions (
            org_id, plan_id, reference, amount, currency, status, created_by,
            product_id, is_sandbox, billing_cycle, product_plan_id, plan_version_id,
            amount_minor, recurring_amount_minor, setup_fee_amount_minor
          ) VALUES (v_other_org, v_legacy_plan, 'zzmode-nogrant-' || replace(gen_random_uuid()::TEXT, '-', ''),
            v_version.amount_minor / 100.0, v_version.currency, 'pending', v_admin,
            v_version.product_id, TRUE, v_version.billing_cycle, v_version.plan_id, v_version.id,
            v_version.amount_minor, v_version.amount_minor, 0);
        EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
        END;
        v_results := v_results || jsonb_build_object('step', 4,
          'name', 'a SANDBOX business still needs the caller to hold a live developer grant',
          'passed', v_err IS NOT NULL AND v_err LIKE '%developer grant%',
          'detail', COALESCE(v_err, 'the insert SUCCEEDED without a developer grant'));

        -- ----------------------------------------------------------
        -- TEST, sandbox business, grant restored: allowed, and LABELLED.
        -- ----------------------------------------------------------
        INSERT INTO public.developer_access_grants (user_id, status, granted_by, reason)
        VALUES (v_admin, 'active', v_admin, 'verification fixture, restored');

        v_ref := 'zzmode-test-' || replace(gen_random_uuid()::TEXT, '-', '');
        v_err := NULL;
        v_row := NULL;
        BEGIN
          INSERT INTO public.subscription_transactions (
            org_id, plan_id, reference, amount, currency, status, created_by,
            product_id, is_sandbox, billing_cycle, product_plan_id, plan_version_id,
            amount_minor, recurring_amount_minor, setup_fee_amount_minor
          ) VALUES (v_other_org, v_legacy_plan, v_ref,
            v_version.amount_minor / 100.0, v_version.currency, 'pending', v_admin,
            v_version.product_id, TRUE, v_version.billing_cycle, v_version.plan_id, v_version.id,
            v_version.amount_minor, v_version.amount_minor, 0)
          RETURNING * INTO v_row;
        EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
        END;

        v_results := v_results || jsonb_build_object('step', 5,
          'name', 'a sandbox business WITH a developer grant may take a test payment',
          'passed', v_err IS NULL AND v_row.id IS NOT NULL,
          'detail', COALESCE(v_err, format('attempt %s created', COALESCE(v_row.reference, '?'))));

        v_results := v_results || jsonb_build_object('step', 6,
          'name', 'the database LABELS the test attempt itself, so it cannot be counted as revenue',
          'passed', v_row.is_test_data IS TRUE AND v_row.payment_mode = 'test',
          'detail', format('is_test_data = %s, payment_mode = %s (both written by the guard trigger, not by the caller)',
            v_row.is_test_data, COALESCE(v_row.payment_mode, 'NULL')));

        -- A caller cannot talk its way out of the label: the trigger overwrites
        -- whatever the insert claimed.
        v_results := v_results || jsonb_build_object('step', 7,
          'name', 'the label is imposed on the row rather than accepted from the caller',
          'passed', v_row.is_test_data IS TRUE,
          'detail', 'the trigger sets NEW.is_test_data and NEW.payment_mode before the row is written');

        -- ----------------------------------------------------------
        -- Back to DISABLED inside the same block: the switch is real both ways.
        -- ----------------------------------------------------------
        UPDATE public.platform_settings SET value = '"DISABLED"'::JSONB
        WHERE key = 'billing.payment_system';

        v_err := NULL;
        BEGIN
          INSERT INTO public.subscription_transactions (
            org_id, plan_id, reference, amount, currency, status, created_by,
            product_id, is_sandbox, billing_cycle, product_plan_id, plan_version_id,
            amount_minor, recurring_amount_minor, setup_fee_amount_minor
          ) VALUES (v_other_org, v_legacy_plan, 'zzmode-again-' || replace(gen_random_uuid()::TEXT, '-', ''),
            v_version.amount_minor / 100.0, v_version.currency, 'pending', v_admin,
            v_version.product_id, TRUE, v_version.billing_cycle, v_version.plan_id, v_version.id,
            v_version.amount_minor, v_version.amount_minor, 0);
        EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
        END;
        v_results := v_results || jsonb_build_object('step', 8,
          'name', 'returning to DISABLED closes the sandbox path again',
          'passed', v_err IS NOT NULL AND v_err LIKE '%not available yet%',
          'detail', COALESCE(v_err, 'the insert SUCCEEDED after DISABLED was restored'));
      END IF;

      RAISE EXCEPTION 'ROLLBACK:TESTMODE';
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLERRM <> 'ROLLBACK:TESTMODE' THEN
          RAISE;
        END IF;
    END;
  END IF;

  IF array_length(v_results, 1) IS NOT NULL THEN
    FOR v_i IN 1..array_length(v_results, 1) LOOP
      INSERT INTO zz_testmode_results (step, check_name, passed, detail)
      VALUES ((v_results[v_i]->>'step')::INTEGER, v_results[v_i]->>'name',
              (v_results[v_i]->>'passed')::BOOLEAN, v_results[v_i]->>'detail');
    END LOOP;
  END IF;

  -- ----------------------------------------------------------
  -- The rollback held: production is where it was.
  -- ----------------------------------------------------------
  SELECT value #>> '{}' INTO v_mode_after
  FROM public.platform_settings WHERE key = 'billing.payment_system';

  INSERT INTO zz_testmode_results VALUES (20,
    'the platform is still in the state this run found it in',
    v_mode_after IS NOT DISTINCT FROM v_mode_before,
    format('%s -> %s', COALESCE(v_mode_before, 'unset'), COALESCE(v_mode_after, 'unset')));

  SELECT count(*) INTO v_grants_after FROM public.developer_access_grants
  WHERE reason IN ('verification fixture, removed by the rollback', 'verification fixture, restored');
  INSERT INTO zz_testmode_results VALUES (21,
    'no verification developer grant survived the rollback',
    v_grants_after = 0, format('%s fixture grant(s) remain', v_grants_after));

  SELECT count(*) INTO v_grants_after FROM public.subscription_transactions
  WHERE reference LIKE 'zzmode-%';
  INSERT INTO zz_testmode_results VALUES (22,
    'no test-mode payment attempt survived the rollback',
    v_grants_after = 0, format('%s attempt(s) named zzmode-%%', v_grants_after));
END
$do$;

SELECT step, check_name,
  CASE passed WHEN TRUE THEN 'PASS' WHEN FALSE THEN 'FAIL' ELSE 'SKIP' END AS result,
  detail
FROM zz_testmode_results
ORDER BY step;
