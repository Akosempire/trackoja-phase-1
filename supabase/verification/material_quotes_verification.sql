-- Verifies material quotes, orders and partial fulfilment. Own fixture, removed after.

DROP TABLE IF EXISTS zz_q_results;
CREATE TEMP TABLE zz_q_results (step int, check_name text, passed boolean, detail text);

DO $$
DECLARE
  v_uid uuid; v_org uuid; v_store uuid; v_role uuid; v_product uuid; v_roll uuid;
  v_quote public.material_quotes; v_item uuid; v_msg text;
  v_status text; v_paid numeric; v_bal numeric; v_out numeric; v_deliv bigint;
  v_rows integer; v_stock numeric;
BEGIN
  SELECT id INTO v_uid FROM public.users WHERE email = 'owner@trackoja.test';
  IF v_uid IS NULL THEN
    INSERT INTO zz_q_results VALUES (0, 'precondition: test user exists', false, 'missing');
    RETURN;
  END IF;

  INSERT INTO public.organizations (name, slug, owner_id, timezone, business_category, trial_ends_at)
  VALUES ('ZZ Materials', 'zz-materials', v_uid, 'UTC', 'building_materials', now() + interval '14 days')
  RETURNING id INTO v_org;

  INSERT INTO public.stores (org_id, name, slug, created_by, currency, timezone)
  VALUES (v_org, 'ZZ Materials Store', 'zz-materials-store', v_uid, 'NGN', 'UTC')
  RETURNING id INTO v_store;

  SELECT id INTO v_role FROM public.roles WHERE name = 'owner' AND is_system LIMIT 1;
  INSERT INTO public.store_members (store_id, user_id, role_id, status)
  VALUES (v_store, v_uid, v_role, 'active');

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, false);

  INSERT INTO public.products (store_id, name, sku, unit, cost_price, selling_price,
                               track_inventory, stock_qty, created_by)
  VALUES (v_store, 'Dangote Cement 50kg', 'ZZ-CEM-001', 'bag', 7000, 8500, true, 0, v_uid)
  RETURNING id INTO v_product;

  SELECT id INTO v_roll FROM public.receive_stock_lot(
    p_store_id := v_store, p_product_id := v_product, p_lot_type := 'roll',
    p_quantity := 100, p_identifier := 'CEM-BULK-1') sl;

  -- ============================================================
  -- CREATE THE QUOTE
  -- ============================================================
  v_quote := public.create_material_quote(
    p_store_id := v_store, p_customer_name := 'Zenith Contractors',
    p_delivery_location := 'Lekki Phase 1', p_delivery_charge := 15000,
    p_valid_until := current_date + 14,
    p_items := jsonb_build_array(
      jsonb_build_object('productId', v_product, 'description', 'Dangote Cement 50kg',
                         'quantity', 60, 'unitPrice', 8500, 'unit', 'bag')));

  INSERT INTO zz_q_results VALUES (1, 'a quote is created with a number',
    v_quote.id IS NOT NULL AND v_quote.quote_number = 1 AND v_quote.status = 'draft',
    format('quote_number=%s status=%s', v_quote.quote_number, v_quote.status));

  SELECT i.id INTO v_item FROM public.material_quote_items i WHERE i.quote_id = v_quote.id;

  SELECT t.total, t.balance INTO v_bal, v_out FROM public.list_material_quotes(v_store) t WHERE t.id = v_quote.id;
  INSERT INTO zz_q_results VALUES (2, 'the quote total includes the delivery charge',
    v_bal = 525000, format('60 x 8500 + 15000 = %s', v_bal));

  -- ============================================================
  -- AN ACCEPTED ORDER IS NOT A DELIVERY
  -- ============================================================
  v_msg := NULL;
  BEGIN
    PERFORM public.record_quote_fulfilment(v_quote.id,
      jsonb_build_array(jsonb_build_object('quoteItemId', v_item, 'quantity', 10)));
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO zz_q_results VALUES (3, 'goods cannot be delivered against a draft quote',
    coalesce(v_msg,'') LIKE '%Only an accepted order can be fulfilled%', coalesce(v_msg, 'delivered a draft'));

  v_msg := NULL;
  BEGIN
    PERFORM public.update_quote_status(v_quote.id, 'ordered');
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO zz_q_results VALUES (4, 'a draft cannot jump straight to ordered',
    coalesce(v_msg,'') LIKE '%cannot go from draft to ordered%', coalesce(v_msg, 'illegal jump accepted'));

  v_msg := NULL;
  BEGIN
    PERFORM public.update_quote_status(v_quote.id, 'fulfilled');
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO zz_q_results VALUES (5, 'delivered status cannot be set by hand',
    coalesce(v_msg,'') LIKE '%automatically when goods are recorded%', coalesce(v_msg, 'manual fulfilled accepted'));

  PERFORM public.update_quote_status(v_quote.id, 'sent');
  PERFORM public.update_quote_status(v_quote.id, 'accepted');
  v_quote := public.update_quote_status(v_quote.id, 'ordered');
  INSERT INTO zz_q_results VALUES (6, 'the commercial path draft to ordered works',
    v_quote.status = 'ordered', format('status=%s', v_quote.status));

  -- ============================================================
  -- PARTIAL DELIVERY
  -- ============================================================
  PERFORM public.record_quote_fulfilment(v_quote.id,
    jsonb_build_array(jsonb_build_object('quoteItemId', v_item, 'quantity', 25)),
    current_date, 'First trip');

  SELECT t.status, t.fulfilled_quantity, t.outstanding_quantity, t.delivery_count
  INTO v_status, v_paid, v_out, v_deliv
  FROM public.list_material_quotes(v_store) t WHERE t.id = v_quote.id;

  INSERT INTO zz_q_results VALUES (7, 'a partial delivery moves the order to partially fulfilled',
    v_status = 'partially_fulfilled', format('status=%s', v_status));
  INSERT INTO zz_q_results VALUES (8, 'delivered and outstanding quantities are tracked per line',
    v_paid = 25 AND v_out = 35, format('delivered=%s outstanding=%s of 60', v_paid, v_out));
  INSERT INTO zz_q_results VALUES (9, 'the delivery is recorded as its own event',
    v_deliv = 1, format('delivery_count=%s', v_deliv));

  SELECT stock_qty INTO v_stock FROM public.products WHERE id = v_product;
  INSERT INTO zz_q_results VALUES (10, 'delivering materials consumes stock',
    v_stock = 75, format('stock went 100 -> %s', v_stock));

  -- Over-delivery must be refused.
  v_msg := NULL;
  BEGIN
    PERFORM public.record_quote_fulfilment(v_quote.id,
      jsonb_build_array(jsonb_build_object('quoteItemId', v_item, 'quantity', 50)));
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO zz_q_results VALUES (11, 'delivering more than is outstanding is refused',
    coalesce(v_msg,'') LIKE '%still outstanding%', coalesce(v_msg, 'over-delivery accepted'));

  -- ============================================================
  -- COMPLETION ON A SECOND TRIP
  -- ============================================================
  PERFORM public.record_quote_fulfilment(v_quote.id,
    jsonb_build_array(jsonb_build_object('quoteItemId', v_item, 'quantity', 35)),
    current_date, 'Second trip');

  SELECT t.status, t.outstanding_quantity, t.delivery_count
  INTO v_status, v_out, v_deliv
  FROM public.list_material_quotes(v_store) t WHERE t.id = v_quote.id;

  INSERT INTO zz_q_results VALUES (12, 'completing every line fulfils the order automatically',
    v_status = 'fulfilled' AND v_out = 0, format('status=%s outstanding=%s', v_status, v_out));
  INSERT INTO zz_q_results VALUES (13, 'a split delivery across two trips is normal',
    v_deliv = 2, format('delivery_count=%s', v_deliv));

  -- ============================================================
  -- MONEY
  -- ============================================================
  PERFORM public.record_quote_payment(v_quote.id, 200000, 'transfer', 'TRF-1');
  SELECT t.paid, t.balance INTO v_paid, v_bal
  FROM public.list_material_quotes(v_store) t WHERE t.id = v_quote.id;

  INSERT INTO zz_q_results VALUES (14, 'a deposit is recorded and the balance follows',
    v_paid = 200000 AND v_bal = 325000, format('paid=%s balance=%s of 525000', v_paid, v_bal));

  v_msg := NULL;
  BEGIN
    PERFORM public.record_quote_payment(v_quote.id, 999999);
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO zz_q_results VALUES (15, 'overpaying a quote is refused',
    coalesce(v_msg,'') LIKE '%more than the outstanding balance%', coalesce(v_msg, 'overpayment accepted'));

  -- ============================================================
  -- REFUSED OPERATIONS LEFT NOTHING BEHIND
  -- ============================================================
  SELECT count(*)::integer INTO v_rows FROM public.material_quote_fulfilments f WHERE f.quote_id = v_quote.id;
  INSERT INTO zz_q_results VALUES (16, 'refused deliveries wrote no delivery records',
    v_rows = 2, format('deliveries=%s (the two valid trips)', v_rows));

  SELECT s.outstanding_balances, s.open_quotes, s.awaiting_fulfilment
  INTO v_out, v_rows, v_deliv
  FROM public.material_quote_summary(v_store) s;

  INSERT INTO zz_q_results VALUES (17, 'the summary reports outstanding balances',
    v_out = 325000, format('outstanding_balances=%s awaiting_fulfilment=%s', v_out, v_deliv));

  -- ============================================================
  -- CLEAN UP
  -- ============================================================
  DELETE FROM public.audit_logs WHERE store_id = v_store;
  DELETE FROM public.material_quote_payments WHERE quote_id = v_quote.id;
  DELETE FROM public.material_quote_fulfilments WHERE quote_id = v_quote.id;
  DELETE FROM public.material_quote_items WHERE quote_id = v_quote.id;
  DELETE FROM public.material_quotes WHERE store_id = v_store;
  DELETE FROM public.material_quote_counters WHERE store_id = v_store;
  DELETE FROM public.inventory_movements WHERE store_id = v_store;
  DELETE FROM public.stock_lots WHERE store_id = v_store;
  DELETE FROM public.products WHERE store_id = v_store;
  DELETE FROM public.stores WHERE id = v_store;
  DELETE FROM public.organizations WHERE id = v_org;
  PERFORM set_config('request.jwt.claims', '', false);
  INSERT INTO zz_q_results VALUES (99, 'test data removed', true, 'fixture organization deleted');
END $$;

SELECT step, check_name, passed, detail FROM zz_q_results ORDER BY step;
