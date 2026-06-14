-- Migration: 015_inventory_movements_schema.sql
-- Description: Inventory movements ledger and the apply_inventory_movement
--   function, which is the only path allowed to mutate products.stock_qty.
--   The function is SECURITY DEFINER (so it can update products and insert the
--   ledger row atomically without relying on table-owner write access), but it
--   re-checks the caller's identity and inventory:adjust permission internally
--   since SECURITY DEFINER functions bypass RLS.
-- Author: TrackOja Team
-- Date: 2026-06-13

CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('replenishment', 'adjustment', 'transfer_in', 'transfer_out', 'sale', 'return')),
  quantity NUMERIC(14,3) NOT NULL CHECK (quantity <> 0),
  quantity_before NUMERIC(14,3) NOT NULL,
  quantity_after NUMERIC(14,3) NOT NULL,
  reason TEXT,
  source_type TEXT,
  source_id UUID,
  created_by UUID NOT NULL REFERENCES public.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CHECK (quantity_after = quantity_before + quantity),
  CHECK (
    (movement_type IN ('replenishment', 'transfer_in', 'return') AND quantity > 0)
    OR (movement_type IN ('transfer_out', 'sale') AND quantity < 0)
    OR (movement_type = 'adjustment')
  )
);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_store ON public.inventory_movements(store_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_product ON public.inventory_movements(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_type ON public.inventory_movements(movement_type);

ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- ATOMIC STOCK ADJUSTMENT
-- ============================================================
CREATE OR REPLACE FUNCTION public.apply_inventory_movement(
  p_store_id UUID,
  p_product_id UUID,
  p_movement_type TEXT,
  p_quantity NUMERIC,
  p_reason TEXT,
  p_source_type TEXT,
  p_source_id UUID
)
RETURNS public.inventory_movements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_qty NUMERIC;
  v_new_qty NUMERIC;
  v_allow_negative BOOLEAN;
  v_movement public.inventory_movements;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.user_has_permission(auth.uid(), p_store_id, 'inventory:adjust') THEN
    RAISE EXCEPTION 'Permission denied: inventory:adjust required';
  END IF;

  IF p_quantity = 0 THEN
    RAISE EXCEPTION 'Movement quantity cannot be zero';
  END IF;

  IF p_movement_type = 'adjustment' AND (p_reason IS NULL OR length(trim(p_reason)) = 0) THEN
    RAISE EXCEPTION 'A reason is required for adjustment movements';
  END IF;

  SELECT stock_qty INTO v_current_qty
  FROM public.products
  WHERE id = p_product_id AND store_id = p_store_id
  FOR UPDATE;

  IF v_current_qty IS NULL THEN
    RAISE EXCEPTION 'Product not found in store';
  END IF;

  v_new_qty := v_current_qty + p_quantity;

  IF v_new_qty < 0 THEN
    SELECT COALESCE(allow_negative_stock, FALSE) INTO v_allow_negative
    FROM public.store_settings WHERE store_id = p_store_id;

    IF NOT COALESCE(v_allow_negative, FALSE) THEN
      RAISE EXCEPTION 'Insufficient stock: movement would reduce stock below zero';
    END IF;
  END IF;

  UPDATE public.products SET stock_qty = v_new_qty WHERE id = p_product_id;

  INSERT INTO public.inventory_movements (
    store_id, product_id, movement_type, quantity, quantity_before, quantity_after,
    reason, source_type, source_id, created_by
  ) VALUES (
    p_store_id, p_product_id, p_movement_type, p_quantity, v_current_qty, v_new_qty,
    p_reason, p_source_type, p_source_id, auth.uid()
  )
  RETURNING * INTO v_movement;

  RETURN v_movement;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_inventory_movement(UUID, UUID, TEXT, NUMERIC, TEXT, TEXT, UUID) TO authenticated;
