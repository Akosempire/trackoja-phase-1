-- Server-owned POS lifecycle. Authenticated users can prepare their own
-- pending checkout; only service_role may claim sends or settle provider data.

CREATE OR REPLACE FUNCTION public.create_pending_pos_sale(
  p_store_id UUID,
  p_items JSONB,
  p_checkout_key UUID,
  p_customer_id UUID DEFAULT NULL,
  p_discount_total NUMERIC DEFAULT 0,
  p_order_type TEXT DEFAULT 'standard',
  p_table_number TEXT DEFAULT NULL
)
RETURNS public.sales LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_store public.stores;
  v_sale public.sales;
  v_settings public.store_settings;
  v_customer public.customers;
  v_item JSONB;
  v_product public.products;
  v_number BIGINT;
  v_qty NUMERIC;
  v_line_discount NUMERIC;
  v_line_subtotal NUMERIC;
  v_tax NUMERIC;
  v_subtotal NUMERIC := 0;
  v_item_discounts NUMERIC := 0;
  v_tax_total NUMERIC := 0;
  v_total NUMERIC;
BEGIN
  IF auth.uid() IS NULL OR NOT public.user_has_permission(auth.uid(), p_store_id, 'sales:create') THEN
    RAISE EXCEPTION 'Permission denied: sales:create required';
  END IF;
  IF p_checkout_key IS NULL THEN RAISE EXCEPTION 'Checkout key is required'; END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'A checkout needs 1 to 100 items';
  END IF;
  IF (SELECT COUNT(DISTINCT item->>'productId') FROM jsonb_array_elements(p_items) AS item)
     <> jsonb_array_length(p_items) THEN
    RAISE EXCEPTION 'A checkout cannot repeat the same product';
  END IF;
  IF p_discount_total IS NULL OR p_discount_total < 0 THEN
    RAISE EXCEPTION 'Discount cannot be negative';
  END IF;
  IF p_order_type IS NULL OR p_order_type NOT IN ('standard', 'dine_in', 'takeaway', 'delivery') THEN
    RAISE EXCEPTION 'Invalid order type';
  END IF;

  -- Serialize same-store preparation so two tabs with the same checkout key
  -- cannot both create a sale. This lock also protects the sale number counter.
  SELECT * INTO v_store FROM public.stores WHERE id = p_store_id FOR UPDATE;
  IF v_store.id IS NULL OR v_store.status <> 'active' OR v_store.currency <> 'NGN' THEN
    RAISE EXCEPTION 'This business cannot accept NGN POS payments';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_products op
    JOIN public.platform_products pp ON pp.id = op.product_id
    WHERE op.org_id = v_store.org_id AND pp.key = 'trackoja'
      AND op.status = 'active' AND (op.expires_at IS NULL OR op.expires_at > now())
  ) THEN
    RAISE EXCEPTION 'An active TrackOja subscription is required for POS checkout';
  END IF;
  SELECT * INTO v_sale FROM public.sales
  WHERE store_id = p_store_id AND checkout_key = p_checkout_key FOR UPDATE;
  IF v_sale.id IS NOT NULL THEN
    IF v_sale.created_by <> auth.uid() THEN RAISE EXCEPTION 'Checkout key belongs to another user'; END IF;
    IF v_sale.status <> 'pending_payment'
       OR v_sale.customer_id IS DISTINCT FROM p_customer_id
       OR v_sale.order_type IS DISTINCT FROM p_order_type
       OR v_sale.table_number IS DISTINCT FROM
         (CASE WHEN p_order_type = 'dine_in' THEN left(NULLIF(trim(p_table_number), ''), 80) ELSE NULL END)
       OR v_sale.discount_total IS DISTINCT FROM
         (p_discount_total + COALESCE((SELECT SUM(COALESCE((item->>'discountAmount')::NUMERIC, 0))
                                       FROM jsonb_array_elements(p_items) AS item), 0))
       OR (SELECT COUNT(*) FROM public.sale_items WHERE sale_id = v_sale.id) <> jsonb_array_length(p_items)
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_items) AS item
         WHERE NOT EXISTS (
           SELECT 1 FROM public.sale_items si WHERE si.sale_id = v_sale.id
             AND si.product_id = (item->>'productId')::UUID
             AND si.quantity = (item->>'quantity')::NUMERIC
             AND si.discount_amount = COALESCE((item->>'discountAmount')::NUMERIC, 0)
         )
       ) THEN
      RAISE EXCEPTION 'Checkout key belongs to a different pending basket';
    END IF;
    RETURN v_sale;
  END IF;

  SELECT * INTO v_settings FROM public.store_settings WHERE store_id = p_store_id;
  IF COALESCE(v_settings.require_customer_for_sale, FALSE) AND p_customer_id IS NULL THEN
    RAISE EXCEPTION 'A customer is required for this sale';
  END IF;
  IF p_customer_id IS NOT NULL THEN
    SELECT * INTO v_customer FROM public.customers
    WHERE id = p_customer_id AND store_id = p_store_id AND is_active FOR UPDATE;
    IF v_customer.id IS NULL THEN RAISE EXCEPTION 'Customer not found in this store'; END IF;
  END IF;

  INSERT INTO public.store_sale_counters(store_id, last_number) VALUES (p_store_id, 1)
  ON CONFLICT (store_id) DO UPDATE SET last_number = public.store_sale_counters.last_number + 1
  RETURNING last_number INTO v_number;
  INSERT INTO public.sales
    (store_id, sale_number, status, checkout_key, customer_id,
     customer_name, customer_phone, order_type, table_number, created_by)
  VALUES
    (p_store_id, v_number::TEXT, 'pending_payment', p_checkout_key, p_customer_id,
     v_customer.name, v_customer.phone, p_order_type,
     CASE WHEN p_order_type = 'dine_in' THEN left(NULLIF(trim(p_table_number), ''), 80) ELSE NULL END,
     auth.uid())
  RETURNING * INTO v_sale;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    IF (v_item->>'productId') IS NULL OR (v_item->>'quantity') IS NULL THEN
      RAISE EXCEPTION 'Each item needs a product and quantity';
    END IF;
    v_qty := (v_item->>'quantity')::NUMERIC;
    v_line_discount := COALESCE((v_item->>'discountAmount')::NUMERIC, 0);
    IF v_qty <= 0 OR v_line_discount < 0 THEN RAISE EXCEPTION 'Invalid item quantity or discount'; END IF;
    SELECT * INTO v_product FROM public.products
    WHERE id = (v_item->>'productId')::UUID AND store_id = p_store_id AND status = 'active' FOR UPDATE;
    IF v_product.id IS NULL THEN RAISE EXCEPTION 'An item is unavailable in this store'; END IF;
    IF v_product.track_inventory AND v_product.stock_qty < v_qty
       AND NOT COALESCE(v_settings.allow_negative_stock, FALSE) THEN
      RAISE EXCEPTION 'Insufficient stock for %', v_product.name;
    END IF;
    v_line_subtotal := ROUND(v_qty * v_product.selling_price, 2);
    IF v_line_discount > v_line_subtotal THEN RAISE EXCEPTION 'Item discount exceeds its price'; END IF;
    v_tax := ROUND((v_line_subtotal - v_line_discount) * v_product.tax_rate / 100, 2);
    INSERT INTO public.sale_items
      (sale_id, product_id, product_name, sku, quantity, unit_price,
       tax_rate, tax_amount, discount_amount, line_total)
    VALUES
      (v_sale.id, v_product.id, v_product.name, v_product.sku, v_qty,
       v_product.selling_price, v_product.tax_rate, v_tax, v_line_discount,
       v_line_subtotal - v_line_discount + v_tax);
    v_subtotal := v_subtotal + v_line_subtotal;
    v_item_discounts := v_item_discounts + v_line_discount;
    v_tax_total := v_tax_total + v_tax;
  END LOOP;

  IF p_discount_total > v_subtotal - v_item_discounts THEN
    RAISE EXCEPTION 'Discount exceeds the sale subtotal';
  END IF;
  v_total := ROUND(v_subtotal - v_item_discounts - p_discount_total + v_tax_total, 2);
  IF v_total <= 0 THEN RAISE EXCEPTION 'Sale total must be greater than zero'; END IF;
  UPDATE public.sales SET subtotal = v_subtotal, discount_total = p_discount_total + v_item_discounts,
    tax_total = v_tax_total, total = v_total
  WHERE id = v_sale.id RETURNING * INTO v_sale;
  RETURN v_sale;
END;
$$;
REVOKE ALL ON FUNCTION public.create_pending_pos_sale(UUID, JSONB, UUID, UUID, NUMERIC, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_pending_pos_sale(UUID, JSONB, UUID, UUID, NUMERIC, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_pos_payment_attempt(
  p_sale_id UUID,
  p_terminal_id UUID,
  p_request_key UUID,
  p_payment_method TEXT DEFAULT 'any',
  p_environment TEXT DEFAULT 'live'
)
RETURNS public.merchant_payment_attempts LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sale public.sales;
  v_terminal public.devices;
  v_store public.stores;
  v_org public.organizations;
  v_connection public.merchant_provider_connections;
  v_attempt public.merchant_payment_attempts;
BEGIN
  IF auth.uid() IS NULL OR p_request_key IS NULL THEN RAISE EXCEPTION 'Authentication and request key required'; END IF;
  IF p_payment_method NOT IN ('card', 'transfer', 'any') THEN RAISE EXCEPTION 'Invalid POS payment method'; END IF;
  IF p_environment NOT IN ('sandbox', 'live') THEN RAISE EXCEPTION 'Invalid payment environment'; END IF;
  SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id FOR UPDATE;
  IF v_sale.id IS NULL OR NOT public.user_has_permission(auth.uid(), v_sale.store_id, 'sales:create') THEN
    RAISE EXCEPTION 'Sale not found or permission denied';
  END IF;
  IF v_sale.created_by <> auth.uid()
     AND NOT public.user_has_permission(auth.uid(), v_sale.store_id, 'sales:refund') THEN
    RAISE EXCEPTION 'This pending sale belongs to another cashier';
  END IF;
  IF v_sale.status <> 'pending_payment' OR v_sale.total <= 0 THEN
    RAISE EXCEPTION 'Sale is not awaiting a POS payment';
  END IF;
  SELECT * INTO v_attempt FROM public.merchant_payment_attempts
  WHERE sale_id = p_sale_id AND status IN ('created', 'sending', 'pending', 'unresolved', 'reconciliation_required')
  FOR UPDATE;
  IF v_attempt.id IS NOT NULL THEN RETURN v_attempt; END IF;

  SELECT * INTO v_store FROM public.stores WHERE id = v_sale.store_id;
  SELECT * INTO v_org FROM public.organizations WHERE id = v_store.org_id;
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_products op
    JOIN public.platform_products pp ON pp.id = op.product_id
    WHERE op.org_id = v_store.org_id AND pp.key = 'trackoja'
      AND op.status = 'active' AND (op.expires_at IS NULL OR op.expires_at > now())
  ) THEN
    RAISE EXCEPTION 'An active TrackOja subscription is required for POS checkout';
  END IF;
  IF (p_environment = 'sandbox') IS DISTINCT FROM v_org.is_sandbox THEN
    RAISE EXCEPTION 'Sandbox payments are restricted to sandbox businesses';
  END IF;
  SELECT * INTO v_terminal FROM public.devices WHERE id = p_terminal_id;
  IF v_terminal.id IS NULL OR v_terminal.store_id <> v_sale.store_id
     OR v_terminal.type <> 'payment_terminal' OR v_terminal.provider <> 'moniepoint'
     OR v_terminal.status <> 'active' OR v_terminal.serial_number IS NULL THEN
    RAISE EXCEPTION 'Choose an active Moniepoint terminal in this branch';
  END IF;
  SELECT * INTO v_connection FROM public.merchant_provider_connections
  WHERE org_id = v_store.org_id AND provider = 'moniepoint'
    AND environment = p_environment AND status IN ('configured', 'connected');
  IF v_connection.id IS NULL OR v_connection.erp_enabled_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'Moniepoint POS needs a configured connection and ERP integration';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.merchant_payment_providers
                 WHERE key = 'moniepoint' AND active AND supports_push AND supports_status) THEN
    RAISE EXCEPTION 'Moniepoint POS is not available on this platform';
  END IF;
  SELECT * INTO v_attempt FROM public.merchant_payment_attempts
  WHERE org_id = v_store.org_id AND request_key = p_request_key;
  IF v_attempt.id IS NOT NULL THEN
    IF v_attempt.sale_id <> p_sale_id THEN RAISE EXCEPTION 'Request key belongs to another sale'; END IF;
    RETURN v_attempt;
  END IF;

  INSERT INTO public.merchant_payment_attempts
    (org_id, store_id, sale_id, terminal_id, terminal_serial, register_id, provider, payment_method,
     expected_amount, currency, merchant_reference, request_key, environment, initiated_by)
  VALUES
    (v_store.org_id, v_sale.store_id, v_sale.id, v_terminal.id, v_terminal.serial_number, v_terminal.register_id,
     'moniepoint', p_payment_method, v_sale.total, 'NGN',
     'TRKOJA-' || replace(v_sale.id::TEXT, '-', '') || '-' || upper(substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 12)),
     p_request_key, p_environment, auth.uid())
  RETURNING * INTO v_attempt;
  RETURN v_attempt;
END;
$$;
REVOKE ALL ON FUNCTION public.create_pos_payment_attempt(UUID, UUID, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_pos_payment_attempt(UUID, UUID, UUID, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_pos_payment_send(p_attempt_id UUID, p_provider_amount BIGINT)
RETURNS public.merchant_payment_attempts LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_attempt public.merchant_payment_attempts;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
  IF p_provider_amount IS NULL OR p_provider_amount <= 0 THEN RAISE EXCEPTION 'Invalid provider amount'; END IF;
  UPDATE public.merchant_payment_attempts
  SET status = 'sending', provider_amount = p_provider_amount
  WHERE id = p_attempt_id AND status = 'created'
  RETURNING * INTO v_attempt;
  RETURN v_attempt;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_pos_payment_send(UUID, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_pos_payment_send(UUID, BIGINT) TO service_role;

CREATE OR REPLACE FUNCTION public.record_pos_send_result(
  p_attempt_id UUID, p_status TEXT, p_failure_code TEXT DEFAULT NULL
)
RETURNS public.merchant_payment_attempts LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_attempt public.merchant_payment_attempts;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
  IF p_status NOT IN ('pending', 'unresolved', 'failed') THEN RAISE EXCEPTION 'Invalid send result'; END IF;
  UPDATE public.merchant_payment_attempts
  SET status = p_status, sent_at = CASE WHEN p_status = 'pending' THEN now() ELSE sent_at END,
      failure_code = left(p_failure_code, 80)
  WHERE id = p_attempt_id AND status = 'sending'
  RETURNING * INTO v_attempt;
  RETURN v_attempt;
END;
$$;
REVOKE ALL ON FUNCTION public.record_pos_send_result(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_pos_send_result(UUID, TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_pos_status_check(p_attempt_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
  UPDATE public.merchant_payment_attempts SET last_checked_at = now()
  WHERE id = p_attempt_id AND status <> 'successful'
    AND (last_checked_at IS NULL OR last_checked_at < now() - INTERVAL '5 seconds')
  RETURNING id INTO v_id;
  RETURN v_id IS NOT NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_pos_status_check(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_pos_status_check(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.record_pos_status_unavailable(p_attempt_id UUID)
RETURNS public.merchant_payment_attempts LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_attempt public.merchant_payment_attempts;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
  UPDATE public.merchant_payment_attempts
  SET status = 'unresolved', failure_code = 'STATUS_UNAVAILABLE'
  WHERE id = p_attempt_id AND status IN ('sending', 'pending', 'unresolved')
  RETURNING * INTO v_attempt;
  IF v_attempt.id IS NULL THEN
    SELECT * INTO v_attempt FROM public.merchant_payment_attempts WHERE id = p_attempt_id;
  END IF;
  RETURN v_attempt;
END;
$$;
REVOKE ALL ON FUNCTION public.record_pos_status_unavailable(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_pos_status_unavailable(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.record_pos_reconciliation_error(p_attempt_id UUID)
RETURNS public.merchant_payment_attempts LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_attempt public.merchant_payment_attempts;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
  UPDATE public.merchant_payment_attempts
  SET status = 'reconciliation_required', failure_code = 'SETTLEMENT_RPC_FAILED'
  WHERE id = p_attempt_id AND status <> 'successful'
  RETURNING * INTO v_attempt;
  IF v_attempt.id IS NULL THEN
    SELECT * INTO v_attempt FROM public.merchant_payment_attempts WHERE id = p_attempt_id;
  END IF;
  RETURN v_attempt;
END;
$$;
REVOKE ALL ON FUNCTION public.record_pos_reconciliation_error(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_pos_reconciliation_error(UUID) TO service_role;

-- This is the sole path from provider evidence to a completed TrackOja sale.
-- It locks the attempt and sale, validates all immutable identifiers and the
-- provider amount, then posts payment, inventory, loyalty, journal and receipt
-- state in one database transaction. A failed stock/lot posting is recorded as
-- reconciliation_required rather than reporting an unpaid customer.
CREATE OR REPLACE FUNCTION public.settle_pos_payment_attempt(
  p_attempt_id UUID,
  p_merchant_reference TEXT,
  p_terminal_serial TEXT,
  p_request_amount BIGINT,
  p_actual_amount BIGINT,
  p_processing_status TEXT,
  p_response_code TEXT,
  p_provider_reference TEXT,
  p_actual_payment_method TEXT,
  p_approved BOOLEAN DEFAULT NULL
)
RETURNS public.merchant_payment_attempts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_attempt public.merchant_payment_attempts;
  v_sale public.sales;
  v_terminal public.devices;
  v_item RECORD;
  v_settings public.store_settings;
  v_customer public.customers;
  v_payment_id UUID;
  v_method TEXT;
  v_points INTEGER := 0;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
  SELECT * INTO v_attempt FROM public.merchant_payment_attempts
  WHERE id = p_attempt_id FOR UPDATE;
  IF v_attempt.id IS NULL THEN RAISE EXCEPTION 'Payment attempt not found'; END IF;
  IF v_attempt.status = 'successful' THEN RETURN v_attempt; END IF;
  SELECT * INTO v_sale FROM public.sales WHERE id = v_attempt.sale_id FOR UPDATE;
  SELECT * INTO v_terminal FROM public.devices WHERE id = v_attempt.terminal_id;

  UPDATE public.merchant_payment_attempts SET
    last_checked_at = now(),
    provider_processing_status = left(p_processing_status, 80),
    provider_response_code = left(p_response_code, 80),
    provider_reference = CASE
      WHEN p_processing_status = 'PROCESSED' AND NULLIF(p_provider_reference, '') IS NOT NULL
      THEN left(p_provider_reference, 160) ELSE provider_reference END,
    actual_amount = CASE
      WHEN p_processing_status = 'PROCESSED' AND p_actual_amount > 0
        AND v_attempt.provider_amount > 0
      THEN ROUND(p_actual_amount * v_attempt.expected_amount / v_attempt.provider_amount, 2)
      ELSE actual_amount END
  WHERE id = v_attempt.id;

  IF p_merchant_reference IS DISTINCT FROM v_attempt.merchant_reference
     OR p_terminal_serial IS DISTINCT FROM v_attempt.terminal_serial
     OR p_request_amount IS DISTINCT FROM v_attempt.provider_amount THEN
    UPDATE public.merchant_payment_attempts
    SET status = 'reconciliation_required', failure_code = 'PROVIDER_IDENTITY_MISMATCH'
    WHERE id = v_attempt.id RETURNING * INTO v_attempt;
    RETURN v_attempt;
  END IF;

  IF p_processing_status = 'PENDING' THEN
    IF v_attempt.status IN ('created', 'sending', 'pending', 'unresolved') THEN
      UPDATE public.merchant_payment_attempts SET status = 'pending', failure_code = NULL
      WHERE id = v_attempt.id RETURNING * INTO v_attempt;
    END IF;
    RETURN v_attempt;
  END IF;
  IF p_processing_status = 'CANCELLED' THEN
    UPDATE public.merchant_payment_attempts
    SET status = CASE WHEN p_actual_amount > 0 THEN 'reconciliation_required' ELSE 'cancelled' END,
        completed_at = CASE WHEN p_actual_amount > 0 THEN NULL ELSE now() END,
        failure_code = CASE WHEN p_actual_amount > 0 THEN 'CANCELLED_WITH_AMOUNT' ELSE 'PROVIDER_CANCELLED' END
    WHERE id = v_attempt.id RETURNING * INTO v_attempt;
    RETURN v_attempt;
  END IF;
  IF p_processing_status IS DISTINCT FROM 'PROCESSED' OR p_approved IS NULL THEN
    UPDATE public.merchant_payment_attempts
    SET status = 'unresolved', failure_code = 'STATUS_NOT_DECISIVE'
    WHERE id = v_attempt.id RETURNING * INTO v_attempt;
    RETURN v_attempt;
  END IF;
  IF NOT p_approved THEN
    UPDATE public.merchant_payment_attempts
    SET status = 'failed', completed_at = now(), failure_code = 'PROVIDER_DECLINED'
    WHERE id = v_attempt.id RETURNING * INTO v_attempt;
    RETURN v_attempt;
  END IF;

  IF p_actual_amount IS DISTINCT FROM v_attempt.provider_amount
     OR NULLIF(p_provider_reference, '') IS NULL THEN
    UPDATE public.merchant_payment_attempts
    SET status = 'reconciliation_required', failure_code = 'AMOUNT_OR_REFERENCE_MISMATCH'
    WHERE id = v_attempt.id RETURNING * INTO v_attempt;
    RETURN v_attempt;
  END IF;
  IF v_sale.status <> 'pending_payment'
     OR EXISTS (SELECT 1 FROM public.merchant_payment_attempts other
                WHERE other.sale_id = v_sale.id AND other.id <> v_attempt.id
                  AND other.status IN ('sending', 'pending', 'unresolved', 'successful', 'reconciliation_required')) THEN
    UPDATE public.merchant_payment_attempts
    SET status = 'reconciliation_required', failure_code = 'SALE_HAS_ANOTHER_PAYMENT'
    WHERE id = v_attempt.id RETURNING * INTO v_attempt;
    RETURN v_attempt;
  END IF;

  v_method := CASE p_actual_payment_method
    WHEN 'CARD_PURCHASE' THEN 'card'
    WHEN 'POS_TRANSFER' THEN 'transfer'
    ELSE NULL END;
  IF v_method IS NULL THEN
    UPDATE public.merchant_payment_attempts
    SET status = 'reconciliation_required', failure_code = 'UNKNOWN_PAYMENT_METHOD'
    WHERE id = v_attempt.id RETURNING * INTO v_attempt;
    RETURN v_attempt;
  END IF;

  BEGIN
    IF EXISTS (
      SELECT 1 FROM public.sale_items si
      LEFT JOIN public.products p ON p.id = si.product_id AND p.store_id = v_sale.store_id
      WHERE si.sale_id = v_sale.id AND p.id IS NULL
    ) THEN
      RAISE EXCEPTION 'A sale item no longer has a matching product';
    END IF;
    FOR v_item IN
      SELECT si.product_id, si.quantity, p.track_inventory
      FROM public.sale_items si JOIN public.products p ON p.id = si.product_id
      WHERE si.sale_id = v_sale.id ORDER BY si.id
    LOOP
      IF v_item.track_inventory THEN
        PERFORM public._apply_inventory_movement_internal(
          v_sale.store_id, v_item.product_id, 'sale', -v_item.quantity,
          NULL, 'sale', v_sale.id, v_sale.created_by);
      END IF;
    END LOOP;
    PERFORM public.allocate_lots_for_sale(v_sale.id, TRUE);

    INSERT INTO public.sale_payments
      (sale_id, method, amount, reference, verification_status,
       verified_by, verified_at, provider, merchant_attempt_id)
    VALUES
      (v_sale.id, v_method, v_attempt.expected_amount, p_provider_reference,
       'verified', NULL, now(), 'moniepoint', v_attempt.id)
    RETURNING id INTO v_payment_id;

    SELECT * INTO v_settings FROM public.store_settings WHERE store_id = v_sale.store_id;
    IF v_sale.customer_id IS NOT NULL AND COALESCE(v_settings.loyalty_enabled, FALSE)
       AND COALESCE(v_settings.loyalty_earn_rate, 0) > 0 THEN
      SELECT * INTO v_customer FROM public.customers WHERE id = v_sale.customer_id FOR UPDATE;
      v_points := FLOOR(v_sale.total * v_settings.loyalty_earn_rate)::INTEGER;
      IF v_points > 0 THEN
        UPDATE public.customers SET loyalty_points = loyalty_points + v_points
        WHERE id = v_customer.id;
        INSERT INTO public.customer_loyalty_transactions
          (store_id, customer_id, type, points, points_before, points_after,
           source_type, source_id, created_by)
        VALUES
          (v_sale.store_id, v_customer.id, 'earn', v_points,
           v_customer.loyalty_points, v_customer.loyalty_points + v_points,
           'sale', v_sale.id, v_sale.created_by);
      END IF;
    END IF;

    UPDATE public.sales SET status = 'completed', amount_paid = total,
      change_due = 0, loyalty_points_earned = v_points,
      order_status = CASE WHEN order_type <> 'standard' THEN 'new' ELSE order_status END
    WHERE id = v_sale.id;
    IF v_attempt.expected_amount > v_sale.tax_total THEN
      INSERT INTO public.merchant_journal_entries
        (org_id, store_id, sale_id, attempt_id, debit_account,
         credit_account, amount, currency)
      VALUES
        (v_attempt.org_id, v_attempt.store_id, v_sale.id, v_attempt.id,
         CASE v_method WHEN 'card' THEN 'card_clearing' ELSE 'transfer_clearing' END,
         'sales_revenue', v_attempt.expected_amount - v_sale.tax_total, 'NGN');
    END IF;
    IF v_sale.tax_total > 0 THEN
      INSERT INTO public.merchant_journal_entries
        (org_id, store_id, sale_id, attempt_id, debit_account,
         credit_account, amount, currency)
      VALUES
        (v_attempt.org_id, v_attempt.store_id, v_sale.id, v_attempt.id,
         CASE v_method WHEN 'card' THEN 'card_clearing' ELSE 'transfer_clearing' END,
         'tax_payable', v_sale.tax_total, 'NGN');
    END IF;
    UPDATE public.merchant_payment_attempts
    SET status = 'successful', actual_amount = expected_amount,
        actual_payment_method = v_method,
        provider_reference = left(p_provider_reference, 160),
        sale_payment_id = v_payment_id, completed_at = now(), failure_code = NULL
    WHERE id = v_attempt.id RETURNING * INTO v_attempt;
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.merchant_payment_attempts
    SET status = 'reconciliation_required', failure_code = 'FINALIZATION_FAILED'
    WHERE id = v_attempt.id RETURNING * INTO v_attempt;
    -- The provider may already have taken the customer's money. Keep the
    -- failure for an authorised reviewer, without leaking SQL internals to UI.
    INSERT INTO public.audit_logs
      (actor_id, org_id, store_id, action, resource_type, resource_id, details)
    VALUES
      (NULL, v_attempt.org_id, v_attempt.store_id, 'PAYMENT_RECONCILIATION_REQUIRED',
       'merchant_payment_attempt', v_attempt.id,
       jsonb_build_object('code', 'FINALIZATION_FAILED', 'sale_id', v_sale.id));
  END;
  RETURN v_attempt;
END;
$$;
REVOKE ALL ON FUNCTION public.settle_pos_payment_attempt(UUID, TEXT, TEXT, BIGINT, BIGINT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.settle_pos_payment_attempt(UUID, TEXT, TEXT, BIGINT, BIGINT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO service_role;

CREATE OR REPLACE FUNCTION public.set_default_moniepoint_terminal(p_terminal_id UUID)
RETURNS public.devices LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_terminal public.devices;
BEGIN
  SELECT * INTO v_terminal FROM public.devices WHERE id = p_terminal_id FOR UPDATE;
  IF v_terminal.id IS NULL OR v_terminal.type <> 'payment_terminal'
     OR v_terminal.provider <> 'moniepoint' OR v_terminal.status <> 'active' THEN
    RAISE EXCEPTION 'Choose an active Moniepoint terminal';
  END IF;
  IF auth.uid() IS NULL OR NOT public.user_has_permission(auth.uid(), v_terminal.store_id, 'devices:manage') THEN
    RAISE EXCEPTION 'Permission denied: devices:manage required';
  END IF;
  PERFORM 1 FROM public.stores WHERE id = v_terminal.store_id FOR UPDATE;
  UPDATE public.devices SET is_default_payment_terminal = FALSE
    WHERE store_id = v_terminal.store_id AND type = 'payment_terminal'
      AND provider = 'moniepoint' AND is_default_payment_terminal;
  UPDATE public.devices SET is_default_payment_terminal = TRUE
    WHERE id = p_terminal_id RETURNING * INTO v_terminal;
  RETURN v_terminal;
END;
$$;
REVOKE ALL ON FUNCTION public.set_default_moniepoint_terminal(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_default_moniepoint_terminal(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.sale_cashier_name(p_sale_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_sale public.sales; v_name TEXT;
BEGIN
  SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id;
  IF v_sale.id IS NULL OR auth.uid() IS NULL
     OR NOT public.user_has_permission(auth.uid(), v_sale.store_id, 'sales:view') THEN
    RAISE EXCEPTION 'Sale not found or permission denied';
  END IF;
  SELECT NULLIF(trim(concat_ws(' ', first_name, last_name)), '')
  INTO v_name FROM public.users WHERE id = v_sale.created_by;
  RETURN COALESCE(v_name, 'Staff member');
END;
$$;
REVOKE ALL ON FUNCTION public.sale_cashier_name(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sale_cashier_name(UUID) TO authenticated;
