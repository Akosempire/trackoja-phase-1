-- Migration: 038_payments_functions.sql
-- Description: Phase 8 payments functions per PHASE_8_PAYMENTS.md section 3.
--   - create_sale (redefined): payments may carry an optional
--     "verificationStatus": "pending" key, stored on sale_payments.
--   - void_sale (redefined): refuses to void a sale that already has refunds.
--   - process_refund (sales:refund): full/partial refund against a completed
--     sale, with optional inventory return and proportional credit/loyalty
--     reversal.
--   - verify_sale_payment (sales:refund): mark a pending payment
--     verified/rejected.
--   - list_pending_sale_payments / list_recent_refunds (sales:refund):
--     read helpers for the Payments page.
-- Author: TrackOja Team
-- Date: 2026-06-14

-- ============================================================
-- CREATE_SALE (redefined - payments may carry an optional verificationStatus)
-- ============================================================
-- p_items: jsonb array of {"productId": UUID, "quantity": number, "discountAmount"?: number}
-- p_payments: jsonb array of {"method": "cash"|"card"|"transfer"|"other"|"credit", "amount": number, "reference"?: string, "verificationStatus"?: "pending"}
CREATE OR REPLACE FUNCTION public.create_sale(
  p_store_id UUID,
  p_items JSONB,
  p_payments JSONB,
  p_customer_name TEXT DEFAULT NULL,
  p_customer_phone TEXT DEFAULT NULL,
  p_discount_total NUMERIC DEFAULT 0,
  p_notes TEXT DEFAULT NULL,
  p_customer_id UUID DEFAULT NULL
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
  v_settings public.store_settings;
  v_customer public.customers;
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
  v_credit_amount NUMERIC := 0;
  v_total NUMERIC;
  v_new_balance NUMERIC;
  v_points_earned INTEGER := 0;
  v_new_points INTEGER;
  v_verification_status TEXT;
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

  SELECT * INTO v_settings FROM public.store_settings WHERE store_id = p_store_id;

  IF COALESCE(v_settings.require_customer_for_sale, FALSE) AND p_customer_id IS NULL THEN
    RAISE EXCEPTION 'A customer is required for this sale';
  END IF;

  IF p_customer_id IS NOT NULL THEN
    SELECT * INTO v_customer
    FROM public.customers
    WHERE id = p_customer_id AND store_id = p_store_id
    FOR UPDATE;

    IF v_customer.id IS NULL THEN
      RAISE EXCEPTION 'Customer not found in store';
    END IF;

    IF NOT v_customer.is_active THEN
      RAISE EXCEPTION 'Customer is inactive';
    END IF;
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

    IF v_payment->>'method' = 'credit' THEN
      IF p_customer_id IS NULL THEN
        RAISE EXCEPTION 'A customer is required to use the credit payment method';
      END IF;
      v_credit_amount := v_credit_amount + (v_payment->>'amount')::NUMERIC;
    END IF;

    IF v_payment->>'verificationStatus' = 'pending' THEN
      v_verification_status := 'pending';
    ELSE
      v_verification_status := 'verified';
    END IF;

    INSERT INTO public.sale_payments (sale_id, method, amount, reference, verification_status)
    VALUES (v_sale_id, v_payment->>'method', (v_payment->>'amount')::NUMERIC, v_payment->>'reference', v_verification_status);

    v_amount_paid := v_amount_paid + (v_payment->>'amount')::NUMERIC;
  END LOOP;

  IF v_amount_paid < v_total THEN
    RAISE EXCEPTION 'Amount paid is less than the sale total';
  END IF;

  -- Credit payment: check against credit limit
  IF v_credit_amount > 0 THEN
    v_new_balance := v_customer.balance + v_credit_amount;

    IF v_new_balance > v_customer.credit_limit THEN
      RAISE EXCEPTION 'Sale would exceed customer credit limit';
    END IF;
  END IF;

  -- Loyalty points earned
  IF p_customer_id IS NOT NULL AND COALESCE(v_settings.loyalty_enabled, FALSE) AND COALESCE(v_settings.loyalty_earn_rate, 0) > 0 THEN
    v_points_earned := FLOOR(v_total * v_settings.loyalty_earn_rate)::INTEGER;
  END IF;

  UPDATE public.sales
  SET subtotal = v_subtotal,
      discount_total = COALESCE(p_discount_total, 0),
      tax_total = v_tax_total,
      total = v_total,
      amount_paid = v_amount_paid,
      change_due = v_amount_paid - v_total,
      customer_id = p_customer_id,
      loyalty_points_earned = v_points_earned
  WHERE id = v_sale_id
  RETURNING * INTO v_sale;

  -- Apply credit and loyalty changes to the customer
  IF p_customer_id IS NOT NULL THEN
    v_new_balance := v_customer.balance + v_credit_amount;
    v_new_points := v_customer.loyalty_points + v_points_earned;

    IF v_credit_amount > 0 OR v_points_earned > 0 THEN
      UPDATE public.customers SET balance = v_new_balance, loyalty_points = v_new_points WHERE id = p_customer_id;
    END IF;

    IF v_credit_amount > 0 THEN
      INSERT INTO public.customer_credit_transactions (
        store_id, customer_id, type, amount, balance_before, balance_after, source_type, source_id, created_by
      ) VALUES (
        p_store_id, p_customer_id, 'sale_credit', v_credit_amount, v_customer.balance, v_new_balance, 'sale', v_sale_id, auth.uid()
      );
    END IF;

    IF v_points_earned > 0 THEN
      INSERT INTO public.customer_loyalty_transactions (
        store_id, customer_id, type, points, points_before, points_after, source_type, source_id, created_by
      ) VALUES (
        p_store_id, p_customer_id, 'earn', v_points_earned, v_customer.loyalty_points, v_new_points, 'sale', v_sale_id, auth.uid()
      );
    END IF;
  END IF;

  RETURN v_sale;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_sale(UUID, JSONB, JSONB, TEXT, TEXT, NUMERIC, TEXT, UUID) TO authenticated;

-- ============================================================
-- VOID_SALE (redefined - refuses to void a sale that already has refunds)
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
  v_customer public.customers;
  v_credit_amount NUMERIC;
  v_new_balance NUMERIC;
  v_new_points INTEGER;
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

  IF v_sale.refunded_amount > 0 THEN
    RAISE EXCEPTION 'Cannot void a sale that has refunds; process or reverse the remaining balance first';
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

  -- Reverse credit payments and loyalty points earned, if any
  IF v_sale.customer_id IS NOT NULL THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_credit_amount
    FROM public.sale_payments
    WHERE sale_id = p_sale_id AND method = 'credit';

    IF v_credit_amount > 0 OR v_sale.loyalty_points_earned > 0 THEN
      SELECT * INTO v_customer FROM public.customers WHERE id = v_sale.customer_id FOR UPDATE;

      v_new_balance := v_customer.balance - v_credit_amount;
      v_new_points := GREATEST(0, v_customer.loyalty_points - v_sale.loyalty_points_earned);

      UPDATE public.customers SET balance = v_new_balance, loyalty_points = v_new_points WHERE id = v_customer.id;

      IF v_credit_amount > 0 THEN
        INSERT INTO public.customer_credit_transactions (
          store_id, customer_id, type, amount, balance_before, balance_after, source_type, source_id, created_by
        ) VALUES (
          v_sale.store_id, v_customer.id, 'sale_void', -v_credit_amount, v_customer.balance, v_new_balance, 'sale_void', p_sale_id, auth.uid()
        );
      END IF;

      IF v_sale.loyalty_points_earned > 0 THEN
        INSERT INTO public.customer_loyalty_transactions (
          store_id, customer_id, type, points, points_before, points_after, source_type, source_id, created_by
        ) VALUES (
          v_sale.store_id, v_customer.id, 'void', v_new_points - v_customer.loyalty_points, v_customer.loyalty_points, v_new_points, 'sale_void', p_sale_id, auth.uid()
        );
      END IF;
    END IF;
  END IF;

  UPDATE public.sales
  SET status = 'voided', voided_at = now(), voided_by = auth.uid(), void_reason = p_reason
  WHERE id = p_sale_id
  RETURNING * INTO v_sale;

  RETURN v_sale;
END;
$$;

GRANT EXECUTE ON FUNCTION public.void_sale(UUID, TEXT) TO authenticated;

-- ============================================================
-- PROCESS_REFUND
-- ============================================================
-- p_items: optional jsonb array of {"saleItemId": UUID, "quantity": number}
CREATE OR REPLACE FUNCTION public.process_refund(
  p_sale_id UUID,
  p_amount NUMERIC,
  p_reason TEXT,
  p_method TEXT,
  p_items JSONB DEFAULT NULL
)
RETURNS public.refunds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale public.sales;
  v_refund public.refunds;
  v_remaining NUMERIC;
  v_item JSONB;
  v_sale_item public.sale_items;
  v_quantity NUMERIC;
  v_customer public.customers;
  v_new_balance NUMERIC;
  v_new_points INTEGER;
  v_points_to_reverse INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id FOR UPDATE;

  IF v_sale.id IS NULL THEN
    RAISE EXCEPTION 'Sale not found';
  END IF;

  IF NOT public.user_has_permission(auth.uid(), v_sale.store_id, 'sales:refund') THEN
    RAISE EXCEPTION 'Permission denied: sales:refund required';
  END IF;

  IF v_sale.status <> 'completed' THEN
    RAISE EXCEPTION 'Only completed sales can be refunded';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Refund amount must be greater than zero';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'A reason is required to process a refund';
  END IF;

  IF p_method NOT IN ('cash', 'card', 'transfer', 'other', 'credit') THEN
    RAISE EXCEPTION 'Invalid refund method';
  END IF;

  v_remaining := v_sale.total - v_sale.refunded_amount;

  IF p_amount > v_remaining THEN
    RAISE EXCEPTION 'Refund amount exceeds the remaining refundable balance';
  END IF;

  -- Return items to stock, if any
  IF p_items IS NOT NULL THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_quantity := (v_item->>'quantity')::NUMERIC;

      IF v_quantity IS NULL OR v_quantity <= 0 THEN
        RAISE EXCEPTION 'Refund item quantity must be greater than zero';
      END IF;

      SELECT * INTO v_sale_item
      FROM public.sale_items
      WHERE id = (v_item->>'saleItemId')::UUID AND sale_id = p_sale_id
      FOR UPDATE;

      IF v_sale_item.id IS NULL THEN
        RAISE EXCEPTION 'Sale item not found on this sale';
      END IF;

      IF v_quantity > (v_sale_item.quantity - v_sale_item.refunded_quantity) THEN
        RAISE EXCEPTION 'Refund quantity exceeds the remaining returnable quantity for %', v_sale_item.product_name;
      END IF;

      UPDATE public.sale_items SET refunded_quantity = refunded_quantity + v_quantity WHERE id = v_sale_item.id;

      IF v_sale_item.product_id IS NOT NULL
         AND EXISTS (SELECT 1 FROM public.products WHERE id = v_sale_item.product_id AND track_inventory = TRUE)
      THEN
        PERFORM public._apply_inventory_movement_internal(
          v_sale.store_id, v_sale_item.product_id, 'return', v_quantity, p_reason, 'sale_refund', p_sale_id, auth.uid()
        );
      END IF;
    END LOOP;
  END IF;

  -- Reverse customer credit (if refunding to a credit account) and a
  -- proportional share of any loyalty points earned by the sale
  IF v_sale.customer_id IS NOT NULL THEN
    SELECT * INTO v_customer FROM public.customers WHERE id = v_sale.customer_id FOR UPDATE;

    IF p_method = 'credit' THEN
      v_new_balance := v_customer.balance - p_amount;

      UPDATE public.customers SET balance = v_new_balance WHERE id = v_customer.id;

      INSERT INTO public.customer_credit_transactions (
        store_id, customer_id, type, amount, balance_before, balance_after, source_type, source_id, notes, created_by
      ) VALUES (
        v_sale.store_id, v_customer.id, 'sale_void', -p_amount, v_customer.balance, v_new_balance, 'sale_refund', p_sale_id, p_reason, auth.uid()
      );
    END IF;

    IF v_sale.loyalty_points_earned > 0 AND v_sale.total > 0 THEN
      v_points_to_reverse := LEAST(
        v_customer.loyalty_points,
        FLOOR(v_sale.loyalty_points_earned * p_amount / v_sale.total)::INTEGER
      );

      IF v_points_to_reverse > 0 THEN
        v_new_points := v_customer.loyalty_points - v_points_to_reverse;

        UPDATE public.customers SET loyalty_points = v_new_points WHERE id = v_customer.id;

        INSERT INTO public.customer_loyalty_transactions (
          store_id, customer_id, type, points, points_before, points_after, source_type, source_id, notes, created_by
        ) VALUES (
          v_sale.store_id, v_customer.id, 'void', -v_points_to_reverse, v_customer.loyalty_points, v_new_points, 'sale_refund', p_sale_id, p_reason, auth.uid()
        );
      END IF;
    END IF;
  END IF;

  INSERT INTO public.refunds (store_id, sale_id, amount, reason, method, items, created_by)
  VALUES (v_sale.store_id, p_sale_id, p_amount, p_reason, p_method, p_items, auth.uid())
  RETURNING * INTO v_refund;

  UPDATE public.sales SET refunded_amount = v_sale.refunded_amount + p_amount WHERE id = p_sale_id;

  RETURN v_refund;
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_refund(UUID, NUMERIC, TEXT, TEXT, JSONB) TO authenticated;

-- ============================================================
-- VERIFY_SALE_PAYMENT
-- ============================================================
CREATE OR REPLACE FUNCTION public.verify_sale_payment(p_payment_id UUID, p_status TEXT)
RETURNS public.sale_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.sale_payments;
  v_sale public.sales;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_status NOT IN ('verified', 'rejected') THEN
    RAISE EXCEPTION 'Invalid verification status';
  END IF;

  SELECT * INTO v_payment FROM public.sale_payments WHERE id = p_payment_id FOR UPDATE;

  IF v_payment.id IS NULL THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;

  SELECT * INTO v_sale FROM public.sales WHERE id = v_payment.sale_id;

  IF NOT public.user_has_permission(auth.uid(), v_sale.store_id, 'sales:refund') THEN
    RAISE EXCEPTION 'Permission denied: sales:refund required';
  END IF;

  IF v_payment.verification_status <> 'pending' THEN
    RAISE EXCEPTION 'Payment has already been verified';
  END IF;

  UPDATE public.sale_payments
  SET verification_status = p_status, verified_by = auth.uid(), verified_at = now()
  WHERE id = p_payment_id
  RETURNING * INTO v_payment;

  RETURN v_payment;
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_sale_payment(UUID, TEXT) TO authenticated;

-- ============================================================
-- LIST_PENDING_SALE_PAYMENTS
-- ============================================================
CREATE OR REPLACE FUNCTION public.list_pending_sale_payments(p_store_id UUID)
RETURNS TABLE (
  id UUID,
  sale_id UUID,
  sale_number TEXT,
  method TEXT,
  amount NUMERIC,
  reference TEXT,
  created_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.user_has_permission(auth.uid(), p_store_id, 'sales:refund') THEN
    RAISE EXCEPTION 'Permission denied: sales:refund required';
  END IF;

  RETURN QUERY
  SELECT sp.id, sp.sale_id, s.sale_number, sp.method, sp.amount, sp.reference, sp.created_at
  FROM public.sale_payments sp
  JOIN public.sales s ON s.id = sp.sale_id
  WHERE s.store_id = p_store_id AND sp.verification_status = 'pending'
  ORDER BY sp.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_pending_sale_payments(UUID) TO authenticated;

-- ============================================================
-- LIST_RECENT_REFUNDS
-- ============================================================
CREATE OR REPLACE FUNCTION public.list_recent_refunds(p_store_id UUID, p_limit INTEGER DEFAULT 50)
RETURNS TABLE (
  id UUID,
  sale_id UUID,
  sale_number TEXT,
  amount NUMERIC,
  reason TEXT,
  method TEXT,
  created_by_email TEXT,
  created_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.user_has_permission(auth.uid(), p_store_id, 'sales:refund') THEN
    RAISE EXCEPTION 'Permission denied: sales:refund required';
  END IF;

  RETURN QUERY
  SELECT r.id, r.sale_id, s.sale_number, r.amount, r.reason, r.method, u.email, r.created_at
  FROM public.refunds r
  JOIN public.sales s ON s.id = r.sale_id
  LEFT JOIN public.users u ON u.id = r.created_by
  WHERE r.store_id = p_store_id
  ORDER BY r.created_at DESC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_recent_refunds(UUID, INTEGER) TO authenticated;
