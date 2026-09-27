-- Verifies suppliers and expenses. Builds its own fixture (an organization with two
-- stores, the owner a member of only the first) and removes it afterwards.

DROP TABLE IF EXISTS zz_exp_results;
CREATE TEMP TABLE zz_exp_results (step int, check_name text, passed boolean, detail text);

DO $$
DECLARE
  v_uid uuid;
  v_org uuid;
  v_store_a uuid;
  v_store_b uuid;
  v_role uuid;
  v_supplier uuid;
  v_expense public.expenses;
  v_msg text;
  v_rows integer;
  v_total numeric;
  v_share numeric;
  v_cat text;
  v_member uuid;
BEGIN
  SELECT id INTO v_uid FROM public.users WHERE email = 'owner@trackoja.test';
  IF v_uid IS NULL THEN
    INSERT INTO zz_exp_results VALUES (0, 'precondition: test user exists', false, 'missing');
    RETURN;
  END IF;

  INSERT INTO public.organizations (name, slug, owner_id, timezone, business_category, trial_ends_at)
  VALUES ('ZZ Expense Test', 'zz-expense-test', v_uid, 'UTC', 'supermarket', now() + interval '14 days')
  RETURNING id INTO v_org;

  INSERT INTO public.stores (org_id, name, slug, created_by, currency, timezone)
  VALUES (v_org, 'ZZ Store A', 'zz-store-a', v_uid, 'NGN', 'UTC') RETURNING id INTO v_store_a;

  INSERT INTO public.stores (org_id, name, slug, created_by, currency, timezone)
  VALUES (v_org, 'ZZ Store B', 'zz-store-b', v_uid, 'NGN', 'UTC') RETURNING id INTO v_store_b;

  SELECT id INTO v_role FROM public.roles WHERE name = 'owner' AND is_system LIMIT 1;

  -- Member of store A only, so store B is a genuine isolation test.
  INSERT INTO public.store_members (store_id, user_id, role_id, status)
  VALUES (v_store_a, v_uid, v_role, 'active');

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, false);

  -- ============================================================
  -- SUPPLIERS
  -- ============================================================
  SELECT id INTO v_supplier FROM public.create_supplier(
    p_store_id := v_store_a, p_name := 'Dangote Cement', p_phone := '08030000000',
    p_payment_terms := 'Net 14') s;

  INSERT INTO zz_exp_results VALUES (1, 'a supplier can be created',
    v_supplier IS NOT NULL, format('supplier=%s', left(coalesce(v_supplier::text,'?'),8)));

  v_msg := NULL;
  BEGIN
    PERFORM public.create_supplier(p_store_id := v_store_a, p_name := 'dangote cement');
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO zz_exp_results VALUES (2, 'a duplicate supplier name differing only in case is refused',
    coalesce(v_msg,'') LIKE '%already have a supplier%', coalesce(v_msg, 'duplicate accepted'));

  v_msg := NULL;
  BEGIN
    PERFORM public.create_supplier(p_store_id := v_store_a, p_name := '   ');
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO zz_exp_results VALUES (3, 'a supplier with a blank name is refused',
    coalesce(v_msg,'') LIKE '%needs a name%', coalesce(v_msg, 'blank name accepted'));

  -- ============================================================
  -- EXPENSES
  -- ============================================================
  v_expense := public.create_expense(
    p_store_id := v_store_a, p_description := 'Cement restock', p_amount := 145000.567,
    p_category := 'stock', p_spent_on := current_date, p_payment_method := 'transfer',
    p_supplier_id := v_supplier, p_reference := 'TRF-001');

  INSERT INTO zz_exp_results VALUES (4, 'an expense can be recorded against a supplier',
    v_expense.id IS NOT NULL AND v_expense.amount = 145000.57,
    format('amount=%s (sent 145000.567, stored to 2dp)', v_expense.amount));

  INSERT INTO zz_exp_results VALUES (5, 'the expense is attributed to the recording user',
    v_expense.recorded_by = v_uid, format('recorded_by matches=%s', v_expense.recorded_by = v_uid));

  -- A second expense in another category, for the summary.
  PERFORM public.create_expense(
    p_store_id := v_store_a, p_description := 'Generator fuel', p_amount := 25000,
    p_category := 'utilities', p_payment_method := 'cash');

  v_msg := NULL;
  BEGIN
    PERFORM public.create_expense(p_store_id := v_store_a, p_description := 'Zero', p_amount := 0);
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO zz_exp_results VALUES (6, 'a zero or negative amount is refused',
    coalesce(v_msg,'') LIKE '%greater than zero%', coalesce(v_msg, 'zero accepted'));

  v_msg := NULL;
  BEGIN
    PERFORM public.create_expense(p_store_id := v_store_a, p_description := '   ', p_amount := 100);
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO zz_exp_results VALUES (7, 'an expense with no description is refused',
    coalesce(v_msg,'') LIKE '%Describe what the expense%', coalesce(v_msg, 'blank accepted'));

  v_msg := NULL;
  BEGIN
    PERFORM public.create_expense(
      p_store_id := v_store_a, p_description := 'Tomorrow', p_amount := 100,
      p_spent_on := current_date + 1);
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO zz_exp_results VALUES (8, 'an expense dated in the future is refused',
    coalesce(v_msg,'') LIKE '%cannot be dated in the future%', coalesce(v_msg, 'future date accepted'));

  -- A supplier attached from a store the caller cannot even see.
  v_msg := NULL;
  BEGIN
    PERFORM public.create_expense(
      p_store_id := v_store_b, p_description := 'Cross store', p_amount := 500);
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO zz_exp_results VALUES (9, 'recording an expense in a store you do not belong to is refused',
    v_msg IS NOT NULL, coalesce(v_msg, 'accepted a foreign store'));

  -- ============================================================
  -- SUMMARY AND LISTING
  -- ============================================================
  SELECT count(*)::integer, COALESCE(SUM(t.total), 0)
  INTO v_rows, v_total FROM public.expense_summary(v_store_a, current_date, current_date) t;

  INSERT INTO zz_exp_results VALUES (10, 'the summary groups by category with a correct total',
    v_rows = 2 AND v_total = 170000.57, format('categories=%s total=%s', v_rows, v_total));

  SELECT t.category, t.share INTO v_cat, v_share
  FROM public.expense_summary(v_store_a, current_date, current_date) t
  ORDER BY t.total DESC LIMIT 1;

  INSERT INTO zz_exp_results VALUES (11, 'the largest category holds the right share of spending',
    v_cat = 'stock' AND v_share > 85 AND v_share < 86, format('%s = %s%%', v_cat, v_share));

  SELECT count(*)::integer INTO v_rows FROM public.list_expenses(v_store_a, current_date, current_date);
  INSERT INTO zz_exp_results VALUES (12, 'listing for today returns both entries',
    v_rows = 2, format('rows=%s', v_rows));

  SELECT count(*)::integer INTO v_rows FROM public.list_expenses(v_store_a, current_date, current_date, 'stock');
  INSERT INTO zz_exp_results VALUES (13, 'listing can be filtered by category',
    v_rows = 1, format('stock rows=%s', v_rows));

  SELECT count(*)::integer INTO v_rows
  FROM public.list_expenses(v_store_a, current_date - 10, current_date - 5);
  INSERT INTO zz_exp_results VALUES (14, 'listing respects the date window',
    v_rows = 0, format('rows in an earlier window=%s', v_rows));

  SELECT count(*)::integer INTO v_rows
  FROM public.list_suppliers(v_store_a) s WHERE s.expense_total = 145000.57;
  INSERT INTO zz_exp_results VALUES (15, 'the supplier list totals spending per supplier',
    v_rows = 1, format('suppliers with that total=%s', v_rows));

  -- ============================================================
  -- DELETION IS AUDITED AND PERMISSION-CHECKED
  -- ============================================================
  PERFORM public.delete_expense(v_expense.id);
  SELECT count(*)::integer INTO v_rows FROM public.expenses WHERE id = v_expense.id;
  INSERT INTO zz_exp_results VALUES (16, 'an authorised deletion removes the expense',
    v_rows = 0, format('rows remaining=%s', v_rows));

  SELECT count(*)::integer INTO v_rows FROM public.audit_logs
  WHERE resource_id = v_expense.id AND action = 'EXPENSE_DELETED';
  INSERT INTO zz_exp_results VALUES (17, 'the deletion outlives the row in the audit trail',
    v_rows = 1, format('audit rows=%s', v_rows));

  -- A cashier may record but not delete.
  SELECT sm.user_id INTO v_member FROM public.store_members sm WHERE sm.store_id = v_store_b LIMIT 1;
  v_msg := NULL;
  BEGIN
    PERFORM public.delete_expense((SELECT e.id FROM public.expenses e WHERE e.store_id = v_store_a LIMIT 1));
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO zz_exp_results VALUES (18, 'the audit trail records who recorded an expense',
    (SELECT count(*) FROM public.audit_logs WHERE store_id = v_store_a AND action = 'EXPENSE_RECORDED') = 2,
    'EXPENSE_RECORDED rows for the store');

  -- ============================================================
  -- CLEAN UP
  -- ============================================================
  DELETE FROM public.audit_logs WHERE store_id IN (v_store_a, v_store_b);
  DELETE FROM public.expenses WHERE store_id IN (v_store_a, v_store_b);
  DELETE FROM public.suppliers WHERE store_id IN (v_store_a, v_store_b);
  DELETE FROM public.stores WHERE id IN (v_store_a, v_store_b);
  DELETE FROM public.organizations WHERE id = v_org;
  PERFORM set_config('request.jwt.claims', '', false);
  INSERT INTO zz_exp_results VALUES (99, 'test data removed', true, 'fixture organization deleted');
END $$;

SELECT step, check_name, passed, detail FROM zz_exp_results ORDER BY step;
