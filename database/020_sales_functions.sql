-- Migration: 020_sales_functions.sql
-- Description: Phase 3 sales functions.
--   - Factors the stock-mutation core of apply_inventory_movement (Phase 2) into
--     a private helper, _apply_inventory_movement_internal, with no permission
--     check of its own (callers must check permissions before invoking it).
--     EXECUTE on the internal helper is revoked from PUBLIC so it cannot be
--     called directly by authenticated/anon clients.
--   - apply_inventory_movement (inventory:adjust) is redefined to delegate to
--     the internal helper after its existing checks - behavior is unchanged.
--   - create_sale (sales:create) atomically creates a sale, its line items and
--     payments, and the corresponding 'sale' inventory movements.
--   - void_sale (sales:void) reverses a completed sale's stock via 'return'
--     movements and marks it voided.
-- Author: TrackOja Team
-- Date: 2026-06-14

-- ============================================================
-- INTERNAL STOCK MUTATION HELPER (no permission check - callers must check)
-- ============================================================
CREATE OR REPLACE FUNCTION public._apply_inventory_movement_internal(
  p_store_id UUID,
  p_product_id UUID,
  p_movement_type TEXT,
  p_quantity NUMERIC,
  p_reason TEXT,
  p_source_type TEXT,
  p_source_id UUID,
  p_created_by UUID
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
  IF p_quantity = 0 THEN
    RAISE EXCEPTION 'Movement quantity cannot be zero';
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
    p_reason, p_source_type, p_source_id, p_created_by
  )
  RETURNING * INTO v_movement;

  RETURN v_movement;
END;
$$;

REVOKE ALL ON FUNCTION public._apply_inventory_movement_internal(UUID, UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, UUID) FROM PUBLIC;

-- ============================================================
-- APPLY_INVENTORY_MOVEMENT (Phase 2, redefined to delegate to the helper)
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
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.user_has_permission(auth.uid(), p_store_id, 'inventory:adjust') THEN
    RAISE EXCEPTION 'Permission denied: inventory:adjust required';
  END IF;

  IF p_movement_type = 'adjustment' AND (p_reason IS NULL OR length(trim(p_reason)) = 0) THEN
    RAISE EXCEPTION 'A reason is required for adjustment movements';
  END IF;

  RETURN public._apply_inventory_movement_internal(
    p_store_id, p_product_id, p_movement_type, p_quantity, p_reason, p_source_type, p_source_id, auth.uid()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_inventory_movement(UUID, UUID, TEXT, NUMERIC, TEXT, TEXT, UUID) TO authenticated;

-- ============================================================
-- CREATE_SALE
-- ============================================================
-- p_items: jsonb array of {"productId": UUID, "quantity": number, "discountAmount"?: number}
-- p_payments: jsonb array of {"method": "cash"|"card"|"transfer"|"other", "amount": number, "reference"?: string}
CREATE OR REPLACE FUNCTION public.create_sale(
  p_store_id UUID,
  p_items JSONB,
  p_payments JSONB,
  p_customer_name TEXT DEFAULT NULL,
  p_customer_phone TEXT DEFAULT NULL,
  p_discount_total NUMERIC DEFAULT 0,
  p_notes TEXT DEFAULT NULL
)
RETURNS public.sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale public.sales;
  v_sale_id UUID;
  v_sale_number BIGINT;
  v_item JSONB;
  v_payment JSONB;
  v_product public.products;
  v_quantity NUMERIC;
  v_discount NUMERIC;
  v_line_subtotal NUMERIC;
  v_tax_amount NUMERIC;
  v_line_total NUMERIC;
  v_subtotal NUMERIC := 0;
  v_tax_total NUMERIC := 0;
  v_amount_paid NUMERIC := 0;
  v_total NUMERIC;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.user_has_permission(auth.uid(), p_store_id, 'sales:create') THEN
    RAISE EXCEPTION 'Permission denied: sales:create required';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'A sale must have at least one item';
  END IF;

  IF p_payments IS NULL OR jsonb_array_length(p_payments) = 0 THEN
    RAISE EXCEPTION 'A sale must have at least one payment';
  END IF;

  -- Allocate the next sale number for this store
  INSERT INTO public.store_sale_counters (store_id, last_number)
  VALUES (p_store_id, 1)
  ON CONFLICT (store_id) DO UPDATE SET last_number = public.store_sale_counters.last_number + 1
  RETURNING last_number INTO v_sale_number;

  -- Create the sale shell row (totals filled in below)
  INSERT INTO public.sales (store_id, sale_number, status, customer_name, customer_phone, notes, created_by)
  VALUES (p_store_id, v_sale_number::TEXT, 'completed', p_customer_name, p_customer_phone, p_notes, auth.uid())
  RETURNING id INTO v_sale_id;

  -- Line items: snapshot product data, accumulate totals, move stock
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_quantity := (v_item->>'quantity')::NUMERIC;
    v_discount := COALESCE((v_item->>'discountAmount')::NUMERIC, 0);

    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'Item quantity must be greater than zero';
    END IF;

    SELECT * INTO v_product
    FROM public.products
    WHERE id = (v_item->>'productId')::UUID AND store_id = p_store_id
    FOR UPDATE;

    IF v_product.id IS NULL THEN
      RAISE EXCEPTION 'Product not found in store';
    END IF;

    v_line_subtotal := v_quantity * v_product.selling_price;
    v_tax_amount := ROUND((v_line_subtotal - v_discount) * v_product.tax_rate / 100, 2);
    v_line_total := v_line_subtotal - v_discount + v_tax_amount;

    INSERT INTO public.sale_items (
      sale_id, product_id, product_name, sku, quantity, unit_price, tax_rate, tax_amount, discount_amount, line_total
    ) VALUES (
      v_sale_id, v_product.id, v_product.name, v_product.sku, v_quantity, v_product.selling_price, v_product.tax_rate,
      v_tax_amount, v_discount, v_line_total
    );

    v_subtotal := v_subtotal + v_line_subtotal;
    v_tax_total := v_tax_total + v_tax_amount;

    IF v_product.track_inventory THEN
      PERFORM public._apply_inventory_movement_internal(
        p_store_id, v_product.id, 'sale', -v_quantity, NULL, 'sale', v_sale_id, auth.uid()
      );
    END IF;
  END LOOP;

  v_total := v_subtotal - COALESCE(p_discount_total, 0) + v_tax_total;

  IF v_total < 0 THEN
    RAISE EXCEPTION 'Sale total cannot be negative';
  END IF;

  -- Payments
  FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments)
  LOOP
    IF (v_payment->>'amount')::NUMERIC <= 0 THEN
      RAISE EXCEPTION 'Payment amount must be greater than zero';
    END IF;

    INSERT INTO public.sale_payments (sale_id, method, amount, reference)
    VALUES (v_sale_id, v_payment->>'method', (v_payment->>'amount')::NUMERIC, v_payment->>'reference');

    v_amount_paid := v_amount_paid + (v_payment->>'amount')::NUMERIC;
  END LOOP;

  IF v_amount_paid < v_total THEN
    RAISE EXCEPTION 'Amount paid is less than the sale total';
  END IF;

  UPDATE public.sales
  SET subtotal = v_subtotal,
      discount_total = COALESCE(p_discount_total, 0),
      tax_total = v_tax_total,
      total = v_total,
      amount_paid = v_amount_paid,
      change_due = v_amount_paid - v_total
  WHERE id = v_sale_id
  RETURNING * INTO v_sale;

  RETURN v_sale;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_sale(UUID, JSONB, JSONB, TEXT, TEXT, NUMERIC, TEXT) TO authenticated;

-- ============================================================
-- VOID_SALE
-- ============================================================
CREATE OR REPLACE FUNCTION public.void_sale(p_sale_id UUID, p_reason TEXT)
RETURNS public.sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale public.sales;
  v_item RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id FOR UPDATE;

  IF v_sale.id IS NULL THEN
    RAISE EXCEPTION 'Sale not found';
  END IF;

  IF NOT public.user_has_permission(auth.uid(), v_sale.store_id, 'sales:void') THEN
    RAISE EXCEPTION 'Permission denied: sales:void required';
  END IF;

  IF v_sale.status <> 'completed' THEN
    RAISE EXCEPTION 'Only completed sales can be voided';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'A reason is required to void a sale';
  END IF;

  FOR v_item IN
    SELECT si.product_id, si.quantity
    FROM public.sale_items si
    JOIN public.products p ON p.id = si.product_id
    WHERE si.sale_id = p_sale_id AND si.product_id IS NOT NULL AND p.track_inventory = TRUE
  LOOP
    PERFORM public._apply_inventory_movement_internal(
      v_sale.store_id, v_item.product_id, 'return', v_item.quantity, p_reason, 'sale_void', p_sale_id, auth.uid()
    );
  END LOOP;

  UPDATE public.sales
  SET status = 'voided', voided_at = now(), voided_by = auth.uid(), void_reason = p_reason
  WHERE id = p_sale_id
  RETURNING * INTO v_sale;

  RETURN v_sale;
END;
$$;

GRANT EXECUTE ON FUNCTION public.void_sale(UUID, TEXT) TO authenticated;
