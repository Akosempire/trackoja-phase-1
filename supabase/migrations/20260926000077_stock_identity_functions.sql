-- Migration: 077_stock_identity_functions.sql
-- Description: Guarded operations over product_variants and stock_lots so the
--   rules that matter for each business type are enforced by the database
--   rather than by whichever screen happens to call them:
--     - an expired or quarantined batch can never be sold
--     - a serialized unit can never be sold twice
--     - a fabric roll's remaining length is fractional and never goes negative
--     - every movement lands in the existing inventory_movements ledger
--
--   Source of truth: for a product that has any stock lot, products.stock_qty is
--   DERIVED from its lots via recompute_product_stock_from_lots(). Lots are not
--   an extra number layered on top of the existing stock, and these functions do
--   not call _apply_inventory_movement_internal(), so nothing is counted twice.
-- Author: TrackOja Team
-- Date: 2026-09-26

-- ============================================================
-- RECEIVE STOCK INTO A LOT
-- ============================================================

CREATE OR REPLACE FUNCTION public.receive_stock_lot(
  p_store_id UUID,
  p_product_id UUID,
  p_lot_type TEXT,
  p_quantity NUMERIC,
  p_unit_of_measure TEXT DEFAULT NULL,
  p_identifier TEXT DEFAULT NULL,
  p_expiry_date DATE DEFAULT NULL,
  p_cost_per_unit NUMERIC DEFAULT NULL,
  p_selling_price_per_unit NUMERIC DEFAULT NULL,
  p_variant_id UUID DEFAULT NULL,
  p_supplier_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS public.stock_lots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_unit TEXT;
  v_lot public.stock_lots;
  v_before NUMERIC;
  v_after NUMERIC;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT public.user_has_permission(v_actor, p_store_id, 'inventory:adjust') THEN
    RAISE EXCEPTION 'Permission denied: inventory:adjust required';
  END IF;

  IF p_lot_type NOT IN ('batch', 'roll', 'serial', 'bulk') THEN
    RAISE EXCEPTION 'Unknown stock type: %', p_lot_type;
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity to receive must be greater than zero';
  END IF;
  IF p_lot_type = 'serial' AND p_quantity <> 1 THEN
    RAISE EXCEPTION 'A serialized unit is received one at a time (got %)', p_quantity;
  END IF;
  IF p_lot_type IN ('batch', 'roll') AND (p_identifier IS NULL OR length(trim(p_identifier)) = 0) THEN
    RAISE EXCEPTION 'A % needs an identifier (batch number or roll number)', p_lot_type;
  END IF;
  IF p_lot_type = 'serial' AND (p_identifier IS NULL OR length(trim(p_identifier)) = 0) THEN
    RAISE EXCEPTION 'A serialized unit needs a serial number or IMEI';
  END IF;

  -- Fall back to the product's own unit so a fabric product configured in metres
  -- does not silently receive stock in pieces.
  SELECT COALESCE(NULLIF(trim(p_unit_of_measure), ''), NULLIF(trim(pr.unit), ''), 'piece')
  INTO v_unit
  FROM public.products pr
  WHERE pr.id = p_product_id AND pr.store_id = p_store_id;

  IF v_unit IS NULL THEN
    RAISE EXCEPTION 'Product not found in this store';
  END IF;

  INSERT INTO public.stock_lots (
    store_id, product_id, variant_id, lot_type, identifier, unit_of_measure,
    qty_received, qty_available, cost_per_unit, selling_price_per_unit,
    expiry_date, supplier_id, status, created_by, attributes
  ) VALUES (
    p_store_id, p_product_id, p_variant_id, p_lot_type, NULLIF(trim(p_identifier), ''), v_unit,
    p_quantity, p_quantity, p_cost_per_unit, p_selling_price_per_unit,
    p_expiry_date, p_supplier_id, 'available', v_actor,
    jsonb_build_object('received_notes', p_notes)
  )
  RETURNING * INTO v_lot;

  -- Capture the product's stock level before the change: inventory_movements
  -- requires quantity_before / quantity_after and is the merchant-visible ledger.
  SELECT stock_qty INTO v_before FROM public.products WHERE id = p_product_id;

  IF p_variant_id IS NOT NULL THEN
    UPDATE public.product_variants
    SET stock_qty = stock_qty + p_quantity, updated_at = now()
    WHERE id = p_variant_id;
  END IF;

  v_after := public.recompute_product_stock_from_lots(p_product_id);
  v_after := COALESCE(v_after, COALESCE(v_before, 0) + p_quantity);

  INSERT INTO public.inventory_movements (
    store_id, product_id, quantity, quantity_before, quantity_after, movement_type,
    source_type, source_id, created_by, reason
  ) VALUES (
    p_store_id, p_product_id, p_quantity, COALESCE(v_before, 0), v_after, 'replenishment',
    'stock_lot', v_lot.id, v_actor,
    format('Received %s %s%s', p_quantity, v_unit,
           CASE WHEN v_lot.identifier IS NULL THEN '' ELSE ' · ' || v_lot.identifier END)
  );

  RETURN v_lot;
END;
$$;

GRANT EXECUTE ON FUNCTION public.receive_stock_lot(UUID, UUID, TEXT, NUMERIC, TEXT, TEXT, DATE, NUMERIC, NUMERIC, UUID, UUID, TEXT) TO authenticated;

-- ============================================================
-- PICK AN ELIGIBLE LOT FOR A SALE
-- ============================================================
-- Earliest expiry first, so stock is rotated rather than left to expire.
-- Expired, quarantined, written-off and depleted lots are never returned.

CREATE OR REPLACE FUNCTION public.select_lot_for_sale(
  p_product_id UUID,
  p_quantity NUMERIC,
  p_variant_id UUID DEFAULT NULL
)
RETURNS public.stock_lots
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_lot public.stock_lots;
BEGIN
  SELECT * INTO v_lot
  FROM public.stock_lots sl
  WHERE sl.product_id = p_product_id
    AND (p_variant_id IS NULL OR sl.variant_id = p_variant_id)
    AND sl.status = 'available'
    AND sl.qty_available >= p_quantity
    AND (sl.expiry_date IS NULL OR sl.expiry_date >= current_date)
  ORDER BY sl.expiry_date NULLS LAST, sl.received_at
  LIMIT 1;

  RETURN v_lot;
END;
$$;

GRANT EXECUTE ON FUNCTION public.select_lot_for_sale(UUID, NUMERIC, UUID) TO authenticated;

-- ============================================================
-- SELL FROM A LOT
-- ============================================================
-- The single chokepoint for consuming identified stock. Takes a row lock, so two
-- concurrent requests cannot both sell the last serialized unit or the last metre
-- on a roll.

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

  -- A serialized unit is indivisible: one thing, sold once.
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
  v_after := COALESCE(v_after, GREATEST(COALESCE(v_before, 0) - p_quantity, 0));

  INSERT INTO public.inventory_movements (
    store_id, product_id, quantity, quantity_before, quantity_after, movement_type,
    source_type, source_id, created_by, reason
  ) VALUES (
    v_lot.store_id, v_lot.product_id, -p_quantity, COALESCE(v_before, 0), v_after, 'sale',
    'sale', p_sale_id, COALESCE(v_actor, v_lot.created_by),
    COALESCE(p_reason, format('Sold %s %s%s · %s remaining', p_quantity, v_lot.unit_of_measure,
      CASE WHEN v_lot.identifier IS NULL THEN '' ELSE ' · ' || v_lot.identifier END, v_remaining))
  );

  RETURN v_lot;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sell_lot_quantity(UUID, NUMERIC, UUID, TEXT) TO authenticated;

-- ============================================================
-- WRITE OFF / QUARANTINE
-- ============================================================
-- Damaged length, a recalled batch, or an opened cosmetics item. A reason is
-- mandatory and the lot keeps its identity, so the loss stays traceable.

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

  v_delta := CASE WHEN p_new_status = 'available' THEN v_lot.qty_received - v_lot.qty_available
                  ELSE -v_lot.qty_available END;

  SELECT stock_qty INTO v_before FROM public.products WHERE id = v_lot.product_id;

  UPDATE public.stock_lots
  SET status = p_new_status,
      qty_available = CASE WHEN p_new_status = 'available' THEN qty_received ELSE 0 END,
      updated_at = now()
  WHERE id = v_lot.id
  RETURNING * INTO v_lot;

  v_after := public.recompute_product_stock_from_lots(v_lot.product_id);
  v_after := COALESCE(v_after, GREATEST(COALESCE(v_before, 0) + v_delta, 0));

  INSERT INTO public.inventory_movements (
    store_id, product_id, quantity, quantity_before, quantity_after, movement_type,
    source_type, source_id, created_by, reason
  ) VALUES (
    v_lot.store_id, v_lot.product_id, v_delta, COALESCE(v_before, 0), v_after, 'adjustment',
    'stock_lot', v_lot.id, v_actor,
    format('%s: %s', upper(replace(p_new_status, '_', ' ')), p_reason)
  );

  RETURN v_lot;
END;
$$;

GRANT EXECUTE ON FUNCTION public.adjust_stock_lot(UUID, TEXT, TEXT) TO authenticated;

-- ============================================================
-- PRODUCT STOCK DERIVED FROM LOTS
-- ============================================================
-- One source of truth. A product with any lot gets its stock_qty from its lots;
-- a product with none keeps whatever the simple product flow maintains.

CREATE OR REPLACE FUNCTION public.recompute_product_stock_from_lots(p_product_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lot_count INTEGER;
  v_total NUMERIC;
BEGIN
  SELECT COUNT(*), COALESCE(SUM(qty_available), 0)
  INTO v_lot_count, v_total
  FROM public.stock_lots
  WHERE product_id = p_product_id;

  IF v_lot_count = 0 THEN
    RETURN NULL; -- no lots: leave the simple stock figure alone
  END IF;

  UPDATE public.products
  SET stock_qty = v_total, updated_at = now()
  WHERE id = p_product_id;

  RETURN v_total;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recompute_product_stock_from_lots(UUID) TO authenticated;

-- ============================================================
-- EXPIRY SWEEP
-- ============================================================
-- Stamps available lots whose expiry date has passed as 'expired', so the status
-- reflects reality without a raising code path trying to write during a rollback.
-- Safe to run repeatedly; call it when opening the stock or expiry screens.

CREATE OR REPLACE FUNCTION public.sweep_expired_lots(p_store_id UUID DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE public.stock_lots
  SET status = 'expired', updated_at = now()
  WHERE status = 'available'
    AND expiry_date IS NOT NULL
    AND expiry_date < current_date
    AND (p_store_id IS NULL OR store_id = p_store_id);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sweep_expired_lots(UUID) TO authenticated;

COMMENT ON FUNCTION public.sweep_expired_lots(UUID) IS
  'Marks past-expiry available stock as expired. Separated from the sale path because a refusal raises and would roll back its own write.';

-- ============================================================
-- OPERATIONAL QUERIES PER BUSINESS TYPE
-- ============================================================

-- Pharmacy / cosmetics: what is expiring, and what has already expired.
CREATE OR REPLACE FUNCTION public.list_expiring_stock(
  p_store_id UUID,
  p_days_ahead INTEGER DEFAULT 90,
  p_include_expired BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
  lot_id UUID,
  product_id UUID,
  product_name TEXT,
  identifier TEXT,
  unit_of_measure TEXT,
  qty_available NUMERIC,
  expiry_date DATE,
  days_remaining INTEGER,
  state TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_has_permission(auth.uid(), p_store_id, 'inventory:view') THEN
    RAISE EXCEPTION 'Permission denied: inventory:view required';
  END IF;

  RETURN QUERY
  SELECT sl.id, sl.product_id, pr.name, sl.identifier, sl.unit_of_measure,
         sl.qty_available, sl.expiry_date,
         (sl.expiry_date - current_date)::INTEGER,
         CASE
           WHEN sl.expiry_date < current_date THEN 'expired'
           WHEN sl.expiry_date <= current_date + 7 THEN 'critical'
           ELSE 'warning'
         END
  FROM public.stock_lots sl
  JOIN public.products pr ON pr.id = sl.product_id
  WHERE sl.store_id = p_store_id
    AND sl.expiry_date IS NOT NULL
    AND sl.qty_available > 0
    AND sl.status IN ('available', 'expired')
    AND (p_include_expired OR sl.expiry_date >= current_date)
    AND sl.expiry_date <= current_date + COALESCE(p_days_ahead, 90)
  ORDER BY sl.expiry_date;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_expiring_stock(UUID, INTEGER, BOOLEAN) TO authenticated;

-- Fabric: remaining length per roll, in the unit the roll was received in.
CREATE OR REPLACE FUNCTION public.list_remaining_rolls(p_store_id UUID)
RETURNS TABLE (
  lot_id UUID,
  product_id UUID,
  product_name TEXT,
  identifier TEXT,
  unit_of_measure TEXT,
  qty_received NUMERIC,
  qty_available NUMERIC,
  sold_quantity NUMERIC,
  cost_per_unit NUMERIC,
  status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_has_permission(auth.uid(), p_store_id, 'inventory:view') THEN
    RAISE EXCEPTION 'Permission denied: inventory:view required';
  END IF;

  RETURN QUERY
  SELECT sl.id, sl.product_id, pr.name, sl.identifier, sl.unit_of_measure,
         sl.qty_received, sl.qty_available, (sl.qty_received - sl.qty_available),
         sl.cost_per_unit, sl.status
  FROM public.stock_lots sl
  JOIN public.products pr ON pr.id = sl.product_id
  WHERE sl.store_id = p_store_id
    AND sl.lot_type = 'roll'
  ORDER BY pr.name, sl.identifier;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_remaining_rolls(UUID) TO authenticated;
