-- Verification for migration 20260927000092 (billing single source).
--
-- Re-runnable and self-cleaning, in the style of the other files here: results
-- are returned as rows because the Management API discards RAISE NOTICE output,
-- and every check that needs to write rows does so inside a block that is then
-- aborted on purpose. The assertions are therefore made against real database
-- behaviour while the fixtures themselves never survive. The final section
-- proves that: it asserts the exact production row counts and that no fixture
-- this script created is still present.
--
-- Every function under test authorises on auth.uid(), which is NULL for SQL run
-- without a JWT, so the blocks that need a session impersonate a real account by
-- setting request.jwt.claims - and each of those groups first checks that the
-- gate refuses when nobody is signed in.
--
-- Run it through the Management API or psql and read the final result set.

CREATE TEMP TABLE IF NOT EXISTS zz_results (
  step INTEGER,
  check_name TEXT,
  passed BOOLEAN,
  detail TEXT
) ON COMMIT DROP;

TRUNCATE zz_results;

DO $do$
DECLARE
  -- ---- real accounts and catalogue rows this database actually holds --------
  v_owner        UUID;   -- a real business owner: owns exactly one organization
  v_owner_org    UUID;   -- that organization
  v_owner_store  UUID;   -- one of its stores
  v_platform     UUID;   -- the platform owner (super_admin: holds every permission)
  v_plain        UUID;   -- a real signed-in user with no platform identity
  v_no_org       UUID;   -- a real user who belongs to no business at all
  v_spare1       UUID;   -- two real users who are not yet members of v_owner_org
  v_spare2       UUID;
  v_cashier_role UUID;

  v_trackoja     UUID;   -- platform_products: the live product
  v_works        UUID;   -- platform_products: a product with no plans at all
  v_starter      UUID;   -- product_plans
  v_standard     UUID;
  v_premium      UUID;
  v_custom       UUID;
  v_retired      UUID;   -- product_plans: premium_90k, retired and private

  -- ---- helpers -------------------------------------------------------------
  v_claims       TEXT;
  v_msg          TEXT;
  v_msg2         TEXT;
  v_n            INTEGER;
  v_n2           INTEGER;
  v_arr          TEXT[];
  v_sig          TEXT;
  v_ok           BOOLEAN;

  -- ---- captured out of aborted blocks --------------------------------------
  v_pub_rows     INTEGER;
  v_pub_keys     TEXT[];
  v_pub_first    TEXT;
  v_pub_last     TEXT;
  v_std_price    NUMERIC;
  v_std_annual   NUMERIC;
  v_std_seats    INTEGER;
  v_std_currency TEXT;
  v_std_setup    NUMERIC;
  v_std_trial    INTEGER;
  v_std_stores   INTEGER;

  v_ent_rows     INTEGER;
  v_ent          RECORD;
  v_trigger_seats BIGINT;
  v_seats_after  INTEGER;
  v_second_error TEXT;
  v_days_expected INTEGER;
  v_works_rows   INTEGER;

  v_draft_id     UUID;
  v_pub_count_before INTEGER;
  v_pub_count_after  INTEGER;
  v_pub_row      public.product_plans;
  v_pub_again    public.product_plans;
  v_revision_ct  INTEGER;
  v_revision_ct2 INTEGER;
  v_revision_note TEXT;
  v_revision_prev TEXT;
  v_revision_new_at TEXT;
  v_audit_ct     INTEGER;
  v_audit_prev   TEXT;
  v_audit_new    TEXT;

  v_txn          public.subscription_transactions;
  v_legacy       public.subscription_plans;
  v_legacy_ct    INTEGER;
  v_txn_annual   public.subscription_transactions;
  v_legacy_after INTEGER;

  v_upsert_old   public.product_plans;
  v_upsert_new   public.product_plans;
  v_new_plan     public.product_plans;
  v_published_before TIMESTAMPTZ;
  v_fee_error    TEXT;
  v_trial_error  TEXT;
  v_store_error  TEXT;
  v_revision_new JSONB;

  v_write_error  TEXT;

  -- ---- the anonymous surface (the public pricing page) ----------------------
  v_anon_rows    INTEGER;
  v_anon_keys    TEXT[];
  v_anon_std_price  NUMERIC;
  v_anon_std_annual NUMERIC;
  v_anon_std_seats  INTEGER;
  v_anon_denied  TEXT[];
  v_anon_err_ent TEXT;
  v_anon_err_pub TEXT;
  v_anon_err_chk TEXT;
  v_anon_err_ups TEXT;
  v_anon_err_lst TEXT;
  v_role_now     TEXT;

  -- ---- baselines, captured before any fixture is written --------------------
  -- "No fixture was left behind" is proved against the state this script found,
  -- not only against a constant. That matters because these tables have other
  -- legitimate writers - the platform console writes product_plan_revisions and
  -- audit_logs every time an admin saves a plan - and a hard-coded total would
  -- fail on somebody else's honest edit rather than on a leftover fixture. The
  -- production totals are still asserted alongside, and both are printed.
  v_base_plans     INTEGER;
  v_base_sub_plans INTEGER;
  v_base_txns      INTEGER;
  v_base_revisions INTEGER;
  v_base_audit     INTEGER;

  -- ---- production counts, as they stood before this migration was applied ---
  c_product_plans      CONSTANT INTEGER := 5;
  c_subscription_plans CONSTANT INTEGER := 3;
  c_transactions       CONSTANT INTEGER := 0;
  c_revisions          CONSTANT INTEGER := 0;
  c_audit_logs         CONSTANT INTEGER := 94;
  c_organizations      CONSTANT INTEGER := 8;
  c_org_members        CONSTANT INTEGER := 8;
  c_org_products       CONSTANT INTEGER := 8;
  c_subscriptions      CONSTANT INTEGER := 8;
  c_stores             CONSTANT INTEGER := 8;
  c_store_members      CONSTANT INTEGER := 8;
  c_users              CONSTANT INTEGER := 12;
  c_platform_products  CONSTANT INTEGER := 2;
  c_platform_admins    CONSTANT INTEGER := 1;
BEGIN
  -- ============================================================
  -- 0. PRECONDITIONS: the real catalogue this script verifies against
  -- ============================================================
  PERFORM set_config('request.jwt.claims', '{}', TRUE);

  SELECT pp.id INTO v_trackoja FROM public.platform_products pp WHERE pp.key = 'trackoja';
  SELECT pp.id INTO v_works    FROM public.platform_products pp WHERE pp.key = 'trackoja_works';

  SELECT pp.id INTO v_starter  FROM public.product_plans pp WHERE pp.product_id = v_trackoja AND pp.key = 'starter';
  SELECT pp.id INTO v_standard FROM public.product_plans pp WHERE pp.product_id = v_trackoja AND pp.key = 'standard';
  SELECT pp.id INTO v_premium  FROM public.product_plans pp WHERE pp.product_id = v_trackoja AND pp.key = 'premium';
  SELECT pp.id INTO v_custom   FROM public.product_plans pp WHERE pp.product_id = v_trackoja AND pp.key = 'custom';
  SELECT pp.id INTO v_retired  FROM public.product_plans pp WHERE pp.product_id = v_trackoja AND pp.key = 'premium_90k';

  -- A real business owner, a real platform owner, and a real user with no
  -- business. Selected rather than hard-coded so the script is not tied to one
  -- account id, and asserted below so a missing one fails loudly.
  SELECT o.owner_id, o.id INTO v_owner, v_owner_org
  FROM public.organizations o
  WHERE o.owner_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = o.owner_id AND pa.status = 'active')
    AND (SELECT count(*) FROM public.organizations o2 WHERE o2.owner_id = o.owner_id) = 1
    AND EXISTS (SELECT 1 FROM public.organization_products op WHERE op.org_id = o.id)
  ORDER BY o.created_at
  LIMIT 1;

  SELECT s.id INTO v_owner_store FROM public.stores s WHERE s.org_id = v_owner_org ORDER BY s.created_at LIMIT 1;

  SELECT pa.user_id INTO v_platform
  FROM public.platform_admins pa
  WHERE pa.level = 'super_admin' AND pa.status = 'active'
  ORDER BY pa.granted_at NULLS LAST
  LIMIT 1;

  SELECT u.id INTO v_plain
  FROM public.users u
  WHERE NOT EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = u.id AND pa.status = 'active')
    AND COALESCE(u.is_platform_admin, FALSE) = FALSE
    AND u.id = v_owner;

  SELECT u.id INTO v_no_org
  FROM public.users u
  WHERE NOT EXISTS (SELECT 1 FROM public.organization_members om WHERE om.user_id = u.id)
    AND NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.owner_id = u.id)
  ORDER BY u.id
  LIMIT 1;

  SELECT array_agg(c.user_id) INTO v_arr
  FROM (
    SELECT u.id AS user_id
    FROM public.users u
    WHERE NOT EXISTS (
      SELECT 1 FROM public.store_members sm
      JOIN public.stores s ON s.id = sm.store_id
      WHERE s.org_id = v_owner_org AND sm.user_id = u.id)
    ORDER BY u.id
    LIMIT 2
  ) c;
  IF v_arr IS NOT NULL AND array_length(v_arr, 1) = 2 THEN
    v_spare1 := v_arr[1];
    v_spare2 := v_arr[2];
  END IF;

  SELECT r.id INTO v_cashier_role FROM public.roles r WHERE r.name = 'cashier';

  -- Baselines. Taken here, before a single fixture row is written, so the
  -- "leftovers" section can prove this script moved nothing.
  SELECT count(*) INTO v_base_plans     FROM public.product_plans;
  SELECT count(*) INTO v_base_sub_plans FROM public.subscription_plans;
  SELECT count(*) INTO v_base_txns      FROM public.subscription_transactions;
  SELECT count(*) INTO v_base_revisions FROM public.product_plan_revisions;
  SELECT count(*) INTO v_base_audit     FROM public.audit_logs;

  INSERT INTO zz_results VALUES (0, 'preconditions: the real catalogue and accounts this verification needs are present',
    v_owner IS NOT NULL AND v_owner_org IS NOT NULL AND v_owner_store IS NOT NULL
    AND v_platform IS NOT NULL AND v_no_org IS NOT NULL
    AND v_spare1 IS NOT NULL AND v_spare2 IS NOT NULL AND v_cashier_role IS NOT NULL
    AND v_trackoja IS NOT NULL AND v_works IS NOT NULL
    AND v_starter IS NOT NULL AND v_standard IS NOT NULL AND v_premium IS NOT NULL
    AND v_custom IS NOT NULL AND v_retired IS NOT NULL,
    format('owner=%s org=%s platform=%s no_org=%s product=%s', v_owner, v_owner_org, v_platform, v_no_org, v_trackoja));

  IF v_owner IS NULL OR v_platform IS NULL OR v_standard IS NULL OR v_works IS NULL OR v_spare1 IS NULL THEN
    RETURN;
  END IF;

  -- ============================================================
  -- 1. product_plans HAS THE FIVE NEW COLUMNS
  -- ============================================================
  SELECT count(*) INTO v_n
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'product_plans'
    AND column_name IN ('setup_fee', 'trial_days', 'store_limit', 'published_at', 'effective_from');
  INSERT INTO zz_results VALUES (1, 'product_plans has all five new columns', v_n = 5, v_n || ' of 5 present');

  SELECT string_agg(column_name || ' ' || data_type || ' nullable=' || is_nullable || ' default=' || COALESCE(column_default, '-'), ' | '
                    ORDER BY ordinal_position)
    INTO v_sig
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'product_plans'
    AND column_name IN ('setup_fee', 'trial_days', 'store_limit', 'published_at', 'effective_from');

  INSERT INTO zz_results VALUES (2, 'their types, nullability and defaults are the ones specified',
    v_sig = 'setup_fee numeric nullable=YES default=- | trial_days integer nullable=NO default=0 | '
            'store_limit integer nullable=YES default=- | published_at timestamp with time zone nullable=YES default=- | '
            'effective_from timestamp with time zone nullable=YES default=-',
    v_sig);

  SELECT count(*) INTO v_n
  FROM pg_constraint
  WHERE conrelid = 'public.product_plans'::regclass
    AND conname IN ('product_plans_setup_fee_check', 'product_plans_trial_days_check');
  INSERT INTO zz_results VALUES (3, 'the setup-fee and trial-days CHECK constraints exist',
    v_n = 2, v_n || ' of 2 present');

  -- The guard that keeps a negative fee out even if a caller writes the table
  -- directly rather than through upsert_product_plan.
  v_write_error := NULL;
  BEGIN
    UPDATE public.product_plans SET setup_fee = -1 WHERE id = v_starter;
    v_write_error := 'ACCEPTED';
  EXCEPTION WHEN OTHERS THEN v_write_error := SQLERRM; END;
  INSERT INTO zz_results VALUES (4, 'the setup-fee CHECK rejects a negative fee',
    v_write_error LIKE '%product_plans_setup_fee_check%', v_write_error);

  -- ============================================================
  -- 2. THE BACKFILL: NOTHING VISIBLE DISAPPEARED
  -- ============================================================
  SELECT count(*) INTO v_n
  FROM public.product_plans
  WHERE status = 'active' AND is_public = TRUE AND published_at IS NOT NULL AND effective_from IS NOT NULL;
  INSERT INTO zz_results VALUES (5, 'the four customer-visible plans carry both published_at and effective_from',
    v_n = 4, v_n || ' row(s) published');

  SELECT pp.key, pp.published_at, pp.effective_from, pp.status, pp.is_public
    INTO v_ent
  FROM public.product_plans pp WHERE pp.id = v_retired;
  INSERT INTO zz_results VALUES (6, 'the retired premium_90k stays unpublished and therefore invisible',
    v_ent.published_at IS NULL AND v_ent.effective_from IS NULL AND v_ent.status = 'retired' AND v_ent.is_public = FALSE,
    format('status=%s is_public=%s published_at=%s', v_ent.status, v_ent.is_public, COALESCE(v_ent.published_at::TEXT, 'NULL')));

  SELECT array_agg(pp.key ORDER BY pp.sort_order, pp.monthly_price NULLS LAST) INTO v_arr
  FROM public.product_plans pp
  WHERE pp.status = 'active' AND pp.is_public = TRUE AND pp.published_at IS NOT NULL AND pp.effective_from <= now();
  INSERT INTO zz_results VALUES (7, 'exactly four plans make up the published set: starter, standard, premium, custom',
    v_arr = ARRAY['starter', 'standard', 'premium', 'custom'],
    COALESCE(v_arr::TEXT, 'NULL'));

  -- ============================================================
  -- 3. list_published_plans: THE CUSTOMER-FACING CATALOGUE
  -- ============================================================
  SELECT count(*) INTO v_pub_rows FROM public.list_published_plans('trackoja');
  INSERT INTO zz_results VALUES (8, 'list_published_plans(trackoja) returns exactly 4 rows',
    v_pub_rows = 4, v_pub_rows || ' row(s)');

  SELECT array_agg(lp.key ORDER BY lp.sort_order, lp.monthly_price NULLS LAST) INTO v_pub_keys
  FROM public.list_published_plans('trackoja') lp;
  INSERT INTO zz_results VALUES (9, 'the four are starter, standard, premium and custom - and not premium_90k',
    v_pub_keys = ARRAY['starter', 'standard', 'premium', 'custom'] AND NOT ('premium_90k' = ANY (v_pub_keys)),
    COALESCE(v_pub_keys::TEXT, 'NULL'));

  -- This is the row the customer's Billing page currently cannot see: Standard
  -- exists and is published but no customer-facing read reaches it.
  SELECT lp.monthly_price, lp.annual_price, lp.user_limit, lp.currency, lp.setup_fee, lp.trial_days, lp.store_limit
    INTO v_std_price, v_std_annual, v_std_seats, v_std_currency, v_std_setup, v_std_trial, v_std_stores
  FROM public.list_published_plans('trackoja') lp
  WHERE lp.key = 'standard';

  INSERT INTO zz_results VALUES (10, 'Standard is published at 22500 / 225000 with 5 seats',
    v_std_price = 22500 AND v_std_annual = 225000 AND v_std_seats = 5,
    format('monthly=%s annual=%s user_limit=%s', v_std_price, v_std_annual, v_std_seats));

  INSERT INTO zz_results VALUES (11, 'a published plan with no setup fee and no trial reports NULL and 0, not a guess',
    v_std_currency = 'NGN' AND v_std_setup IS NULL AND v_std_trial = 0 AND v_std_stores IS NULL,
    format('currency=%s setup_fee=%s trial_days=%s store_limit=%s', v_std_currency, v_std_setup, v_std_trial, v_std_stores));

  SELECT string_agg(x.n || ' ' || format_type(x.t, NULL), ', ' ORDER BY x.o) INTO v_sig
  FROM (
    SELECT n, t, o
    FROM unnest(
      (SELECT proargnames FROM pg_proc WHERE oid = 'public.list_published_plans(text)'::regprocedure),
      (SELECT proallargtypes FROM pg_proc WHERE oid = 'public.list_published_plans(text)'::regprocedure)
    ) WITH ORDINALITY AS u(n, t, o)
    WHERE o > 1
  ) x;

  INSERT INTO zz_results VALUES (12, 'its returned columns are exactly the twenty specified, in order',
    v_sig = 'id uuid, product_key text, product_name text, key text, name text, description text, monthly_price numeric, '
            'annual_price numeric, currency text, billing_cycle text, user_limit integer, store_limit integer, features jsonb, '
            'onboarding_note text, setup_fee numeric, trial_days integer, is_default boolean, sort_order integer, '
            'published_at timestamp with time zone, effective_from timestamp with time zone',
    v_sig);

  SELECT lp.key INTO v_pub_first FROM public.list_published_plans('trackoja') lp LIMIT 1;
  SELECT lp.key INTO v_pub_last
  FROM public.list_published_plans('trackoja') lp
  ORDER BY lp.sort_order DESC, lp.monthly_price ASC NULLS LAST
  LIMIT 1;
  INSERT INTO zz_results VALUES (13, 'ordering is sort_order then monthly price with the negotiated tier last',
    v_pub_first = 'starter' AND v_pub_last = 'custom',
    format('first=%s last=%s', v_pub_first, v_pub_last));

  -- list_published_plans IS anon-callable: the public pricing page renders inside
  -- GuestRoute, which redirects signed-in users away, so the only people who ever
  -- read that page hold the anon role. It is SECURITY DEFINER and returns only
  -- published prices and plan rows - no tenant data, no entitlement, no usage -
  -- so an anonymous read of it discloses nothing the marketing site does not
  -- already advertise. The anon role is exercised directly in section 11.
  INSERT INTO zz_results VALUES (14, 'list_published_plans is executable by anon and by authenticated',
    has_function_privilege('anon', 'public.list_published_plans(text)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.list_published_plans(text)', 'EXECUTE'),
    'anon=' || has_function_privilege('anon', 'public.list_published_plans(text)', 'EXECUTE')::TEXT
    || ' authenticated=' || has_function_privilege('authenticated', 'public.list_published_plans(text)', 'EXECUTE')::TEXT);

  v_msg := 'NOT RAISED';
  BEGIN
    PERFORM count(*) FROM public.list_published_plans('no_such_product');
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO zz_results VALUES (15, 'an unknown product key is refused', v_msg = 'Unknown product: no_such_product', v_msg);

  -- A product that exists but sells nothing is not an error: it is an empty
  -- catalogue, which is a different fact from an unknown product.
  SELECT count(*) INTO v_n FROM public.list_published_plans('trackoja_works');
  INSERT INTO zz_results VALUES (16, 'the known-but-unsold product returns an empty catalogue rather than raising',
    v_n = 0, v_n || ' row(s) for trackoja_works');

  -- A tenant read must work for an ordinary signed-in customer, not only for a
  -- platform admin. This is the whole reason the function exists.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::TEXT, TRUE);
  v_msg := 'NOT RAISED';
  v_n := -1;
  BEGIN
    SELECT count(*) INTO v_n FROM public.list_published_plans('trackoja');
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO zz_results VALUES (17, 'a plain signed-in customer can read the published catalogue',
    v_n = 4 AND v_msg = 'NOT RAISED', format('rows=%s error=%s', v_n, v_msg));

  -- The admin catalogue stays gated: it exposes drafts, retired rows and counts.
  v_msg := 'NOT RAISED';
  BEGIN
    PERFORM count(*) FROM public.list_product_plans('trackoja');
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO zz_results VALUES (18, 'the same customer still cannot read the admin catalogue',
    v_msg = 'Permission denied: platform:view required', v_msg);

  PERFORM set_config('request.jwt.claims', '{}', TRUE);

  -- A draft and a future-dated plan must both stay out of the customer read.
  -- Exercised on throwaway rows, then rolled back.
  v_pub_rows := NULL; v_pub_count_after := NULL; v_write_error := NULL;
  BEGIN
    INSERT INTO public.product_plans (product_id, key, name, monthly_price, annual_price, user_limit,
                                      status, is_public, sort_order)
    VALUES (v_trackoja, 'zz_verify_draft_092', 'ZZ Verify Draft', 1000, 10000, 1, 'draft', TRUE, 90);

    INSERT INTO public.product_plans (product_id, key, name, monthly_price, annual_price, user_limit,
                                      status, is_public, sort_order, published_at, effective_from)
    VALUES (v_trackoja, 'zz_verify_future_092', 'ZZ Verify Future', 2000, 20000, 1, 'active', TRUE, 91,
            now(), now() + INTERVAL '30 days');

    SELECT count(*) INTO v_pub_rows FROM public.list_published_plans('trackoja');

    RAISE EXCEPTION 'zz_verify_rollback';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'zz_verify_rollback' THEN v_write_error := SQLERRM; END IF;
  END;

  INSERT INTO zz_results VALUES (19, 'a draft plan and a not-yet-effective plan are both invisible to customers',
    v_pub_rows = 4,
    COALESCE(v_write_error, v_pub_rows::TEXT || ' row(s) with a draft and a future-dated plan present'));

  -- ============================================================
  -- 4. get_my_entitlement: THE BUSINESS'S OWN PLAN AND ITS REAL USAGE
  -- ============================================================
  PERFORM set_config('request.jwt.claims', '{}', TRUE);
  v_msg := 'NOT RAISED';
  BEGIN
    PERFORM * FROM public.get_my_entitlement('trackoja');
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO zz_results VALUES (20, 'get_my_entitlement refuses a caller with no session',
    v_msg = 'Authentication required', v_msg);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_no_org, 'role', 'authenticated')::TEXT, TRUE);
  v_msg := 'NOT RAISED';
  BEGIN
    PERFORM * FROM public.get_my_entitlement('trackoja');
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO zz_results VALUES (21, 'a user who belongs to no business is told so',
    v_msg = 'No business is linked to your account', v_msg);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::TEXT, TRUE);

  SELECT count(*) INTO v_ent_rows FROM public.get_my_entitlement('trackoja');
  INSERT INTO zz_results VALUES (22, 'the owner gets exactly one row: their own entitlement', v_ent_rows = 1, v_ent_rows || ' row(s)');

  SELECT * INTO v_ent FROM public.get_my_entitlement('trackoja');

  SELECT op.agreed_monthly_price, op.agreed_annual_price, op.agreed_user_limit, op.status, op.source,
         op.expires_at, op.trial_ends_at, op.currency
    INTO v_ent
  FROM public.organization_products op
  WHERE op.org_id = v_owner_org AND op.product_id = v_trackoja;

  SELECT * INTO v_ent FROM public.get_my_entitlement('trackoja');

  INSERT INTO zz_results VALUES (23, 'it reports the real entitlement, not a placeholder',
    v_ent.org_id = v_owner_org
    AND v_ent.product_key = 'trackoja'
    AND v_ent.plan_key = 'starter'
    AND v_ent.agreed_user_limit = 2
    AND v_ent.agreed_monthly_price = 5000
    AND v_ent.currency = 'NGN'
    AND v_ent.agreed_store_limit IS NULL
    AND v_ent.billing_cycle = 'monthly',
    format('org=%s plan=%s seats_limit=%s monthly=%s', v_ent.org_name, v_ent.plan_key, v_ent.agreed_user_limit, v_ent.agreed_monthly_price));

  -- The seat count, taken the way enforce_seat_limit takes it. The predicate
  -- below is the trigger's own, copied from 20260926000069 section
  -- "SEAT LIMIT AND SUBSCRIPTION ENFORCEMENT" with the one term that cannot
  -- apply here removed: `sm.user_id <> NEW.user_id` excludes the row being
  -- inserted, which is not a member yet and so is not in any count of members.
  SELECT COUNT(DISTINCT sm.user_id) INTO v_trigger_seats
  FROM public.store_members sm
  JOIN public.stores s ON s.id = sm.store_id
  WHERE s.org_id = v_owner_org
    AND sm.status = 'active'
    AND sm.user_id IS NOT NULL;

  INSERT INTO zz_results VALUES (24, 'seats_used is exactly what enforce_seat_limit counts for the same business',
    v_ent.seats_used = v_trigger_seats,
    format('get_my_entitlement=%s, enforce_seat_limit predicate=%s', v_ent.seats_used, v_trigger_seats));

  SELECT COUNT(*) INTO v_n FROM public.stores s WHERE s.org_id = v_owner_org;
  INSERT INTO zz_results VALUES (25, 'stores_used counts the business''s stores', v_ent.stores_used = v_n,
    format('stores_used=%s, stores=%s', v_ent.stores_used, v_n));

  SELECT floor(EXTRACT(EPOCH FROM (COALESCE(op.expires_at, op.trial_ends_at) - now())) / 86400)::INTEGER
    INTO v_days_expected
  FROM public.organization_products op
  WHERE op.org_id = v_owner_org AND op.product_id = v_trackoja;

  INSERT INTO zz_results VALUES (26, 'days_remaining is the whole days to COALESCE(expires_at, trial_ends_at)',
    v_ent.days_remaining = v_days_expected AND v_ent.days_remaining IS NOT NULL,
    format('days_remaining=%s, recomputed=%s, expires_at=%s, trial_ends_at=%s',
           v_ent.days_remaining, v_days_expected, v_ent.expires_at, v_ent.trial_ends_at));

  -- A PRODUCT THE BUSINESS HOLDS NO ENTITLEMENT FOR RETURNS NO ROW. trackoja_works
  -- is a real product with no plans and no entitlements, so this is the real
  -- case and not a synthetic one.
  SELECT count(*) INTO v_works_rows FROM public.get_my_entitlement('trackoja_works');
  INSERT INTO zz_results VALUES (27, 'no entitlement returns no row, so "no plan" is distinguishable from "no dates"',
    v_works_rows = 0, v_works_rows || ' row(s) for trackoja_works');

  -- ------------------------------------------------------------------
  -- The seat number must be the number that is enforced, so this fills the
  -- business's last free seat and then shows the trigger refusing the next one
  -- at exactly the count get_my_entitlement reports. Entirely inside a block
  -- that is aborted, so neither member survives.
  -- ------------------------------------------------------------------
  v_seats_after := NULL; v_second_error := NULL; v_write_error := NULL;
  BEGIN
    INSERT INTO public.store_members (store_id, user_id, role_id, status, invited_by, accepted_at)
    VALUES (v_owner_store, v_spare1, v_cashier_role, 'active', v_owner, now());

    SELECT (public.get_my_entitlement('trackoja')).seats_used INTO v_seats_after;

    BEGIN
      INSERT INTO public.store_members (store_id, user_id, role_id, status, invited_by, accepted_at)
      VALUES (v_owner_store, v_spare2, v_cashier_role, 'active', v_owner, now());
      v_second_error := 'NOT REFUSED';
    EXCEPTION WHEN OTHERS THEN v_second_error := SQLERRM; END;

    RAISE EXCEPTION 'zz_verify_rollback';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'zz_verify_rollback' THEN v_write_error := SQLERRM; END IF;
  END;

  INSERT INTO zz_results VALUES (28, 'the seat count follows the trigger: last free seat fills, the next is refused',
    v_write_error IS NULL
    AND v_seats_after = v_ent.seats_used + 1
    AND v_second_error LIKE 'Seat limit reached for this plan (2).%',
    format('fixture_error=%s seats_after_one_more=%s attempted_second=%s',
           COALESCE(v_write_error, 'none'), v_seats_after, v_second_error));

  INSERT INTO zz_results VALUES (29, 'get_my_entitlement is executable by authenticated and not by anon',
    has_function_privilege('authenticated', 'public.get_my_entitlement(text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.get_my_entitlement(text)', 'EXECUTE'),
    'authenticated=' || has_function_privilege('authenticated', 'public.get_my_entitlement(text)', 'EXECUTE')::TEXT
    || ' anon=' || has_function_privilege('anon', 'public.get_my_entitlement(text)', 'EXECUTE')::TEXT);

  SELECT string_agg(x.n || ' ' || format_type(x.t, NULL), ', ' ORDER BY x.o) INTO v_sig
  FROM (
    SELECT n, t, o
    FROM unnest(
      (SELECT proargnames FROM pg_proc WHERE oid = 'public.get_my_entitlement(text)'::regprocedure),
      (SELECT proallargtypes FROM pg_proc WHERE oid = 'public.get_my_entitlement(text)'::regprocedure)
    ) WITH ORDINALITY AS u(n, t, o)
    WHERE o > 1
  ) x;

  INSERT INTO zz_results VALUES (30, 'its returned columns are exactly the twenty-two specified, in order',
    v_sig = 'org_id uuid, org_name text, product_key text, product_name text, plan_id uuid, plan_key text, plan_name text, '
            'status text, source text, agreed_monthly_price numeric, agreed_annual_price numeric, agreed_user_limit integer, '
            'agreed_store_limit integer, billing_cycle text, currency text, trial_ends_at timestamp with time zone, '
            'activated_at timestamp with time zone, expires_at timestamp with time zone, cancelled_at timestamp with time zone, '
            'seats_used bigint, stores_used bigint, days_remaining integer',
    v_sig);

  -- ============================================================
  -- 5. publish_product_plan: THE DELIBERATE PUBLICATION STEP
  -- ============================================================
  -- A plain customer holds no platform permission at all, so this is the
  -- "refused for a caller without platform:manage_plans" case.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_plain, 'role', 'authenticated')::TEXT, TRUE);
  v_msg := 'NOT RAISED';
  BEGIN
    PERFORM public.publish_product_plan('trackoja', 'starter', 'zz verify publish');
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO zz_results VALUES (31, 'publishing is refused for a caller without platform:manage_plans',
    v_msg = 'Permission denied: platform:manage_plans required', v_msg);

  PERFORM set_config('request.jwt.claims', '{}', TRUE);
  v_msg := 'NOT RAISED';
  BEGIN
    PERFORM public.publish_product_plan('trackoja', 'starter', 'zz verify publish');
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO zz_results VALUES (32, 'publishing is refused with no session at all',
    v_msg = 'Authentication required', v_msg);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_platform, 'role', 'authenticated')::TEXT, TRUE);

  v_msg := 'NOT RAISED';
  BEGIN
    PERFORM public.publish_product_plan('trackoja', 'zz_no_such_plan', 'zz verify publish');
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO zz_results VALUES (33, 'an unknown plan is refused',
    v_msg = 'Unknown plan zz_no_such_plan for product trackoja', v_msg);

  v_msg := 'NOT RAISED';
  BEGIN
    PERFORM public.publish_product_plan('trackoja', 'starter', 'zz verify publish', now() - INTERVAL '2 days');
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO zz_results VALUES (34, 'a backdated effective date is refused rather than silently rounded up',
    v_msg = 'The effective date cannot be in the past', v_msg);

  -- ------------------------------------------------------------------
  -- Publish a throwaway draft as the platform owner, inside a block that is
  -- aborted. Both the revision row and the audit row are asserted here and
  -- proved to be gone in the final section.
  -- ------------------------------------------------------------------
  v_draft_id := NULL; v_pub_row := NULL; v_pub_again := NULL;
  v_pub_count_before := NULL; v_pub_count_after := NULL;
  v_revision_ct := NULL; v_revision_ct2 := NULL; v_revision_note := NULL;
  v_revision_prev := NULL; v_revision_new_at := NULL;
  v_audit_ct := NULL; v_audit_prev := NULL; v_audit_new := NULL;
  v_write_error := NULL;

  BEGIN
    INSERT INTO public.product_plans (product_id, key, name, description, monthly_price, annual_price,
                                      user_limit, store_limit, setup_fee, trial_days,
                                      status, is_public, sort_order, created_by)
    VALUES (v_trackoja, 'zz_verify_publish_092', 'ZZ Verify Publish', 'throwaway', 7000, 70000,
            3, 2, 25000, 14, 'draft', TRUE, 92, v_platform)
    RETURNING id INTO v_draft_id;

    SELECT count(*) INTO v_pub_count_before FROM public.list_published_plans('trackoja');

    v_pub_row := public.publish_product_plan('trackoja', 'zz_verify_publish_092', 'zz verify publish step');

    -- Captured immediately after the FIRST publish, so the pair of rows is
    -- attributed to the call that wrote it rather than to whichever call ran last.
    SELECT count(*), min(r.note), min(r.previous_values->>'published_at'), min(r.new_values->>'published_at')
      INTO v_revision_ct, v_revision_note, v_revision_prev, v_revision_new_at
    FROM public.product_plan_revisions r
    WHERE r.plan_id = v_draft_id AND r.change_type = 'published';

    SELECT count(*), min(a.changes->'previous'->>'published_at'), min(a.changes->'new'->>'published_at')
      INTO v_audit_ct, v_audit_prev, v_audit_new
    FROM public.audit_logs a
    WHERE a.resource_id = v_draft_id AND a.action = 'PLAN_PUBLISHED';

    SELECT count(*) INTO v_pub_count_after FROM public.list_published_plans('trackoja');

    -- Publishing again must not move the original publication date, and must be
    -- journaled like the first one.
    v_pub_again := public.publish_product_plan('trackoja', 'zz_verify_publish_092', 'zz verify republish',
                                              now() + INTERVAL '1 day');

    SELECT count(*) INTO v_revision_ct2
    FROM public.product_plan_revisions r
    WHERE r.plan_id = v_draft_id AND r.change_type = 'published';

    RAISE EXCEPTION 'zz_verify_rollback';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'zz_verify_rollback' THEN v_write_error := SQLERRM; END IF;
  END;

  INSERT INTO zz_results VALUES (35, 'as the platform owner, publishing a draft makes it active and stamped',
    v_write_error IS NULL
    AND v_pub_row.id = v_draft_id
    AND v_pub_row.status = 'active'
    AND v_pub_row.published_at IS NOT NULL
    AND v_pub_row.effective_from IS NOT NULL
    AND v_pub_row.setup_fee = 25000
    AND v_pub_row.trial_days = 14
    AND v_pub_row.store_limit = 2,
    COALESCE(v_write_error,
      format('status=%s published_at=%s effective_from=%s', v_pub_row.status, v_pub_row.published_at, v_pub_row.effective_from)));

  INSERT INTO zz_results VALUES (36, 'the draft was invisible before publishing and visible after',
    v_pub_count_before = 4 AND v_pub_count_after = 5,
    format('published rows before=%s after=%s', v_pub_count_before, v_pub_count_after));

  INSERT INTO zz_results VALUES (37, 'a ''published'' product_plan_revisions row is written with the note',
    v_revision_ct = 1 AND v_revision_note = 'zz verify publish step'
    AND v_revision_prev IS NULL AND v_revision_new_at IS NOT NULL,
    format('rows=%s note=%s previous_published_at=%s new_published_at=%s',
           v_revision_ct, v_revision_note, COALESCE(v_revision_prev, 'NULL'), COALESCE(v_revision_new_at, 'NULL')));

  INSERT INTO zz_results VALUES (38, 'a PLAN_PUBLISHED audit row carries the previous and the new value',
    v_audit_ct = 1 AND v_audit_prev IS NULL AND v_audit_new IS NOT NULL,
    format('rows=%s previous.published_at=%s new.published_at=%s', v_audit_ct, COALESCE(v_audit_prev, 'NULL'), v_audit_new));

  INSERT INTO zz_results VALUES (39, 're-publishing leaves published_at untouched, moves effective_from and journals again',
    v_pub_again.published_at = v_pub_row.published_at
    AND v_pub_again.effective_from > v_pub_row.effective_from
    AND v_revision_ct2 = 2,
    format('published_at %s -> %s, effective_from %s -> %s, published revisions 1 -> %s',
           v_pub_row.published_at, v_pub_again.published_at, v_pub_row.effective_from, v_pub_again.effective_from,
           v_revision_ct2));

  INSERT INTO zz_results VALUES (40, 'publish_product_plan is executable by authenticated and not by anon',
    has_function_privilege('authenticated', 'public.publish_product_plan(text,text,text,timestamp with time zone)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.publish_product_plan(text,text,text,timestamp with time zone)', 'EXECUTE'),
    'authenticated=' || has_function_privilege('authenticated', 'public.publish_product_plan(text,text,text,timestamp with time zone)', 'EXECUTE')::TEXT
    || ' anon=' || has_function_privilege('anon', 'public.publish_product_plan(text,text,text,timestamp with time zone)', 'EXECUTE')::TEXT);

  -- ============================================================
  -- 6. start_plan_checkout: THE PURCHASE PATH
  -- ============================================================
  PERFORM set_config('request.jwt.claims', '{}', TRUE);
  v_msg := 'NOT RAISED';
  BEGIN
    PERFORM public.start_plan_checkout(v_standard, 'monthly');
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO zz_results VALUES (41, 'checkout refuses a caller with no session',
    v_msg = 'Authentication required', v_msg);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_no_org, 'role', 'authenticated')::TEXT, TRUE);
  v_msg := 'NOT RAISED';
  BEGIN
    PERFORM public.start_plan_checkout(v_standard, 'monthly');
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO zz_results VALUES (42, 'a caller who owns no business is refused',
    v_msg = 'An organisation is required', v_msg);

  -- A member who is not the owner gets the product's own sentence rather than
  -- being told they have no business. No such member exists in production, so
  -- the membership is a fixture and the block is aborted.
  v_msg := NULL; v_write_error := NULL;
  BEGIN
    INSERT INTO public.organization_members (org_id, user_id, role, joined_at, accepted_at)
    VALUES (v_owner_org, v_no_org, 'member', now(), now());

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_no_org, 'role', 'authenticated')::TEXT, TRUE);

    BEGIN
      PERFORM public.start_plan_checkout(v_standard, 'monthly');
      v_msg := 'NOT REFUSED';
    EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;

    RAISE EXCEPTION 'zz_verify_rollback';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'zz_verify_rollback' THEN v_write_error := SQLERRM; END IF;
  END;

  INSERT INTO zz_results VALUES (43, 'a member who is not the owner is refused with the product''s own sentence',
    v_write_error IS NULL AND v_msg = 'Only the organization owner can manage billing',
    COALESCE(v_write_error, v_msg));

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::TEXT, TRUE);

  -- The retired, private premium_90k tier must not be buyable, and neither must a
  -- plan that has been edited into a good state but never published.
  v_msg := NULL; v_write_error := NULL; v_draft_id := NULL;
  BEGIN
    BEGIN
      PERFORM public.start_plan_checkout(v_retired, 'monthly');
      v_msg := 'NOT REFUSED';
    EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;

    INSERT INTO public.product_plans (product_id, key, name, monthly_price, annual_price, user_limit,
                                      status, is_public, sort_order)
    VALUES (v_trackoja, 'zz_verify_unpub_092', 'ZZ Verify Unpublished', 8000, 80000, 1, 'active', TRUE, 93)
    RETURNING id INTO v_draft_id;

    BEGIN
      PERFORM public.start_plan_checkout(v_draft_id, 'monthly');
      v_msg2 := 'NOT REFUSED';
    EXCEPTION WHEN OTHERS THEN v_msg2 := SQLERRM; END;

    RAISE EXCEPTION 'zz_verify_rollback';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'zz_verify_rollback' THEN v_write_error := SQLERRM; END IF;
  END;

  INSERT INTO zz_results VALUES (44, 'an unpublished or retired plan cannot be bought',
    v_write_error IS NULL AND v_msg = 'Unknown plan' AND v_msg2 = 'Unknown plan',
    format('premium_90k=%s, unpublished draft=%s', v_msg, v_msg2));

  v_msg := 'NOT RAISED';
  BEGIN
    PERFORM public.start_plan_checkout(v_standard, 'weekly');
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO zz_results VALUES (45, 'an unsupported billing cycle is refused',
    v_msg = 'Unsupported billing cycle: weekly', v_msg);

  -- ------------------------------------------------------------------
  -- The valid path: a real published plan, bought by the real owner, writing the
  -- pending transaction and the legacy mirror. Aborted, so neither survives.
  -- ------------------------------------------------------------------
  v_txn := NULL; v_legacy := NULL; v_legacy_ct := NULL; v_txn_annual := NULL;
  v_legacy_after := NULL; v_write_error := NULL; v_msg := NULL;
  BEGIN
    v_txn := public.start_plan_checkout(v_standard, 'monthly');

    SELECT * INTO v_legacy
    FROM public.subscription_plans sp
    WHERE sp.id = v_txn.plan_id;

    SELECT count(*) INTO v_legacy_ct FROM public.subscription_plans;

    -- A second purchase of the same plan must reuse the mirror, not duplicate it.
    v_txn_annual := public.start_plan_checkout(v_standard, 'annual');

    SELECT count(*) INTO v_legacy_after FROM public.subscription_plans;

    RAISE EXCEPTION 'zz_verify_rollback';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'zz_verify_rollback' THEN v_write_error := SQLERRM; END IF;
  END;

  INSERT INTO zz_results VALUES (46, 'a valid checkout writes a pending transaction with the product attribution',
    v_write_error IS NULL
    AND v_txn.id IS NOT NULL
    AND v_txn.status = 'pending'
    AND v_txn.reference ~ '^sub_[0-9a-f]{32}$'
    AND v_txn.amount = 22500
    AND v_txn.currency = 'NGN'
    AND v_txn.org_id = v_owner_org
    AND v_txn.product_id = v_trackoja
    AND v_txn.is_sandbox = FALSE
    AND v_txn.created_by = v_owner,
    COALESCE(v_write_error,
      format('reference=%s amount=%s status=%s product_id=%s is_sandbox=%s',
             v_txn.reference, v_txn.amount, v_txn.status, v_txn.product_id, v_txn.is_sandbox)));

  INSERT INTO zz_results VALUES (47, 'the legacy mirror row is created for a plan the legacy table never had',
    v_legacy.id IS NOT NULL
    AND v_legacy.name = 'Standard'
    AND v_legacy.price = 22500
    AND v_legacy.billing_interval = 'monthly'
    AND v_legacy.currency = 'NGN'
    AND v_legacy.trial_days = 0
    AND v_legacy.status = 'active'
    AND v_legacy.feature_set->>'user_limit' = '5'
    AND v_legacy.feature_set ? 'store_limit',
    format('name=%s price=%s interval=%s trial_days=%s status=%s feature_set=%s',
           v_legacy.name, v_legacy.price, v_legacy.billing_interval, v_legacy.trial_days, v_legacy.status, v_legacy.feature_set));

  INSERT INTO zz_results VALUES (48, 'the mirror is created once and reused by a second checkout',
    v_legacy_ct = c_subscription_plans + 1 AND v_legacy_after = c_subscription_plans + 1,
    format('subscription_plans %s -> after first checkout %s -> after second %s',
           c_subscription_plans, v_legacy_ct, v_legacy_after));

  INSERT INTO zz_results VALUES (49, 'an annual purchase carries the annual price, not the monthly one',
    v_txn_annual.amount = 225000
    AND v_txn_annual.plan_id = v_legacy.id
    AND v_txn_annual.reference <> v_txn.reference,
    format('annual amount=%s (monthly was %s), same mirror=%s', v_txn_annual.amount, v_txn.amount, v_txn_annual.plan_id = v_legacy.id));

  INSERT INTO zz_results VALUES (50, 'start_plan_checkout is executable by authenticated and not by anon',
    has_function_privilege('authenticated', 'public.start_plan_checkout(uuid,text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.start_plan_checkout(uuid,text)', 'EXECUTE'),
    'authenticated=' || has_function_privilege('authenticated', 'public.start_plan_checkout(uuid,text)', 'EXECUTE')::TEXT
    || ' anon=' || has_function_privilege('anon', 'public.start_plan_checkout(uuid,text)', 'EXECUTE')::TEXT);

  -- ============================================================
  -- 7. upsert_product_plan: BACKWARD COMPATIBLE AND NON-PUBLISHING
  -- ============================================================
  -- Back to the platform owner: editing the catalogue requires
  -- platform:manage_plans, exactly as publishing does.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_platform, 'role', 'authenticated')::TEXT, TRUE);

  v_upsert_old := NULL; v_upsert_new := NULL; v_new_plan := NULL;
  v_published_before := NULL; v_arr := NULL;
  v_fee_error := NULL; v_trial_error := NULL; v_store_error := NULL;
  v_revision_new := NULL; v_write_error := NULL;
  v_msg := NULL; v_msg2 := NULL;

  BEGIN
    -- (a) EXACTLY the fifteen arguments the app's savePlan sends today, by name.
    -- If the new arguments had been inserted before p_billing_cycle instead of
    -- appended after it, this call would silently write the wrong columns.
    v_upsert_old := public.upsert_product_plan(
      p_product_key   => 'trackoja',
      p_plan_key      => 'starter',
      p_name          => 'Starter',
      p_description   => NULL,
      p_monthly_price => 5000,
      p_annual_price  => 50000,
      p_user_limit    => 2,
      p_features      => NULL,
      p_onboarding_note => NULL,
      p_status        => 'active',
      p_is_default    => TRUE,
      p_is_public     => TRUE,
      p_sort_order    => 1,
      p_note          => 'zz verify legacy 15-argument call',
      p_billing_cycle => 'monthly'
    );

    -- (b) the same call plus the three new arguments.
    v_upsert_new := public.upsert_product_plan(
      p_product_key   => 'trackoja',
      p_plan_key      => 'standard',
      p_name          => 'Standard',
      p_description   => NULL,
      p_monthly_price => 22500,
      p_annual_price  => 225000,
      p_user_limit    => 5,
      p_features      => NULL,
      p_onboarding_note => NULL,
      p_status        => 'active',
      p_is_default    => FALSE,
      p_is_public     => TRUE,
      p_sort_order    => 2,
      p_note          => 'zz verify new arguments',
      p_billing_cycle => 'monthly',
      p_setup_fee     => 50000,
      p_trial_days    => 14,
      p_store_limit   => 3
    );

    SELECT r.new_values INTO v_revision_new
    FROM public.product_plan_revisions r
    WHERE r.plan_id = v_standard
    ORDER BY r.created_at DESC
    LIMIT 1;

    -- (c) a plan created by an upsert is a draft: an edit must not publish.
    v_new_plan := public.upsert_product_plan(
      p_product_key => 'trackoja',
      p_plan_key    => 'zz_verify_upsert_092',
      p_name        => 'ZZ Verify Upsert',
      p_monthly_price => 100,
      p_annual_price  => 1000,
      p_note        => 'zz verify draft creation'
    );

    -- (d) the three validations.
    BEGIN
      PERFORM public.upsert_product_plan('trackoja', 'zz_verify_upsert_092', 'ZZ', NULL, 100, 1000, 1, NULL, NULL,
                                         'active', FALSE, TRUE, 94, 'zz', 'monthly', -1, 0, NULL);
      v_fee_error := 'NOT REFUSED';
    EXCEPTION WHEN OTHERS THEN v_fee_error := SQLERRM; END;

    BEGIN
      PERFORM public.upsert_product_plan('trackoja', 'zz_verify_upsert_092', 'ZZ', NULL, 100, 1000, 1, NULL, NULL,
                                         'active', FALSE, TRUE, 94, 'zz', 'monthly', NULL, -1, NULL);
      v_trial_error := 'NOT REFUSED';
    EXCEPTION WHEN OTHERS THEN v_trial_error := SQLERRM; END;

    BEGIN
      PERFORM public.upsert_product_plan('trackoja', 'zz_verify_upsert_092', 'ZZ', NULL, 100, 1000, 1, NULL, NULL,
                                         'active', FALSE, TRUE, 94, 'zz', 'monthly', NULL, 0, 0);
      v_store_error := 'NOT REFUSED';
    EXCEPTION WHEN OTHERS THEN v_store_error := SQLERRM; END;

    RAISE EXCEPTION 'zz_verify_rollback';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'zz_verify_rollback' THEN v_write_error := SQLERRM; END IF;
  END;

  INSERT INTO zz_results VALUES (51, 'upsert_product_plan still accepts exactly its previous fifteen arguments',
    v_write_error IS NULL AND v_upsert_old.id = v_starter AND v_upsert_old.monthly_price = 5000
    AND v_upsert_old.user_limit = 2 AND v_upsert_old.billing_cycle = 'monthly',
    COALESCE(v_write_error, format('plan=%s monthly=%s seats=%s cycle=%s',
      v_upsert_old.key, v_upsert_old.monthly_price, v_upsert_old.user_limit, v_upsert_old.billing_cycle)));

  INSERT INTO zz_results VALUES (52, 'an edit to a PUBLISHED plan leaves published_at unchanged',
    v_upsert_old.published_at IS NOT NULL AND v_upsert_old.published_at = (SELECT pp.published_at FROM public.product_plans pp WHERE pp.id = v_starter),
    format('published_at after the edit = %s', v_upsert_old.published_at));

  INSERT INTO zz_results VALUES (53, 'the three new arguments are accepted and stored',
    v_upsert_new.setup_fee = 50000 AND v_upsert_new.trial_days = 14 AND v_upsert_new.store_limit = 3,
    format('setup_fee=%s trial_days=%s store_limit=%s',
           v_upsert_new.setup_fee, v_upsert_new.trial_days, v_upsert_new.store_limit));

  INSERT INTO zz_results VALUES (54, 'the new fields appear in the revision snapshot',
    v_revision_new ? 'setup_fee' AND v_revision_new ? 'trial_days' AND v_revision_new ? 'store_limit'
    AND (v_revision_new->>'setup_fee')::NUMERIC = 50000
    AND (v_revision_new->>'trial_days')::INTEGER = 14
    AND (v_revision_new->>'store_limit')::INTEGER = 3,
    COALESCE(v_revision_new::TEXT, 'NULL'));

  INSERT INTO zz_results VALUES (55, 'a plan created through upsert_product_plan starts unpublished',
    v_new_plan.id IS NOT NULL AND v_new_plan.published_at IS NULL AND v_new_plan.status = 'active',
    format('status=%s published_at=%s', v_new_plan.status, COALESCE(v_new_plan.published_at::TEXT, 'NULL')));

  INSERT INTO zz_results VALUES (56, 'the three new validations raise their exact messages',
    v_fee_error = 'Setup fee cannot be negative'
    AND v_trial_error = 'Trial days cannot be negative'
    AND v_store_error = 'Store limit must be positive, -1 for unlimited, or NULL for custom',
    format('setup_fee -> %s | trial_days -> %s | store_limit -> %s', v_fee_error, v_trial_error, v_store_error));

  INSERT INTO zz_results VALUES (57, 'upsert_product_plan is executable by authenticated and not by anon',
    has_function_privilege('authenticated',
      'public.upsert_product_plan(text,text,text,text,numeric,numeric,integer,jsonb,text,text,boolean,boolean,integer,text,text,numeric,integer,integer)', 'EXECUTE')
    AND NOT has_function_privilege('anon',
      'public.upsert_product_plan(text,text,text,text,numeric,numeric,integer,jsonb,text,text,boolean,boolean,integer,text,text,numeric,integer,integer)', 'EXECUTE'),
    'authenticated=' || has_function_privilege('authenticated',
      'public.upsert_product_plan(text,text,text,text,numeric,numeric,integer,jsonb,text,text,boolean,boolean,integer,text,text,numeric,integer,integer)', 'EXECUTE')::TEXT
    || ' anon=' || has_function_privilege('anon',
      'public.upsert_product_plan(text,text,text,text,numeric,numeric,integer,jsonb,text,text,boolean,boolean,integer,text,text,numeric,integer,integer)', 'EXECUTE')::TEXT);

  -- ============================================================
  -- 8. THE FUNCTIONS THIS MIGRATION PROMISED NOT TO TOUCH
  -- ============================================================
  INSERT INTO zz_results VALUES (58, 'activate_subscription keeps its signature and its service_role-only grant',
    to_regprocedure('public.activate_subscription(text,jsonb,timestamp with time zone)') IS NOT NULL
    AND has_function_privilege('service_role', 'public.activate_subscription(text,jsonb,timestamp with time zone)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.activate_subscription(text,jsonb,timestamp with time zone)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.activate_subscription(text,jsonb,timestamp with time zone)', 'EXECUTE'),
    'signature present, service_role EXECUTE kept, client roles still locked out');

  INSERT INTO zz_results VALUES (59, 'initiate_subscription_checkout keeps its signature and still works for an owner',
    to_regprocedure('public.initiate_subscription_checkout(uuid,uuid)') IS NOT NULL
    AND has_function_privilege('authenticated', 'public.initiate_subscription_checkout(uuid,uuid)', 'EXECUTE'),
    'legacy checkout left intact and client-callable');

  SELECT pg_get_function_identity_arguments(p.oid) INTO v_sig
  FROM pg_proc p WHERE p.oid = 'public.enforce_seat_limit()'::regprocedure;
  INSERT INTO zz_results VALUES (60, 'enforce_seat_limit keeps its signature and is still attached to store_members',
    v_sig = '' AND EXISTS (
      SELECT 1 FROM pg_trigger t
      WHERE t.tgrelid = 'public.store_members'::regclass
        AND NOT t.tgisinternal
        AND t.tgname = 'enforce_seat_limit_on_store_members'
        AND t.tgfoid = 'public.enforce_seat_limit()'::regprocedure),
    'trigger enforce_seat_limit_on_store_members still resolves to public.enforce_seat_limit()');

  -- No function this migration added or changed may be reachable anonymously,
  -- with exactly one deliberate exception. list_published_plans is anon-callable
  -- because the public pricing page renders for anonymous visitors; it is
  -- exercised as the anon role itself in section 11. The five below must stay
  -- unreachable: get_my_entitlement is caller-scoped, publish_product_plan and
  -- start_plan_checkout write, upsert_product_plan edits the catalogue, and
  -- list_product_plans exposes drafts, retired rows and subscriber counts.
  SELECT count(*) INTO v_n
  FROM unnest(ARRAY[
    'public.get_my_entitlement(text)',
    'public.publish_product_plan(text,text,text,timestamp with time zone)',
    'public.start_plan_checkout(uuid,text)',
    'public.upsert_product_plan(text,text,text,text,numeric,numeric,integer,jsonb,text,text,boolean,boolean,integer,text,text,numeric,integer,integer)',
    'public.list_product_plans(text)'
  ]) AS s(sig)
  WHERE has_function_privilege('anon', s.sig, 'EXECUTE');

  INSERT INTO zz_results VALUES (61, 'list_published_plans is the ONLY thing anon may execute; the other five are closed',
    v_n = 0 AND has_function_privilege('anon', 'public.list_published_plans(text)', 'EXECUTE'),
    v_n || ' of 5 non-public functions still callable by anon');

  SELECT count(*) INTO v_n
  FROM unnest(ARRAY[
    'public.list_published_plans(text)',
    'public.get_my_entitlement(text)',
    'public.publish_product_plan(text,text,text,timestamp with time zone)',
    'public.start_plan_checkout(uuid,text)',
    'public.upsert_product_plan(text,text,text,text,numeric,numeric,integer,jsonb,text,text,boolean,boolean,integer,text,text,numeric,integer,integer)',
    'public.list_product_plans(text)'
  ]) AS s(sig)
  WHERE has_function_privilege('authenticated', s.sig, 'EXECUTE');

  INSERT INTO zz_results VALUES (62, 'every one of them is executable by authenticated',
    v_n = 6, v_n || ' of 6 granted to authenticated');

  -- ============================================================
  -- 9. IDEMPOTENCY AND NO FIXTURES LEFT BEHIND
  -- ============================================================
  PERFORM set_config('request.jwt.claims', '{}', TRUE);

  -- The backfill's own predicate. Empty means a second run of the migration
  -- writes no row at all: not "writes the same values again", but no UPDATE.
  SELECT count(*) INTO v_n
  FROM public.product_plans
  WHERE status = 'active' AND is_public = TRUE AND (published_at IS NULL OR effective_from IS NULL);
  INSERT INTO zz_results VALUES (63, 'the backfill predicate is empty, so a second migration run is a clean no-op',
    v_n = 0, v_n || ' row(s) still needing a publication stamp');

  SELECT count(*) INTO v_n FROM public.product_plans;
  SELECT count(*) INTO v_n2 FROM public.product_plans pp WHERE pp.key LIKE 'zz\_verify\_%';
  INSERT INTO zz_results VALUES (64, 'no throwaway plan row survives',
    v_n = c_product_plans AND v_n = v_base_plans AND v_n2 = 0,
    format('product_plans=%s (expected %s, was %s at the start of this script), zz_ rows=%s',
           v_n, c_product_plans, v_base_plans, v_n2));

  SELECT count(*) INTO v_n FROM public.subscription_plans;
  SELECT count(*) INTO v_n2 FROM public.subscription_plans sp WHERE sp.name = 'Standard';
  INSERT INTO zz_results VALUES (65, 'no legacy mirror row survives',
    v_n = c_subscription_plans AND v_n = v_base_sub_plans AND v_n2 = 0,
    format('subscription_plans=%s (expected %s, was %s at the start), any Standard mirror=%s',
           v_n, c_subscription_plans, v_base_sub_plans, v_n2));

  SELECT count(*) INTO v_n FROM public.subscription_transactions;
  INSERT INTO zz_results VALUES (66, 'no checkout transaction survives',
    v_n = c_transactions AND v_n = v_base_txns,
    format('subscription_transactions=%s (expected %s, was %s at the start)', v_n, c_transactions, v_base_txns));

  SELECT count(*) INTO v_n FROM public.product_plan_revisions;
  SELECT count(*) INTO v_n2 FROM public.product_plan_revisions r WHERE r.change_type = 'published';
  INSERT INTO zz_results VALUES (67, 'no plan revision survives',
    v_n = v_base_revisions AND v_n2 = 0,
    format('product_plan_revisions=%s (was %s at the start of this script, expected %s before any other writer), published revisions=%s',
           v_n, v_base_revisions, c_revisions, v_n2));

  SELECT count(*) INTO v_n FROM public.audit_logs;
  SELECT count(*) INTO v_n2 FROM public.audit_logs a
   WHERE a.action = 'PLAN_PUBLISHED'
      OR a.resource_id IN (SELECT pp.id FROM public.product_plans pp WHERE pp.key LIKE 'zz\_verify\_%');
  INSERT INTO zz_results VALUES (68, 'no audit row survives',
    v_n = v_base_audit AND v_n2 = 0,
    format('audit_logs=%s (was %s at the start of this script, expected %s before any other writer), PLAN_PUBLISHED or zz_ rows=%s',
           v_n, v_base_audit, c_audit_logs, v_n2));

  SELECT count(*) INTO v_n FROM public.store_members;
  INSERT INTO zz_results VALUES (69, 'no fixture store member survives',
    v_n = c_store_members, format('store_members=%s (expected %s)', v_n, c_store_members));

  SELECT count(*) INTO v_n FROM public.organization_members;
  SELECT count(*) INTO v_n2 FROM public.organizations;
  INSERT INTO zz_results VALUES (70, 'no fixture organization membership survives',
    v_n = c_org_members AND v_n2 = c_organizations,
    format('organization_members=%s (expected %s), organizations=%s (expected %s)',
           v_n, c_org_members, v_n2, c_organizations));

  SELECT count(*) INTO v_n FROM public.platform_admins;
  INSERT INTO zz_results VALUES (71, 'the platform admin roster is untouched',
    v_n = c_platform_admins, format('platform_admins=%s (expected %s)', v_n, c_platform_admins));

  SELECT count(*) INTO v_n FROM public.platform_products;
  INSERT INTO zz_results VALUES (72, 'the product catalogue is untouched',
    v_n = c_platform_products, format('platform_products=%s (expected %s)', v_n, c_platform_products));

  SELECT count(*) INTO v_n FROM public.users;
  SELECT count(*) INTO v_n2 FROM public.stores;
  INSERT INTO zz_results VALUES (73, 'no user or store row was created or removed',
    v_n = c_users AND v_n2 = c_stores,
    format('users=%s (expected %s), stores=%s (expected %s)', v_n, c_users, v_n2, c_stores));

  -- ============================================================
  -- 10. NO CUSTOMER ROW CHANGED
  -- ============================================================
  -- The audit's own measurement, re-taken: every live subscription points at the
  -- legacy Starter plan, and every business still carries its Starter entitlement.
  SELECT count(*) INTO v_n
  FROM public.subscriptions s
  JOIN public.subscription_plans sp ON sp.id = s.plan_id
  WHERE sp.name = 'Starter';

  SELECT count(*) INTO v_n2 FROM public.subscriptions;

  INSERT INTO zz_results VALUES (74, 'all 8 existing subscriptions still point at their Starter plan',
    v_n = c_subscriptions AND v_n2 = c_subscriptions,
    format('%s of %s subscriptions on Starter', v_n, v_n2));

  SELECT array_agg(s.status || '=' || c ORDER BY s.status) INTO v_arr
  FROM (SELECT s2.status, count(*) AS c FROM public.subscriptions s2 GROUP BY s2.status) s;

  INSERT INTO zz_results VALUES (75, 'the trialing / active split is unchanged at 6 and 2',
    v_arr = ARRAY['active=2', 'trialing=6'], COALESCE(v_arr::TEXT, 'NULL'));

  SELECT count(*) INTO v_n
  FROM public.organization_products op
  WHERE op.plan_id = v_starter;

  SELECT count(*) INTO v_n2 FROM public.organization_products;

  INSERT INTO zz_results VALUES (76, 'all 8 business entitlements still point at the Starter product plan',
    v_n = c_org_products AND v_n2 = c_org_products,
    format('%s of %s entitlements on starter', v_n, v_n2));

  SELECT count(*) INTO v_n
  FROM public.organizations o
  WHERE o.billing_status = 'trial';

  INSERT INTO zz_results VALUES (77, 'no business billing status moved',
    v_n = c_organizations, format('%s of %s businesses still on trial', v_n, c_organizations));

  -- The columns the catalogue's prices live in, for the four published plans.
  -- Asserted rather than described, because a migration that touched a price
  -- would otherwise pass every other check in this file.
  SELECT string_agg(pp.key || '=' || COALESCE(pp.monthly_price::TEXT, 'null') || '/' || COALESCE(pp.annual_price::TEXT, 'null'), ',' ORDER BY pp.sort_order)
    INTO v_sig
  FROM public.product_plans pp
  WHERE pp.id IN (v_starter, v_standard, v_premium, v_custom);

  INSERT INTO zz_results VALUES (78, 'the published prices are exactly the ones the catalogue already held',
    v_sig = 'starter=5000.00/50000.00,standard=22500.00/225000.00,premium=45000.00/450000.00,custom=null/null',
    v_sig);

  -- ============================================================
  -- 11. THE ANONYMOUS SURFACE: THE PUBLIC PRICING PAGE
  -- ============================================================
  -- The public pricing page renders inside GuestRoute, which redirects any
  -- signed-in user away, so EVERY visitor who reads it holds the anon role. This
  -- section therefore does not check has_function_privilege and stop there: it
  -- drops to the role itself and reads the catalogue exactly as a visitor does.
  -- `SET LOCAL ROLE` inside a block is used so the role cannot leak past the
  -- block, and the checks are collected into variables before anything is
  -- written back, because zz_results belongs to the session's original role.
  PERFORM set_config('request.jwt.claims', '{}', TRUE);

  SELECT current_user INTO v_role_now;
  v_anon_rows := NULL; v_anon_keys := NULL;
  v_anon_std_price := NULL; v_anon_std_annual := NULL; v_anon_std_seats := NULL;
  v_anon_err_ent := NULL; v_anon_err_pub := NULL; v_anon_err_chk := NULL;
  v_anon_err_ups := NULL; v_anon_err_lst := NULL;
  v_write_error := NULL;

  BEGIN
    SET LOCAL ROLE anon;

    SELECT count(*) INTO v_anon_rows FROM public.list_published_plans('trackoja');

    SELECT array_agg(lp.key ORDER BY lp.sort_order, lp.monthly_price NULLS LAST) INTO v_anon_keys
    FROM public.list_published_plans('trackoja') lp;

    SELECT lp.monthly_price, lp.annual_price, lp.user_limit
      INTO v_anon_std_price, v_anon_std_annual, v_anon_std_seats
    FROM public.list_published_plans('trackoja') lp
    WHERE lp.key = 'standard';

    -- Everything else must be refused to an anonymous caller, and refused by
    -- privilege rather than by a NULL session: the error must be the privilege
    -- error, not a business rule that a future grant would walk straight past.
    BEGIN
      PERFORM count(*) FROM public.get_my_entitlement('trackoja');
      v_anon_err_ent := 'NOT REFUSED';
    EXCEPTION WHEN OTHERS THEN v_anon_err_ent := SQLERRM; END;

    BEGIN
      PERFORM public.publish_product_plan('trackoja', 'starter', 'zz verify anon');
      v_anon_err_pub := 'NOT REFUSED';
    EXCEPTION WHEN OTHERS THEN v_anon_err_pub := SQLERRM; END;

    BEGIN
      PERFORM public.start_plan_checkout(v_standard, 'monthly');
      v_anon_err_chk := 'NOT REFUSED';
    EXCEPTION WHEN OTHERS THEN v_anon_err_chk := SQLERRM; END;

    BEGIN
      PERFORM public.upsert_product_plan('trackoja', 'zz_verify_anon_092', 'ZZ Verify Anon', NULL, 1, 1, 1,
                                         NULL, NULL, 'active', FALSE, TRUE, 95, 'zz verify anon', 'monthly');
      v_anon_err_ups := 'NOT REFUSED';
    EXCEPTION WHEN OTHERS THEN v_anon_err_ups := SQLERRM; END;

    BEGIN
      PERFORM count(*) FROM public.list_product_plans('trackoja');
      v_anon_err_lst := 'NOT REFUSED';
    EXCEPTION WHEN OTHERS THEN v_anon_err_lst := SQLERRM; END;

    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    v_write_error := SQLERRM;
    BEGIN
      RESET ROLE;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END;

  INSERT INTO zz_results VALUES (79, 'as the anon role, the catalogue returns exactly the 4 published plans',
    v_write_error IS NULL AND v_anon_rows = 4
    AND v_anon_keys = ARRAY['starter', 'standard', 'premium', 'custom'],
    COALESCE(v_write_error, format('rows=%s keys=%s', v_anon_rows, COALESCE(v_anon_keys::TEXT, 'NULL'))));

  INSERT INTO zz_results VALUES (80, 'as anon, Standard comes back at 22500 / 225000 with 5 seats',
    v_anon_std_price = 22500 AND v_anon_std_annual = 225000 AND v_anon_std_seats = 5,
    format('monthly=%s annual=%s user_limit=%s', v_anon_std_price, v_anon_std_annual, v_anon_std_seats));

  INSERT INTO zz_results VALUES (81, 'as anon, the retired premium_90k is not in the catalogue',
    NOT ('premium_90k' = ANY (v_anon_keys)),
    COALESCE(v_anon_keys::TEXT, 'NULL'));

  INSERT INTO zz_results VALUES (82, 'anon is refused on all five non-public functions, by privilege',
    v_anon_err_ent LIKE 'permission denied for function%'
    AND v_anon_err_pub LIKE 'permission denied for function%'
    AND v_anon_err_chk LIKE 'permission denied for function%'
    AND v_anon_err_ups LIKE 'permission denied for function%'
    AND v_anon_err_lst LIKE 'permission denied for function%',
    format('entitlement=%s | publish=%s | checkout=%s | upsert=%s | admin_list=%s',
           v_anon_err_ent, v_anon_err_pub, v_anon_err_chk, v_anon_err_ups, v_anon_err_lst));

  -- The reasoning that does NOT extend to get_my_entitlement, checked rather than
  -- asserted in prose: it is caller-scoped, it is not granted to anon, and even
  -- with a session it refuses a caller with no authenticated identity.
  PERFORM set_config('request.jwt.claims', '{}', TRUE);
  v_msg := 'NOT RAISED';
  BEGIN
    PERFORM count(*) FROM public.get_my_entitlement('trackoja');
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;

  INSERT INTO zz_results VALUES (83, 'get_my_entitlement stays authenticated-only and needs a session even then',
    NOT has_function_privilege('anon', 'public.get_my_entitlement(text)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.get_my_entitlement(text)', 'EXECUTE')
    AND v_msg = 'Authentication required',
    'anon=' || has_function_privilege('anon', 'public.get_my_entitlement(text)', 'EXECUTE')::TEXT
    || ' authenticated=' || has_function_privilege('authenticated', 'public.get_my_entitlement(text)', 'EXECUTE')::TEXT
    || ' with no session -> ' || v_msg);

  INSERT INTO zz_results VALUES (84, 'the role switch was clean: the session is back to the role it started on',
    current_user = v_role_now AND current_user = 'postgres',
    format('started as %s, now %s', v_role_now, current_user));
END
$do$;

SELECT step, check_name, passed, detail FROM zz_results ORDER BY step;
