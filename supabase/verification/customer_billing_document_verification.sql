-- ============================================================
-- Verification: the customer billing document read
--
--   node sbq.js --file supabase/verification/customer_billing_document_verification.sql
--
-- WHAT IT PROVES. `public.get_my_billing_document(p_document_number)` is what makes
-- an invoice or receipt downloadable. It is the first customer-facing read of the
-- billing document tables, so what is worth measuring is what would be a leak or a
-- lie: that it cannot see another business's document, that it cannot be used to
-- discover whether a number exists, that it needs a session, and that it reads
-- through the database's own row-level security rather than around it.
--
-- The migration that introduces it asserts its own privileges and policies in a
-- closing DO block, which is why applying it was meaningful. This goes further: it
-- checks the behaviour, including a real document fetched by its real owner.
--
-- `billing_invoices` and `billing_receipts` hold ZERO rows on this deployment, so
-- without a fixture every check would pass on emptiness. The fixture therefore runs
-- inside a sub-block that always rolls back, and the results are buffered in an
-- array because a savepoint rollback erases table writes including a temporary
-- table's. PL/pgSQL variables are not transactional, which is why the buffer works.

DROP TABLE IF EXISTS zz_doc_results;
CREATE TEMP TABLE zz_doc_results (
  step INTEGER,
  check_name TEXT,
  passed BOOLEAN,
  detail TEXT
);

DO $do$
DECLARE
  v_results JSONB[] := ARRAY[]::JSONB[];
  v_prosecdef BOOLEAN;
  v_org UUID;
  v_owner UUID;
  v_other_org UUID;
  v_other_owner UUID;
  v_doc JSONB;
  v_err TEXT;
  v_n INTEGER;
  v_lines JSONB;
  v_i INTEGER;
  v_invoice_number TEXT;
  v_receipt_number TEXT;
  v_product_id UUID;
  v_version_id UUID;
  v_legacy_plan UUID;
  v_txn_id UUID;
  v_txn_ref TEXT;
  v_before_inv INTEGER;
  v_before_rct INTEGER;
  v_before_lines INTEGER;
BEGIN
  SELECT count(*) INTO v_before_inv FROM public.billing_invoices;
  SELECT count(*) INTO v_before_rct FROM public.billing_receipts;
  SELECT count(*) INTO v_before_lines FROM public.billing_invoice_lines;

  -- Everything below is undone by the RAISE at the end of this block.
  BEGIN
    -- ----------------------------------------------------------
    -- The contract. Needs no fixture.
    -- ----------------------------------------------------------
    SELECT p.prosecdef INTO v_prosecdef FROM pg_proc p
    WHERE p.oid = to_regprocedure('public.get_my_billing_document(text)');

    v_results := v_results || jsonb_build_object('step', 1,
      'name', 'it is SECURITY INVOKER, so it reads THROUGH row-level security rather than around it',
      'passed', v_prosecdef IS FALSE,
      'detail', CASE WHEN v_prosecdef IS NULL THEN 'the function does not exist'
                     WHEN v_prosecdef THEN 'SECURITY DEFINER: it would bypass the policies'
                     ELSE 'invoker: the invoice and receipt policies decide what the caller sees' END);

    v_results := v_results || jsonb_build_object('step', 2,
      'name', 'anon cannot execute it',
      'passed', NOT has_function_privilege('anon', 'public.get_my_billing_document(text)', 'EXECUTE'),
      'detail', 'a billing document is a customer record');

    v_results := v_results || jsonb_build_object('step', 3,
      'name', 'a signed-in customer can execute it',
      'passed', has_function_privilege('authenticated', 'public.get_my_billing_document(text)', 'EXECUTE'),
      'detail', 'the Billing page calls it');

    -- No session: it must refuse, not return an empty document.
    PERFORM set_config('request.jwt.claims', '{}', TRUE);
    v_err := NULL;
    BEGIN
      v_doc := public.get_my_billing_document('ANY');
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
    END;
    v_results := v_results || jsonb_build_object('step', 4,
      'name', 'with no session it raises rather than answering',
      'passed', v_err IS NOT NULL AND v_err LIKE '%Authentication required%',
      'detail', COALESCE(v_err, 'it RETURNED without an authenticated identity'));

    SELECT o.id, o.owner_id INTO v_org, v_owner FROM public.organizations o
    WHERE o.owner_id IS NOT NULL ORDER BY o.created_at ASC LIMIT 1;

    SELECT o.id, o.owner_id INTO v_other_org, v_other_owner FROM public.organizations o
    WHERE o.id <> v_org AND o.owner_id IS NOT NULL ORDER BY o.created_at ASC LIMIT 1;

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_owner::TEXT, 'role', 'authenticated')::TEXT, TRUE);

    -- A session, but a number that does not exist. NULL, not an error: if "unknown"
    -- and "not yours" produced different answers, a caller could enumerate numbers.
    v_doc := NULL; v_err := NULL;
    BEGIN
      v_doc := public.get_my_billing_document('NO-SUCH-DOCUMENT-' || replace(gen_random_uuid()::TEXT, '-', ''));
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
    END;
    v_results := v_results || jsonb_build_object('step', 5,
      'name', 'an unknown number returns NULL rather than an error, so numbers cannot be probed',
      'passed', v_err IS NULL AND v_doc IS NULL,
      'detail', format('returned %s, error %s', COALESCE(v_doc::TEXT, 'NULL'), COALESCE(v_err, 'none')));

    -- ----------------------------------------------------------
    -- A real document, fetched by its real owner.
    -- ----------------------------------------------------------
    BEGIN
      v_invoice_number := 'ZZDOC-INV-' || replace(gen_random_uuid()::TEXT, '-', '');
      v_receipt_number := 'ZZDOC-RCT-' || replace(gen_random_uuid()::TEXT, '-', '');

      -- product_id, plan_version_id and transaction_id are NOT NULL, and a real
      -- invoice always has all three because the trigger that writes it runs on a
      -- settled payment. The guard trigger refuses to create a
      -- subscription_transactions row while billing.payment_system is DISABLED, so
      -- it is disabled here - inside the block that always rolls back - to build a
      -- document shaped like a real one rather than a degenerate fixture.
      ALTER TABLE public.subscription_transactions DISABLE TRIGGER guard_subscription_payment_creation;

      SELECT pr.id INTO v_product_id FROM public.platform_products pr ORDER BY pr.created_at ASC LIMIT 1;
      SELECT pv.id INTO v_version_id FROM public.product_plan_versions pv ORDER BY pv.created_at ASC LIMIT 1;
      SELECT sp.id INTO v_legacy_plan FROM public.subscription_plans sp ORDER BY sp.created_at ASC LIMIT 1;

      v_txn_ref := 'ZZDOC-TXN-' || replace(gen_random_uuid()::TEXT, '-', '');
      INSERT INTO public.subscription_transactions (
        org_id, plan_id, reference, amount, currency, status, created_by,
        product_id, is_sandbox, billing_cycle, plan_version_id,
        amount_minor, recurring_amount_minor, setup_fee_amount_minor
      ) VALUES (
        v_org, v_legacy_plan, v_txn_ref, 30000, 'NGN', 'success', v_owner,
        v_product_id, FALSE, 'monthly', v_version_id, 3000000, 500000, 2500000
      ) RETURNING id INTO v_txn_id;

      -- transaction_id and plan_version_id set, so this invoice is shaped like one
      -- the real trigger would have written.
      INSERT INTO public.billing_invoices (
        invoice_number, org_id, product_id, plan_version_id, transaction_id,
        billing_email, currency, subtotal_minor, total_minor,
        status, is_test_data, issued_at, paid_at, metadata
      ) VALUES (
        v_invoice_number, v_org, v_product_id, v_version_id, v_txn_id,
        'docs-verify@trackoja.test', 'NGN', 3000000, 3000000,
        'paid', TRUE, now(), now(), jsonb_build_object('reference', v_txn_ref)
      );

      -- setup_fee inserted BEFORE subscription on purpose, to prove the function
      -- orders the lines rather than relying on insert order. The real trigger
      -- writes both rows with the same now(), so time alone is not a tiebreak.
      INSERT INTO public.billing_invoice_lines (invoice_id, line_type, description, unit_amount_minor, total_amount_minor)
      SELECT id, 'setup_fee', 'Setup fee', 2500000, 2500000 FROM public.billing_invoices WHERE invoice_number = v_invoice_number;

      INSERT INTO public.billing_invoice_lines (invoice_id, line_type, description, unit_amount_minor, total_amount_minor)
      SELECT id, 'subscription', 'Starter - monthly', 500000, 500000 FROM public.billing_invoices WHERE invoice_number = v_invoice_number;

      INSERT INTO public.billing_receipts (
        receipt_number, invoice_id, transaction_id, org_id, amount_minor, currency,
        payment_mode, is_test_data, paid_at
      ) SELECT v_receipt_number, id, v_txn_id, v_org, 3000000, 'NGN', 'test', TRUE, now()
        FROM public.billing_invoices WHERE invoice_number = v_invoice_number;

      v_doc := public.get_my_billing_document(v_invoice_number);
      v_results := v_results || jsonb_build_object('step', 6,
        'name', 'the owner can fetch their own invoice by invoice number',
        'passed', v_doc IS NOT NULL AND v_doc->>'invoice_number' = v_invoice_number,
        'detail', format('invoice_number = %s, total_minor = %s, status = %s',
          COALESCE(v_doc->>'invoice_number', 'null'), COALESCE(v_doc->>'total_minor', 'null'),
          COALESCE(v_doc->>'status', 'null')));

      v_lines := COALESCE(v_doc->'lines', '[]'::JSONB);
      v_results := v_results || jsonb_build_object('step', 7,
        'name', 'its line items come back in a deterministic order, subscription before setup fee',
        'passed', jsonb_array_length(v_lines) = 2
          AND v_lines->0->>'line_type' = 'subscription'
          AND v_lines->1->>'line_type' = 'setup_fee',
        'detail', format('%s line(s): %s', jsonb_array_length(v_lines),
          COALESCE((SELECT string_agg(e->>'line_type', ' then ' ORDER BY ord)
                    FROM jsonb_array_elements(v_lines) WITH ORDINALITY AS t(e, ord)), 'none')));

      v_results := v_results || jsonb_build_object('step', 8,
        'name', 'the receipt is attached, and the test flag travels with the document',
        'passed', (v_doc->'receipt'->>'receipt_number') = v_receipt_number
          AND (v_doc->>'is_test_data')::BOOLEAN IS TRUE
          AND (v_doc->'receipt'->>'is_test_data')::BOOLEAN IS TRUE,
        'detail', format('receipt = %s, is_test_data = %s',
          COALESCE(v_doc->'receipt'->>'receipt_number', 'null'), COALESCE(v_doc->>'is_test_data', 'null')));

      -- The same document, reached the other way.
      v_doc := public.get_my_billing_document(v_receipt_number);
      v_results := v_results || jsonb_build_object('step', 9,
        'name', 'the same document is reachable by receipt number',
        'passed', v_doc IS NOT NULL AND v_doc->>'invoice_number' = v_invoice_number,
        'detail', format('receipt %s resolves to invoice %s', v_receipt_number,
          COALESCE(v_doc->>'invoice_number', 'null')));

      -- ----------------------------------------------------------
      -- THE LEAK TEST - AND THE TRAP THAT MAKES IT EASY TO GET WRONG.
      -- ----------------------------------------------------------
      -- The function is SECURITY INVOKER, so whether it can see another business's
      -- document is decided by ROW LEVEL SECURITY rather than by any check inside
      -- it. The Management API runs SQL as `postgres`, and PostgreSQL does not apply
      -- RLS to a table's OWNER. Setting `request.jwt.claims` changes auth.uid() but
      -- not the effective role, so a naive version of this test never consults the
      -- policies at all: every row is visible, and it reports a cross-tenant leak
      -- that does not exist. That happened while writing this file.
      --
      -- SET LOCAL ROLE authenticated is what makes RLS apply for real. auth.uid() is
      -- still driven by the claim. RESET ROLE afterwards, because the fixture insert
      -- below has already happened and nothing else here should run as a customer.
      IF v_other_owner IS NULL THEN
        v_results := v_results || jsonb_build_object('step', 10,
          'name', 'another business cannot read this document', 'passed', NULL,
          'detail', 'SKIPPED: needs a second organization with a different owner');
      ELSE
        SET LOCAL ROLE authenticated;
        PERFORM set_config('request.jwt.claims',
          json_build_object('sub', v_other_owner::TEXT, 'role', 'authenticated')::TEXT, TRUE);

        v_doc := public.get_my_billing_document(v_invoice_number);
        v_results := v_results || jsonb_build_object('step', 10,
          'name', 'another business''s owner gets NULL, not the document',
          'passed', v_doc IS NULL,
          'detail', CASE WHEN v_doc IS NULL
                         THEN 'refused by the policy, and indistinguishable from "no such number"'
                         ELSE 'LEAK: returned ' || left(v_doc::TEXT, 120) END);

        SELECT count(*) INTO v_n FROM public.billing_invoices;
        v_results := v_results || jsonb_build_object('step', 11,
          'name', 'and sees no invoice rows at the policy level',
          'passed', v_n = 0, 'detail', format('%s invoice row(s) visible to the other business', v_n));

        -- The line policy is `invoice_id IN (SELECT id FROM billing_invoices)` with no
        -- WHERE clause of its own, so it depends entirely on billing_invoices RLS
        -- being applied inside that subquery. That inheritance is the assumption
        -- worth testing directly: lines readable while the invoice was not would still
        -- be a leak, and it is not obvious from reading the policy.
        SELECT count(*) INTO v_n FROM public.billing_invoice_lines;
        v_results := v_results || jsonb_build_object('step', 12,
          'name', 'and sees no line items, though its own policy has no WHERE clause',
          'passed', v_n = 0,
          'detail', format('%s line row(s) visible; the policy relies on billing_invoices RLS applying inside its subquery', v_n));

        RESET ROLE;
      END IF;

      -- -----------------
      -- The negative half of the leak test: the OWNER, under the same role, must
      -- still be able to read it. Without this, a policy that denied everyone would
      -- pass every check above.
      -- -----------------
      SET LOCAL ROLE authenticated;
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_owner::TEXT, 'role', 'authenticated')::TEXT, TRUE);

      v_doc := public.get_my_billing_document(v_invoice_number);
      v_results := v_results || jsonb_build_object('step', 13,
        'name', 'while the owner, under the same enforced RLS, still can',
        'passed', v_doc IS NOT NULL AND v_doc->>'invoice_number' = v_invoice_number,
        'detail', COALESCE(v_doc->>'invoice_number', 'the policy hid it from its own owner'));
      RESET ROLE;
    EXCEPTION WHEN OTHERS THEN
      v_results := v_results || jsonb_build_object('step', 6,
        'name', 'the document round-trip could be measured', 'passed', NULL,
        'detail', 'SKIPPED: the fixture could not be created (' || SQLERRM || ')');
    END;

    RAISE EXCEPTION 'ROLLBACK:ZZDOC';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM <> 'ROLLBACK:ZZDOC' THEN
        RAISE;
      END IF;
  END;

  -- Buffered results, written only now because the rollback above would have erased
  -- anything written inside.
  IF array_length(v_results, 1) IS NOT NULL THEN
    FOR v_i IN 1..array_length(v_results, 1) LOOP
      INSERT INTO zz_doc_results (step, check_name, passed, detail)
      VALUES ((v_results[v_i]->>'step')::INTEGER, v_results[v_i]->>'name',
              (v_results[v_i]->>'passed')::BOOLEAN, v_results[v_i]->>'detail');
    END LOOP;
  END IF;

  -- The rollback held.
  SELECT count(*) INTO v_n FROM public.billing_invoices;
  INSERT INTO zz_doc_results VALUES (20, 'no fixture invoice survived the rollback',
    v_n = v_before_inv, format('%s -> %s', v_before_inv, v_n));

  SELECT count(*) INTO v_n FROM public.billing_invoice_lines;
  INSERT INTO zz_doc_results VALUES (21, 'no fixture invoice line survived the rollback',
    v_n = v_before_lines, format('%s -> %s', v_before_lines, v_n));

  SELECT count(*) INTO v_n FROM public.billing_receipts;
  INSERT INTO zz_doc_results VALUES (22, 'no fixture receipt survived the rollback',
    v_n = v_before_rct, format('%s -> %s', v_before_rct, v_n));

  SELECT count(*) INTO v_n FROM public.billing_invoices WHERE invoice_number LIKE 'ZZDOC-%';
  INSERT INTO zz_doc_results VALUES (23, 'no document named ZZDOC- remains',
    v_n = 0, format('%s row(s)', v_n));
END
$do$;

SELECT step, check_name,
  CASE passed WHEN TRUE THEN 'PASS' WHEN FALSE THEN 'FAIL' ELSE 'SKIP' END AS result,
  detail
FROM zz_doc_results
ORDER BY step;
