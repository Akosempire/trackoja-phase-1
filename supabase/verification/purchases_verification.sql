-- Verifies purchases. Builds its own fixture and removes it afterwards.

DROP TABLE IF EXISTS zz_pur_results;
CREATE TEMP TABLE zz_pur_results (step int, check_name text, passed boolean, detail text);

DO $$
DECLARE
  v_uid uuid; v_org uuid; v_store uuid; v_role uuid;
  v_supplier uuid; v_product uuid; v_purchase public.purchases;
  v_msg text; v_lot uuid; v_lot_supplier uuid; v_lot_cost numeric;
  v_expense numeric; v_rows integer; v_total numeric; v_trace text; v_item_lot uuid;
  v_lots integer;
BEGIN
  SELECT id INTO v_uid FROM public.users WHERE email = 'owner@trackoja.test';
  IF v_uid IS NULL THEN
    INSERT INTO zz_pur_results VALUES (0, 'precondition: test user exists', false, 'missing');
    RETURN;
  END IF;

  INSERT INTO public.organizations (name, slug, owner_id, timezone, business_category, trial_ends_at)
  VALUES ('ZZ Purchase Test', 'zz-purchase-test', v_uid, 'UTC', 'pharmacy', now() + interval '14 days')
  RETURNING id INTO v_org;

  INSERT INTO public.stores (org_id, name, slug, created_by, currency, timezone)
  VALUES (v_org, 'ZZ Purchase Store', 'zz-purchase-store', v_uid, 'NGN', 'UTC')
  RETURNING id INTO v_store;

  SELECT id INTO v_role FROM public.roles WHERE name = 'owner' AND is_system LIMIT 1;
  INSERT INTO public.store_members (store_id, user_id, role_id, status)
  VALUES (v_store, v_uid, v_role, 'active');

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, false);

  INSERT INTO public.products (store_id, name, sku, unit, cost_price, selling_price,
                               track_inventory, stock_qty, created_by)
  VALUES (v_store, 'Paracetamol 500mg', 'ZZ-PARA-001', 'pack', 800, 1500, true, 0, v_uid)
  RETURNING id INTO v_product;

  SELECT id INTO v_supplier FROM public.create_supplier(
    p_store_id := v_store, p_name := 'Emzor Pharmaceuticals', p_payment_terms := 'Net 30') s;

  -- ============================================================
  -- RECORD A PURCHASE OF A BATCH
  -- ============================================================
  v_purchase := public.record_purchase(
    p_store_id := v_store,
    p_items := jsonb_build_array(
      jsonb_build_object('productId', v_product, 'quantity', 20, 'unitCost', 800,
                         'lotType', 'batch', 'identifier', 'BN-2026-777',
                         'expiryDate', (current_date + 200)::text, 'unit', 'pack')
    ),
    p_supplier_id := v_supplier,
    p_purchased_on := current_date,
    p_payment_method := 'transfer',
    p_reference := 'PO-1001');

  INSERT INTO zz_pur_results VALUES (1, 'a purchase records its total',
    v_purchase.id IS NOT NULL AND v_purchase.total = 16000,
    format('total=%s (20 x 800)', v_purchase.total));

  -- ============================================================
  -- THE BATCH ARRIVED CARRYING ITS SUPPLIER AND COST
  -- ============================================================
  SELECT pi.lot_id INTO v_item_lot FROM public.purchase_items pi WHERE pi.purchase_id = v_purchase.id;
  INSERT INTO zz_pur_results VALUES (2, 'the purchase line links to the batch it created',
    v_item_lot IS NOT NULL, format('lot=%s', left(coalesce(v_item_lot::text,'?'),8)));

  SELECT sl.id, sl.supplier_id, sl.cost_per_unit
  INTO v_lot, v_lot_supplier, v_lot_cost
  FROM public.stock_lots sl WHERE sl.id = v_item_lot;

  INSERT INTO zz_pur_results VALUES (3, 'the batch carries the supplying supplier',
    v_lot_supplier = v_supplier, format('supplier matches=%s', v_lot_supplier = v_supplier));

  INSERT INTO zz_pur_results VALUES (4, 'the batch carries the unit cost paid',
    v_lot_cost = 800, format('cost_per_unit=%s', v_lot_cost));

  -- Traceability both ways: batch -> purchase -> supplier.
  SELECT format('%s from %s', sl.identifier, s.name) INTO v_trace
  FROM public.purchase_items pi
  JOIN public.stock_lots sl ON sl.id = pi.lot_id
  JOIN public.purchases p ON p.id = pi.purchase_id
  JOIN public.suppliers s ON s.id = p.supplier_id
  WHERE pi.purchase_id = v_purchase.id;

  INSERT INTO zz_pur_results VALUES (5, 'a batch can be traced back to its delivery and supplier',
    v_trace = 'BN-2026-777 from Emzor Pharmaceuticals', coalesce(v_trace, 'no trace'));

  -- ============================================================
  -- THE RESTOCK ALSO APPEARED AS AN EXPENSE, ONCE
  -- ============================================================
  SELECT e.amount INTO v_expense
  FROM public.expenses e WHERE e.id = v_purchase.expense_id;

  INSERT INTO zz_pur_results VALUES (6, 'the purchase recorded the matching expense',
    v_expense = 16000 AND v_purchase.expense_id IS NOT NULL,
    format('expense=%s', coalesce(v_expense::text, 'none')));

  SELECT count(*)::integer INTO v_rows FROM public.expenses e WHERE e.store_id = v_store;
  INSERT INTO zz_pur_results VALUES (7, 'restocking cost appears in expenses exactly once',
    v_rows = 1, format('expense rows=%s', v_rows));

  -- ============================================================
  -- STOCK AND REPORTING
  -- ============================================================
  SELECT stock_qty INTO v_total FROM public.products WHERE id = v_product;
  INSERT INTO zz_pur_results VALUES (8, 'the received stock is in the product',
    v_total = 20, format('stock_qty=%s', v_total));

  SELECT p.total, p.line_count::integer, p.lots_received::integer INTO v_total, v_rows, v_lots
  FROM public.list_purchases(v_store, current_date, current_date) p;

  INSERT INTO zz_pur_results VALUES (9, 'the purchase list reports one line and one lot received',
    v_total = 16000 AND v_rows = 1 AND v_lots = 1,
    format('total=%s lines=%s lots=%s', v_total, v_rows, v_lots));

  -- ============================================================
  -- REFUSALS
  -- ============================================================
  v_msg := NULL;
  BEGIN
    PERFORM public.record_purchase(p_store_id := v_store, p_items := '[]'::jsonb);
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO zz_pur_results VALUES (10, 'a purchase with no items is refused',
    coalesce(v_msg,'') LIKE '%at least one item%', coalesce(v_msg, 'empty accepted'));

  v_msg := NULL;
  BEGIN
    PERFORM public.record_purchase(p_store_id := v_store,
      p_items := jsonb_build_array(jsonb_build_object('productId', v_product, 'quantity', 0, 'unitCost', 100)));
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO zz_pur_results VALUES (11, 'a zero-quantity line is refused',
    coalesce(v_msg,'') LIKE '%quantity greater than zero%', coalesce(v_msg, 'zero accepted'));

  v_msg := NULL;
  BEGIN
    PERFORM public.record_purchase(p_store_id := v_store,
      p_items := jsonb_build_array(jsonb_build_object('productId', v_product, 'quantity', 5, 'unitCost', -1)));
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO zz_pur_results VALUES (12, 'a negative unit cost is refused',
    coalesce(v_msg,'') LIKE '%cannot be negative%', coalesce(v_msg, 'negative accepted'));

  v_msg := NULL;
  BEGIN
    PERFORM public.record_purchase(p_store_id := v_store,
      p_items := jsonb_build_array(jsonb_build_object('productId', v_product, 'quantity', 5, 'unitCost', 100)),
      p_purchased_on := current_date + 1);
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO zz_pur_results VALUES (13, 'a purchase dated in the future is refused',
    coalesce(v_msg,'') LIKE '%cannot be dated in the future%', coalesce(v_msg, 'future accepted'));

  v_msg := NULL;
  BEGIN
    PERFORM public.record_purchase(p_store_id := v_store,
      p_items := jsonb_build_array(jsonb_build_object('productId', gen_random_uuid(), 'quantity', 5, 'unitCost', 100)));
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO zz_pur_results VALUES (14, 'a product from another store is refused',
    coalesce(v_msg,'') LIKE '%is not in this store%', coalesce(v_msg, 'foreign product accepted'));

  -- Nothing was written by any of those refusals.
  SELECT count(*)::integer INTO v_rows FROM public.purchases WHERE store_id = v_store;
  INSERT INTO zz_pur_results VALUES (15, 'refused purchases left no partial records behind',
    v_rows = 1, format('purchases=%s (expected 1, the valid one)', v_rows));

  -- ============================================================
  -- CLEAN UP
  -- ============================================================
  DELETE FROM public.audit_logs WHERE store_id = v_store;
  DELETE FROM public.purchase_items WHERE purchase_id = v_purchase.id;
  DELETE FROM public.purchases WHERE store_id = v_store;
  DELETE FROM public.expenses WHERE store_id = v_store;
  DELETE FROM public.inventory_movements WHERE store_id = v_store;
  DELETE FROM public.stock_lots WHERE store_id = v_store;
  DELETE FROM public.products WHERE store_id = v_store;
  DELETE FROM public.suppliers WHERE store_id = v_store;
  DELETE FROM public.stores WHERE id = v_store;
  DELETE FROM public.organizations WHERE id = v_org;
  PERFORM set_config('request.jwt.claims', '', false);
  INSERT INTO zz_pur_results VALUES (99, 'test data removed', true, 'fixture organization deleted');
END $$;

SELECT step, check_name, passed, detail FROM zz_pur_results ORDER BY step;
