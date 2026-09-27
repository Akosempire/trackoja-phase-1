-- Migration: 087_material_quote_functions.sql
-- Description: Quote, order and fulfilment operations for building materials.
--   Fulfilment is the important one: a delivery can be partial and can happen over
--   several trips, so it records what actually went out per line, advances the
--   commercial status only when every line is complete, and consumes stock.
-- Author: TrackOja Team
-- Date: 2026-09-26

-- ============================================================
-- CREATE A QUOTE
-- ============================================================
-- p_items: jsonb array of { productId?, description, quantity, unitPrice, unit? }

CREATE OR REPLACE FUNCTION public.create_material_quote(
  p_store_id UUID,
  p_items JSONB,
  p_customer_id UUID DEFAULT NULL,
  p_customer_name TEXT DEFAULT NULL,
  p_customer_phone TEXT DEFAULT NULL,
  p_delivery_location TEXT DEFAULT NULL,
  p_delivery_charge NUMERIC DEFAULT 0,
  p_valid_until DATE DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS public.material_quotes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_number INTEGER;
  v_quote public.material_quotes;
  v_item JSONB;
  v_qty NUMERIC;
  v_price NUMERIC;
  v_product UUID;
  v_total NUMERIC := 0;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT public.user_has_permission(v_actor, p_store_id, 'quote:create') THEN
    RAISE EXCEPTION 'Permission denied: quote:create required';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'A quote needs at least one item';
  END IF;
  IF COALESCE(p_delivery_charge, 0) < 0 THEN
    RAISE EXCEPTION 'A delivery charge cannot be negative';
  END IF;
  IF p_valid_until IS NOT NULL AND p_valid_until < current_date THEN
    RAISE EXCEPTION 'A quote cannot already have expired';
  END IF;

  -- Validate and total before writing, so a bad line leaves no half-made quote.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product := NULLIF(trim(COALESCE(v_item ->> 'productId', '')), '')::UUID;
    v_qty := (v_item ->> 'quantity')::NUMERIC;
    v_price := COALESCE((v_item ->> 'unitPrice')::NUMERIC, 0);

    IF length(trim(COALESCE(v_item ->> 'description', ''))) = 0 THEN
      RAISE EXCEPTION 'Every quote line needs a description';
    END IF;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Every quote line needs a quantity greater than zero';
    END IF;
    IF v_price < 0 THEN
      RAISE EXCEPTION 'A unit price cannot be negative';
    END IF;
    IF v_product IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.products pr WHERE pr.id = v_product AND pr.store_id = p_store_id
    ) THEN
      RAISE EXCEPTION 'Product % is not in this store', v_product;
    END IF;

    v_total := v_total + round(v_qty * v_price, 2);
  END LOOP;

  INSERT INTO public.material_quote_counters (store_id, next_number)
  VALUES (p_store_id, 2)
  ON CONFLICT (store_id) DO UPDATE SET next_number = public.material_quote_counters.next_number + 1
  RETURNING next_number - 1 INTO v_number;

  INSERT INTO public.material_quotes (
    store_id, quote_number, customer_id, customer_name, customer_phone,
    delivery_location, delivery_charge, valid_until, notes, created_by
  ) VALUES (
    p_store_id, v_number, p_customer_id, p_customer_name, p_customer_phone,
    p_delivery_location, round(COALESCE(p_delivery_charge, 0), 2), p_valid_until, p_notes, v_actor
  )
  RETURNING * INTO v_quote;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product := NULLIF(trim(COALESCE(v_item ->> 'productId', '')), '')::UUID;
    v_qty := (v_item ->> 'quantity')::NUMERIC;
    v_price := COALESCE((v_item ->> 'unitPrice')::NUMERIC, 0);

    INSERT INTO public.material_quote_items (
      quote_id, product_id, description, unit_of_measure, quantity, unit_price, line_total
    ) VALUES (
      v_quote.id, v_product, trim(v_item ->> 'description'),
      COALESCE(NULLIF(trim(COALESCE(v_item ->> 'unit', '')), ''), 'unit'),
      v_qty, round(v_price, 2), round(v_qty * v_price, 2)
    );
  END LOOP;

  INSERT INTO public.audit_logs (actor_id, store_id, action, resource_type, resource_id, status, details)
  VALUES (v_actor, p_store_id, 'MATERIAL_QUOTE_CREATED', 'material_quote', v_quote.id, 'success',
          jsonb_build_object('quote_number', v_number, 'items', jsonb_array_length(p_items), 'total', v_total));

  RETURN v_quote;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_material_quote(UUID, JSONB, UUID, TEXT, TEXT, TEXT, NUMERIC, DATE, TEXT) TO authenticated;

-- ============================================================
-- CHANGE STATUS
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_quote_status(
  p_quote_id UUID,
  p_new_status TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS public.material_quotes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_quote public.material_quotes;
  v_rule public.material_quote_transitions;
BEGIN
  SELECT * INTO v_quote FROM public.material_quotes WHERE id = p_quote_id FOR UPDATE;
  IF v_quote.id IS NULL THEN
    RAISE EXCEPTION 'Quote not found';
  END IF;
  IF NOT public.user_has_permission(v_actor, v_quote.store_id, 'quote:update') THEN
    RAISE EXCEPTION 'Permission denied: quote:update required';
  END IF;
  IF v_quote.status = p_new_status THEN
    RAISE EXCEPTION 'This quote is already %', replace(p_new_status, '_', ' ');
  END IF;

  -- Statuses driven by deliveries are reached through record_quote_fulfilment.
  IF p_new_status IN ('partially_fulfilled', 'fulfilled') THEN
    RAISE EXCEPTION 'Delivery status changes automatically when goods are recorded as delivered';
  END IF;

  SELECT * INTO v_rule FROM public.material_quote_transitions
  WHERE from_status = v_quote.status AND to_status = p_new_status;

  IF v_rule.from_status IS NULL THEN
    RAISE EXCEPTION 'A quote cannot go from % to %',
      replace(v_quote.status, '_', ' '), replace(p_new_status, '_', ' ');
  END IF;
  IF v_rule.requires_reason AND (p_reason IS NULL OR length(trim(p_reason)) < 3) THEN
    RAISE EXCEPTION 'Moving this quote to % needs a reason', replace(p_new_status, '_', ' ');
  END IF;

  UPDATE public.material_quotes SET status = p_new_status, updated_at = now()
  WHERE id = p_quote_id RETURNING * INTO v_quote;

  INSERT INTO public.audit_logs (actor_id, store_id, action, resource_type, resource_id, status, details)
  VALUES (v_actor, v_quote.store_id, 'MATERIAL_QUOTE_STATUS_CHANGED', 'material_quote', p_quote_id, 'success',
          jsonb_build_object('from', v_rule.from_status, 'to', p_new_status, 'reason', p_reason));

  RETURN v_quote;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_quote_status(UUID, TEXT, TEXT) TO authenticated;

-- ============================================================
-- RECORD A DELIVERY (POSSIBLY PARTIAL)
-- ============================================================
-- p_items: jsonb array of { quoteItemId, quantity } - only what went out this trip.
-- Consumes stock for lines tied to a product, so delivering materials is what
-- actually reduces the yard. Requires sales:create in addition to quote:update,
-- because consuming lots is the sales path.

CREATE OR REPLACE FUNCTION public.record_quote_fulfilment(
  p_quote_id UUID,
  p_items JSONB,
  p_delivered_on DATE DEFAULT NULL,
  p_note TEXT DEFAULT NULL
)
RETURNS public.material_quote_fulfilments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_quote public.material_quotes;
  v_fulfilment public.material_quote_fulfilments;
  v_item JSONB;
  v_item_id UUID;
  v_qty NUMERIC;
  v_row public.material_quote_items;
  v_total_items INTEGER;
  v_complete_items INTEGER;
  v_new_status TEXT;
  v_delivered DATE := COALESCE(p_delivered_on, current_date);
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_quote FROM public.material_quotes WHERE id = p_quote_id FOR UPDATE;
  IF v_quote.id IS NULL THEN
    RAISE EXCEPTION 'Quote not found';
  END IF;
  IF NOT public.user_has_permission(v_actor, v_quote.store_id, 'quote:update') THEN
    RAISE EXCEPTION 'Permission denied: quote:update required';
  END IF;
  IF NOT public.user_has_permission(v_actor, v_quote.store_id, 'sales:create') THEN
    RAISE EXCEPTION 'Permission denied: sales:create required to deliver stock';
  END IF;
  -- Goods only leave once the order is placed. A quote is not a dispatch note.
  IF v_quote.status NOT IN ('ordered', 'partially_fulfilled') THEN
    RAISE EXCEPTION 'Only an accepted order can be fulfilled (this quote is %)',
      replace(v_quote.status, '_', ' ');
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'A delivery needs at least one item';
  END IF;
  IF v_delivered > current_date THEN
    RAISE EXCEPTION 'A delivery cannot be dated in the future';
  END IF;

  -- Validate every line before writing anything.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_item_id := (v_item ->> 'quoteItemId')::UUID;
    v_qty := (v_item ->> 'quantity')::NUMERIC;

    SELECT * INTO v_row FROM public.material_quote_items
    WHERE id = v_item_id AND quote_id = p_quote_id;
    IF v_row.id IS NULL THEN
      RAISE EXCEPTION 'That line is not part of this quote';
    END IF;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'A delivered quantity must be greater than zero';
    END IF;
    IF v_row.fulfilled_quantity + v_qty > v_row.quantity THEN
      RAISE EXCEPTION 'Only % % of "%" is still outstanding',
        (v_row.quantity - v_row.fulfilled_quantity), v_row.unit_of_measure, v_row.description;
    END IF;
  END LOOP;

  INSERT INTO public.material_quote_fulfilments (quote_id, delivered_on, note, created_by)
  VALUES (p_quote_id, v_delivered, p_note, v_actor)
  RETURNING * INTO v_fulfilment;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_item_id := (v_item ->> 'quoteItemId')::UUID;
    v_qty := (v_item ->> 'quantity')::NUMERIC;

    INSERT INTO public.material_quote_fulfilment_items (fulfilment_id, quote_item_id, quantity)
    VALUES (v_fulfilment.id, v_item_id, v_qty);

    UPDATE public.material_quote_items
    SET fulfilled_quantity = fulfilled_quantity + v_qty
    WHERE id = v_item_id
    RETURNING * INTO v_row;

    -- Deliver from stock, using the same lot consumption as a sale.
    IF v_row.product_id IS NOT NULL THEN
      PERFORM public.allocate_lots_for_product(v_row.product_id, v_qty, NULL, NULL, FALSE);
    END IF;
  END LOOP;

  -- The commercial status follows from the quantities, not from a manual step.
  SELECT COUNT(*), COUNT(*) FILTER (WHERE fulfilled_quantity >= quantity)
  INTO v_total_items, v_complete_items
  FROM public.material_quote_items WHERE quote_id = p_quote_id;

  v_new_status := CASE WHEN v_complete_items = v_total_items THEN 'fulfilled' ELSE 'partially_fulfilled' END;

  IF v_new_status IS DISTINCT FROM v_quote.status THEN
    UPDATE public.material_quotes SET status = v_new_status, updated_at = now() WHERE id = p_quote_id;
  END IF;

  INSERT INTO public.audit_logs (actor_id, store_id, action, resource_type, resource_id, status, details)
  VALUES (v_actor, v_quote.store_id, 'MATERIAL_QUOTE_DELIVERED', 'material_quote', p_quote_id, 'success',
          jsonb_build_object('delivered_on', v_delivered, 'lines', jsonb_array_length(p_items),
                             'status', v_new_status));

  RETURN v_fulfilment;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_quote_fulfilment(UUID, JSONB, DATE, TEXT) TO authenticated;

-- ============================================================
-- PAYMENTS
-- ============================================================

CREATE OR REPLACE FUNCTION public.record_quote_payment(
  p_quote_id UUID,
  p_amount NUMERIC,
  p_method TEXT DEFAULT 'cash',
  p_reference TEXT DEFAULT NULL
)
RETURNS public.material_quote_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_quote public.material_quotes;
  v_due NUMERIC;
  v_paid NUMERIC;
  v_row public.material_quote_payments;
BEGIN
  SELECT * INTO v_quote FROM public.material_quotes WHERE id = p_quote_id;
  IF v_quote.id IS NULL THEN
    RAISE EXCEPTION 'Quote not found';
  END IF;
  IF NOT public.user_has_permission(v_actor, v_quote.store_id, 'quote:create') THEN
    RAISE EXCEPTION 'Permission denied: quote:create required';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'A payment must be greater than zero';
  END IF;
  IF p_method NOT IN ('cash', 'transfer', 'card', 'credit', 'other') THEN
    RAISE EXCEPTION 'Unknown payment method: %', p_method;
  END IF;
  IF v_quote.status = 'cancelled' THEN
    RAISE EXCEPTION 'This quote was cancelled';
  END IF;

  v_due := v_quote.delivery_charge + COALESCE(
    (SELECT SUM(i.line_total) FROM public.material_quote_items i WHERE i.quote_id = p_quote_id), 0);
  SELECT COALESCE(SUM(p.amount), 0) INTO v_paid
  FROM public.material_quote_payments p WHERE p.quote_id = p_quote_id;

  IF v_paid + p_amount > v_due THEN
    RAISE EXCEPTION 'That is more than the outstanding balance of %', round(v_due - v_paid, 2);
  END IF;

  INSERT INTO public.material_quote_payments (quote_id, amount, method, reference, received_by)
  VALUES (p_quote_id, round(p_amount, 2), p_method, p_reference, v_actor)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_quote_payment(UUID, NUMERIC, TEXT, TEXT) TO authenticated;

-- ============================================================
-- QUERIES
-- ============================================================

CREATE OR REPLACE FUNCTION public.list_material_quotes(
  p_store_id UUID,
  p_status TEXT DEFAULT NULL,
  p_open_only BOOLEAN DEFAULT TRUE,
  p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
  id UUID,
  quote_number INTEGER,
  customer_name TEXT,
  status TEXT,
  items_total NUMERIC,
  delivery_charge NUMERIC,
  total NUMERIC,
  paid NUMERIC,
  balance NUMERIC,
  ordered_quantity NUMERIC,
  fulfilled_quantity NUMERIC,
  outstanding_quantity NUMERIC,
  delivery_count BIGINT,
  valid_until DATE,
  is_expired BOOLEAN,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_has_permission(auth.uid(), p_store_id, 'quote:view') THEN
    RAISE EXCEPTION 'Permission denied: quote:view required';
  END IF;

  RETURN QUERY
  SELECT q.id, q.quote_number, q.customer_name, q.status,
         COALESCE((SELECT SUM(i.line_total) FROM public.material_quote_items i WHERE i.quote_id = q.id), 0)::NUMERIC,
         q.delivery_charge,
         (q.delivery_charge + COALESCE((SELECT SUM(i.line_total) FROM public.material_quote_items i WHERE i.quote_id = q.id), 0))::NUMERIC,
         COALESCE((SELECT SUM(p.amount) FROM public.material_quote_payments p WHERE p.quote_id = q.id), 0)::NUMERIC,
         (q.delivery_charge
           + COALESCE((SELECT SUM(i.line_total) FROM public.material_quote_items i WHERE i.quote_id = q.id), 0)
           - COALESCE((SELECT SUM(p.amount) FROM public.material_quote_payments p WHERE p.quote_id = q.id), 0))::NUMERIC,
         COALESCE((SELECT SUM(i.quantity) FROM public.material_quote_items i WHERE i.quote_id = q.id), 0)::NUMERIC,
         COALESCE((SELECT SUM(i.fulfilled_quantity) FROM public.material_quote_items i WHERE i.quote_id = q.id), 0)::NUMERIC,
         COALESCE((SELECT SUM(i.quantity - i.fulfilled_quantity) FROM public.material_quote_items i WHERE i.quote_id = q.id), 0)::NUMERIC,
         (SELECT COUNT(*) FROM public.material_quote_fulfilments f WHERE f.quote_id = q.id),
         q.valid_until,
         (q.valid_until IS NOT NULL AND q.valid_until < current_date),
         q.created_at
  FROM public.material_quotes q
  WHERE q.store_id = p_store_id
    AND (p_status IS NULL OR q.status = p_status)
    AND (NOT p_open_only OR q.status NOT IN ('closed', 'cancelled'))
  ORDER BY q.created_at DESC
  LIMIT COALESCE(p_limit, 100);
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_material_quotes(UUID, TEXT, BOOLEAN, INTEGER) TO authenticated;

/** Every building-materials dashboard metric in one round trip. */
CREATE OR REPLACE FUNCTION public.material_quote_summary(p_store_id UUID)
RETURNS TABLE (
  open_quotes BIGINT,
  awaiting_fulfilment BIGINT,
  partial_deliveries BIGINT,
  outstanding_quantity NUMERIC,
  outstanding_balances NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_has_permission(auth.uid(), p_store_id, 'quote:view') THEN
    RAISE EXCEPTION 'Permission denied: quote:view required';
  END IF;

  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM public.material_quotes q
      WHERE q.store_id = p_store_id AND q.status IN ('draft', 'sent')),
    (SELECT COUNT(*) FROM public.material_quotes q
      WHERE q.store_id = p_store_id AND q.status IN ('accepted', 'ordered', 'partially_fulfilled')),
    (SELECT COUNT(*) FROM public.material_quotes q
      WHERE q.store_id = p_store_id AND q.status = 'partially_fulfilled'),
    (SELECT COALESCE(SUM(i.quantity - i.fulfilled_quantity), 0)
      FROM public.material_quote_items i
      JOIN public.material_quotes q ON q.id = i.quote_id
      WHERE q.store_id = p_store_id AND q.status IN ('ordered', 'partially_fulfilled')),
    (SELECT COALESCE(SUM(
        q.delivery_charge
        + COALESCE((SELECT SUM(i2.line_total) FROM public.material_quote_items i2 WHERE i2.quote_id = q.id), 0)
        - COALESCE((SELECT SUM(p.amount) FROM public.material_quote_payments p WHERE p.quote_id = q.id), 0)
      ), 0)
      FROM public.material_quotes q
      WHERE q.store_id = p_store_id AND q.status NOT IN ('closed', 'cancelled'));
END;
$$;

GRANT EXECUTE ON FUNCTION public.material_quote_summary(UUID) TO authenticated;
