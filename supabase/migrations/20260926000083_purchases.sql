-- Migration: 083_purchases.sql
-- Description: Purchases - stock received from a supplier. Expenses (081/082) cover
--   money going out, but nothing represented goods coming in: a supermarket restock
--   or a pharmacy delivery had no record, and the batch or roll it created could not
--   be traced back to who supplied it. stock_lots has carried an unused supplier_id
--   since 076; this is what fills it.
--
--   One purchase does three things at once, so they cannot drift apart:
--     1. records what was bought and at what cost
--     2. receives each line into stock via receive_stock_lot, so a batch, roll or
--        serial arrives already carrying its supplier and unit cost
--     3. optionally records the matching expense, linked back to the purchase
--
--   Schema, permissions, RLS and functions are in one file deliberately: they are
--   one concern here, and splitting them across four files would make the receiving
--   logic harder to review than it is to read.
-- Author: TrackOja Team
-- Date: 2026-09-26

-- ============================================================
-- TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  reference TEXT,
  purchased_on DATE NOT NULL DEFAULT current_date,
  total NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  currency TEXT NOT NULL DEFAULT 'NGN',
  payment_method TEXT
    CHECK (payment_method IS NULL OR payment_method IN ('cash', 'transfer', 'card', 'credit', 'other')),
  notes TEXT,
  -- The expense this purchase created, when one was requested.
  expense_id UUID REFERENCES public.expenses(id) ON DELETE SET NULL,
  recorded_by UUID NOT NULL REFERENCES public.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchases_store_date ON public.purchases(store_id, purchased_on DESC);
CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON public.purchases(supplier_id) WHERE supplier_id IS NOT NULL;

COMMENT ON COLUMN public.purchases.expense_id IS
  'Set when the purchase also recorded an expense, so restocking cost appears in expense reporting exactly once.';

CREATE TABLE IF NOT EXISTS public.purchase_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id UUID NOT NULL REFERENCES public.purchases(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  description TEXT,
  quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(14,2) NOT NULL CHECK (unit_cost >= 0),
  line_total NUMERIC(14,2) NOT NULL CHECK (line_total >= 0),
  -- The lot this line created, when it was received into identified stock.
  lot_id UUID REFERENCES public.stock_lots(id) ON DELETE SET NULL,
  lot_identifier TEXT,
  unit_of_measure TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON public.purchase_items(purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_lot ON public.purchase_items(lot_id) WHERE lot_id IS NOT NULL;

COMMENT ON TABLE public.purchase_items IS
  'One line per product bought. lot_id links the line to the batch, roll or serial it created, '
  'which is how a batch can be traced back to the delivery it arrived in.';

-- ============================================================
-- PERMISSIONS
-- ============================================================

INSERT INTO public.permissions (name, resource, action, description, category) VALUES
  ('purchase:view',   'purchases', 'read',   'View purchases and what was received from suppliers', 'purchases'),
  ('purchase:create', 'purchases', 'create', 'Record a purchase and receive its stock',              'purchases')
ON CONFLICT (name) DO NOTHING;

-- Owner and Manager hold everything via the wildcard seeds, but those are snapshots
-- taken when they ran, so new permissions need explicit grants. Same fix as 049.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r
JOIN public.permissions p ON TRUE
WHERE r.name IN ('owner', 'manager') AND r.is_system = TRUE
  AND p.name IN ('purchase:view', 'purchase:create')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- An inventory officer receives deliveries but does not see cost or supplier terms.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r
JOIN public.permissions p ON TRUE
WHERE r.name = 'inventory_officer' AND r.is_system = TRUE
  AND p.name = 'purchase:view'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================================================
-- UPDATED_AT + RLS
-- ============================================================

DROP TRIGGER IF EXISTS handle_updated_at_purchases ON public.purchases;
CREATE TRIGGER handle_updated_at_purchases BEFORE UPDATE ON public.purchases
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS purchases_select ON public.purchases;
CREATE POLICY purchases_select ON public.purchases
  FOR SELECT TO authenticated
  USING (
    store_id IN (SELECT public.get_user_active_store_ids(auth.uid()))
    AND public.user_has_permission(auth.uid(), store_id, 'purchase:view')
  );

DROP POLICY IF EXISTS purchase_items_select ON public.purchase_items;
CREATE POLICY purchase_items_select ON public.purchase_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.purchases p
      WHERE p.id = purchase_id
        AND p.store_id IN (SELECT public.get_user_active_store_ids(auth.uid()))
        AND public.user_has_permission(auth.uid(), p.store_id, 'purchase:view')
    )
  );

-- ============================================================
-- RECORD A PURCHASE AND RECEIVE ITS STOCK
-- ============================================================
-- p_items: jsonb array of
--   { productId, quantity, unitCost,
--     lotType? ('batch'|'roll'|'serial'|'bulk'), identifier?, expiryDate?, unit? }

CREATE OR REPLACE FUNCTION public.record_purchase(
  p_store_id UUID,
  p_items JSONB,
  p_supplier_id UUID DEFAULT NULL,
  p_purchased_on DATE DEFAULT NULL,
  p_payment_method TEXT DEFAULT NULL,
  p_reference TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_record_expense BOOLEAN DEFAULT TRUE
)
RETURNS public.purchases
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_purchase public.purchases;
  v_item JSONB;
  v_product UUID;
  v_qty NUMERIC;
  v_unit_cost NUMERIC;
  v_line_total NUMERIC;
  v_total NUMERIC := 0;
  v_lot public.stock_lots;
  v_expense public.expenses;
  v_purchased DATE := COALESCE(p_purchased_on, current_date);
  v_lot_type TEXT;
  v_identifier TEXT;
  v_expiry DATE;
  v_unit TEXT;
  v_receives_stock BOOLEAN;
  v_product_name TEXT;
  v_expense_id UUID := NULL;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT public.user_has_permission(v_actor, p_store_id, 'purchase:create') THEN
    RAISE EXCEPTION 'Permission denied: purchase:create required';
  END IF;
  -- Receiving into a lot adjusts stock, so that permission is required too.
  IF NOT public.user_has_permission(v_actor, p_store_id, 'inventory:adjust') THEN
    RAISE EXCEPTION 'Permission denied: inventory:adjust required to receive purchased stock';
  END IF;
  IF v_purchased > current_date THEN
    RAISE EXCEPTION 'A purchase cannot be dated in the future';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'A purchase needs at least one item';
  END IF;
  IF p_supplier_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.suppliers s WHERE s.id = p_supplier_id AND s.store_id = p_store_id
  ) THEN
    RAISE EXCEPTION 'That supplier belongs to a different store';
  END IF;

  -- Validate every line and total it before writing anything, so a bad line cannot
  -- leave a half-received delivery behind.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product := (v_item ->> 'productId')::UUID;
    v_qty := (v_item ->> 'quantity')::NUMERIC;
    v_unit_cost := COALESCE((v_item ->> 'unitCost')::NUMERIC, 0);

    IF v_product IS NULL THEN
      RAISE EXCEPTION 'Every purchase line needs a product';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.products pr WHERE pr.id = v_product AND pr.store_id = p_store_id) THEN
      RAISE EXCEPTION 'Product % is not in this store', v_product;
    END IF;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Every purchase line needs a quantity greater than zero';
    END IF;
    IF v_unit_cost < 0 THEN
      RAISE EXCEPTION 'A unit cost cannot be negative';
    END IF;

    v_total := v_total + round(v_qty * v_unit_cost, 2);
  END LOOP;

  INSERT INTO public.purchases (
    store_id, supplier_id, reference, purchased_on, total, payment_method, notes, recorded_by
  ) VALUES (
    p_store_id, p_supplier_id, p_reference, v_purchased, v_total, p_payment_method, p_notes, v_actor
  )
  RETURNING * INTO v_purchase;

  -- Receive each line. A line with a lot type becomes identified stock (a batch,
  -- roll or serial) carrying its supplier and unit cost; a plain line is ordinary
  -- quantity stock and only the cost is recorded.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product := (v_item ->> 'productId')::UUID;
    v_qty := (v_item ->> 'quantity')::NUMERIC;
    v_unit_cost := COALESCE((v_item ->> 'unitCost')::NUMERIC, 0);
    v_line_total := round(v_qty * v_unit_cost, 2);
    v_lot_type := NULLIF(trim(COALESCE(v_item ->> 'lotType', '')), '');
    v_identifier := NULLIF(trim(COALESCE(v_item ->> 'identifier', '')), '');
    v_unit := NULLIF(trim(COALESCE(v_item ->> 'unit', '')), '');
    v_expiry := NULLIF(trim(COALESCE(v_item ->> 'expiryDate', '')), '')::DATE;
    v_receives_stock := v_lot_type IS NOT NULL AND v_lot_type <> 'bulk';
    v_lot := NULL;
    v_product_name := NULL;

    IF v_receives_stock THEN
      v_lot := public.receive_stock_lot(
        p_store_id := p_store_id,
        p_product_id := v_product,
        p_lot_type := v_lot_type,
        p_quantity := v_qty,
        p_unit_of_measure := v_unit,
        p_identifier := v_identifier,
        p_expiry_date := v_expiry,
        p_cost_per_unit := v_unit_cost,
        p_supplier_id := p_supplier_id,
        p_notes := format('Purchase %s', COALESCE(p_reference, left(v_purchase.id::text, 8)))
      );
      SELECT pr.name INTO v_product_name FROM public.products pr WHERE pr.id = v_product;
    END IF;

    INSERT INTO public.purchase_items (
      purchase_id, product_id, description, quantity, unit_cost, line_total,
      lot_id, lot_identifier, unit_of_measure
    ) VALUES (
      v_purchase.id, v_product, v_product_name, v_qty, v_unit_cost, v_line_total,
      v_lot.id, COALESCE(v_lot.identifier, v_identifier), COALESCE(v_lot.unit_of_measure, v_unit)
    );
  END LOOP;

  -- Restocking cost appears in expense reporting, once, linked back to this purchase.
  IF p_record_expense AND v_total > 0 THEN
    v_expense := public.create_expense(
      p_store_id := p_store_id,
      p_description := COALESCE(NULLIF(trim(p_reference), ''), 'Stock purchase'),
      p_amount := v_total,
      p_category := 'stock',
      p_spent_on := v_purchased,
      p_payment_method := p_payment_method,
      p_supplier_id := p_supplier_id,
      p_reference := p_reference,
      p_notes := format('Received against purchase %s', left(v_purchase.id::text, 8))
    );
    v_expense_id := v_expense.id;
    UPDATE public.purchases SET expense_id = v_expense_id WHERE id = v_purchase.id;
    v_purchase.expense_id := v_expense_id;
  END IF;

  INSERT INTO public.audit_logs (actor_id, store_id, action, resource_type, resource_id, status, details)
  VALUES (v_actor, p_store_id, 'PURCHASE_RECORDED', 'purchase', v_purchase.id, 'success',
          jsonb_build_object('total', v_total, 'supplier_id', p_supplier_id,
                             'lines', jsonb_array_length(p_items), 'expense_id', v_expense_id));

  RETURN v_purchase;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_purchase(UUID, JSONB, UUID, DATE, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_purchases(
  p_store_id UUID,
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL,
  p_supplier_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
  id UUID,
  reference TEXT,
  purchased_on DATE,
  total NUMERIC,
  currency TEXT,
  supplier_id UUID,
  supplier_name TEXT,
  line_count BIGINT,
  lots_received BIGINT,
  expense_id UUID,
  recorded_by_email TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_has_permission(auth.uid(), p_store_id, 'purchase:view') THEN
    RAISE EXCEPTION 'Permission denied: purchase:view required';
  END IF;

  RETURN QUERY
  SELECT p.id, p.reference, p.purchased_on, p.total, p.currency,
         p.supplier_id, s.name,
         (SELECT COUNT(*) FROM public.purchase_items pi WHERE pi.purchase_id = p.id),
         (SELECT COUNT(*) FROM public.purchase_items pi WHERE pi.purchase_id = p.id AND pi.lot_id IS NOT NULL),
         p.expense_id, u.email, p.created_at
  FROM public.purchases p
  LEFT JOIN public.suppliers s ON s.id = p.supplier_id
  LEFT JOIN public.users u ON u.id = p.recorded_by
  WHERE p.store_id = p_store_id
    AND (p_from IS NULL OR p.purchased_on >= p_from)
    AND (p_to IS NULL OR p.purchased_on <= p_to)
    AND (p_supplier_id IS NULL OR p.supplier_id = p_supplier_id)
  ORDER BY p.purchased_on DESC, p.created_at DESC
  LIMIT COALESCE(p_limit, 100);
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_purchases(UUID, DATE, DATE, UUID, INTEGER) TO authenticated;
