-- Migration: 080_lot_movement_ledger_consistency.sql
-- Description: Makes lot operations respect the inventory_movements ledger rules.
--
--   The ledger enforces quantity_after = quantity_before + quantity, quantity <> 0,
--   and 'sale' must be negative. Lot consumption wrote a 'sale' row using the
--   product's stock level before and after - but when create_sale has ALREADY
--   decremented the product, those are identical, so the row claimed a -12.5 change
--   with before = after and violated the check. Found by running the real sale path
--   (create_sale + allocate_lots_for_sale) rather than by reading the code.
--
--   The rule now: a movement is written only when the product's own stock actually
--   moved, and its quantity is derived as (after - before), which satisfies the
--   constraint by construction. Consequence, and an improvement: allocating lots to
--   a sale no longer duplicates the product-level row create_sale already wrote.
--   Lot identity remains on sale_items, and the movement ledger keeps one
--   authoritative row per stock change.
-- Author: TrackOja Team
-- Date: 2026-09-26

CREATE OR REPLACE FUNCTION public.sell_lot_quantity(
  p_lot_id UUID,
  p_quantity NUMERIC,
  p_sale_id UUID DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS public.stock_lots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_lot public.stock_lots;
  v_remaining NUMERIC;
  v_before NUMERIC;
  v_after NUMERIC;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero';
  END IF;

  SELECT * INTO v_lot FROM public.stock_lots WHERE id = p_lot_id FOR UPDATE;

  IF v_lot.id IS NULL THEN
    RAISE EXCEPTION 'Stock lot not found';
  END IF;

  IF v_actor IS NOT NULL
     AND NOT public.user_has_permission(v_actor, v_lot.store_id, 'sales:create') THEN
    RAISE EXCEPTION 'Permission denied: sales:create required';
  END IF;

  -- Expired stock is refused outright. Note: we deliberately do NOT try to flip the
  -- status here - raising an exception rolls back this whole sub-transaction, so
  -- any write on this path would be discarded. Expiry is stamped by
  -- sweep_expired_lots(), which is the honest place for that side effect.
  IF v_lot.expiry_date IS NOT NULL AND v_lot.expiry_date < current_date THEN
    RAISE EXCEPTION 'This stock expired on % and cannot be sold', v_lot.expiry_date;
  END IF;

  IF v_lot.status = 'quarantined' THEN
    RAISE EXCEPTION 'This stock is quarantined and cannot be sold';
  END IF;
  IF v_lot.status = 'written_off' THEN
    RAISE EXCEPTION 'This stock has been written off and cannot be sold';
  END IF;
  IF v_lot.status <> 'available' THEN
    RAISE EXCEPTION 'This stock is not available for sale (status: %)', v_lot.status;
  END IF;

  IF v_lot.lot_type = 'serial' AND p_quantity <> 1 THEN
    RAISE EXCEPTION 'A serialized unit cannot be split (asked for %)', p_quantity;
  END IF;

  IF v_lot.qty_available < p_quantity THEN
    RAISE EXCEPTION 'Only % % left on this %, cannot sell %',
      v_lot.qty_available, v_lot.unit_of_measure,
      CASE v_lot.lot_type WHEN 'roll' THEN 'roll' WHEN 'batch' THEN 'batch' ELSE 'item' END,
      p_quantity;
  END IF;

  v_remaining := v_lot.qty_available - p_quantity;
  SELECT stock_qty INTO v_before FROM public.products WHERE id = v_lot.product_id;

  UPDATE public.stock_lots
  SET qty_available = v_remaining,
      status = CASE WHEN v_remaining = 0 THEN 'depleted' ELSE status END,
      updated_at = now()
  WHERE id = v_lot.id
  RETURNING * INTO v_lot;

  IF v_lot.variant_id IS NOT NULL THEN
    UPDATE public.product_variants
    SET stock_qty = GREATEST(stock_qty - p_quantity, 0), updated_at = now()
    WHERE id = v_lot.variant_id;
  END IF;

  v_after := public.recompute_product_stock_from_lots(v_lot.product_id);

  -- Only record a product-level movement when the product level actually moved.
  -- After create_sale it has not, and writing a row here would double-count.
  IF v_after IS NOT NULL AND v_after IS DISTINCT FROM v_before THEN
    INSERT INTO public.inventory_movements (
      store_id, product_id, quantity, quantity_before, quantity_after, movement_type,
      source_type, source_id, created_by, reason
    ) VALUES (
      v_lot.store_id, v_lot.product_id, v_after - v_before, v_before, v_after, 'sale',
      'sale', p_sale_id, COALESCE(v_actor, v_lot.created_by),
      COALESCE(p_reason, format('Sold %s %s%s · %s remaining', p_quantity, v_lot.unit_of_measure,
        CASE WHEN v_lot.identifier IS NULL THEN '' ELSE ' · ' || v_lot.identifier END, v_remaining))
    );
  END IF;

  RETURN v_lot;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sell_lot_quantity(UUID, NUMERIC, UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.adjust_stock_lot(
  p_lot_id UUID,
  p_new_status TEXT,
  p_reason TEXT
)
RETURNS public.stock_lots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_lot public.stock_lots;
  v_delta NUMERIC;
  v_before NUMERIC;
  v_after NUMERIC;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'A reason is required when adjusting stock';
  END IF;
  IF p_new_status NOT IN ('available', 'quarantined', 'expired', 'written_off') THEN
    RAISE EXCEPTION 'Invalid stock status: %', p_new_status;
  END IF;

  SELECT * INTO v_lot FROM public.stock_lots WHERE id = p_lot_id FOR UPDATE;
  IF v_lot.id IS NULL THEN
    RAISE EXCEPTION 'Stock lot not found';
  END IF;
  IF NOT public.user_has_permission(v_actor, v_lot.store_id, 'inventory:adjust') THEN
    RAISE EXCEPTION 'Permission denied: inventory:adjust required';
  END IF;

  SELECT stock_qty INTO v_before FROM public.products WHERE id = v_lot.product_id;

  UPDATE public.stock_lots
  SET status = p_new_status,
      qty_available = CASE WHEN p_new_status = 'available' THEN qty_received ELSE 0 END,
      updated_at = now()
  WHERE id = v_lot.id
  RETURNING * INTO v_lot;

  IF v_lot.variant_id IS NOT NULL THEN
    UPDATE public.product_variants pv
    SET stock_qty = COALESCE((
      SELECT SUM(sl2.qty_available) FROM public.stock_lots sl2
      WHERE sl2.variant_id = pv.id AND sl2.status = 'available'
    ), 0),
    updated_at = now()
    WHERE pv.id = v_lot.variant_id;
  END IF;

  v_after := public.recompute_product_stock_from_lots(v_lot.product_id);
  v_delta := COALESCE(v_after, 0) - COALESCE(v_before, 0);

  -- adjustment permits any sign, but the ledger still forbids zero.
  IF v_delta <> 0 THEN
    INSERT INTO public.inventory_movements (
      store_id, product_id, quantity, quantity_before, quantity_after, movement_type,
      source_type, source_id, created_by, reason
    ) VALUES (
      v_lot.store_id, v_lot.product_id, v_delta, COALESCE(v_before, 0), v_after, 'adjustment',
      'stock_lot', v_lot.id, v_actor,
      format('%s: %s', upper(replace(p_new_status, '_', ' ')), p_reason)
    );
  END IF;

  RETURN v_lot;
END;
$$;

GRANT EXECUTE ON FUNCTION public.adjust_stock_lot(UUID, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.sell_lot_quantity(UUID, NUMERIC, UUID, TEXT) IS
  'Consumes a lot quantity. Writes an inventory_movements row only when the product-level '
  'stock actually changed, so it never duplicates the row create_sale already wrote.';
