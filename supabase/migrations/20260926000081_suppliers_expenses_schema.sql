-- Migration: 081_suppliers_expenses_schema.sql
-- Description: Suppliers and expenses. Neither exists today, so every business
--   type is missing them: a supermarket cannot record a supplier or a restock cost,
--   a pharmacy cannot track where a batch came from, and no type can report what it
--   spent. The dashboard already defines an Expenses metric for several types and
--   has had to report it as unavailable.
--
--   Supersedes the superseded product note on the marketing page: the landing page
--   correctly lists "expenses and supplier records" as upcoming, and this is the
--   change that makes it real.
-- Author: TrackOja Team
-- Date: 2026-09-26

-- ============================================================
-- SUPPLIERS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  payment_terms TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  created_by UUID NOT NULL REFERENCES public.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_suppliers_store ON public.suppliers(store_id, status);
-- One supplier per name per store, case-insensitively, so "Dangote" and "dangote"
-- do not become two records the merchant then has to reconcile.
CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_store_name
  ON public.suppliers(store_id, lower(name));

-- ============================================================
-- EXPENSES
-- ============================================================
-- amount is NUMERIC(14,2), never a float: naira amounts must not drift.

CREATE TABLE IF NOT EXISTS public.expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'NGN',
  spent_on DATE NOT NULL DEFAULT current_date,
  payment_method TEXT
    CHECK (payment_method IS NULL OR payment_method IN ('cash', 'transfer', 'card', 'credit', 'other')),
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  reference TEXT,
  notes TEXT,
  recorded_by UUID NOT NULL REFERENCES public.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expenses_store_date ON public.expenses(store_id, spent_on DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON public.expenses(store_id, category);
CREATE INDEX IF NOT EXISTS idx_expenses_supplier ON public.expenses(supplier_id)
  WHERE supplier_id IS NOT NULL;

COMMENT ON COLUMN public.expenses.spent_on IS
  'Business-local date the money was spent. Reporting windows use this, not created_at, '
  'so an expense entered late still lands in the right period.';
COMMENT ON COLUMN public.expenses.supplier_id IS
  'Optional link to the supplier paid. ON DELETE SET NULL keeps the expense if a supplier record is removed.';

-- ============================================================
-- PERMISSIONS
-- ============================================================

INSERT INTO public.permissions (name, resource, action, description, category) VALUES
  ('expense:view',    'expenses',  'read',   'View recorded expenses and expense summaries',   'expenses'),
  ('expense:create',  'expenses',  'create', 'Record a new expense',                           'expenses'),
  ('expense:update',  'expenses',  'update', 'Edit or correct a recorded expense',             'expenses'),
  ('expense:delete',  'expenses',  'delete', 'Delete a recorded expense',                      'expenses'),
  ('supplier:view',   'suppliers', 'read',   'View the supplier directory',                    'suppliers'),
  ('supplier:create', 'suppliers', 'create', 'Add a supplier',                                'suppliers'),
  ('supplier:update', 'suppliers', 'update', 'Edit a supplier',                                'suppliers')
ON CONFLICT (name) DO NOTHING;

-- Owner and Manager hold every permission via the wildcard seeds in
-- 007_seed_initial_data.sql, but those are snapshots taken when they ran, so newly
-- added permissions must be granted explicitly. Same fix as 049.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r
JOIN public.permissions p ON TRUE
WHERE r.name = 'owner' AND r.is_system = TRUE
  AND p.name IN ('expense:view', 'expense:create', 'expense:update', 'expense:delete',
                 'supplier:view', 'supplier:create', 'supplier:update')
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r
JOIN public.permissions p ON TRUE
WHERE r.name = 'manager' AND r.is_system = TRUE
  AND p.name IN ('expense:view', 'expense:create', 'expense:update',
                 'supplier:view', 'supplier:create', 'supplier:update')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- A cashier records everyday spending but cannot delete or rewrite history.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r
JOIN public.permissions p ON TRUE
WHERE r.name = 'cashier' AND r.is_system = TRUE
  AND p.name IN ('expense:view', 'expense:create', 'supplier:view')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- An inventory officer sees suppliers they buy from, but not the expense ledger.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r
JOIN public.permissions p ON TRUE
WHERE r.name = 'inventory_officer' AND r.is_system = TRUE
  AND p.name IN ('supplier:view')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================================================
-- UPDATED_AT TRIGGERS
-- ============================================================

DROP TRIGGER IF EXISTS handle_updated_at_suppliers ON public.suppliers;
CREATE TRIGGER handle_updated_at_suppliers BEFORE UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS handle_updated_at_expenses ON public.expenses;
CREATE TRIGGER handle_updated_at_expenses BEFORE UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
-- Store membership plus the matching permission, the same shape as every other
-- tenant table. Writes go through SECURITY DEFINER functions, so there are no
-- INSERT/UPDATE/DELETE policies: the permission check lives in one place.

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS suppliers_select ON public.suppliers;
CREATE POLICY suppliers_select ON public.suppliers
  FOR SELECT TO authenticated
  USING (
    store_id IN (SELECT public.get_user_active_store_ids(auth.uid()))
    AND public.user_has_permission(auth.uid(), store_id, 'supplier:view')
  );

DROP POLICY IF EXISTS expenses_select ON public.expenses;
CREATE POLICY expenses_select ON public.expenses
  FOR SELECT TO authenticated
  USING (
    store_id IN (SELECT public.get_user_active_store_ids(auth.uid()))
    AND public.user_has_permission(auth.uid(), store_id, 'expense:view')
  );
