-- Migration: 022_sales_audit_triggers.sql
-- Description: Database-layer audit logging for Phase 3 sale events, following
--   the pattern established in 011_audit_log_triggers.sql and
--   017_inventory_audit_triggers.sql. create_sale inserts a 'sales' shell row
--   (amount_paid = 0) and then finalizes it with computed totals in a single
--   UPDATE - SALE_CREATED fires on that finalizing UPDATE, when sale_items are
--   already present. SALE_VOIDED fires when void_sale transitions the sale to
--   'voided'.
-- Author: TrackOja Team
-- Date: 2026-06-14

-- ============================================================
-- SALE_CREATED (sales finalizing update from create_sale)
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_sale_created_audit()
RETURNS TRIGGER AS $$
DECLARE
  v_org_id UUID;
  v_item_count INTEGER;
BEGIN
  SELECT org_id INTO v_org_id FROM public.stores WHERE id = NEW.store_id;
  SELECT COUNT(*) INTO v_item_count FROM public.sale_items WHERE sale_id = NEW.id;

  INSERT INTO public.audit_logs (actor_id, org_id, store_id, action, resource_type, resource_id, resource_name, details)
  VALUES (
    NEW.created_by, v_org_id, NEW.store_id, 'SALE_CREATED', 'sale', NEW.id, NEW.sale_number,
    jsonb_build_object('sale_number', NEW.sale_number, 'total', NEW.total, 'item_count', v_item_count)
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_sale_created ON public.sales;
CREATE TRIGGER on_sale_created
  AFTER UPDATE ON public.sales
  FOR EACH ROW
  WHEN (OLD.amount_paid = 0 AND NEW.amount_paid > 0 AND NEW.status = 'completed')
  EXECUTE FUNCTION public.handle_sale_created_audit();

-- ============================================================
-- SALE_VOIDED (sales update from void_sale)
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_sale_voided_audit()
RETURNS TRIGGER AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT org_id INTO v_org_id FROM public.stores WHERE id = NEW.store_id;

  INSERT INTO public.audit_logs (actor_id, org_id, store_id, action, resource_type, resource_id, resource_name, changes, details)
  VALUES (
    NEW.voided_by, v_org_id, NEW.store_id, 'SALE_VOIDED', 'sale', NEW.id, NEW.sale_number,
    jsonb_build_object('before', jsonb_build_object('status', OLD.status), 'after', jsonb_build_object('status', NEW.status)),
    jsonb_build_object('sale_number', NEW.sale_number, 'void_reason', NEW.void_reason)
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_sale_voided ON public.sales;
CREATE TRIGGER on_sale_voided
  AFTER UPDATE ON public.sales
  FOR EACH ROW
  WHEN (OLD.status = 'completed' AND NEW.status = 'voided')
  EXECUTE FUNCTION public.handle_sale_voided_audit();
