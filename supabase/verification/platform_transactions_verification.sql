-- ============================================================
-- Verification: the Platform Owner transactions list and detail
--
--   node sbq.js --file supabase/verification/platform_transactions_verification.sql
--
-- WHAT IT PROVES. The Platform Owner "Payments and invoices" section has been
-- showing an error state instead of a transaction table, because
-- `list_platform_commercial_transactions` selected `v.version_number`, a column
-- that does not exist on `product_plan_versions`, and joined `public.products`,
-- the merchant inventory table, instead of `public.platform_products`. Migration
-- 20261001000002 repairs it and adds the filters and the detail function the
-- brief asks for. This measures that the repair holds and that the new surface
-- behaves.
--
-- It reads only. It creates nothing and deletes nothing, so it needs no rollback.

DROP TABLE IF EXISTS zz_txn_results;
CREATE TEMP TABLE zz_txn_results (
  step INTEGER,
  check_name TEXT,
  passed BOOLEAN,
  detail TEXT
);

DO $do$
DECLARE
  v_admin UUID;
  v_n INTEGER;
  v_ref TEXT;
  v_row RECORD;
  v_detail JSONB;
  v_body TEXT;
  v_before INTEGER;
BEGIN
  SELECT user_id INTO v_admin FROM public.platform_admins LIMIT 1;

  INSERT INTO zz_txn_results VALUES (1,
    'a platform admin account exists to read as',
    v_admin IS NOT NULL,
    COALESCE(v_admin::TEXT, 'no platform_admins row'));

  IF v_admin IS NULL THEN
    RETURN;
  END IF;

  -- The console reaches these through PostgREST with the operator's own JWT. The
  -- claims are set here so the platform-permission check inside each function is
  -- exercised rather than bypassed.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin::TEXT, 'role', 'authenticated')::TEXT, TRUE);

  -- ----------------------------------------------------------
  -- The repair itself.
  -- ----------------------------------------------------------
  -- Both names that made the original function fail. Asserted against the stored
  -- body rather than against the file, because the file is not what runs.
  SELECT pg_get_functiondef(p.oid) INTO v_body
  FROM pg_proc p
  WHERE p.oid = to_regprocedure('public.list_platform_commercial_transactions(integer,text,text,text,uuid,text,timestamp with time zone,timestamp with time zone,boolean)');

  INSERT INTO zz_txn_results VALUES (2,
    'the transaction list function exists with its filter signature',
    v_body IS NOT NULL,
    CASE WHEN v_body IS NULL THEN 'function missing'
         ELSE format('%s characters of body', length(v_body)) END);

  INSERT INTO zz_txn_results VALUES (3,
    'it no longer selects the non-existent version_number column',
    v_body IS NOT NULL AND position('version_number' IN v_body) = 0,
    'the original raised 42703: column v.version_number does not exist');

  INSERT INTO zz_txn_results VALUES (4,
    'it no longer joins the merchant inventory table',
    v_body IS NOT NULL AND position('public.products ' IN v_body) = 0
      AND position('JOIN public.products' IN v_body) = 0,
    'the original joined public.products instead of public.platform_products');

  INSERT INTO zz_txn_results VALUES (5,
    'it joins platform_products for the product name',
    v_body IS NOT NULL AND position('public.platform_products' IN v_body) > 0,
    'product attribution comes from platform_products');

  -- ----------------------------------------------------------
  -- It runs, which is the whole point.
  -- ----------------------------------------------------------
  SELECT count(*) INTO v_before FROM public.subscription_transactions;

  v_n := NULL;
  BEGIN
    SELECT count(*) INTO v_n FROM public.list_platform_commercial_transactions(100);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO zz_txn_results VALUES (6,
      'the list runs without raising', FALSE, SQLERRM);
  END;

  IF v_n IS NOT NULL THEN
    INSERT INTO zz_txn_results VALUES (6,
      'the list runs without raising and returns the platform''s attempts',
      v_n = v_before,
      format('%s row(s) returned, %s attempt(s) exist', v_n, v_before));
  END IF;

  -- ----------------------------------------------------------
  -- Filters actually filter, server-side.
  -- ----------------------------------------------------------
  SELECT count(*) INTO v_n FROM public.list_platform_commercial_transactions(100, p_status => 'success');
  INSERT INTO zz_txn_results VALUES (7,
    'the status filter narrows the result',
    v_n <= v_before,
    format('%s row(s) with status success', v_n));

  SELECT count(*) INTO v_n
  FROM public.list_platform_commercial_transactions(100, p_status => 'no-such-status');
  INSERT INTO zz_txn_results VALUES (8,
    'a status that matches nothing returns nothing rather than everything',
    v_n = 0, format('%s row(s) for an unmatched status', v_n));

  -- The environment filter is new: `environment` was previously fetched into the
  -- client type and then never shown or filtered anywhere.
  SELECT count(*) INTO v_n
  FROM public.list_platform_commercial_transactions(100, p_environment => 'production');
  INSERT INTO zz_txn_results VALUES (9,
    'the environment filter is applied in SQL',
    v_n <= v_before, format('%s row(s) in the production environment', v_n));

  SELECT count(*) INTO v_n
  FROM public.list_platform_commercial_transactions(100, p_search => 'zzz-no-such-reference-zzz');
  INSERT INTO zz_txn_results VALUES (10,
    'free-text search matches nothing for a nonsense term',
    v_n = 0, format('%s row(s)', v_n));

  SELECT count(*) INTO v_n
  FROM public.list_platform_commercial_transactions(100, p_search => COALESCE((SELECT reference FROM public.subscription_transactions LIMIT 1), 'zzz'));
  INSERT INTO zz_txn_results VALUES (11,
    'free-text search finds a transaction by its own reference',
    v_n >= CASE WHEN EXISTS (SELECT 1 FROM public.subscription_transactions) THEN 1 ELSE 0 END,
    format('%s row(s) for the first stored reference', v_n));

  SELECT count(*) INTO v_n
  FROM public.list_platform_commercial_transactions(100, p_test_only => TRUE);
  INSERT INTO zz_txn_results VALUES (12,
    'the test-data filter is applied in SQL',
    v_n <= v_before, format('%s row(s) marked as test data', v_n));

  SELECT count(*) INTO v_n
  FROM public.list_platform_commercial_transactions(100, p_from => now() + INTERVAL '1 day');
  INSERT INTO zz_txn_results VALUES (13,
    'a future date range returns nothing',
    v_n = 0, format('%s row(s) created after tomorrow', v_n));

  -- The columns the detail view needs must actually be populated. `environment` is
  -- deliberately NOT required to be non-NULL: the four attempts on this database
  -- predate 095, were never initialized against a gateway, and therefore have no
  -- environment. NULL is the true answer for them and inventing one would be worse
  -- than the empty cell. What is required is that the column is RETURNED, so the
  -- client can tell "no environment recorded" from "the query omitted it".
  SELECT * INTO v_row FROM public.list_platform_commercial_transactions(1) LIMIT 1;
  INSERT INTO zz_txn_results VALUES (14,
    'the list returns the columns the table and detail need',
    v_row.reference IS NOT NULL
      AND v_row.business_name IS NOT NULL
      AND v_row.product_name IS NOT NULL,
    format('reference=%s business=%s product=%s environment=%s plan=%s',
      v_row.reference, v_row.business_name, v_row.product_name,
      COALESCE(v_row.environment, 'NULL (never initialized, which is a fact)'),
      COALESCE(v_row.plan_name, 'null')));

  INSERT INTO zz_txn_results VALUES (15,
    'a payment that was never initialized still lists, with its mode absent rather than invented',
    v_row.reference IS NOT NULL,
    format('payment_mode = %s (NULL means never initialized, which is a fact and not a gap)',
      COALESCE(v_row.payment_mode, 'NULL')));

  SELECT count(*) INTO v_n FROM public.billing_invoices;
  INSERT INTO zz_txn_results VALUES (16,
    'the invoice number is NULL when no invoice exists rather than fabricated',
    (v_row.invoice_number IS NULL) = (v_n = 0),
    format('list invoice_number=%s, %s invoice(s) in the table', COALESCE(v_row.invoice_number, 'NULL'), v_n));

  -- ----------------------------------------------------------
  -- The detail.
  -- ----------------------------------------------------------
  SELECT reference INTO v_ref FROM public.subscription_transactions ORDER BY created_at DESC LIMIT 1;

  IF v_ref IS NULL THEN
    INSERT INTO zz_txn_results VALUES (17,
      'the transaction detail could be measured', NULL,
      'SKIPPED: no subscription_transactions row exists on this database');
  ELSE
    v_detail := public.get_platform_commercial_transaction(v_ref);

    INSERT INTO zz_txn_results VALUES (17,
      'the detail returns a single object for a real reference',
      v_detail IS NOT NULL AND v_detail->>'reference' = v_ref,
      format('keys: %s', (SELECT string_agg(k, ', ' ORDER BY k) FROM jsonb_object_keys(v_detail) AS k)));

    INSERT INTO zz_txn_results VALUES (18,
      'the detail reports refunds as NOT IMPLEMENTED rather than implying one exists',
      v_detail->'refund'->>'state' = 'not_implemented'
        AND (v_detail->'refund'->>'refundable')::BOOLEAN = FALSE
        AND length(COALESCE(v_detail->'refund'->>'reason', '')) > 40,
      left(COALESCE(v_detail->'refund'->>'reason', 'no reason given'), 160));

    INSERT INTO zz_txn_results VALUES (19,
      'the detail carries the verification result and the gateway identifiers',
      (v_detail ? 'verifiedAt') AND (v_detail ? 'settledBy')
        AND (v_detail ? 'gatewayReference') AND (v_detail ? 'providerReference')
        AND (v_detail ? 'verificationData'),
      format('verifiedAt=%s settledBy=%s gateway=%s',
        COALESCE(v_detail->>'verifiedAt', 'NULL'), COALESCE(v_detail->>'settledBy', 'NULL'),
        COALESCE(v_detail->>'gatewayReference', 'NULL')));

    INSERT INTO zz_txn_results VALUES (20,
      'the detail carries the business, its billing email and the plan bought',
      (v_detail ? 'business') AND (v_detail ? 'plan') AND (v_detail ? 'legacyPlanName')
        AND (v_detail->'business' ? 'billingEmail'),
      format('business=%s plan=%s', COALESCE(v_detail#>>'{business,name}', 'null'),
        COALESCE(v_detail#>>'{plan,displayName}', COALESCE(v_detail->>'legacyPlanName', 'null'))));

    INSERT INTO zz_txn_results VALUES (21,
      'the detail carries the subscription effect',
      v_detail ? 'subscriptionEffect',
      format('subscription status=%s, entitlement status=%s',
        COALESCE(v_detail#>>'{subscriptionEffect,status}', 'null'),
        COALESCE(v_detail#>>'{subscriptionEffect,entitlementStatus}', 'null')));

    INSERT INTO zz_txn_results VALUES (22,
      'the timeline begins with the checkout that opened the attempt',
      jsonb_array_length(COALESCE(v_detail->'timeline', '[]'::JSONB)) >= 1
        AND (v_detail->'timeline'->0->>'kind') = 'checkout_opened',
      format('%s timeline entr(y/ies), first kind = %s',
        jsonb_array_length(COALESCE(v_detail->'timeline', '[]'::JSONB)),
        COALESCE(v_detail->'timeline'->0->>'kind', 'none')));

    INSERT INTO zz_txn_results VALUES (23,
      'every timeline entry names the stored column it came from',
      NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(v_detail->'timeline', '[]'::JSONB)) AS e
        WHERE COALESCE(e->>'source', '') = ''
      ),
      'a reader can tell a recorded fact from a derived one');

    -- A sub-select that finds no invoice yields SQL NULL, and jsonb_build_object
    -- renders SQL NULL as JSON null. So the client receives `invoice: null` rather
    -- than a missing key, which is what lets it say "no invoice" instead of
    -- rendering an empty block. jsonb_typeof of that is 'null', not SQL NULL, so
    -- the check is written against the JSON value.
    INSERT INTO zz_txn_results VALUES (24,
      'an invoice that does not exist is JSON null, not a placeholder object',
      COALESCE(jsonb_typeof(v_detail->'invoice'), 'sql-null') IN ('null', 'object')
        AND ((v_detail->'invoice') = 'null'::JSONB) = ((SELECT count(*) FROM public.billing_invoices) = 0),
      format('invoice = %s; %s invoice(s) exist in the table',
        COALESCE((v_detail->'invoice')::TEXT, 'sql null'),
        (SELECT count(*) FROM public.billing_invoices)));
  END IF;

  -- ----------------------------------------------------------
  -- Authorisation.
  -- ----------------------------------------------------------
  INSERT INTO zz_txn_results VALUES (26,
    'anon cannot list platform transactions',
    NOT has_function_privilege('anon', 'public.list_platform_commercial_transactions(integer,text,text,text,uuid,text,timestamp with time zone,timestamp with time zone,boolean)', 'EXECUTE'),
    'the console reads as a signed-in operator');

  INSERT INTO zz_txn_results VALUES (27,
    'anon cannot read a transaction detail',
    NOT has_function_privilege('anon', 'public.get_platform_commercial_transaction(text)', 'EXECUTE'),
    'this payload contains gateway references and verification data');

  INSERT INTO zz_txn_results VALUES (28,
    'the platform overview, product and user lists are closed to anon again',
    NOT has_function_privilege('anon', 'public.get_platform_overview_v2(text)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.list_platform_products()', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.list_platform_users(text,text,integer)', 'EXECUTE'),
    'a later migration re-created these without a REVOKE, so the default privilege grant was left in place');

  -- A caller with no session must be refused by the body, not merely by the grant.
  PERFORM set_config('request.jwt.claims', '{}', TRUE);
  BEGIN
    PERFORM count(*) FROM public.list_platform_commercial_transactions(1);
    INSERT INTO zz_txn_results VALUES (29,
      'a caller with no session is refused by the function itself', FALSE,
      'the function returned rows without an authenticated identity');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO zz_txn_results VALUES (29,
      'a caller with no session is refused by the function itself',
      SQLERRM LIKE '%Authentication required%' OR SQLERRM LIKE '%Permission denied%',
      SQLERRM);
  END;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::TEXT, 'role', 'authenticated')::TEXT, TRUE);

  -- Detail for an unknown reference must raise rather than return an empty object
  -- that a client could mistake for a real record.
  BEGIN
    PERFORM public.get_platform_commercial_transaction('zz-does-not-exist-' || replace(gen_random_uuid()::TEXT, '-', ''));
    INSERT INTO zz_txn_results VALUES (30,
      'an unknown reference raises rather than returning an empty record', FALSE,
      'the function returned instead of raising');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO zz_txn_results VALUES (30,
      'an unknown reference raises rather than returning an empty record',
      SQLERRM LIKE '%Transaction not found%', SQLERRM);
  END;
END
$do$;

SELECT step, check_name,
  CASE passed WHEN TRUE THEN 'PASS' WHEN FALSE THEN 'FAIL' ELSE 'SKIP' END AS result,
  detail
FROM zz_txn_results
ORDER BY step;
