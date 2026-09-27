-- Migration: 078_allocate_lots_to_sale.sql
-- Description: Connects sale lines to the stock identity added in 076/077.
--
--   create_sale() deducts products.stock_qty directly and knows nothing about
--   batches, rolls or serials, so a fabric seller could not sell 12.5 metres and a
--   pharmacy could not sell from a specific batch. Rather than rewrite that large
--   live function blind, allocation is a separate, testable step:
--
--     allocate_lots_for_product()  consumes eligible lots for one product
--     allocate_lots_for_sale()     walks a sale's lines and stamps lot identity
--
--   Deliberately split so the consumption logic can be verified without
--   constructing a whole sale, and so wiring it into create_sale (or into the
--   service layer after the insert) is a one-line change on either side.
--
--   KNOWN LIMITATION, stated rather than hidden: create_sale already writes a
--   product-level inventory_movements row, and consuming a lot writes a lot-level
--   row. For products tracked by lots, products.stock_qty is still correct because
--   it is derived from the lots, but the movement ledger shows both a sale summary
--   row and lot rows. Reconciling that duplication is a follow-up task.
-- Author: TrackOja Team
-- Date: 2026-09-26

-- ============================================================
-- CONSUME LOTS FOR ONE PRODUCT
-- ============================================================
-- Earliest expiry first, so stock rotates. Consumes across as many lots as needed
-- (part of a roll plus part of the next one) and reports exactly what it took.

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

  -- A product with no lots is ordinary quantity stock: nothing to allocate.
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
    ORDER BY sl.expiry_date NULLS LAST, sl.received_at
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

COMMENT ON FUNCTION public.allocate_lots_for_product(UUID, NUMERIC, UUID, UUID, BOOLEAN) IS
  'Consumes eligible lots for one product, earliest expiry first, across as many lots as needed. '
  'Returns nothing for a product with no lots, which is ordinary quantity stock.';

-- ============================================================
-- STAMP A SALE'S LINES WITH THE LOTS THAT FULFILLED THEM
-- ============================================================
-- Idempotent: a line already carrying a lot is skipped, so retrying after a
-- partial failure does not double-consume stock.

CREATE OR REPLACE FUNCTION public.allocate_lots_for_sale(
  p_sale_id UUID,
  p_require_full BOOLEAN DEFAULT TRUE
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store_id UUID;
  v_actor UUID := auth.uid();
  v_item RECORD;
  v_allocation RECORD;
  v_lines INTEGER := 0;
BEGIN
  SELECT store_id INTO v_store_id FROM public.sales WHERE id = p_sale_id;
  IF v_store_id IS NULL THEN
    RAISE EXCEPTION 'Sale not found';
  END IF;

  IF v_actor IS NOT NULL
     AND NOT public.user_has_permission(v_actor, v_store_id, 'sales:create') THEN
    RAISE EXCEPTION 'Permission denied: sales:create required';
  END IF;

  FOR v_item IN
    SELECT si.id, si.product_id, si.quantity, si.variant_id
    FROM public.sale_items si
    WHERE si.sale_id = p_sale_id
      AND si.lot_id IS NULL
      AND EXISTS (SELECT 1 FROM public.stock_lots sl WHERE sl.product_id = si.product_id)
    ORDER BY si.created_at, si.id
  LOOP
    FOR v_allocation IN
      SELECT * FROM public.allocate_lots_for_product(
        v_item.product_id, v_item.quantity, v_item.variant_id, p_sale_id, p_require_full
      )
    LOOP
      -- Record the lot identity on the line, and the unit sold with it, so a
      -- receipt, a batch trace and a length report can all see them.
      UPDATE public.sale_items
      SET lot_id = v_allocation.lot_id,
          lot_identifier = v_allocation.identifier,
          unit_of_measure = COALESCE(unit_of_measure, v_allocation.unit_of_measure)
      WHERE id = v_item.id
        AND lot_id IS NULL;
    END LOOP;

    -- A line split across several lots keeps the first lot on the line and the
    -- full picture is recoverable from the lot movements for the sale.
    v_lines := v_lines + 1;
  END LOOP;

  RETURN v_lines;
END;
$$;

GRANT EXECUTE ON FUNCTION public.allocate_lots_for_sale(UUID, BOOLEAN) TO authenticated;

COMMENT ON FUNCTION public.allocate_lots_for_sale(UUID, BOOLEAN) IS
  'Allocates lots to a sale''s unallocated lines and stamps lot identity and unit onto each line. '
  'Idempotent: lines that already carry a lot are skipped.';
