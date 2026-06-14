-- Migration: 027_customers_audit_triggers.sql
-- Description: Database-layer audit logging for Phase 4 customer events, following
--   the pattern established in 011_audit_log_triggers.sql / 017_inventory_audit_triggers.sql.
--   Covers CUSTOMER_CREATED, CUSTOMER_UPDATED, CUSTOMER_DELETED,
--   CUSTOMER_CREDIT_ADJUSTED (manual payment/adjustment), and
--   CUSTOMER_LOYALTY_ADJUSTED (manual redeem/adjustment). Sale-driven ledger
--   entries (sale_credit, sale_void, earn, void) are covered by SALE_CREATED/
--   SALE_VOIDED and are not separately audited here.
-- Author: TrackOja Team
-- Date: 2026-06-14

-- ============================================================
-- CUSTOMER_CREATED (customers insert)
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_customer_created_audit()
RETURNS TRIGGER AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT org_id INTO v_org_id FROM public.stores WHERE id = NEW.store_id;

  INSERT INTO public.audit_logs (actor_id, org_id, store_id, action, resource_type, resource_id, resource_name, details)
  VALUES (NEW.created_by, v_org_id, NEW.store_id, 'CUSTOMER_CREATED', 'customer', NEW.id, NEW.name, to_jsonb(NEW));

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_customer_created ON public.customers;
CREATE TRIGGER on_customer_created
  AFTER INSERT ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_customer_created_audit();

-- ============================================================
-- CUSTOMER_UPDATED (customers update)
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_customer_updated_audit()
RETURNS TRIGGER AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT org_id INTO v_org_id FROM public.stores WHERE id = NEW.store_id;

  INSERT INTO public.audit_logs (actor_id, org_id, store_id, action, resource_type, resource_id, resource_name, changes)
  VALUES (
    auth.uid(), v_org_id, NEW.store_id, 'CUSTOMER_UPDATED', 'customer', NEW.id, NEW.name,
    jsonb_build_object('before', to_jsonb(OLD) - 'updated_at', 'after', to_jsonb(NEW) - 'updated_at')
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_customer_updated ON public.customers;
CREATE TRIGGER on_customer_updated
  AFTER UPDATE ON public.customers
  FOR EACH ROW
  WHEN (OLD IS DISTINCT FROM NEW)
  EXECUTE FUNCTION public.handle_customer_updated_audit();

-- ============================================================
-- CUSTOMER_DELETED (customers delete)
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_customer_deleted_audit()
RETURNS TRIGGER AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT org_id INTO v_org_id FROM public.stores WHERE id = OLD.store_id;

  INSERT INTO public.audit_logs (actor_id, org_id, store_id, action, resource_type, resource_id, resource_name, details)
  VALUES (auth.uid(), v_org_id, OLD.store_id, 'CUSTOMER_DELETED', 'customer', OLD.id, OLD.name, to_jsonb(OLD));

  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_customer_deleted ON public.customers;
CREATE TRIGGER on_customer_deleted
  AFTER DELETE ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_customer_deleted_audit();

-- ============================================================
-- CUSTOMER_CREDIT_ADJUSTED (customer_credit_transactions insert - manual only)
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_customer_credit_adjusted_audit()
RETURNS TRIGGER AS $$
DECLARE
  v_org_id UUID;
  v_customer_name TEXT;
BEGIN
  SELECT s.org_id, c.name INTO v_org_id, v_customer_name
  FROM public.stores s
  JOIN public.customers c ON c.id = NEW.customer_id
  WHERE s.id = NEW.store_id;

  INSERT INTO public.audit_logs (actor_id, org_id, store_id, action, resource_type, resource_id, resource_name, details)
  VALUES (
    NEW.created_by, v_org_id, NEW.store_id, 'CUSTOMER_CREDIT_ADJUSTED', 'customer', NEW.customer_id, v_customer_name,
    jsonb_build_object(
      'type', NEW.type,
      'amount', NEW.amount,
      'balance_before', NEW.balance_before,
      'balance_after', NEW.balance_after,
      'notes', NEW.notes
    )
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_customer_credit_adjusted ON public.customer_credit_transactions;
CREATE TRIGGER on_customer_credit_adjusted
  AFTER INSERT ON public.customer_credit_transactions
  FOR EACH ROW
  WHEN (NEW.type IN ('payment', 'adjustment'))
  EXECUTE FUNCTION public.handle_customer_credit_adjusted_audit();

-- ============================================================
-- CUSTOMER_LOYALTY_ADJUSTED (customer_loyalty_transactions insert - manual only)
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_customer_loyalty_adjusted_audit()
RETURNS TRIGGER AS $$
DECLARE
  v_org_id UUID;
  v_customer_name TEXT;
BEGIN
  SELECT s.org_id, c.name INTO v_org_id, v_customer_name
  FROM public.stores s
  JOIN public.customers c ON c.id = NEW.customer_id
  WHERE s.id = NEW.store_id;

  INSERT INTO public.audit_logs (actor_id, org_id, store_id, action, resource_type, resource_id, resource_name, details)
  VALUES (
    NEW.created_by, v_org_id, NEW.store_id, 'CUSTOMER_LOYALTY_ADJUSTED', 'customer', NEW.customer_id, v_customer_name,
    jsonb_build_object(
      'type', NEW.type,
      'points', NEW.points,
      'points_before', NEW.points_before,
      'points_after', NEW.points_after,
      'notes', NEW.notes
    )
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_customer_loyalty_adjusted ON public.customer_loyalty_transactions;
CREATE TRIGGER on_customer_loyalty_adjusted
  AFTER INSERT ON public.customer_loyalty_transactions
  FOR EACH ROW
  WHEN (NEW.type IN ('redeem', 'adjustment'))
  EXECUTE FUNCTION public.handle_customer_loyalty_adjusted_audit();
