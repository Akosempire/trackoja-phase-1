-- ============================================================
-- 20261030002001: RESTOCKING, STOCK COUNTS, BRANCH TRANSFERS, LOW STOCK
-- ============================================================
-- Builds on suppliers / purchases / purchase_items (081-083), stock_lots (076)
-- and _apply_inventory_movement_internal (sales functions). Additive only.
--
-- 1. Receiving stock: receive_purchase() raises stock for EVERY line. (The older
--    record_purchase() only moved stock for lot lines and only recorded the cost
--    of plain lines, so plain products never went up. It is left in place for
--    compatibility but nothing in the app calls it any more.)
--    Cost price uses a WEIGHTED AVERAGE, not the last price paid:
--      new cost = (stock on hand x old cost + qty received x unit cost) / (on hand + received)
--    so profit on the units already on the shelf isn't rewritten by one cheap or
--    expensive delivery. Negative stock counts as zero on hand.
--    Each purchase records what was paid now; supplier_payments records what was
--    paid later. Owed = total - paid.
-- 2. Stock counts: one open count per store. Lines snapshot the system quantity
--    at the start; applying moves stock by (counted - expected), so sales made
--    while counting are not undone. Lot-tracked products are counted per batch in
--    Stock & Batches and are left out here.
-- 3. Transfers between branches of the same business: stock leaves the source on
--    send (transfer_out) and arrives on receive (transfer_in), matched by SKU;
--    a product the receiving branch doesn't have yet is created there.
-- 4. Low stock: list_low_stock() with the usual supplier and last cost, for the
--    Low stock page and "Reorder".
-- Money is NUMERIC(14,2), quantities NUMERIC(14,3), like the rest of the schema.
-- ============================================================

-- ============================================================
-- 1. PURCHASES: PAID / OWED, SUPPLIER PAYMENTS
-- ============================================================
ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(14,2) NOT NULL DEFAULT 0;
DO $$ BEGIN
  ALTER TABLE public.purchases ADD CONSTRAINT purchases_amount_paid_range CHECK (amount_paid >= 0 AND amount_paid <= total);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.supplier_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  purchase_id UUID REFERENCES public.purchases(id) ON DELETE CASCADE,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  paid_on DATE NOT NULL DEFAULT current_date,
  payment_method TEXT CHECK (payment_method IS NULL OR payment_method IN ('cash', 'transfer', 'card', 'other')),
  reference TEXT,
  notes TEXT,
  recorded_by UUID NOT NULL REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier ON public.supplier_payments(supplier_id, paid_on DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_purchase ON public.supplier_payments(purchase_id);
ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supplier_payments_select ON public.supplier_payments;
CREATE POLICY supplier_payments_select ON public.supplier_payments FOR SELECT TO authenticated
  USING (store_id IN (SELECT public.get_user_active_store_ids(auth.uid()))
         AND public.user_has_permission(auth.uid(), store_id, 'purchase:view'));

-- weighted average after receiving qty at unit_cost (negative stock counts as none)
CREATE OR REPLACE FUNCTION public.weighted_cost(p_on_hand NUMERIC, p_old_cost NUMERIC, p_qty NUMERIC, p_unit_cost NUMERIC)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN GREATEST(COALESCE(p_on_hand, 0), 0) + p_qty <= 0 THEN round(p_unit_cost, 2)
    ELSE round((GREATEST(COALESCE(p_on_hand, 0), 0) * COALESCE(p_old_cost, 0) + p_qty * p_unit_cost)
               / (GREATEST(COALESCE(p_on_hand, 0), 0) + p_qty), 2)
  END;
$$;

-- p_items: [{ productId, quantity, unitCost, lotType?, identifier?, expiryDate?, unit? }]
CREATE OR REPLACE FUNCTION public.receive_purchase(
  p_store_id UUID,
  p_items JSONB,
  p_supplier_id UUID DEFAULT NULL,
  p_purchased_on DATE DEFAULT NULL,
  p_payment_method TEXT DEFAULT NULL,
  p_reference TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_amount_paid NUMERIC DEFAULT NULL
)
RETURNS public.purchases
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_purchase public.purchases;
  v_item JSONB;
  v_product public.products;
  v_qty NUMERIC; v_cost NUMERIC; v_total NUMERIC := 0; v_paid NUMERIC;
  v_lot public.stock_lots;
  v_lot_type TEXT; v_identifier TEXT; v_expiry DATE; v_unit TEXT;
  v_date DATE := COALESCE(p_purchased_on, current_date);
  v_expense public.expenses;
  v_label TEXT;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT public.user_has_permission(v_actor, p_store_id, 'purchase:create') THEN
    RAISE EXCEPTION 'Permission denied: purchase:create required';
  END IF;
  IF NOT public.user_has_permission(v_actor, p_store_id, 'inventory:adjust') THEN
    RAISE EXCEPTION 'Permission denied: inventory:adjust required to receive stock';
  END IF;
  IF v_date > current_date THEN RAISE EXCEPTION 'A purchase cannot be dated in the future'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Add at least one product';
  END IF;
  IF jsonb_array_length(p_items) > 300 THEN RAISE EXCEPTION 'A delivery can have at most 300 lines'; END IF;
  IF p_supplier_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.suppliers s WHERE s.id = p_supplier_id AND s.store_id = p_store_id) THEN
    RAISE EXCEPTION 'That supplier belongs to a different store';
  END IF;
  IF p_payment_method IS NOT NULL AND p_payment_method NOT IN ('cash', 'transfer', 'card', 'credit', 'other') THEN
    RAISE EXCEPTION 'Unknown payment method';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item ->> 'quantity')::NUMERIC;
    v_cost := COALESCE((v_item ->> 'unitCost')::NUMERIC, 0);
    IF NOT EXISTS (SELECT 1 FROM public.products pr WHERE pr.id = (v_item ->> 'productId')::UUID AND pr.store_id = p_store_id) THEN
      RAISE EXCEPTION 'A product on this delivery is not in this store';
    END IF;
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'Every line needs a quantity above zero'; END IF;
    IF v_cost < 0 THEN RAISE EXCEPTION 'A cost cannot be negative'; END IF;
    v_total := v_total + round(v_qty * v_cost, 2);
  END LOOP;

  v_paid := LEAST(GREATEST(COALESCE(p_amount_paid, CASE WHEN p_payment_method = 'credit' THEN 0 ELSE v_total END), 0), v_total);

  INSERT INTO public.purchases (store_id, supplier_id, reference, purchased_on, total, payment_method, notes, recorded_by, amount_paid)
  VALUES (p_store_id, p_supplier_id, NULLIF(trim(p_reference), ''), v_date, v_total, p_payment_method, NULLIF(trim(p_notes), ''), v_actor, v_paid)
  RETURNING * INTO v_purchase;
  v_label := 'Delivery ' || COALESCE(v_purchase.reference, upper(left(v_purchase.id::text, 8)));

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item ->> 'quantity')::NUMERIC;
    v_cost := COALESCE((v_item ->> 'unitCost')::NUMERIC, 0);
    v_lot_type := NULLIF(trim(COALESCE(v_item ->> 'lotType', '')), '');
    v_identifier := NULLIF(trim(COALESCE(v_item ->> 'identifier', '')), '');
    v_unit := NULLIF(trim(COALESCE(v_item ->> 'unit', '')), '');
    v_expiry := NULLIF(trim(COALESCE(v_item ->> 'expiryDate', '')), '')::DATE;
    v_lot := NULL;

    SELECT * INTO v_product FROM public.products WHERE id = (v_item ->> 'productId')::UUID FOR UPDATE;
    -- the new cost is worked out from what was on hand BEFORE this line arrives
    UPDATE public.products SET cost_price = public.weighted_cost(v_product.stock_qty, v_product.cost_price, v_qty, v_cost)
      WHERE id = v_product.id;

    IF v_lot_type IS NOT NULL AND v_lot_type <> 'bulk' THEN
      v_lot := public.receive_stock_lot(
        p_store_id := p_store_id, p_product_id := v_product.id, p_lot_type := v_lot_type, p_quantity := v_qty,
        p_unit_of_measure := v_unit, p_identifier := v_identifier, p_expiry_date := v_expiry,
        p_cost_per_unit := v_cost, p_supplier_id := p_supplier_id, p_notes := v_label);
    ELSIF v_product.track_inventory THEN
      PERFORM public._apply_inventory_movement_internal(p_store_id, v_product.id, 'replenishment', v_qty,
        v_label, 'purchase', v_purchase.id, v_actor);
    END IF;

    INSERT INTO public.purchase_items (purchase_id, product_id, description, quantity, unit_cost, line_total, lot_id, lot_identifier, unit_of_measure)
    VALUES (v_purchase.id, v_product.id, v_product.name, v_qty, v_cost, round(v_qty * v_cost, 2),
            v_lot.id, COALESCE(v_lot.identifier, v_identifier), COALESCE(v_lot.unit_of_measure, v_unit, v_product.unit));
  END LOOP;

  IF v_paid > 0 THEN
    INSERT INTO public.supplier_payments (store_id, supplier_id, purchase_id, amount, paid_on, payment_method, reference, notes, recorded_by)
    VALUES (p_store_id, p_supplier_id, v_purchase.id, v_paid, v_date,
            CASE WHEN p_payment_method IN ('cash', 'transfer', 'card') THEN p_payment_method ELSE 'other' END,
            v_purchase.reference, 'Paid on delivery', v_actor);
  END IF;

  -- the cost of stock shows in Expenses once, on the delivery date
  IF v_total > 0 THEN
    v_expense := public.create_expense(
      p_store_id := p_store_id, p_description := v_label, p_amount := v_total, p_category := 'stock',
      p_spent_on := v_date, p_payment_method := p_payment_method, p_supplier_id := p_supplier_id,
      p_reference := v_purchase.reference, p_notes := format('Received against purchase %s', left(v_purchase.id::text, 8)));
    UPDATE public.purchases SET expense_id = v_expense.id WHERE id = v_purchase.id RETURNING * INTO v_purchase;
  END IF;

  INSERT INTO public.audit_logs (actor_id, store_id, action, resource_type, resource_id, status, details)
  VALUES (v_actor, p_store_id, 'PURCHASE_RECEIVED', 'purchase', v_purchase.id, 'success',
          jsonb_build_object('total', v_total, 'paid', v_paid, 'supplier_id', p_supplier_id, 'lines', jsonb_array_length(p_items)));
  RETURN v_purchase;
END;
$$;
REVOKE ALL ON FUNCTION public.receive_purchase(UUID, JSONB, UUID, DATE, TEXT, TEXT, TEXT, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receive_purchase(UUID, JSONB, UUID, DATE, TEXT, TEXT, TEXT, NUMERIC) TO authenticated;

-- A later payment to a supplier. With a purchase: pays that one. Without: pays the
-- oldest unpaid deliveries first. Never more than what is owed.
CREATE OR REPLACE FUNCTION public.record_supplier_payment(
  p_store_id UUID,
  p_supplier_id UUID,
  p_amount NUMERIC,
  p_purchase_id UUID DEFAULT NULL,
  p_payment_method TEXT DEFAULT 'transfer',
  p_reference TEXT DEFAULT NULL,
  p_paid_on DATE DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_left NUMERIC := round(COALESCE(p_amount, 0), 2);
  v_owed NUMERIC;
  v_p RECORD;
  v_part NUMERIC;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT public.user_has_permission(v_actor, p_store_id, 'purchase:create') THEN
    RAISE EXCEPTION 'Permission denied: purchase:create required';
  END IF;
  IF v_left <= 0 THEN RAISE EXCEPTION 'Enter an amount above zero'; END IF;
  IF COALESCE(p_paid_on, current_date) > current_date THEN RAISE EXCEPTION 'A payment cannot be dated in the future'; END IF;
  IF p_payment_method IS NOT NULL AND p_payment_method NOT IN ('cash', 'transfer', 'card', 'other') THEN RAISE EXCEPTION 'Unknown payment method'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.suppliers s WHERE s.id = p_supplier_id AND s.store_id = p_store_id) THEN
    RAISE EXCEPTION 'Supplier not found in this store';
  END IF;

  SELECT COALESCE(SUM(total - amount_paid), 0) INTO v_owed FROM public.purchases
    WHERE store_id = p_store_id AND supplier_id = p_supplier_id AND (p_purchase_id IS NULL OR id = p_purchase_id);
  IF v_left > v_owed THEN
    RAISE EXCEPTION 'That is more than you owe (%)', to_char(v_owed, 'FM999,999,999,990.00');
  END IF;

  FOR v_p IN SELECT id, total - amount_paid AS due FROM public.purchases
      WHERE store_id = p_store_id AND supplier_id = p_supplier_id AND total > amount_paid
        AND (p_purchase_id IS NULL OR id = p_purchase_id)
      ORDER BY purchased_on, created_at FOR UPDATE LOOP
    EXIT WHEN v_left <= 0;
    v_part := LEAST(v_left, v_p.due);
    UPDATE public.purchases SET amount_paid = amount_paid + v_part WHERE id = v_p.id;
    INSERT INTO public.supplier_payments (store_id, supplier_id, purchase_id, amount, paid_on, payment_method, reference, notes, recorded_by)
    VALUES (p_store_id, p_supplier_id, v_p.id, v_part, COALESCE(p_paid_on, current_date), p_payment_method,
            NULLIF(trim(p_reference), ''), NULLIF(trim(p_notes), ''), v_actor);
    v_left := v_left - v_part;
  END LOOP;

  INSERT INTO public.audit_logs (actor_id, store_id, action, resource_type, resource_id, status, details)
  VALUES (v_actor, p_store_id, 'SUPPLIER_PAID', 'supplier', p_supplier_id, 'success', jsonb_build_object('amount', p_amount));
  RETURN v_owed - p_amount;
END;
$$;
REVOKE ALL ON FUNCTION public.record_supplier_payment(UUID, UUID, NUMERIC, UUID, TEXT, TEXT, DATE, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_supplier_payment(UUID, UUID, NUMERIC, UUID, TEXT, TEXT, DATE, TEXT) TO authenticated;

-- Suppliers with what was bought and what is owed. Money only for purchase:view.
CREATE OR REPLACE FUNCTION public.list_supplier_balances(p_store_id UUID, p_include_inactive BOOLEAN DEFAULT FALSE)
RETURNS TABLE (id UUID, name TEXT, contact_name TEXT, phone TEXT, email TEXT, address TEXT, payment_terms TEXT, notes TEXT,
               status TEXT, purchase_count BIGINT, purchased_total NUMERIC, paid_total NUMERIC, owed NUMERIC, last_purchase_on DATE)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE v_money BOOLEAN;
BEGIN
  IF NOT public.user_has_permission(auth.uid(), p_store_id, 'supplier:view') THEN
    RAISE EXCEPTION 'Permission denied: supplier:view required';
  END IF;
  v_money := public.user_has_permission(auth.uid(), p_store_id, 'purchase:view');
  RETURN QUERY
  SELECT s.id, s.name, s.contact_name, s.phone, s.email, s.address, s.payment_terms, s.notes, s.status,
         COUNT(p.id),
         CASE WHEN v_money THEN COALESCE(SUM(p.total), 0) END,
         CASE WHEN v_money THEN COALESCE(SUM(p.amount_paid), 0) END,
         CASE WHEN v_money THEN COALESCE(SUM(p.total - p.amount_paid), 0) END,
         MAX(p.purchased_on)
  FROM public.suppliers s
  LEFT JOIN public.purchases p ON p.supplier_id = s.id AND p.store_id = s.store_id
  WHERE s.store_id = p_store_id AND (p_include_inactive OR s.status = 'active')
  GROUP BY s.id
  ORDER BY s.name;
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_supplier_balances(UUID, BOOLEAN) TO authenticated;

-- Purchase history with paid / owed
CREATE OR REPLACE FUNCTION public.list_purchase_history(p_store_id UUID, p_supplier_id UUID DEFAULT NULL, p_limit INTEGER DEFAULT 100)
RETURNS TABLE (id UUID, reference TEXT, purchased_on DATE, total NUMERIC, amount_paid NUMERIC, owed NUMERIC,
               supplier_id UUID, supplier_name TEXT, line_count BIGINT, recorded_by_name TEXT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
BEGIN
  IF NOT public.user_has_permission(auth.uid(), p_store_id, 'purchase:view') THEN
    RAISE EXCEPTION 'Permission denied: purchase:view required';
  END IF;
  RETURN QUERY
  SELECT p.id, p.reference, p.purchased_on, p.total, p.amount_paid, p.total - p.amount_paid, p.supplier_id, s.name,
         (SELECT COUNT(*) FROM public.purchase_items pi WHERE pi.purchase_id = p.id),
         NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), ''), p.created_at
  FROM public.purchases p
  LEFT JOIN public.suppliers s ON s.id = p.supplier_id
  LEFT JOIN public.users u ON u.id = p.recorded_by
  WHERE p.store_id = p_store_id AND (p_supplier_id IS NULL OR p.supplier_id = p_supplier_id)
  ORDER BY p.purchased_on DESC, p.created_at DESC
  LIMIT LEAST(COALESCE(p_limit, 100), 500);
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_purchase_history(UUID, UUID, INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_purchase_detail(p_purchase_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE v_p public.purchases;
BEGIN
  SELECT * INTO v_p FROM public.purchases WHERE id = p_purchase_id;
  IF v_p.id IS NULL OR NOT public.user_has_permission(auth.uid(), v_p.store_id, 'purchase:view') THEN
    RAISE EXCEPTION 'Purchase not found';
  END IF;
  RETURN jsonb_build_object(
    'purchase', to_jsonb(v_p) || jsonb_build_object('owed', v_p.total - v_p.amount_paid,
      'supplier_name', (SELECT name FROM public.suppliers WHERE id = v_p.supplier_id)),
    'items', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', pi.id, 'product_id', pi.product_id,
        'name', COALESCE(pr.name, pi.description), 'sku', pr.sku, 'quantity', pi.quantity, 'unit_cost', pi.unit_cost,
        'line_total', pi.line_total, 'lot_identifier', pi.lot_identifier, 'unit', pi.unit_of_measure) ORDER BY pi.created_at, pi.id)
      FROM public.purchase_items pi LEFT JOIN public.products pr ON pr.id = pi.product_id WHERE pi.purchase_id = v_p.id), '[]'::jsonb),
    'payments', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', sp.id, 'amount', sp.amount, 'paid_on', sp.paid_on,
        'method', sp.payment_method, 'reference', sp.reference, 'notes', sp.notes) ORDER BY sp.paid_on, sp.created_at)
      FROM public.supplier_payments sp WHERE sp.purchase_id = v_p.id), '[]'::jsonb));
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_purchase_detail(UUID) TO authenticated;

-- ============================================================
-- 2. STOCK COUNTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.stock_counts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  category_id UUID REFERENCES public.product_categories(id) ON DELETE SET NULL,
  scope_label TEXT NOT NULL DEFAULT 'All products',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'applied', 'cancelled')),
  started_by UUID NOT NULL REFERENCES public.users(id),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_by UUID REFERENCES public.users(id),
  finished_at TIMESTAMPTZ,
  notes TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS stock_counts_one_open ON public.stock_counts(store_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS stock_counts_store_idx ON public.stock_counts(store_id, started_at DESC);

CREATE TABLE IF NOT EXISTS public.stock_count_lines (
  count_id UUID NOT NULL REFERENCES public.stock_counts(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  expected_qty NUMERIC(14,3) NOT NULL,
  counted_qty NUMERIC(14,3) CHECK (counted_qty IS NULL OR counted_qty >= 0),
  unit_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  counted_at TIMESTAMPTZ,
  PRIMARY KEY (count_id, product_id)
);
ALTER TABLE public.stock_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_count_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stock_counts_select ON public.stock_counts;
CREATE POLICY stock_counts_select ON public.stock_counts FOR SELECT TO authenticated
  USING (store_id IN (SELECT public.get_user_active_store_ids(auth.uid())) AND public.user_has_permission(auth.uid(), store_id, 'inventory:view'));
DROP POLICY IF EXISTS stock_count_lines_select ON public.stock_count_lines;
CREATE POLICY stock_count_lines_select ON public.stock_count_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.stock_counts c WHERE c.id = count_id
    AND c.store_id IN (SELECT public.get_user_active_store_ids(auth.uid())) AND public.user_has_permission(auth.uid(), c.store_id, 'inventory:view')));

CREATE OR REPLACE FUNCTION public.start_stock_count(p_store_id UUID, p_category_id UUID DEFAULT NULL)
RETURNS public.stock_counts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor UUID := auth.uid(); v_count public.stock_counts; v_label TEXT := 'All products';
BEGIN
  IF v_actor IS NULL OR NOT public.user_has_permission(v_actor, p_store_id, 'inventory:adjust') THEN
    RAISE EXCEPTION 'Permission denied: inventory:adjust required';
  END IF;
  IF EXISTS (SELECT 1 FROM public.stock_counts WHERE store_id = p_store_id AND status = 'open') THEN
    RAISE EXCEPTION 'A stock count is already open in this branch. Finish or cancel it first.';
  END IF;
  IF p_category_id IS NOT NULL THEN
    SELECT name INTO v_label FROM public.product_categories WHERE id = p_category_id AND store_id = p_store_id;
    IF v_label IS NULL THEN RAISE EXCEPTION 'Category not found in this store'; END IF;
  END IF;
  INSERT INTO public.stock_counts (store_id, category_id, scope_label, started_by)
  VALUES (p_store_id, p_category_id, v_label, v_actor) RETURNING * INTO v_count;
  INSERT INTO public.stock_count_lines (count_id, product_id, expected_qty, unit_cost)
  SELECT v_count.id, p.id, p.stock_qty, p.cost_price FROM public.products p
  WHERE p.store_id = p_store_id AND p.status = 'active' AND p.track_inventory
    AND (p_category_id IS NULL OR p.category_id = p_category_id)
    -- batches, rolls and serials are counted lot by lot in Stock & Batches
    AND NOT EXISTS (SELECT 1 FROM public.stock_lots l WHERE l.product_id = p.id);
  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.start_stock_count(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_stock_count_line(p_count_id UUID, p_product_id UUID, p_counted NUMERIC)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count public.stock_counts;
BEGIN
  SELECT * INTO v_count FROM public.stock_counts WHERE id = p_count_id;
  IF v_count.id IS NULL OR NOT public.user_has_permission(auth.uid(), v_count.store_id, 'inventory:adjust') THEN
    RAISE EXCEPTION 'Stock count not found';
  END IF;
  IF v_count.status <> 'open' THEN RAISE EXCEPTION 'This stock count is finished'; END IF;
  IF p_counted IS NOT NULL AND p_counted < 0 THEN RAISE EXCEPTION 'A count cannot be negative'; END IF;
  UPDATE public.stock_count_lines SET counted_qty = p_counted, counted_at = CASE WHEN p_counted IS NULL THEN NULL ELSE now() END
    WHERE count_id = p_count_id AND product_id = p_product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'That product is not part of this count'; END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.set_stock_count_line(UUID, UUID, NUMERIC) TO authenticated;

-- applies (counted - expected) to each counted line; uncounted lines are left alone
CREATE OR REPLACE FUNCTION public.apply_stock_count(p_count_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor UUID := auth.uid(); v_count public.stock_counts; v_line RECORD; v_changed INT := 0; v_value NUMERIC := 0;
BEGIN
  SELECT * INTO v_count FROM public.stock_counts WHERE id = p_count_id FOR UPDATE;
  IF v_count.id IS NULL OR NOT public.user_has_permission(v_actor, v_count.store_id, 'inventory:adjust') THEN
    RAISE EXCEPTION 'Stock count not found';
  END IF;
  IF v_count.status <> 'open' THEN RAISE EXCEPTION 'This stock count is finished'; END IF;
  FOR v_line IN SELECT l.*, p.name FROM public.stock_count_lines l JOIN public.products p ON p.id = l.product_id
      WHERE l.count_id = p_count_id AND l.counted_qty IS NOT NULL AND l.counted_qty <> l.expected_qty LOOP
    PERFORM public._apply_inventory_movement_internal(v_count.store_id, v_line.product_id, 'adjustment',
      v_line.counted_qty - v_line.expected_qty, 'Stock count', 'stock_count', p_count_id, v_actor);
    v_changed := v_changed + 1;
    v_value := v_value + round((v_line.counted_qty - v_line.expected_qty) * v_line.unit_cost, 2);
  END LOOP;
  UPDATE public.stock_counts SET status = 'applied', finished_by = v_actor, finished_at = now() WHERE id = p_count_id;
  INSERT INTO public.audit_logs (actor_id, store_id, action, resource_type, resource_id, status, details)
  VALUES (v_actor, v_count.store_id, 'STOCK_COUNT_APPLIED', 'stock_count', p_count_id, 'success',
          jsonb_build_object('products_changed', v_changed, 'value_change', v_value));
  RETURN jsonb_build_object('changed', v_changed, 'value_change', v_value);
END;
$$;
GRANT EXECUTE ON FUNCTION public.apply_stock_count(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_stock_count(p_count_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count public.stock_counts;
BEGIN
  SELECT * INTO v_count FROM public.stock_counts WHERE id = p_count_id;
  IF v_count.id IS NULL OR NOT public.user_has_permission(auth.uid(), v_count.store_id, 'inventory:adjust') THEN
    RAISE EXCEPTION 'Stock count not found';
  END IF;
  UPDATE public.stock_counts SET status = 'cancelled', finished_by = auth.uid(), finished_at = now() WHERE id = p_count_id AND status = 'open';
END;
$$;
GRANT EXECUTE ON FUNCTION public.cancel_stock_count(UUID) TO authenticated;

-- ============================================================
-- 3. TRANSFERS BETWEEN BRANCHES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.stock_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  from_store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  to_store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'in_transit' CHECK (status IN ('in_transit', 'received', 'cancelled')),
  notes TEXT,
  sent_by UUID NOT NULL REFERENCES public.users(id),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  received_by UUID REFERENCES public.users(id),
  received_at TIMESTAMPTZ,
  CHECK (from_store_id <> to_store_id)
);
CREATE INDEX IF NOT EXISTS stock_transfers_from_idx ON public.stock_transfers(from_store_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS stock_transfers_to_idx ON public.stock_transfers(to_store_id, status);

CREATE TABLE IF NOT EXISTS public.stock_transfer_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id UUID NOT NULL REFERENCES public.stock_transfers(id) ON DELETE CASCADE,
  from_product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  to_product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  sku TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'pcs',
  unit_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  quantity_sent NUMERIC(14,3) NOT NULL CHECK (quantity_sent > 0),
  quantity_received NUMERIC(14,3) CHECK (quantity_received IS NULL OR quantity_received >= 0)
);
CREATE INDEX IF NOT EXISTS stock_transfer_lines_transfer_idx ON public.stock_transfer_lines(transfer_id);
ALTER TABLE public.stock_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_transfer_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stock_transfers_select ON public.stock_transfers;
CREATE POLICY stock_transfers_select ON public.stock_transfers FOR SELECT TO authenticated
  USING ((from_store_id IN (SELECT public.get_user_active_store_ids(auth.uid())) AND public.user_has_permission(auth.uid(), from_store_id, 'inventory:view'))
      OR (to_store_id IN (SELECT public.get_user_active_store_ids(auth.uid())) AND public.user_has_permission(auth.uid(), to_store_id, 'inventory:view')));
DROP POLICY IF EXISTS stock_transfer_lines_select ON public.stock_transfer_lines;
CREATE POLICY stock_transfer_lines_select ON public.stock_transfer_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.stock_transfers t WHERE t.id = transfer_id));

-- other active branches of the same business, to send stock to
CREATE OR REPLACE FUNCTION public.list_transfer_branches(p_store_id UUID)
RETURNS TABLE (id UUID, name TEXT) LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
BEGIN
  IF NOT public.user_has_permission(auth.uid(), p_store_id, 'inventory:adjust') THEN
    RAISE EXCEPTION 'Permission denied: inventory:adjust required';
  END IF;
  RETURN QUERY SELECT s.id, s.name FROM public.stores s
    WHERE s.org_id = (SELECT x.org_id FROM public.stores x WHERE x.id = p_store_id) AND s.id <> p_store_id AND s.status = 'active'
    ORDER BY s.name;
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_transfer_branches(UUID) TO authenticated;

-- p_lines: [{ productId, quantity }]
CREATE OR REPLACE FUNCTION public.send_stock_transfer(p_from_store_id UUID, p_to_store_id UUID, p_lines JSONB, p_notes TEXT DEFAULT NULL)
RETURNS public.stock_transfers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor UUID := auth.uid(); v_org UUID; v_t public.stock_transfers; v_l JSONB; v_p public.products; v_qty NUMERIC; v_to_name TEXT;
BEGIN
  IF v_actor IS NULL OR NOT public.user_has_permission(v_actor, p_from_store_id, 'inventory:adjust') THEN
    RAISE EXCEPTION 'Permission denied: inventory:adjust required';
  END IF;
  SELECT org_id INTO v_org FROM public.stores WHERE id = p_from_store_id;
  SELECT name INTO v_to_name FROM public.stores WHERE id = p_to_store_id AND org_id = v_org AND status = 'active' AND id <> p_from_store_id;
  IF v_to_name IS NULL THEN RAISE EXCEPTION 'Choose another branch of this business'; END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN RAISE EXCEPTION 'Add at least one product'; END IF;
  IF jsonb_array_length(p_lines) > 300 THEN RAISE EXCEPTION 'A transfer can have at most 300 lines'; END IF;

  INSERT INTO public.stock_transfers (org_id, from_store_id, to_store_id, notes, sent_by)
  VALUES (v_org, p_from_store_id, p_to_store_id, NULLIF(trim(p_notes), ''), v_actor) RETURNING * INTO v_t;

  FOR v_l IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_qty := (v_l ->> 'quantity')::NUMERIC;
    SELECT * INTO v_p FROM public.products WHERE id = (v_l ->> 'productId')::UUID AND store_id = p_from_store_id;
    IF v_p.id IS NULL THEN RAISE EXCEPTION 'A product on this transfer is not in this branch'; END IF;
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'Every line needs a quantity above zero'; END IF;
    IF NOT v_p.track_inventory THEN RAISE EXCEPTION '% does not track stock', v_p.name; END IF;
    IF EXISTS (SELECT 1 FROM public.stock_lots l WHERE l.product_id = v_p.id) THEN
      RAISE EXCEPTION '% is tracked by batch. Move batches from Stock & Batches.', v_p.name;
    END IF;
    PERFORM public._apply_inventory_movement_internal(p_from_store_id, v_p.id, 'transfer_out', -v_qty,
      'Sent to ' || v_to_name, 'stock_transfer', v_t.id, v_actor);
    INSERT INTO public.stock_transfer_lines (transfer_id, from_product_id, product_name, sku, unit, unit_cost, quantity_sent)
    VALUES (v_t.id, v_p.id, v_p.name, v_p.sku, v_p.unit, v_p.cost_price, v_qty);
  END LOOP;

  INSERT INTO public.audit_logs (actor_id, store_id, action, resource_type, resource_id, status, details)
  VALUES (v_actor, p_from_store_id, 'STOCK_TRANSFER_SENT', 'stock_transfer', v_t.id, 'success',
          jsonb_build_object('to_store_id', p_to_store_id, 'lines', jsonb_array_length(p_lines)));
  RETURN v_t;
END;
$$;
GRANT EXECUTE ON FUNCTION public.send_stock_transfer(UUID, UUID, JSONB, TEXT) TO authenticated;

-- p_lines: [{ lineId, quantityReceived }]; a line left out counts as fully received
CREATE OR REPLACE FUNCTION public.receive_stock_transfer(p_transfer_id UUID, p_lines JSONB DEFAULT '[]'::jsonb)
RETURNS public.stock_transfers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor UUID := auth.uid(); v_t public.stock_transfers; v_line public.stock_transfer_lines; v_got NUMERIC; v_dest UUID; v_from_name TEXT; v_src public.products;
BEGIN
  SELECT * INTO v_t FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF v_t.id IS NULL OR v_actor IS NULL OR NOT public.user_has_permission(v_actor, v_t.to_store_id, 'inventory:adjust') THEN
    RAISE EXCEPTION 'Transfer not found';
  END IF;
  IF v_t.status <> 'in_transit' THEN RAISE EXCEPTION 'This transfer was already %', replace(v_t.status, '_', ' '); END IF;
  SELECT name INTO v_from_name FROM public.stores WHERE id = v_t.from_store_id;

  FOR v_line IN SELECT * FROM public.stock_transfer_lines WHERE transfer_id = p_transfer_id ORDER BY product_name FOR UPDATE LOOP
    SELECT (x ->> 'quantityReceived')::NUMERIC INTO v_got FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) x
      WHERE x ->> 'lineId' = v_line.id::text LIMIT 1;
    v_got := COALESCE(v_got, v_line.quantity_sent);
    IF v_got < 0 THEN RAISE EXCEPTION 'A received quantity cannot be negative'; END IF;
    IF v_got > v_line.quantity_sent THEN RAISE EXCEPTION 'You cannot receive more % than was sent', v_line.product_name; END IF;

    -- same product in this branch (by SKU), or create it from the sender's
    SELECT id INTO v_dest FROM public.products WHERE store_id = v_t.to_store_id AND sku = v_line.sku;
    IF v_dest IS NULL THEN
      SELECT * INTO v_src FROM public.products WHERE id = v_line.from_product_id;
      INSERT INTO public.products (store_id, name, sku, barcode, description, unit, cost_price, selling_price, tax_rate,
                                   track_inventory, stock_qty, reorder_level, image_url, status, created_by)
      VALUES (v_t.to_store_id, v_line.product_name, v_line.sku, v_src.barcode, v_src.description, v_line.unit, v_line.unit_cost,
              COALESCE(v_src.selling_price, 0), COALESCE(v_src.tax_rate, 0), TRUE, 0, COALESCE(v_src.reorder_level, 0), v_src.image_url, 'active', v_actor)
      RETURNING id INTO v_dest;
    END IF;
    IF v_got > 0 THEN
      PERFORM public._apply_inventory_movement_internal(v_t.to_store_id, v_dest, 'transfer_in', v_got,
        'From ' || COALESCE(v_from_name, 'another branch'), 'stock_transfer', v_t.id, v_actor);
    END IF;
    UPDATE public.stock_transfer_lines SET quantity_received = v_got, to_product_id = v_dest WHERE id = v_line.id;
  END LOOP;

  UPDATE public.stock_transfers SET status = 'received', received_by = v_actor, received_at = now() WHERE id = p_transfer_id RETURNING * INTO v_t;
  INSERT INTO public.audit_logs (actor_id, store_id, action, resource_type, resource_id, status, details)
  VALUES (v_actor, v_t.to_store_id, 'STOCK_TRANSFER_RECEIVED', 'stock_transfer', v_t.id, 'success', jsonb_build_object('from_store_id', v_t.from_store_id));
  RETURN v_t;
END;
$$;
GRANT EXECUTE ON FUNCTION public.receive_stock_transfer(UUID, JSONB) TO authenticated;

-- the sending branch takes it back while it is still on the way
CREATE OR REPLACE FUNCTION public.cancel_stock_transfer(p_transfer_id UUID)
RETURNS public.stock_transfers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor UUID := auth.uid(); v_t public.stock_transfers; v_line public.stock_transfer_lines;
BEGIN
  SELECT * INTO v_t FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF v_t.id IS NULL OR v_actor IS NULL OR NOT public.user_has_permission(v_actor, v_t.from_store_id, 'inventory:adjust') THEN
    RAISE EXCEPTION 'Transfer not found';
  END IF;
  IF v_t.status <> 'in_transit' THEN RAISE EXCEPTION 'Only a transfer that is still on the way can be cancelled'; END IF;
  FOR v_line IN SELECT * FROM public.stock_transfer_lines WHERE transfer_id = p_transfer_id LOOP
    IF v_line.from_product_id IS NOT NULL THEN
      PERFORM public._apply_inventory_movement_internal(v_t.from_store_id, v_line.from_product_id, 'transfer_in', v_line.quantity_sent,
        'Transfer cancelled', 'stock_transfer', v_t.id, v_actor);
    END IF;
  END LOOP;
  UPDATE public.stock_transfers SET status = 'cancelled', received_by = v_actor, received_at = now() WHERE id = p_transfer_id RETURNING * INTO v_t;
  RETURN v_t;
END;
$$;
GRANT EXECUTE ON FUNCTION public.cancel_stock_transfer(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_stock_transfers(p_store_id UUID)
RETURNS TABLE (id UUID, direction TEXT, status TEXT, other_branch TEXT, line_count BIGINT, units_sent NUMERIC, units_received NUMERIC,
               value NUMERIC, notes TEXT, sent_at TIMESTAMPTZ, received_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
BEGIN
  IF NOT public.user_has_permission(auth.uid(), p_store_id, 'inventory:view') THEN
    RAISE EXCEPTION 'Permission denied: inventory:view required';
  END IF;
  RETURN QUERY
  SELECT t.id, CASE WHEN t.from_store_id = p_store_id THEN 'out' ELSE 'in' END, t.status,
         (SELECT s.name FROM public.stores s WHERE s.id = CASE WHEN t.from_store_id = p_store_id THEN t.to_store_id ELSE t.from_store_id END),
         COUNT(l.id), COALESCE(SUM(l.quantity_sent), 0), SUM(l.quantity_received),
         COALESCE(SUM(round(l.quantity_sent * l.unit_cost, 2)), 0), t.notes, t.sent_at, t.received_at
  FROM public.stock_transfers t LEFT JOIN public.stock_transfer_lines l ON l.transfer_id = t.id
  WHERE t.from_store_id = p_store_id OR t.to_store_id = p_store_id
  GROUP BY t.id
  ORDER BY (t.status = 'in_transit') DESC, t.sent_at DESC
  LIMIT 200;
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_stock_transfers(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_stock_transfer(p_transfer_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE v_t public.stock_transfers;
BEGIN
  SELECT * INTO v_t FROM public.stock_transfers WHERE id = p_transfer_id;
  IF v_t.id IS NULL OR NOT (public.user_has_permission(auth.uid(), v_t.from_store_id, 'inventory:view')
                            OR public.user_has_permission(auth.uid(), v_t.to_store_id, 'inventory:view')) THEN
    RAISE EXCEPTION 'Transfer not found';
  END IF;
  RETURN jsonb_build_object('transfer', to_jsonb(v_t) || jsonb_build_object(
      'from_name', (SELECT name FROM public.stores WHERE id = v_t.from_store_id),
      'to_name', (SELECT name FROM public.stores WHERE id = v_t.to_store_id)),
    'lines', COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.product_name) FROM public.stock_transfer_lines l WHERE l.transfer_id = v_t.id), '[]'::jsonb));
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_stock_transfer(UUID) TO authenticated;

-- ============================================================
-- 4. LOW STOCK
-- ============================================================
-- At or below reorder level (reorder level above zero), most urgent first, with
-- the supplier and cost of the last delivery and a suggested order: back up to
-- twice the reorder level.
CREATE OR REPLACE FUNCTION public.list_low_stock(p_store_id UUID)
RETURNS TABLE (product_id UUID, name TEXT, sku TEXT, unit TEXT, stock_qty NUMERIC, reorder_level NUMERIC,
               suggested_qty NUMERIC, last_unit_cost NUMERIC, supplier_id UUID, supplier_name TEXT, last_purchased_on DATE)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
BEGIN
  IF NOT public.user_has_permission(auth.uid(), p_store_id, 'inventory:view') THEN
    RAISE EXCEPTION 'Permission denied: inventory:view required';
  END IF;
  RETURN QUERY
  SELECT p.id, p.name, p.sku, p.unit, p.stock_qty, p.reorder_level,
         GREATEST(ceil(p.reorder_level * 2 - p.stock_qty), 1)::NUMERIC,
         COALESCE(last.unit_cost, p.cost_price), last.supplier_id, last.supplier_name, last.purchased_on
  FROM public.products p
  LEFT JOIN LATERAL (
    SELECT pi.unit_cost, pu.supplier_id, s.name AS supplier_name, pu.purchased_on
    FROM public.purchase_items pi JOIN public.purchases pu ON pu.id = pi.purchase_id
    LEFT JOIN public.suppliers s ON s.id = pu.supplier_id
    WHERE pi.product_id = p.id ORDER BY pu.purchased_on DESC, pu.created_at DESC LIMIT 1
  ) last ON TRUE
  WHERE p.store_id = p_store_id AND p.status = 'active' AND p.track_inventory
    AND p.reorder_level > 0 AND p.stock_qty <= p.reorder_level
  ORDER BY (p.stock_qty / NULLIF(p.reorder_level, 0)) ASC, p.name;
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_low_stock(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.weighted_cost(NUMERIC, NUMERIC, NUMERIC, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.weighted_cost(NUMERIC, NUMERIC, NUMERIC, NUMERIC) TO authenticated, service_role;
