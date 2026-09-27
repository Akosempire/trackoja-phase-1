-- Migration: 086_material_quotes.sql
-- Description: Building materials: quotes, orders and fulfilment. Nothing exists
--   for this today, so a quote has nowhere to live and an accepted order is
--   indistinguishable from a completed sale.
--
--   The requirement that shapes this design: an accepted order is NOT a completed
--   sale and NOT a completed delivery. Those are three separate things a merchant
--   must see apart, and a delivery can be partial across several trips. So:
--     - quote status tracks the commercial state (draft..accepted..ordered..closed)
--     - per-line fulfilled_quantity tracks how much has actually gone out
--     - deliveries are their own events, so a split delivery is normal, not an edge case
--     - the balance is computed from payments, never stored
--   Status transitions are data (material_quote_transitions), same pattern as
--   tailoring, because a quote legitimately goes back a step when a price is revised.
-- Author: TrackOja Team
-- Date: 2026-09-26

-- ============================================================
-- TRANSITION RULES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.material_quote_transitions (
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  requires_reason BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (from_status, to_status)
);

INSERT INTO public.material_quote_transitions (from_status, to_status, requires_reason) VALUES
  ('draft',    'sent',                 FALSE),
  ('draft',    'cancelled',            TRUE),
  ('sent',     'accepted',             FALSE),
  ('sent',     'draft',                TRUE),   -- revising a sent quote
  ('sent',     'cancelled',            TRUE),
  ('accepted', 'ordered',              FALSE),
  ('accepted', 'sent',                 TRUE),   -- customer asks for a change before ordering
  ('accepted', 'cancelled',            TRUE),
  ('ordered',  'partially_fulfilled',  FALSE),
  ('ordered',  'fulfilled',            FALSE),
  ('ordered',  'cancelled',            TRUE),
  ('partially_fulfilled', 'fulfilled', FALSE),
  ('partially_fulfilled', 'cancelled', TRUE),   -- customer cancels what has not gone out
  ('fulfilled','closed',               FALSE)
ON CONFLICT (from_status, to_status) DO NOTHING;

-- ============================================================
-- TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.material_quote_counters (
  store_id UUID PRIMARY KEY REFERENCES public.stores(id) ON DELETE CASCADE,
  next_number INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS public.material_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  quote_number INTEGER NOT NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name TEXT,
  customer_phone TEXT,
  delivery_location TEXT,
  delivery_charge NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (delivery_charge >= 0),
  valid_until DATE,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'accepted', 'ordered', 'partially_fulfilled',
                      'fulfilled', 'closed', 'cancelled')),
  created_by UUID NOT NULL REFERENCES public.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE (store_id, quote_number)
);

CREATE INDEX IF NOT EXISTS idx_material_quotes_store_status ON public.material_quotes(store_id, status);
CREATE INDEX IF NOT EXISTS idx_material_quotes_customer ON public.material_quotes(customer_id)
  WHERE customer_id IS NOT NULL;

COMMENT ON COLUMN public.material_quotes.status IS
  'Commercial state only. Goods going out is tracked by fulfilled_quantity per line and by '
  'deliveries, so "ordered" never implies "delivered".';

CREATE TABLE IF NOT EXISTS public.material_quote_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES public.material_quotes(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  unit_of_measure TEXT NOT NULL DEFAULT 'unit',
  quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
  line_total NUMERIC(14,2) NOT NULL CHECK (line_total >= 0),
  -- How much has actually been delivered. Partial fulfilment is the normal case here.
  fulfilled_quantity NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (fulfilled_quantity >= 0),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT material_quote_items_not_over_fulfilled CHECK (fulfilled_quantity <= quantity)
);

CREATE INDEX IF NOT EXISTS idx_material_quote_items_quote ON public.material_quote_items(quote_id);

CREATE TABLE IF NOT EXISTS public.material_quote_fulfilments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES public.material_quotes(id) ON DELETE CASCADE,
  delivered_on DATE NOT NULL DEFAULT current_date,
  note TEXT,
  created_by UUID NOT NULL REFERENCES public.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_material_quote_fulfilments_quote
  ON public.material_quote_fulfilments(quote_id, delivered_on DESC);

CREATE TABLE IF NOT EXISTS public.material_quote_fulfilment_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fulfilment_id UUID NOT NULL REFERENCES public.material_quote_fulfilments(id) ON DELETE CASCADE,
  quote_item_id UUID NOT NULL REFERENCES public.material_quote_items(id) ON DELETE CASCADE,
  quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS idx_material_fulfilment_items_fulfilment
  ON public.material_quote_fulfilment_items(fulfilment_id);

CREATE TABLE IF NOT EXISTS public.material_quote_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES public.material_quotes(id) ON DELETE CASCADE,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL CHECK (method IN ('cash', 'transfer', 'card', 'credit', 'other')),
  reference TEXT,
  received_by UUID NOT NULL REFERENCES public.users(id),
  received_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_material_quote_payments_quote ON public.material_quote_payments(quote_id);

-- ============================================================
-- PERMISSIONS
-- ============================================================

INSERT INTO public.permissions (name, resource, action, description, category) VALUES
  ('quote:view',   'material_quotes', 'read',   'View quotes, orders and deliveries', 'materials'),
  ('quote:create', 'material_quotes', 'create', 'Create a quote and record payments', 'materials'),
  ('quote:update', 'material_quotes', 'update', 'Revise a quote, change status, record deliveries', 'materials')
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r
JOIN public.permissions p ON TRUE
WHERE r.name IN ('owner', 'manager') AND r.is_system = TRUE
  AND p.name IN ('quote:view', 'quote:create', 'quote:update')
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r
JOIN public.permissions p ON TRUE
WHERE r.name = 'cashier' AND r.is_system = TRUE
  AND p.name IN ('quote:view', 'quote:create')
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r
JOIN public.permissions p ON TRUE
WHERE r.name = 'inventory_officer' AND r.is_system = TRUE
  AND p.name IN ('quote:view')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================================================
-- TRIGGERS AND RLS
-- ============================================================

DROP TRIGGER IF EXISTS handle_updated_at_material_quotes ON public.material_quotes;
CREATE TRIGGER handle_updated_at_material_quotes BEFORE UPDATE ON public.material_quotes
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.material_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_quote_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_quote_fulfilments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_quote_fulfilment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_quote_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_quote_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_quote_counters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS material_quotes_select ON public.material_quotes;
CREATE POLICY material_quotes_select ON public.material_quotes
  FOR SELECT TO authenticated
  USING (
    store_id IN (SELECT public.get_user_active_store_ids(auth.uid()))
    AND public.user_has_permission(auth.uid(), store_id, 'quote:view')
  );

DROP POLICY IF EXISTS material_quote_transitions_select ON public.material_quote_transitions;
CREATE POLICY material_quote_transitions_select ON public.material_quote_transitions
  FOR SELECT TO authenticated USING (TRUE);

-- Child rows follow the parent quote's visibility.
DROP POLICY IF EXISTS material_quote_items_select ON public.material_quote_items;
CREATE POLICY material_quote_items_select ON public.material_quote_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.material_quotes q WHERE q.id = quote_id
      AND q.store_id IN (SELECT public.get_user_active_store_ids(auth.uid()))
      AND public.user_has_permission(auth.uid(), q.store_id, 'quote:view')
  ));

DROP POLICY IF EXISTS material_quote_fulfilments_select ON public.material_quote_fulfilments;
CREATE POLICY material_quote_fulfilments_select ON public.material_quote_fulfilments
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.material_quotes q WHERE q.id = quote_id
      AND q.store_id IN (SELECT public.get_user_active_store_ids(auth.uid()))
      AND public.user_has_permission(auth.uid(), q.store_id, 'quote:view')
  ));

DROP POLICY IF EXISTS material_quote_fulfilment_items_select ON public.material_quote_fulfilment_items;
CREATE POLICY material_quote_fulfilment_items_select ON public.material_quote_fulfilment_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.material_quote_fulfilments f
    JOIN public.material_quotes q ON q.id = f.quote_id
    WHERE f.id = fulfilment_id
      AND q.store_id IN (SELECT public.get_user_active_store_ids(auth.uid()))
      AND public.user_has_permission(auth.uid(), q.store_id, 'quote:view')
  ));

DROP POLICY IF EXISTS material_quote_payments_select ON public.material_quote_payments;
CREATE POLICY material_quote_payments_select ON public.material_quote_payments
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.material_quotes q WHERE q.id = quote_id
      AND q.store_id IN (SELECT public.get_user_active_store_ids(auth.uid()))
      AND public.user_has_permission(auth.uid(), q.store_id, 'quote:view')
  ));
