-- End-to-end check of the real sale path: create_sale followed by lot allocation,
-- exactly as sale.service.ts now calls them. Builds its own fixture and removes it.

DROP TABLE IF EXISTS zz_sale_results;
CREATE TEMP TABLE zz_sale_results (step int, check_name text, passed boolean, detail text);

DO $$
DECLARE
  v_product uuid;
  v_store uuid;
  v_actor uuid;
  v_roll uuid;
  v_sale public.sales;
  v_lot uuid;
  v_ident text;
  v_unit text;
  v_qty numeric;
  v_lot_left numeric;
  v_stock numeric;
  v_lines integer;
  v_msg text;
BEGIN
  SELECT sm.store_id, sm.user_id INTO v_store, v_actor
  FROM public.store_members sm
  JOIN public.roles r ON r.id = sm.role_id
  WHERE sm.status = 'active' AND sm.user_id IS NOT NULL AND r.name IN ('owner', 'manager')
  ORDER BY sm.created_at LIMIT 1;

  IF v_store IS NULL THEN
    INSERT INTO zz_sale_results VALUES (0, 'precondition: usable store member', false, 'none');
    RETURN;
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_actor::text, 'role', 'authenticated')::text, false);

  -- Fixture: a fabric sold by the metre with a 50 metre roll.
  INSERT INTO public.products (store_id, name, sku, unit, cost_price, selling_price,
                               track_inventory, stock_qty, created_by)
  VALUES (v_store, 'ZZ Sale Fabric', 'ZZ-SALE-001', 'metre', 1000, 2500, true, 0, v_actor)
  RETURNING id INTO v_product;

  SELECT id INTO v_roll FROM public.receive_stock_lot(
    p_store_id := v_store, p_product_id := v_product, p_lot_type := 'roll',
    p_quantity := 50, p_identifier := 'SALE-ROLL-1') sl;

  -- ============================================================
  -- THE REAL SALE, VIA create_sale
  -- ============================================================
  SELECT * INTO v_sale FROM public.create_sale(
    p_store_id := v_store,
    p_items := jsonb_build_array(
      jsonb_build_object('productId', v_product, 'quantity', 12.5, 'discountAmount', 0)
    ),
    p_payments := jsonb_build_array(
      jsonb_build_object('method', 'cash', 'amount', 31250, 'reference', NULL, 'verificationStatus', 'verified')
    ),
    p_customer_name := 'ZZ Walk-in',
    p_customer_phone := NULL,
    p_discount_total := 0,
    p_notes := 'end-to-end allocation check',
    p_customer_id := NULL
  );

  INSERT INTO zz_sale_results VALUES (1, 'create_sale records a measured 12.5 m sale',
    v_sale.id IS NOT NULL, format('sale=%s total=%s', left(coalesce(v_sale.id::text,'?'),8), coalesce(v_sale.total::text,'?')));

  IF v_sale.id IS NULL THEN
    DELETE FROM public.stock_lots WHERE product_id = v_product;
    DELETE FROM public.products WHERE id = v_product;
    RETURN;
  END IF;

  -- Before allocation the line carries no lot: this is the state that used to persist.
  SELECT count(*) INTO v_lines FROM public.sale_items WHERE sale_id = v_sale.id AND lot_id IS NULL;
  INSERT INTO zz_sale_results VALUES (2, 'before allocation the sale line has no lot identity',
    v_lines = 1, format('unallocated lines=%s', v_lines));

  -- ============================================================
  -- ALLOCATION, AS THE SERVICE NOW CALLS IT
  -- ============================================================
  v_lines := public.allocate_lots_for_sale(v_sale.id);
  INSERT INTO zz_sale_results VALUES (3, 'allocation processes the unallocated line',
    v_lines = 1, format('lines allocated=%s', v_lines));

  SELECT si.lot_id, si.lot_identifier, si.unit_of_measure, si.quantity
  INTO v_lot, v_ident, v_unit, v_qty
  FROM public.sale_items si WHERE si.sale_id = v_sale.id;

  INSERT INTO zz_sale_results VALUES (4, 'the sale line now names the roll it came from',
    v_ident = 'SALE-ROLL-1', format('lot_identifier=%s', coalesce(v_ident,'null')));
  INSERT INTO zz_sale_results VALUES (5, 'the unit sold is recorded on the line',
    v_unit = 'metre', format('unit_of_measure=%s', coalesce(v_unit,'null')));

  SELECT qty_available INTO v_lot_left FROM public.stock_lots WHERE id = v_roll;
  INSERT INTO zz_sale_results VALUES (6, 'the roll is reduced by exactly the measured quantity',
    v_lot_left = 37.5, format('roll remaining=%s (was 50, sold 12.5)', v_lot_left));

  SELECT stock_qty INTO v_stock FROM public.products WHERE id = v_product;
  INSERT INTO zz_sale_results VALUES (7, 'product stock agrees with the remaining roll',
    v_stock = 37.5, format('products.stock_qty=%s', v_stock));

  -- ============================================================
  -- IDEMPOTENCY: A RETRY MUST NOT DOUBLE-CONSUME
  -- ============================================================
  v_lines := public.allocate_lots_for_sale(v_sale.id);
  SELECT qty_available INTO v_lot_left FROM public.stock_lots WHERE id = v_roll;
  INSERT INTO zz_sale_results VALUES (8, 're-running allocation does not consume stock twice',
    v_lines = 0 AND v_lot_left = 37.5, format('lines=%s roll=%s', v_lines, v_lot_left));

  -- ============================================================
  -- CLEAN UP
  -- ============================================================
  DELETE FROM public.inventory_movements WHERE product_id = v_product;
  DELETE FROM public.sales WHERE id = v_sale.id;
  DELETE FROM public.stock_lots WHERE product_id = v_product;
  DELETE FROM public.products WHERE id = v_product;
  PERFORM set_config('request.jwt.claims', '', false);
  INSERT INTO zz_sale_results VALUES (99, 'test data removed', true, 'sale, product and lots deleted');
END $$;

SELECT step, check_name, passed, detail FROM zz_sale_results ORDER BY step;
