-- Wholesale by the piece: some wholesalers buy 12 loose pieces, not a carton.
-- A product can have a wholesale price per piece; at the till a line is sold at
-- retail or wholesale (or by the carton). Empty wholesale price = the carton
-- price shared out per piece (N5,400 / 24 = N225). Stock is unchanged: pieces.

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS wholesale_price NUMERIC(14,2);
DO $$ BEGIN
  ALTER TABLE public.products ADD CONSTRAINT products_wholesale_ok CHECK (wholesale_price IS NULL OR wholesale_price >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS price_tier TEXT;

-- create_sale: as in 20261109001001, plus an item "price": "wholesale"
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
  v_variant public.product_variants;
  v_price NUMERIC;
  v_name TEXT;
  v_sku TEXT;
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
  v_pack_qty NUMERIC;
  v_pack_price NUMERIC;
  v_tier TEXT;
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

  INSERT INTO public.store_sale_counters (store_id, last_number)
  VALUES (p_store_id, 1)
  ON CONFLICT (store_id) DO UPDATE SET last_number = public.store_sale_counters.last_number + 1
  RETURNING last_number INTO v_sale_number;

  INSERT INTO public.sales (store_id, sale_number, status, customer_name, customer_phone, notes, created_by)
  VALUES (p_store_id, v_sale_number::TEXT, 'completed', p_customer_name, p_customer_phone, p_notes, auth.uid())
  RETURNING id INTO v_sale_id;

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

    v_variant := NULL;
    v_price := v_product.selling_price;
    v_name := v_product.name;
    v_sku := v_product.sku;
    IF NULLIF(v_item->>'variantId', '') IS NOT NULL THEN
      SELECT * INTO v_variant FROM public.product_variants
      WHERE id = (v_item->>'variantId')::UUID AND product_id = v_product.id AND status = 'active'
      FOR UPDATE;
      IF v_variant.id IS NULL THEN
        RAISE EXCEPTION 'That size or colour of % is no longer available', v_product.name;
      END IF;
      IF v_product.track_inventory AND v_variant.stock_qty < v_quantity
         AND NOT COALESCE(v_settings.allow_negative_stock, FALSE) THEN
        RAISE EXCEPTION 'Insufficient stock for % (%)', v_product.name, public.variant_label(v_variant.size, v_variant.colour);
      END IF;
      v_price := COALESCE(v_variant.selling_price, v_product.selling_price);
      v_name := left(v_product.name || ' – ' || COALESCE(public.variant_label(v_variant.size, v_variant.colour), ''), 300);
      v_sku := COALESCE(v_variant.sku, v_product.sku);
    END IF;

    -- Wholesale by the piece: the product's wholesale price, else its carton
    -- price shared out per piece. A carton line already has its own price.
    v_tier := NULL;
    IF v_item->>'price' = 'wholesale' AND COALESCE(v_item->>'unit', '') <> 'pack' THEN
      v_price := COALESCE(v_product.wholesale_price,
        CASE WHEN v_product.pack_size > 1 THEN ROUND(COALESCE(v_product.pack_price, v_product.pack_size * v_price) / v_product.pack_size, 2) END);
      IF v_price IS NULL THEN
        RAISE EXCEPTION '% has no wholesale price', v_product.name;
      END IF;
      v_tier := 'wholesale';
    END IF;

    -- Sold by the pack (a carton of 24): stock still counts in pieces. The line
    -- keeps how many packs at what pack price; quantity is the pieces it takes.
    v_pack_qty := NULL;
    IF v_item->>'unit' = 'pack' THEN
      IF COALESCE(v_product.pack_size, 0) <= 1 THEN
        RAISE EXCEPTION '% isn''t sold by the pack', v_product.name;
      END IF;
      v_pack_qty := v_quantity;
      v_pack_price := COALESCE(v_product.pack_price, v_product.pack_size * v_price);
      v_quantity := v_pack_qty * v_product.pack_size;
      IF v_variant.id IS NOT NULL AND v_product.track_inventory AND v_variant.stock_qty < v_quantity
         AND NOT COALESCE(v_settings.allow_negative_stock, FALSE) THEN
        RAISE EXCEPTION 'Insufficient stock for % (%)', v_product.name, public.variant_label(v_variant.size, v_variant.colour);
      END IF;
      v_line_subtotal := v_pack_qty * v_pack_price;
      v_price := ROUND(v_pack_price / v_product.pack_size, 2);
    ELSE
      v_line_subtotal := v_quantity * v_price;
    END IF;
    v_tax_amount := ROUND((v_line_subtotal - v_discount) * v_product.tax_rate / 100, 2);
    v_line_total := v_line_subtotal - v_discount + v_tax_amount;

    INSERT INTO public.sale_items (
      sale_id, product_id, product_name, sku, quantity, unit_price, tax_rate, tax_amount, discount_amount, line_total, variant_id,
      pack_qty, pack_name, pack_size, pack_price, price_tier
    ) VALUES (
      v_sale_id, v_product.id, v_name, v_sku, v_quantity, v_price, v_product.tax_rate,
      v_tax_amount, v_discount, v_line_total, v_variant.id,
      v_pack_qty, CASE WHEN v_pack_qty IS NOT NULL THEN COALESCE(NULLIF(v_product.pack_name, ''), 'Pack') END,
      CASE WHEN v_pack_qty IS NOT NULL THEN v_product.pack_size END,
      CASE WHEN v_pack_qty IS NOT NULL THEN v_pack_price END,
      v_tier
    );

    v_subtotal := v_subtotal + v_line_subtotal;
    v_tax_total := v_tax_total + v_tax_amount;

    IF v_product.track_inventory THEN
      PERFORM public._apply_inventory_movement_internal(
        p_store_id, v_product.id, 'sale', -v_quantity, NULL, 'sale', v_sale_id, auth.uid()
      );
      IF v_variant.id IS NOT NULL THEN
        UPDATE public.product_variants SET stock_qty = stock_qty - v_quantity WHERE id = v_variant.id;
      END IF;
    END IF;
  END LOOP;

  v_total := v_subtotal - COALESCE(p_discount_total, 0) + v_tax_total;

  IF v_total < 0 THEN
    RAISE EXCEPTION 'Sale total cannot be negative';
  END IF;

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

  IF v_credit_amount > 0 THEN
    v_new_balance := v_customer.balance + v_credit_amount;

    IF v_new_balance > v_customer.credit_limit THEN
      RAISE EXCEPTION 'Sale would exceed customer credit limit';
    END IF;
  END IF;

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

-- new product columns readable by the app (cost columns stay private)
SELECT public._apply_cost_privacy();
