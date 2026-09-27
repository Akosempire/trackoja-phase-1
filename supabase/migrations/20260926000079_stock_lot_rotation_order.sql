-- Migration: 079_stock_lot_rotation_order.sql
-- Description: Makes stock rotation deterministic.
--
--   Lot selection ordered by (expiry_date NULLS LAST, received_at). For lots
--   received in the same transaction received_at is identical - it is the
--   transaction timestamp - so the order was non-deterministic. Fabric rolls have
--   no expiry date at all, so EVERY roll tied and consumption order was arbitrary.
--   Verification caught it: allocating 15 m when the first roll held 7.5 m took 15
--   from the second roll instead of spanning both.
--
--   Adds a monotonic lot_seq (true insertion order) and orders by it. Rotation is
--   now earliest-expiry-first, then first-received-first, deterministically.
-- Author: TrackOja Team
-- Date: 2026-09-26

ALTER TABLE public.stock_lots
  ADD COLUMN IF NOT EXISTS lot_seq BIGSERIAL;

CREATE INDEX IF NOT EXISTS idx_stock_lots_rotation
  ON public.stock_lots(product_id, expiry_date, lot_seq);

COMMENT ON COLUMN public.stock_lots.lot_seq IS
  'Monotonic insertion order. Tiebreaker for stock rotation: received_at is not enough '
  'because lots received in one transaction share a timestamp.';

-- ============================================================
-- DETERMINISTIC ROTATION IN SELECTION AND ALLOCATION
-- ============================================================

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
  ORDER BY sl.expiry_date NULLS LAST, sl.lot_seq
  LIMIT 1;

  RETURN v_lot;
END;
$$;

GRANT EXECUTE ON FUNCTION public.select_lot_for_sale(UUID, NUMERIC, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.allocate_lots_for_product(
  p_product_id UUID,
  p_quantity NUMERIC,
  p_variant_id UUID DEFAULT NULL,
  p_sale_id UUID DEFAULT NULL,
  p_require_full BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
  lot_id UUID,
  identifier TEXT,
  unit_of_measure TEXT,
  quantity_taken NUMERIC,
  remaining_on_lot NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lot public.stock_lots;
  v_remaining NUMERIC := p_quantity;
  v_take NUMERIC;
  v_after public.stock_lots;
  v_lot_count INTEGER;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity to allocate must be greater than zero';
  END IF;

  SELECT COUNT(*) INTO v_lot_count FROM public.stock_lots WHERE product_id = p_product_id;
  IF v_lot_count = 0 THEN
    RETURN;
  END IF;

  FOR v_lot IN
    SELECT * FROM public.stock_lots sl
    WHERE sl.product_id = p_product_id
      AND (p_variant_id IS NULL OR sl.variant_id = p_variant_id)
      AND sl.status = 'available'
      AND sl.qty_available > 0
      AND (sl.expiry_date IS NULL OR sl.expiry_date >= current_date)
    ORDER BY sl.expiry_date NULLS LAST, sl.lot_seq
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;

    v_take := LEAST(v_lot.qty_available, v_remaining);
    v_after := public.sell_lot_quantity(v_lot.id, v_take, p_sale_id, 'Allocated to sale');
    v_remaining := v_remaining - v_take;

    lot_id := v_after.id;
    identifier := v_after.identifier;
    unit_of_measure := v_after.unit_of_measure;
    quantity_taken := v_take;
    remaining_on_lot := v_after.qty_available;
    RETURN NEXT;
  END LOOP;

  IF v_remaining > 0 AND p_require_full THEN
    RAISE EXCEPTION 'Only % of % could be allocated from stock for this product',
      (p_quantity - v_remaining), p_quantity;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.allocate_lots_for_product(UUID, NUMERIC, UUID, UUID, BOOLEAN) TO authenticated;

-- The expiry-exposure query must rotate in the same order as selling.
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
  ORDER BY sl.expiry_date, sl.lot_seq;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_expiring_stock(UUID, INTEGER, BOOLEAN) TO authenticated;
