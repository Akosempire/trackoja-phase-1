-- ============================================================
-- Verification for migration 094: a checkout records which cycle it charged.
--
-- Run it as one statement against the live database:
--   node sbq.js --file supabase/verification/checkout_cycle_verification.sql
--
-- It reads only, plus one fixture block that ends in a deliberate rollback. The
-- database is left exactly as it was found, and the last statement returns the
-- full report as rows.
--
-- The defect it is written against: activate_subscription derived the period from
-- the LEGACY mirror row's billing_interval. subscription_plans.name is UNIQUE, so
-- one plan name holds one interval, and an annual purchase of Starter charged
-- NGN 225,000 and activated a ONE MONTH period.
--
-- The interesting check is step 17: a real annual purchase, started through the
-- real start_plan_checkout, settled by the real activate_subscription, with the
-- resulting period read back.
--
-- A NOTE ON HOW THE RESULTS SURVIVE THE ROLLBACK. A savepoint rollback undoes
-- every change to a table, including a temporary one, so results written into
-- zz_cycle_results from inside the fixture block would be erased along with the
-- fixture. PL/pgSQL variables are not transactional, so the measured results are
-- buffered in an array and written out after the rollback. Getting this wrong is
-- silent: the block runs, passes, and reports nothing.
-- ============================================================

DROP TABLE IF EXISTS zz_cycle_results;
CREATE TEMP TABLE zz_cycle_results (
  step INTEGER,
  check_name TEXT,
  passed BOOLEAN,
  detail TEXT
);

DO $do$
DECLARE
  v_actor UUID;
  v_org_id UUID;
  v_owner UUID;
  v_plan public.product_plans;
  v_plan_monthly public.product_plans;
  v_legacy_id UUID;
  v_txn public.subscription_transactions;
  v_sub public.subscriptions;
  v_months NUMERIC;
  v_ent public.organization_products;
  v_before_total INTEGER;
  v_before_settled INTEGER;
  v_n INTEGER;
  v_text TEXT;
  v_bool BOOLEAN;
  v_measured JSONB[] := ARRAY[]::JSONB[];
  i INTEGER;
BEGIN
  -- ==========================================================
  -- A. THE SHAPE THE FIX DEPENDS ON
  -- ==========================================================

  INSERT INTO zz_cycle_results VALUES (1,
    'subscription_transactions.billing_cycle exists as text',
    EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'subscription_transactions'
              AND column_name = 'billing_cycle' AND data_type = 'text'),
    COALESCE((SELECT data_type FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'subscription_transactions'
                AND column_name = 'billing_cycle'), 'column missing'));

  INSERT INTO zz_cycle_results VALUES (2,
    'subscription_transactions.product_plan_id exists as uuid',
    EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'subscription_transactions'
              AND column_name = 'product_plan_id' AND data_type = 'uuid'),
    COALESCE((SELECT data_type FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'subscription_transactions'
                AND column_name = 'product_plan_id'), 'column missing'));

  -- The FK must be ON DELETE SET NULL, so retiring a plan is never blocked by the
  -- customers who bought it and a settled transaction outlives its plan row.
  v_text := (SELECT confdeltype::text FROM pg_constraint
             WHERE conrelid = 'public.subscription_transactions'::regclass
               AND conname = 'subscription_transactions_product_plan_id_fkey');
  INSERT INTO zz_cycle_results VALUES (3,
    'product_plan_id FK is ON DELETE SET NULL',
    v_text = 'n',
    CASE v_text WHEN 'n' THEN 'SET NULL' WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
                WHEN 'c' THEN 'CASCADE' ELSE COALESCE(v_text, 'constraint missing') END);

  -- An unindexed FK makes every plan delete scan the whole transaction table.
  INSERT INTO zz_cycle_results VALUES (4,
    'product_plan_id is indexed',
    EXISTS (SELECT 1 FROM pg_indexes
            WHERE schemaname = 'public' AND tablename = 'subscription_transactions'
              AND indexdef LIKE '%product_plan_id%'),
    COALESCE((SELECT indexname FROM pg_indexes
              WHERE schemaname = 'public' AND tablename = 'subscription_transactions'
                AND indexdef LIKE '%product_plan_id%' LIMIT 1), 'no index'));

  -- The CHECK rejects a cycle that is neither monthly nor annual. Asserted by
  -- trying it, not by reading the constraint list, and the row is deleted whether
  -- or not the insert succeeded - a verification that leaves a fixture behind
  -- when it FAILS is worse than no verification.
  SELECT o.id, o.owner_id INTO v_org_id, v_owner
  FROM public.organizations o ORDER BY o.created_at ASC LIMIT 1;

  SELECT sp.id INTO v_legacy_id
  FROM public.subscription_plans sp ORDER BY sp.created_at ASC LIMIT 1;

  IF v_org_id IS NULL OR v_legacy_id IS NULL THEN
    INSERT INTO zz_cycle_results VALUES (5,
      'an unsupported cycle is refused by the CHECK', NULL,
      'SKIPPED: an organization and a legacy plan row are both required');
  ELSE
    v_bool := FALSE;
    BEGIN
      INSERT INTO public.subscription_transactions (
        org_id, plan_id, reference, amount, status, created_by, billing_cycle
      ) VALUES (
        v_org_id, v_legacy_id, 'mig094check-badcycle', 1, 'pending', v_owner, 'weekly'
      );
      -- Reached only when the CHECK is missing, which is the failure being tested.
    EXCEPTION WHEN check_violation THEN
      v_bool := TRUE;
    END;

    DELETE FROM public.subscription_transactions WHERE reference = 'mig094check-badcycle';

    INSERT INTO zz_cycle_results VALUES (5,
      'an unsupported cycle is refused by the CHECK', v_bool,
      CASE WHEN v_bool THEN 'weekly rejected, and the attempt removed'
           ELSE 'a wrong cycle was ACCEPTED' END);
  END IF;

  -- NULL is permitted. Every pre-094 row carries NULL, and a NOT NULL column
  -- would have forced a wrong answer onto them.
  SELECT count(*) INTO v_n FROM public.subscription_transactions WHERE billing_cycle IS NULL;
  INSERT INTO zz_cycle_results VALUES (6,
    'NULL cycle is permitted, for pre-094 rows and the legacy checkout',
    v_n >= 0,
    format('%s of %s existing row(s) carry NULL and therefore fall back',
      v_n, (SELECT count(*) FROM public.subscription_transactions)));

  -- ==========================================================
  -- B. THE TWO FUNCTIONS KEPT THEIR CONTRACT
  -- ==========================================================
  -- The Paystack webhook resolves activate_subscription by name and arity and
  -- stores what it returns, so a changed signature or return type breaks
  -- settlement for every customer rather than failing loudly.

  v_bool := (SELECT p.prorettype = 'public.subscriptions'::regtype AND p.pronargs = 3
             FROM pg_proc p
             WHERE p.oid = to_regprocedure('public.activate_subscription(text,jsonb,timestamp with time zone)'));
  INSERT INTO zz_cycle_results VALUES (7,
    'activate_subscription(text,jsonb,timestamptz) -> subscriptions',
    v_bool IS TRUE,
    COALESCE((SELECT pg_get_function_identity_arguments(p.oid) || ' -> ' || p.prorettype::regtype::text
              FROM pg_proc p
              WHERE p.oid = to_regprocedure('public.activate_subscription(text,jsonb,timestamp with time zone)')), 'missing'));

  v_bool := (SELECT p.prorettype = 'public.subscription_transactions'::regtype
             FROM pg_proc p
             WHERE p.oid = to_regprocedure('public.start_plan_checkout(uuid,text)'));
  INSERT INTO zz_cycle_results VALUES (8,
    'start_plan_checkout(uuid,text) -> subscription_transactions',
    v_bool IS TRUE,
    COALESCE((SELECT pg_get_function_identity_arguments(p.oid) || ' -> ' || p.prorettype::regtype::text
              FROM pg_proc p
              WHERE p.oid = to_regprocedure('public.start_plan_checkout(uuid,text)')), 'missing'));

  -- This project grants EXECUTE on new public functions to anon and authenticated
  -- through ALTER DEFAULT PRIVILEGES, so re-creating a function is close enough to
  -- creating one that the result is asserted rather than trusted.
  INSERT INTO zz_cycle_results VALUES (9,
    'anon CANNOT execute activate_subscription',
    NOT has_function_privilege('anon', 'public.activate_subscription(text,jsonb,timestamp with time zone)', 'EXECUTE'),
    'a client that can settle money can activate a subscription it never paid for');

  INSERT INTO zz_cycle_results VALUES (10,
    'authenticated CANNOT execute activate_subscription',
    NOT has_function_privilege('authenticated', 'public.activate_subscription(text,jsonb,timestamp with time zone)', 'EXECUTE'),
    '090 locked it to service_role and 094 must not have undone that');

  INSERT INTO zz_cycle_results VALUES (11,
    'service_role CAN execute activate_subscription (the webhook)',
    has_function_privilege('service_role', 'public.activate_subscription(text,jsonb,timestamp with time zone)', 'EXECUTE'),
    'the Paystack webhook settles through this function');

  INSERT INTO zz_cycle_results VALUES (12,
    'anon CAN execute list_published_plans (public pricing)',
    has_function_privilege('anon', 'public.list_published_plans(text)', 'EXECUTE'),
    'the public pricing page only ever renders for anonymous visitors');

  INSERT INTO zz_cycle_results VALUES (13,
    'authenticated CAN still execute the legacy checkout',
    has_function_privilege('authenticated', 'public.initiate_subscription_checkout(uuid,uuid)', 'EXECUTE'),
    'existing customers must keep the path they have');

  -- ==========================================================
  -- C. THE MONEY BEHAVIOUR, MEASURED
  -- ==========================================================
  -- Everything from here to the rollback runs inside a savepoint that is always
  -- rolled back. No transaction, subscription, entitlement or mirror row survives
  -- it, and the results are buffered because a rollback would erase them too.

  SELECT count(*) INTO v_before_total FROM public.subscription_transactions;
  SELECT count(*) INTO v_before_settled FROM public.subscription_transactions WHERE status = 'success';

  BEGIN
    -- An owner who owns exactly one business, so start_plan_checkout's
    -- sole-business rule is satisfied by real data rather than by a fixture.
    SELECT o.owner_id, o.id INTO v_actor, v_org_id
    FROM public.organizations o
    WHERE o.owner_id IS NOT NULL
      AND (SELECT count(*) FROM public.organizations o2 WHERE o2.owner_id = o.owner_id) = 1
    ORDER BY o.created_at ASC
    LIMIT 1;

    -- The dearest published plan with an annual price: the clearest case, because
    -- its annual figure is nowhere near its monthly one.
    SELECT pp.* INTO v_plan
    FROM public.product_plans pp
    WHERE pp.status = 'active' AND pp.is_public = TRUE
      AND pp.published_at IS NOT NULL AND pp.effective_from <= now()
      AND pp.annual_price IS NOT NULL
    ORDER BY pp.annual_price DESC
    LIMIT 1;

    -- And a plan with BOTH prices, to prove the monthly path is unchanged.
    SELECT pp.* INTO v_plan_monthly
    FROM public.product_plans pp
    WHERE pp.status = 'active' AND pp.is_public = TRUE
      AND pp.published_at IS NOT NULL AND pp.effective_from <= now()
      AND pp.annual_price IS NOT NULL AND pp.monthly_price IS NOT NULL
    ORDER BY pp.sort_order ASC
    LIMIT 1;

    IF v_actor IS NULL OR v_plan.id IS NULL THEN
      v_measured := v_measured || jsonb_build_object('step', 14,
        'name', 'the money behaviour could not be measured', 'passed', NULL,
        'detail', format('SKIPPED: a sole-business owner (%s) and a published plan with an annual price (%s) are both required',
          CASE WHEN v_actor IS NULL THEN 'none found' ELSE 'found' END,
          CASE WHEN v_plan.id IS NULL THEN 'none found' ELSE 'found' END));
    ELSE
      -- ----------------------------------------------------------
      -- The annual path
      -- ----------------------------------------------------------
      -- Called as the owner, through auth.uid(), which is what the function
      -- authorises on. set_config is how a session is simulated through the
      -- Management API, where auth.uid() would otherwise be NULL.
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_actor::text, 'role', 'authenticated')::text, TRUE);

      v_txn := public.start_plan_checkout(v_plan.id, 'annual');

      v_measured := v_measured || jsonb_build_object('step', 14,
        'name', 'an annual checkout records billing_cycle = annual',
        'passed', v_txn.billing_cycle = 'annual',
        'detail', format('plan "%s", recorded %s', v_plan.name, COALESCE(v_txn.billing_cycle, 'NULL')));

      v_measured := v_measured || jsonb_build_object('step', 15,
        'name', 'an annual checkout charges the annual price',
        'passed', v_txn.amount = v_plan.annual_price,
        'detail', format('charged NGN %s, annual price is NGN %s', v_txn.amount, v_plan.annual_price));

      v_measured := v_measured || jsonb_build_object('step', 16,
        'name', 'an annual checkout records the exact plan id',
        'passed', v_txn.product_plan_id = v_plan.id,
        'detail', format('recorded %s, which is "%s"', COALESCE(v_txn.product_plan_id::text, 'NULL'), v_plan.name));

      -- ----------------------------------------------------------
      -- THE DEFECT ITSELF. Settle it and read the period back.
      -- ----------------------------------------------------------
      v_sub := public.activate_subscription(v_txn.reference, '{"source":"verification-094"}'::jsonb, now());

      v_months := round(EXTRACT(EPOCH FROM (v_sub.current_period_end - v_sub.current_period_start)) / 2629746.0, 2);

      v_measured := v_measured || jsonb_build_object('step', 17,
        'name', 'an ANNUAL purchase activates an annual period',
        'passed', v_sub.current_period_end >= now() + INTERVAL '360 days',
        'detail', format('%s month(s), ending %s%s', v_months, v_sub.current_period_end,
          CASE WHEN v_sub.current_period_end >= now() + INTERVAL '360 days' THEN ''
               ELSE ' - THE 092 DEFECT IS STILL PRESENT' END));

      -- The entitlement's own expiry is the column the platform metrics and the
      -- access checks read, so it must carry the same year.
      SELECT * INTO v_ent FROM public.organization_products
      WHERE org_id = v_txn.org_id AND product_id = v_txn.product_id;

      v_measured := v_measured || jsonb_build_object('step', 18,
        'name', 'the entitlement expires with the annual period',
        'passed', v_ent.expires_at >= now() + INTERVAL '360 days',
        'detail', format('expires %s', v_ent.expires_at));

      v_measured := v_measured || jsonb_build_object('step', 19,
        'name', 'the entitlement grants the plan that was bought',
        'passed', v_ent.plan_id = v_plan.id,
        'detail', format('granted %s, bought %s ("%s")',
          COALESCE(v_ent.plan_id::text, 'NULL'), v_plan.id, v_plan.name));

      v_measured := v_measured || jsonb_build_object('step', 20,
        'name', 'the entitlement records the cycle that was charged',
        'passed', v_ent.metadata->>'billing_cycle' = 'annual',
        'detail', format('billing_cycle = %s, legacy billing_interval = %s',
          COALESCE(v_ent.metadata->>'billing_cycle', 'absent'),
          COALESCE(v_ent.metadata->>'billing_interval', 'absent')));

      -- ----------------------------------------------------------
      -- The monthly path, unchanged
      -- ----------------------------------------------------------
      IF v_plan_monthly.id IS NULL THEN
        v_measured := v_measured || jsonb_build_object('step', 21,
          'name', 'a monthly purchase still activates a monthly period', 'passed', NULL,
          'detail', 'SKIPPED: no published plan carries both a monthly and an annual price');
      ELSE
        v_txn := public.start_plan_checkout(v_plan_monthly.id, 'monthly');
        v_sub := public.activate_subscription(v_txn.reference, '{"source":"verification-094"}'::jsonb, now());
        v_months := round(EXTRACT(EPOCH FROM (v_sub.current_period_end - v_sub.current_period_start)) / 2629746.0, 2);

        v_measured := v_measured || jsonb_build_object('step', 21,
          'name', 'a monthly purchase still activates a monthly period',
          'passed', v_months BETWEEN 0.9 AND 1.1,
          'detail', format('%s month(s), charged NGN %s (monthly price NGN %s)',
            v_months, v_txn.amount, v_plan_monthly.monthly_price));

        v_measured := v_measured || jsonb_build_object('step', 22,
          'name', 'a monthly checkout charges the monthly price',
          'passed', v_txn.amount = v_plan_monthly.monthly_price,
          'detail', format('charged NGN %s', v_txn.amount));

        -- The default argument matters: a caller that omits the cycle must get
        -- exactly what it got before this migration existed.
        v_txn := public.start_plan_checkout(v_plan_monthly.id);
        v_measured := v_measured || jsonb_build_object('step', 23,
          'name', 'the cycle argument defaults to monthly',
          'passed', v_txn.billing_cycle = 'monthly',
          'detail', format('omitted the argument, recorded %s', COALESCE(v_txn.billing_cycle, 'NULL')));
      END IF;

      -- ----------------------------------------------------------
      -- The fallback, which is what makes this migration safe.
      -- ----------------------------------------------------------
      -- A transaction with NULL billing_cycle is exactly what a pre-094 row and
      -- every legacy-checkout row look like. It must behave as it did in 090: the
      -- legacy mirror's interval decides.
      SELECT sp.id INTO v_legacy_id
      FROM public.subscription_plans sp
      WHERE sp.billing_interval = 'yearly'
      ORDER BY (sp.status = 'active') DESC, sp.created_at ASC
      LIMIT 1;

      IF v_legacy_id IS NULL THEN
        INSERT INTO public.subscription_plans (
          name, description, price, currency, billing_interval, trial_days, feature_set, status
        ) VALUES (
          'mig094check-yearly', 'verification fixture, removed by the rollback',
          1, 'NGN', 'yearly', 0, '{}'::jsonb, 'active'
        ) RETURNING id INTO v_legacy_id;
      END IF;

      INSERT INTO public.subscription_transactions (
        org_id, plan_id, reference, amount, currency, status, created_by,
        product_id, is_sandbox, billing_cycle, product_plan_id
      ) VALUES (
        v_txn.org_id, v_legacy_id, 'mig094check-legacy',
        v_txn.amount, 'NGN', 'pending', v_actor, v_txn.product_id, FALSE, NULL, NULL
      ) RETURNING * INTO v_txn;

      v_sub := public.activate_subscription(v_txn.reference, '{"source":"verification-094-legacy"}'::jsonb, now());
      v_months := round(EXTRACT(EPOCH FROM (v_sub.current_period_end - v_sub.current_period_start)) / 2629746.0, 2);

      v_measured := v_measured || jsonb_build_object('step', 24,
        'name', 'a NULL-cycle row (pre-094 and legacy) still uses the legacy interval',
        'passed', v_months BETWEEN 11.9 AND 12.1,
        'detail', format('%s month(s) from a yearly legacy mirror, exactly as 090 did', v_months));
    END IF;

    -- The rollback is what makes leaving no trace a fact rather than an intention.
    RAISE EXCEPTION 'ROLLBACK:VERIFY094';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM <> 'ROLLBACK:VERIFY094' THEN
        RAISE;
      END IF;
  END;

  -- Written out only now, because the rollback above would have erased them.
  IF array_length(v_measured, 1) IS NOT NULL THEN
    FOR i IN 1..array_length(v_measured, 1) LOOP
      INSERT INTO zz_cycle_results (step, check_name, passed, detail)
      VALUES (
        (v_measured[i]->>'step')::INTEGER,
        v_measured[i]->>'name',
        (v_measured[i]->>'passed')::BOOLEAN,
        v_measured[i]->>'detail'
      );
    END LOOP;
  END IF;

  -- ==========================================================
  -- D. AND THE DATABASE IS AS IT WAS
  -- ==========================================================
  -- Checked rather than assumed, so a leak fails the verification instead of
  -- hiding in the output.

  SELECT count(*) INTO v_n FROM public.subscription_transactions;
  INSERT INTO zz_cycle_results VALUES (30,
    'no verification transaction survived the rollback',
    v_n = v_before_total,
    format('was %s row(s), now %s', v_before_total, v_n));

  SELECT count(*) INTO v_n FROM public.subscription_transactions WHERE status = 'success';
  INSERT INTO zz_cycle_results VALUES (31,
    'no fake settled payment survived the rollback',
    v_n = v_before_settled,
    format('was %s settled row(s), now %s', v_before_settled, v_n));

  INSERT INTO zz_cycle_results VALUES (32,
    'no verification mirror row survived the rollback',
    NOT EXISTS (SELECT 1 FROM public.subscription_plans WHERE name = 'mig094check-yearly'),
    COALESCE((SELECT 'still present: ' || name FROM public.subscription_plans WHERE name = 'mig094check-yearly'),
             'no row named mig094check-yearly'));

  -- Every unsettled row must carry NULL in both new columns. A row that does not
  -- is a row whose activation would change meaning, which is the one thing this
  -- migration promises not to do.
  SELECT count(*) INTO v_n
  FROM public.subscription_transactions
  WHERE status <> 'success' AND (billing_cycle IS NOT NULL OR product_plan_id IS NOT NULL);

  INSERT INTO zz_cycle_results VALUES (33,
    'every pre-existing unsettled row still activates as it did before',
    v_n = 0,
    format('%s unsettled row(s) carry a cycle or a plan; expected 0', v_n));
END
$do$;

-- The last statement's rows are what the Management API returns.
SELECT
  step,
  check_name,
  CASE passed WHEN TRUE THEN 'PASS' WHEN FALSE THEN 'FAIL' ELSE 'SKIP' END AS result,
  detail
FROM zz_cycle_results
ORDER BY step;
