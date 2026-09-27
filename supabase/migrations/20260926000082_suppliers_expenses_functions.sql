-- Migration: 082_suppliers_expenses_functions.sql
-- Description: Permission-checked operations for suppliers and expenses. Every
--   write re-checks the permission in the database, so hiding a UI control is never
--   the control. Amounts are validated server-side and money stays NUMERIC.
-- Author: TrackOja Team
-- Date: 2026-09-26

-- ============================================================
-- EXPENSES
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_expense(
  p_store_id UUID,
  p_description TEXT,
  p_amount NUMERIC,
  p_category TEXT DEFAULT 'other',
  p_spent_on DATE DEFAULT NULL,
  p_payment_method TEXT DEFAULT NULL,
  p_supplier_id UUID DEFAULT NULL,
  p_reference TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS public.expenses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_row public.expenses;
  v_spent DATE := COALESCE(p_spent_on, current_date);
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT public.user_has_permission(v_actor, p_store_id, 'expense:create') THEN
    RAISE EXCEPTION 'Permission denied: expense:create required';
  END IF;

  IF p_description IS NULL OR length(trim(p_description)) = 0 THEN
    RAISE EXCEPTION 'Describe what the expense was for';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'An expense amount must be greater than zero';
  END IF;
  -- An expense dated in the future would land in a reporting period that has not
  -- happened yet and distort the figures.
  IF v_spent > current_date THEN
    RAISE EXCEPTION 'An expense cannot be dated in the future';
  END IF;
  IF p_payment_method IS NOT NULL
     AND p_payment_method NOT IN ('cash', 'transfer', 'card', 'credit', 'other') THEN
    RAISE EXCEPTION 'Unknown payment method: %', p_payment_method;
  END IF;

  -- A supplier from another store must never be attachable.
  IF p_supplier_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.suppliers s WHERE s.id = p_supplier_id AND s.store_id = p_store_id
    ) THEN
      RAISE EXCEPTION 'That supplier belongs to a different store';
    END IF;
  END IF;

  INSERT INTO public.expenses (
    store_id, description, category, amount, spent_on, payment_method,
    supplier_id, reference, notes, recorded_by
  ) VALUES (
    p_store_id, trim(p_description), COALESCE(NULLIF(trim(p_category), ''), 'other'),
    round(p_amount, 2), v_spent, p_payment_method,
    p_supplier_id, p_reference, p_notes, v_actor
  )
  RETURNING * INTO v_row;

  INSERT INTO public.audit_logs (actor_id, store_id, action, resource_type, resource_id, status, details)
  VALUES (v_actor, p_store_id, 'EXPENSE_RECORDED', 'expense', v_row.id, 'success',
          jsonb_build_object('amount', v_row.amount, 'category', v_row.category, 'spent_on', v_row.spent_on));

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_expense(UUID, TEXT, NUMERIC, TEXT, DATE, TEXT, UUID, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_expense(
  p_expense_id UUID,
  p_description TEXT DEFAULT NULL,
  p_amount NUMERIC DEFAULT NULL,
  p_category TEXT DEFAULT NULL,
  p_spent_on DATE DEFAULT NULL,
  p_payment_method TEXT DEFAULT NULL
)
RETURNS public.expenses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_existing public.expenses;
  v_row public.expenses;
BEGIN
  SELECT * INTO v_existing FROM public.expenses WHERE id = p_expense_id;
  IF v_existing.id IS NULL THEN
    RAISE EXCEPTION 'Expense not found';
  END IF;
  IF NOT public.user_has_permission(v_actor, v_existing.store_id, 'expense:update') THEN
    RAISE EXCEPTION 'Permission denied: expense:update required';
  END IF;
  IF p_amount IS NOT NULL AND p_amount <= 0 THEN
    RAISE EXCEPTION 'An expense amount must be greater than zero';
  END IF;
  IF p_spent_on IS NOT NULL AND p_spent_on > current_date THEN
    RAISE EXCEPTION 'An expense cannot be dated in the future';
  END IF;
  IF p_description IS NOT NULL AND length(trim(p_description)) = 0 THEN
    RAISE EXCEPTION 'Describe what the expense was for';
  END IF;

  UPDATE public.expenses
  SET description = COALESCE(NULLIF(trim(p_description), ''), description),
      amount = COALESCE(round(p_amount, 2), amount),
      category = COALESCE(NULLIF(trim(p_category), ''), category),
      spent_on = COALESCE(p_spent_on, spent_on),
      payment_method = COALESCE(p_payment_method, payment_method)
  WHERE id = p_expense_id
  RETURNING * INTO v_row;

  INSERT INTO public.audit_logs (actor_id, store_id, action, resource_type, resource_id, status, details)
  VALUES (v_actor, v_row.store_id, 'EXPENSE_UPDATED', 'expense', v_row.id, 'success',
          jsonb_build_object('before', jsonb_build_object('amount', v_existing.amount, 'category', v_existing.category),
                             'after', jsonb_build_object('amount', v_row.amount, 'category', v_row.category)));

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_expense(UUID, TEXT, NUMERIC, TEXT, DATE, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_expense(p_expense_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_existing public.expenses;
BEGIN
  SELECT * INTO v_existing FROM public.expenses WHERE id = p_expense_id;
  IF v_existing.id IS NULL THEN
    RAISE EXCEPTION 'Expense not found';
  END IF;
  IF NOT public.user_has_permission(v_actor, v_existing.store_id, 'expense:delete') THEN
    RAISE EXCEPTION 'Permission denied: expense:delete required';
  END IF;

  DELETE FROM public.expenses WHERE id = p_expense_id;

  -- The deletion is recorded after the row is gone, so the audit trail outlives it.
  INSERT INTO public.audit_logs (actor_id, store_id, action, resource_type, resource_id, status, details)
  VALUES (v_actor, v_existing.store_id, 'EXPENSE_DELETED', 'expense', v_existing.id, 'success',
          jsonb_build_object('amount', v_existing.amount, 'description', v_existing.description,
                             'spent_on', v_existing.spent_on));
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_expense(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_expenses(
  p_store_id UUID,
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL,
  p_category TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
  id UUID,
  description TEXT,
  category TEXT,
  amount NUMERIC,
  currency TEXT,
  spent_on DATE,
  payment_method TEXT,
  supplier_id UUID,
  supplier_name TEXT,
  reference TEXT,
  recorded_by_email TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_has_permission(auth.uid(), p_store_id, 'expense:view') THEN
    RAISE EXCEPTION 'Permission denied: expense:view required';
  END IF;

  RETURN QUERY
  SELECT e.id, e.description, e.category, e.amount, e.currency, e.spent_on,
         e.payment_method, e.supplier_id, s.name, e.reference, u.email, e.created_at
  FROM public.expenses e
  LEFT JOIN public.suppliers s ON s.id = e.supplier_id
  LEFT JOIN public.users u ON u.id = e.recorded_by
  WHERE e.store_id = p_store_id
    AND (p_from IS NULL OR e.spent_on >= p_from)
    AND (p_to IS NULL OR e.spent_on <= p_to)
    AND (p_category IS NULL OR e.category = p_category)
  ORDER BY e.spent_on DESC, e.created_at DESC
  LIMIT COALESCE(p_limit, 100);
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_expenses(UUID, DATE, DATE, TEXT, INTEGER) TO authenticated;

/** Totals per category over a period, for the dashboard and the expense report. */
CREATE OR REPLACE FUNCTION public.expense_summary(
  p_store_id UUID,
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL
)
RETURNS TABLE (category TEXT, total NUMERIC, entry_count BIGINT, share NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_grand NUMERIC;
BEGIN
  IF NOT public.user_has_permission(auth.uid(), p_store_id, 'expense:view') THEN
    RAISE EXCEPTION 'Permission denied: expense:view required';
  END IF;

  SELECT COALESCE(SUM(e.amount), 0) INTO v_grand
  FROM public.expenses e
  WHERE e.store_id = p_store_id
    AND (p_from IS NULL OR e.spent_on >= p_from)
    AND (p_to IS NULL OR e.spent_on <= p_to);

  RETURN QUERY
  SELECT e.category,
         SUM(e.amount)::NUMERIC,
         COUNT(*)::BIGINT,
         CASE WHEN v_grand > 0 THEN round((SUM(e.amount) / v_grand) * 100, 1) ELSE 0 END
  FROM public.expenses e
  WHERE e.store_id = p_store_id
    AND (p_from IS NULL OR e.spent_on >= p_from)
    AND (p_to IS NULL OR e.spent_on <= p_to)
  GROUP BY e.category
  ORDER BY SUM(e.amount) DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.expense_summary(UUID, DATE, DATE) TO authenticated;

-- ============================================================
-- SUPPLIERS
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_supplier(
  p_store_id UUID,
  p_name TEXT,
  p_contact_name TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_address TEXT DEFAULT NULL,
  p_payment_terms TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS public.suppliers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_row public.suppliers;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT public.user_has_permission(v_actor, p_store_id, 'supplier:create') THEN
    RAISE EXCEPTION 'Permission denied: supplier:create required';
  END IF;
  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'A supplier needs a name';
  END IF;

  -- Case-insensitive uniqueness, so a duplicate is reported clearly instead of
  -- surfacing as a raw constraint error.
  IF EXISTS (
    SELECT 1 FROM public.suppliers s
    WHERE s.store_id = p_store_id AND lower(s.name) = lower(trim(p_name))
  ) THEN
    RAISE EXCEPTION 'You already have a supplier called %', trim(p_name);
  END IF;

  INSERT INTO public.suppliers (
    store_id, name, contact_name, phone, email, address, payment_terms, notes, created_by
  ) VALUES (
    p_store_id, trim(p_name), p_contact_name, p_phone, p_email, p_address, p_payment_terms, p_notes, v_actor
  )
  RETURNING * INTO v_row;

  INSERT INTO public.audit_logs (actor_id, store_id, action, resource_type, resource_id, status, details)
  VALUES (v_actor, p_store_id, 'SUPPLIER_ADDED', 'supplier', v_row.id, 'success',
          jsonb_build_object('name', v_row.name));

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_supplier(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_supplier(
  p_supplier_id UUID,
  p_name TEXT DEFAULT NULL,
  p_contact_name TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_address TEXT DEFAULT NULL,
  p_payment_terms TEXT DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS public.suppliers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_existing public.suppliers;
  v_row public.suppliers;
BEGIN
  SELECT * INTO v_existing FROM public.suppliers WHERE id = p_supplier_id;
  IF v_existing.id IS NULL THEN
    RAISE EXCEPTION 'Supplier not found';
  END IF;
  IF NOT public.user_has_permission(v_actor, v_existing.store_id, 'supplier:update') THEN
    RAISE EXCEPTION 'Permission denied: supplier:update required';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('active', 'inactive') THEN
    RAISE EXCEPTION 'Invalid supplier status: %', p_status;
  END IF;
  IF p_name IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.suppliers s
    WHERE s.store_id = v_existing.store_id
      AND lower(s.name) = lower(trim(p_name))
      AND s.id <> p_supplier_id
  ) THEN
    RAISE EXCEPTION 'You already have a supplier called %', trim(p_name);
  END IF;

  UPDATE public.suppliers
  SET name = COALESCE(NULLIF(trim(p_name), ''), name),
      contact_name = COALESCE(p_contact_name, contact_name),
      phone = COALESCE(p_phone, phone),
      email = COALESCE(p_email, email),
      address = COALESCE(p_address, address),
      payment_terms = COALESCE(p_payment_terms, payment_terms),
      status = COALESCE(p_status, status),
      notes = COALESCE(p_notes, notes)
  WHERE id = p_supplier_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_supplier(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_suppliers(
  p_store_id UUID,
  p_include_inactive BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  payment_terms TEXT,
  status TEXT,
  expense_total NUMERIC,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_has_permission(auth.uid(), p_store_id, 'supplier:view') THEN
    RAISE EXCEPTION 'Permission denied: supplier:view required';
  END IF;

  RETURN QUERY
  SELECT s.id, s.name, s.contact_name, s.phone, s.email, s.address, s.payment_terms,
         s.status,
         COALESCE((SELECT SUM(e.amount) FROM public.expenses e WHERE e.supplier_id = s.id), 0)::NUMERIC,
         s.created_at
  FROM public.suppliers s
  WHERE s.store_id = p_store_id
    AND (p_include_inactive OR s.status = 'active')
  ORDER BY s.name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_suppliers(UUID, BOOLEAN) TO authenticated;
