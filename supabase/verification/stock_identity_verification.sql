-- Verifies the stock-identity rules against the live database.
-- Creates a throwaway product and lots, exercises the guards, reports results as
-- rows, then removes everything it created.

DROP TABLE IF EXISTS zz_lot_results;
CREATE TEMP TABLE zz_lot_results (step int, check_name text, passed boolean, detail text);

DO $$
DECLARE
  v_product uuid;
  v_store uuid;
  v_actor uuid;
  v_roll uuid;
  v_serial uuid;
  v_batch uuid;
  v_after numeric;
  v_total numeric;
  v_msg text;
  v_picked_expiry date;
  v_ok boolean;
  v_role text;
BEGIN
  -- Use a store where an owner/manager is an active member, so permission-gated
  -- functions can be exercised for real.
  SELECT sm.store_id, sm.user_id, r.name
  INTO v_store, v_actor, v_role
  FROM public.store_members sm
  JOIN public.roles r ON r.id = sm.role_id
  WHERE sm.status = 'active' AND sm.user_id IS NOT NULL
    AND r.name IN ('owner', 'manager')
  ORDER BY sm.created_at LIMIT 1;

  IF v_store IS NULL THEN
    SELECT store_id, user_id, 'member' INTO v_store, v_actor, v_role
    FROM public.store_members WHERE status = 'active' AND user_id IS NOT NULL LIMIT 1;
  END IF;

  IF v_store IS NULL THEN
    INSERT INTO zz_lot_results VALUES (0, 'precondition: an active store member exists', false, 'none found');
    RETURN;
  END IF;

  INSERT INTO zz_lot_results VALUES (0, 'precondition: usable store member',
    true, format('role=%s store=%s', v_role, left(v_store::text, 8)));

  -- Act as that member so auth.uid() and the permission checks resolve.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_actor::text, 'role', 'authenticated')::text, false);

  INSERT INTO public.products (store_id, name, sku, unit, cost_price, selling_price,
                               track_inventory, stock_qty, created_by)
  VALUES (v_store, 'ZZ Test Fabric', 'ZZ-TEST-FABRIC-001', 'metre', 1500, 2500, true, 0, v_actor)
  RETURNING id INTO v_product;

  -- ============================================================
  -- PERMISSION-GATED RECEIVE (fabric roll)
  -- ============================================================
  v_msg := NULL;
  BEGIN
    SELECT id INTO v_roll FROM public.receive_stock_lot(
      p_store_id := v_store, p_product_id := v_product, p_lot_type := 'roll',
      p_quantity := 50, p_identifier := 'ROLL-001', p_cost_per_unit := 1500) sl;
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;

  INSERT INTO zz_lot_results VALUES (1, 'receive_stock_lot records a 50 metre roll',
    v_roll IS NOT NULL, coalesce(v_msg, 'roll created'));

  IF v_roll IS NULL THEN
    DELETE FROM public.products WHERE id = v_product;
    INSERT INTO zz_lot_results VALUES (99, 'cleanup', true, 'product removed');
    RETURN;
  END IF;

  SELECT unit_of_measure INTO v_msg FROM public.stock_lots WHERE id = v_roll;
  INSERT INTO zz_lot_results VALUES (2, 'the unit of measure travels with the stock',
    v_msg = 'metre', format('unit=%s', v_msg));

  -- ============================================================
  -- FABRIC: fractional measured sale
  -- ============================================================
  PERFORM public.sell_lot_quantity(v_roll, 12.5);
  SELECT qty_available INTO v_after FROM public.stock_lots WHERE id = v_roll;
  INSERT INTO zz_lot_results VALUES (3, 'a measured sale of 12.5 m leaves 37.5 m',
    v_after = 37.5, format('remaining=%s metre', v_after));

  SELECT stock_qty INTO v_total FROM public.products WHERE id = v_product;
  INSERT INTO zz_lot_results VALUES (4, 'product stock is derived from its lots',
    v_total = 37.5, format('products.stock_qty=%s', v_total));

  v_msg := NULL;
  BEGIN PERFORM public.sell_lot_quantity(v_roll, 100);
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO zz_lot_results VALUES (5, 'overselling a roll is refused with the remaining length',
    coalesce(v_msg,'') LIKE 'Only %left on this roll%', coalesce(v_msg, 'no exception'));

  v_msg := NULL;
  BEGIN PERFORM public.sell_lot_quantity(v_roll, -5);
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO zz_lot_results VALUES (6, 'a negative sale quantity is refused',
    v_msg IS NOT NULL, coalesce(v_msg, 'negative quantity accepted'));

  -- ============================================================
  -- ELECTRONICS: serialized unit
  -- ============================================================
  SELECT id INTO v_serial FROM public.receive_stock_lot(
    p_store_id := v_store, p_product_id := v_product, p_lot_type := 'serial',
    p_quantity := 1, p_identifier := 'IMEI-TEST-0001') sl;

  PERFORM public.sell_lot_quantity(v_serial, 1);
  SELECT status INTO v_msg FROM public.stock_lots WHERE id = v_serial;
  INSERT INTO zz_lot_results VALUES (7, 'a serialized unit is depleted after one sale',
    v_msg = 'depleted', format('status=%s', v_msg));

  v_msg := NULL;
  BEGIN PERFORM public.sell_lot_quantity(v_serial, 1);
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO zz_lot_results VALUES (8, 'the same serialized unit cannot be sold twice',
    v_msg IS NOT NULL, coalesce(v_msg, 'sold twice'));

  v_ok := false;
  BEGIN
    PERFORM public.receive_stock_lot(p_store_id := v_store, p_product_id := v_product,
      p_lot_type := 'serial', p_quantity := 1, p_identifier := 'IMEI-TEST-0001');
  EXCEPTION WHEN unique_violation THEN v_ok := true;
            WHEN OTHERS THEN v_ok := false; END;
  INSERT INTO zz_lot_results VALUES (9, 'a duplicate serial/IMEI cannot be received again',
    v_ok, CASE WHEN v_ok THEN 'unique violation' ELSE 'duplicate accepted' END);

  v_msg := NULL;
  BEGIN
    PERFORM public.receive_stock_lot(p_store_id := v_store, p_product_id := v_product,
      p_lot_type := 'serial', p_quantity := 5, p_identifier := 'IMEI-TEST-0002');
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO zz_lot_results VALUES (10, 'a serialized unit cannot hold quantity greater than one',
    coalesce(v_msg,'') LIKE '%one at a time%', coalesce(v_msg, 'accepted qty 5'));

  v_msg := NULL;
  BEGIN
    PERFORM public.receive_stock_lot(p_store_id := v_store, p_product_id := v_product,
      p_lot_type := 'batch', p_quantity := 10, p_identifier := NULL);
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO zz_lot_results VALUES (11, 'a batch without a batch number is refused',
    coalesce(v_msg,'') LIKE '%needs an identifier%', coalesce(v_msg, 'accepted no identifier'));

  -- ============================================================
  -- PHARMACY: expiry
  -- ============================================================
  SELECT id INTO v_batch FROM public.receive_stock_lot(
    p_store_id := v_store, p_product_id := v_product, p_lot_type := 'batch',
    p_quantity := 10, p_identifier := 'BN-EXPIRED', p_expiry_date := current_date - 1) sl;

  v_msg := NULL;
  BEGIN PERFORM public.sell_lot_quantity(v_batch, 1);
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO zz_lot_results VALUES (12, 'an expired batch cannot be sold',
    coalesce(v_msg,'') LIKE '%expired on%', coalesce(v_msg, 'sold expired stock'));

  PERFORM public.sweep_expired_lots(v_store);
  SELECT status INTO v_msg FROM public.stock_lots WHERE id = v_batch;
  INSERT INTO zz_lot_results VALUES (13, 'the expiry sweep stamps past-expiry batches as expired',
    v_msg = 'expired', format('status=%s', v_msg));

  PERFORM public.receive_stock_lot(p_store_id := v_store, p_product_id := v_product,
    p_lot_type := 'batch', p_quantity := 10, p_identifier := 'BN-SOON',
    p_expiry_date := current_date + 5);
  PERFORM public.receive_stock_lot(p_store_id := v_store, p_product_id := v_product,
    p_lot_type := 'batch', p_quantity := 10, p_identifier := 'BN-LATER',
    p_expiry_date := current_date + 60);

  SELECT sl.expiry_date INTO v_picked_expiry
  FROM public.select_lot_for_sale(v_product, 1, NULL) sl;
  INSERT INTO zz_lot_results VALUES (14, 'lot selection rotates earliest-expiry-first, skipping expired stock',
    v_picked_expiry = current_date + 5,
    format('picked expiry=%s, expected %s', v_picked_expiry, current_date + 5));

  -- ============================================================
  -- EXPIRY REPORT
  -- ============================================================
  SELECT count(*)::text INTO v_msg FROM public.list_expiring_stock(v_store, 90, true);
  INSERT INTO zz_lot_results VALUES (15, 'the expiry exposure query returns the expiring batches',
    v_msg IS NOT NULL AND v_msg::int >= 2, format('rows=%s', v_msg));

  -- ============================================================
  -- CLEAN UP
  -- ============================================================
  DELETE FROM public.inventory_movements WHERE product_id = v_product;
  DELETE FROM public.stock_lots WHERE product_id = v_product;
  DELETE FROM public.products WHERE id = v_product;
  PERFORM set_config('request.jwt.claims', '', false);
  INSERT INTO zz_lot_results VALUES (99, 'test data removed', true, 'temporary product and lots deleted');
END $$;

SELECT step, check_name, passed, detail FROM zz_lot_results ORDER BY step;
