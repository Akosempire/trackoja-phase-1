-- ============================================================
-- 20261030003001: PRODUCT VARIANTS (sizes, colours) IN THE SHOP
-- ============================================================
-- Design (least risk to stock, sales, reports and the Usetally payload):
--
--   * A product keeps being the unit everything else knows about. Its stock_qty
--     is the TOTAL across its variants and every change to it still goes through
--     _apply_inventory_movement_internal, so the inventory ledger, reports,
--     low-stock checks and Usetally's stock updates stay correct.
--   * Each variant (product_variants, from 20260926000076) carries its own
--     size/colour, SKU, barcode, optional price (NULL = the product's price) and
--     its own stock_qty. Up to two options per product (e.g. Size, Colour),
--     named in products.variant_options; option 1 → size, option 2 → colour,
--     so the existing unique (product, size, colour) index keeps combinations unique.
--   * Selling a variant: create_sale takes an optional item variantId. The line
--     snapshots "Product – M / Red", the variant SKU and price, records
--     sale_items.variant_id, moves the PRODUCT stock exactly as before and also
--     lowers the variant's stock. Without variantId nothing changes.
--   * Voids and refunds are untouched functions; two triggers give the variant
--     back what the product gets back (void: the full quantity; refund: the
--     refunded quantity), mirroring what void_sale/process_refund do for products.
--   * The Usetally payload reads sale_items.product_name and sku, so it shows the
--     variant with no change to the connection.
--   * Moniepoint terminal checkouts (create_pending_pos_sale) don't take variants
--     yet; the app asks for Card (POS) instead when the basket has variants.
-- ============================================================

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS variant_options JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS barcode TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_variants_unique_barcode
  ON public.product_variants(store_id, barcode) WHERE barcode IS NOT NULL;

-- "M / Red"
CREATE OR REPLACE FUNCTION public.variant_label(p_size TEXT, p_colour TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT NULLIF(concat_ws(' / ', NULLIF(trim(p_size), ''), NULLIF(trim(p_colour), '')), '');
$$;

-- ------------------------------------------------------------
-- Saving a product's options and variants (product:update)
-- ------------------------------------------------------------
-- p_options: [{"name":"Size","values":["S","M"]},{"name":"Colour","values":["Red"]}] (0–2)
-- p_variants: [{"size":"M","colour":"Red","sku":"TS-M-RED","barcode":"","price":null,"stock":4}]
-- Variants not in the list are archived. The product's stock becomes the sum of
-- the active variants' stock, through one ledger movement for the difference.
CREATE OR REPLACE FUNCTION public.save_product_variants(p_product_id UUID, p_options JSONB, p_variants JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_product public.products;
  v_item JSONB;
  v_size TEXT; v_colour TEXT; v_sku TEXT; v_barcode TEXT; v_price NUMERIC; v_stock NUMERIC;
  v_keep UUID[] := '{}';
  v_id UUID;
  v_total NUMERIC;
  v_count INT := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_product FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF v_product.id IS NULL THEN RAISE EXCEPTION 'Product not found'; END IF;
  IF NOT public.user_has_permission(auth.uid(), v_product.store_id, 'product:update') THEN
    RAISE EXCEPTION 'Permission denied: product:update required';
  END IF;
  IF jsonb_typeof(COALESCE(p_options, '[]'::jsonb)) <> 'array' OR jsonb_array_length(COALESCE(p_options, '[]'::jsonb)) > 2 THEN
    RAISE EXCEPTION 'A product can have up to two options, such as Size and Colour';
  END IF;
  IF jsonb_typeof(COALESCE(p_variants, '[]'::jsonb)) <> 'array' OR jsonb_array_length(COALESCE(p_variants, '[]'::jsonb)) > 200 THEN
    RAISE EXCEPTION 'A product can have up to 200 variants';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_variants, '[]'::jsonb)) LOOP
    v_size := NULLIF(left(trim(COALESCE(v_item->>'size', '')), 40), '');
    v_colour := NULLIF(left(trim(COALESCE(v_item->>'colour', '')), 40), '');
    IF v_size IS NULL AND v_colour IS NULL THEN RAISE EXCEPTION 'Each variant needs a size or colour'; END IF;
    v_sku := NULLIF(left(trim(COALESCE(v_item->>'sku', '')), 64), '');
    v_barcode := NULLIF(left(trim(COALESCE(v_item->>'barcode', '')), 64), '');
    v_price := NULLIF(v_item->>'price', '')::NUMERIC;
    v_stock := COALESCE(NULLIF(v_item->>'stock', '')::NUMERIC, 0);
    IF v_price IS NOT NULL AND v_price < 0 THEN RAISE EXCEPTION 'Price cannot be negative'; END IF;
    IF v_stock < 0 THEN RAISE EXCEPTION 'Stock cannot be negative'; END IF;
    IF v_sku IS NOT NULL AND EXISTS (SELECT 1 FROM public.products WHERE store_id = v_product.store_id AND sku = v_sku AND id <> v_product.id) THEN
      RAISE EXCEPTION 'SKU % is already used by another product', v_sku;
    END IF;
    IF v_barcode IS NOT NULL AND EXISTS (SELECT 1 FROM public.products WHERE store_id = v_product.store_id AND barcode = v_barcode) THEN
      RAISE EXCEPTION 'Barcode % is already used by a product', v_barcode;
    END IF;

    SELECT id INTO v_id FROM public.product_variants
    WHERE product_id = v_product.id AND COALESCE(size, '') = COALESCE(v_size, '') AND COALESCE(colour, '') = COALESCE(v_colour, '');
    IF v_id IS NULL THEN
      INSERT INTO public.product_variants (store_id, product_id, sku, barcode, size, colour, selling_price, stock_qty, status, created_by)
      VALUES (v_product.store_id, v_product.id, v_sku, v_barcode, v_size, v_colour, v_price, v_stock, 'active', auth.uid())
      RETURNING id INTO v_id;
    ELSE
      UPDATE public.product_variants SET sku = v_sku, barcode = v_barcode, selling_price = v_price, stock_qty = v_stock, status = 'active'
      WHERE id = v_id;
    END IF;
    v_keep := v_keep || v_id;
    v_count := v_count + 1;
  END LOOP;

  UPDATE public.product_variants SET status = 'archived', stock_qty = 0
  WHERE product_id = v_product.id AND status <> 'archived' AND NOT (id = ANY (v_keep));

  UPDATE public.products SET variant_options = CASE WHEN v_count = 0 THEN '[]'::jsonb ELSE COALESCE(p_options, '[]'::jsonb) END
  WHERE id = v_product.id;

  -- the product total follows the variants, through the ledger
  IF v_count > 0 AND v_product.track_inventory THEN
    SELECT COALESCE(SUM(stock_qty), 0) INTO v_total FROM public.product_variants WHERE product_id = v_product.id AND status = 'active';
    IF v_total <> v_product.stock_qty THEN
      PERFORM public._apply_inventory_movement_internal(
        v_product.store_id, v_product.id, 'adjustment', v_total - v_product.stock_qty,
        'Stock set by size/colour', 'product_variants', v_product.id, auth.uid());
    END IF;
  END IF;

  RETURN jsonb_build_object('variants', v_count);
END;
$$;
REVOKE ALL ON FUNCTION public.save_product_variants(UUID, JSONB, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_product_variants(UUID, JSONB, JSONB) TO authenticated;

-- ------------------------------------------------------------
-- create_sale: same as 20260614000038, plus an optional item variantId
-- ------------------------------------------------------------
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

    v_line_subtotal := v_quantity * v_price;
    v_tax_amount := ROUND((v_line_subtotal - v_discount) * v_product.tax_rate / 100, 2);
    v_line_total := v_line_subtotal - v_discount + v_tax_amount;

    INSERT INTO public.sale_items (
      sale_id, product_id, product_name, sku, quantity, unit_price, tax_rate, tax_amount, discount_amount, line_total, variant_id
    ) VALUES (
      v_sale_id, v_product.id, v_name, v_sku, v_quantity, v_price, v_product.tax_rate,
      v_tax_amount, v_discount, v_line_total, v_variant.id
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

-- ------------------------------------------------------------
-- Voids and refunds give the variant back what the product gets back
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.variant_stock_on_void()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- void_sale returns each tracked line's full quantity to the product
  UPDATE public.product_variants v SET stock_qty = v.stock_qty + si.quantity
  FROM public.sale_items si JOIN public.products p ON p.id = si.product_id
  WHERE si.sale_id = NEW.id AND si.variant_id = v.id AND p.track_inventory;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS variant_stock_on_void ON public.sales;
CREATE TRIGGER variant_stock_on_void AFTER UPDATE OF status ON public.sales
  FOR EACH ROW WHEN (OLD.status = 'completed' AND NEW.status = 'voided')
  EXECUTE FUNCTION public.variant_stock_on_void();

CREATE OR REPLACE FUNCTION public.variant_stock_on_refund()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- process_refund returns refunded quantities of tracked products
  IF EXISTS (SELECT 1 FROM public.products WHERE id = NEW.product_id AND track_inventory) THEN
    UPDATE public.product_variants SET stock_qty = stock_qty + (NEW.refunded_quantity - OLD.refunded_quantity) WHERE id = NEW.variant_id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS variant_stock_on_refund ON public.sale_items;
CREATE TRIGGER variant_stock_on_refund AFTER UPDATE OF refunded_quantity ON public.sale_items
  FOR EACH ROW WHEN (NEW.variant_id IS NOT NULL AND NEW.refunded_quantity > OLD.refunded_quantity)
  EXECUTE FUNCTION public.variant_stock_on_refund();

REVOKE ALL ON FUNCTION public.variant_stock_on_void() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.variant_stock_on_refund() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- Barcode for labels: products without one get theirs from the SKU
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_product_barcodes(p_product_ids UUID[])
RETURNS TABLE (id UUID, barcode TEXT) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD; v_code TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  FOR r IN SELECT p.* FROM public.products p WHERE p.id = ANY (p_product_ids) FOR UPDATE LOOP
    IF NOT public.user_has_permission(auth.uid(), r.store_id, 'product:update') THEN
      RAISE EXCEPTION 'Permission denied: product:update required';
    END IF;
    v_code := NULLIF(trim(r.barcode), '');
    IF v_code IS NULL THEN
      -- Code 128 prints any plain ASCII; keep the SKU when it fits, else a store-unique number
      v_code := CASE WHEN r.sku ~ '^[ -~]{1,40}$' THEN r.sku ELSE '2' || lpad((abs(hashtext(r.id::text)) % 100000000000)::text, 11, '0') END;
      IF EXISTS (SELECT 1 FROM public.products x WHERE x.store_id = r.store_id AND x.barcode = v_code AND x.id <> r.id)
         OR EXISTS (SELECT 1 FROM public.product_variants x WHERE x.store_id = r.store_id AND x.barcode = v_code) THEN
        v_code := '2' || lpad((abs(hashtext(r.id::text)) % 100000000000)::text, 11, '0');
      END IF;
      UPDATE public.products SET barcode = v_code WHERE products.id = r.id;
    END IF;
    id := r.id; barcode := v_code;
    RETURN NEXT;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.ensure_product_barcodes(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_product_barcodes(UUID[]) TO authenticated;

-- ------------------------------------------------------------
-- Credit reminders: who owes, and a log line when someone is reminded
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_credit_reminder(p_customer_id UUID, p_channel TEXT DEFAULT 'whatsapp')
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.customers; v_org UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO c FROM public.customers WHERE id = p_customer_id;
  IF c.id IS NULL OR NOT (c.store_id IN (SELECT public.get_user_active_store_ids(auth.uid()))) THEN
    RAISE EXCEPTION 'Customer not found';
  END IF;
  SELECT org_id INTO v_org FROM public.stores WHERE id = c.store_id;
  INSERT INTO public.audit_logs (actor_id, org_id, store_id, action, resource_type, resource_id, resource_name, details)
  VALUES (auth.uid(), v_org, c.store_id, 'CREDIT_REMINDER_SENT', 'customer', c.id, c.name,
          jsonb_build_object('channel', left(COALESCE(p_channel, 'whatsapp'), 20), 'balance', c.balance));
END;
$$;
REVOKE ALL ON FUNCTION public.log_credit_reminder(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_credit_reminder(UUID, TEXT) TO authenticated;
