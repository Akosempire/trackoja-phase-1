-- Verifies lot allocation for a sale. Creates a throwaway product with rolls,
-- exercises allocation, then removes everything it created.

DROP TABLE IF EXISTS zz_alloc_results;
CREATE TEMP TABLE zz_alloc_results (step int, check_name text, passed boolean, detail text);

DO $$
DECLARE
  v_product uuid;
  v_store uuid;
  v_actor uuid;
  v_roll_a uuid;
  v_roll_b uuid;
  v_msg text;
  v_rows integer;
  v_total numeric;
  v_taken text;
  v_product2 uuid;
BEGIN
  SELECT sm.store_id, sm.user_id INTO v_store, v_actor
  FROM public.store_members sm
  JOIN public.roles r ON r.id = sm.role_id
  WHERE sm.status = 'active' AND sm.user_id IS NOT NULL AND r.name IN ('owner', 'manager')
  ORDER BY sm.created_at LIMIT 1;

  IF v_store IS NULL THEN
    INSERT INTO zz_alloc_results VALUES (0, 'precondition: usable store member', false, 'none');
    RETURN;
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_actor::text, 'role', 'authenticated')::text, false);

  INSERT INTO public.products (store_id, name, sku, unit, cost_price, selling_price,
                               track_inventory, stock_qty, created_by)
  VALUES (v_store, 'ZZ Alloc Fabric', 'ZZ-ALLOC-001', 'metre', 1000, 2000, true, 0, v_actor)
  RETURNING id INTO v_product;

  -- Two rolls of the same fabric, different lengths.
  SELECT id INTO v_roll_a FROM public.receive_stock_lot(
    p_store_id := v_store, p_product_id := v_product, p_lot_type := 'roll',
    p_quantity := 20, p_identifier := 'ROLL-A') sl;

  SELECT id INTO v_roll_b FROM public.receive_stock_lot(
    p_store_id := v_store, p_product_id := v_product, p_lot_type := 'roll',
    p_quantity := 30, p_identifier := 'ROLL-B') sl;

  SELECT stock_qty INTO v_total FROM public.products WHERE id = v_product;
  INSERT INTO zz_alloc_results VALUES (1, 'receiving two rolls derives 50 m of product stock',
    v_total = 50, format('stock_qty=%s', v_total));

  -- ============================================================
  -- ALLOCATE A MEASURED SALE FROM ONE ROLL
  -- ============================================================
  SELECT count(*), string_agg(format('%s %s from %s', a.quantity_taken, a.unit_of_measure, a.identifier), '; ')
  INTO v_rows, v_taken
  FROM public.allocate_lots_for_product(v_product, 12.5) a;

  INSERT INTO zz_alloc_results VALUES (2, 'a 12.5 m sale allocates from a single roll',
    v_rows = 1, format('rows=%s (%s)', v_rows, v_taken));

  SELECT qty_available INTO v_total FROM public.stock_lots WHERE id = v_roll_a;
  INSERT INTO zz_alloc_results VALUES (3, 'the roll it came from is reduced to 7.5 m',
    v_total = 7.5, format('ROLL-A remaining=%s', v_total));

  -- ============================================================
  -- ALLOCATE ACROSS TWO ROLLS
  -- ============================================================
  SELECT count(*), string_agg(format('%s from %s', a.quantity_taken, a.identifier), '; ')
  INTO v_rows, v_taken
  FROM public.allocate_lots_for_product(v_product, 15) a;

  SELECT qty_available INTO v_total FROM public.stock_lots WHERE id = v_roll_a;
  INSERT INTO zz_alloc_results VALUES (4, 'a sale larger than the first roll splits across rolls',
    v_rows = 2 AND v_total = 0, format('rows=%s, ROLL-A now %s (%s)', v_rows, v_total, v_taken));

  SELECT qty_available INTO v_total FROM public.stock_lots WHERE id = v_roll_b;
  INSERT INTO zz_alloc_results VALUES (5, 'the remainder comes off the second roll',
    v_total = 22.5, format('ROLL-B remaining=%s', v_total));

  -- ============================================================
  -- REFUSE TO OVERSELL
  -- ============================================================
  v_msg := NULL;
  BEGIN
    PERFORM public.allocate_lots_for_product(v_product, 100);
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO zz_alloc_results VALUES (6, 'allocating more than stock allows is refused',
    coalesce(v_msg,'') LIKE 'Only % could be allocated%', coalesce(v_msg, 'no exception'));

  SELECT stock_qty INTO v_total FROM public.products WHERE id = v_product;
  INSERT INTO zz_alloc_results VALUES (7, 'product stock still matches the rolls after the refusal',
    v_total = 22.5, format('stock_qty=%s', v_total));

  -- ============================================================
  -- A PRODUCT WITH NO LOTS IS UNTOUCHED
  -- ============================================================
  INSERT INTO public.products (store_id, name, sku, unit, cost_price, selling_price,
                               track_inventory, stock_qty, created_by)
  VALUES (v_store, 'ZZ Alloc Plain', 'ZZ-ALLOC-002', 'piece', 500, 900, true, 40, v_actor)
  RETURNING id INTO v_product2;

  SELECT count(*) INTO v_rows FROM public.allocate_lots_for_product(v_product2, 5);
  INSERT INTO zz_alloc_results VALUES (8, 'a product with no lots is left to ordinary quantity stock',
    v_rows = 0, format('allocations=%s', v_rows));

  SELECT stock_qty INTO v_total FROM public.products WHERE id = v_product2;
  INSERT INTO zz_alloc_results VALUES (9, 'ordinary stock is not changed by allocation',
    v_total = 40, format('stock_qty=%s', v_total));

  -- ============================================================
  -- NEGATIVE AND ZERO QUANTITIES
  -- ============================================================
  v_msg := NULL;
  BEGIN PERFORM public.allocate_lots_for_product(v_product, 0);
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO zz_alloc_results VALUES (10, 'allocating zero is refused',
    v_msg IS NOT NULL, coalesce(v_msg, 'zero accepted'));

  v_msg := NULL;
  BEGIN PERFORM public.allocate_lots_for_product(v_product, -5);
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO zz_alloc_results VALUES (11, 'allocating a negative quantity is refused',
    v_msg IS NOT NULL, coalesce(v_msg, 'negative accepted'));

  -- ============================================================
  -- CLEAN UP
  -- ============================================================
  DELETE FROM public.inventory_movements WHERE product_id IN (v_product, v_product2);
  DELETE FROM public.stock_lots WHERE product_id IN (v_product, v_product2);
  DELETE FROM public.products WHERE id IN (v_product, v_product2);
  PERFORM set_config('request.jwt.claims', '', false);
  INSERT INTO zz_alloc_results VALUES (99, 'test data removed', true, 'temporary products and lots deleted');
END $$;

SELECT step, check_name, passed, detail FROM zz_alloc_results ORDER BY step;
