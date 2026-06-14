-- Migration: 017_inventory_audit_triggers.sql
-- Description: Database-layer audit logging for Phase 2 inventory events, following
--   the pattern established in 011_audit_log_triggers.sql. Covers PRODUCT_CREATED,
--   PRODUCT_UPDATED, PRODUCT_DELETED, CATEGORY_CREATED, CATEGORY_UPDATED,
--   CATEGORY_DELETED, and STOCK_ADJUSTED (adjustment/replenishment/transfer movements).
-- Author: TrackOja Team
-- Date: 2026-06-13

-- ============================================================
-- PRODUCT_CREATED (products insert)
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_product_created_audit()
RETURNS TRIGGER AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT org_id INTO v_org_id FROM public.stores WHERE id = NEW.store_id;

  INSERT INTO public.audit_logs (actor_id, org_id, store_id, action, resource_type, resource_id, resource_name, details)
  VALUES (NEW.created_by, v_org_id, NEW.store_id, 'PRODUCT_CREATED', 'product', NEW.id, NEW.name, to_jsonb(NEW));

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_product_created ON public.products;
CREATE TRIGGER on_product_created
  AFTER INSERT ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_product_created_audit();

-- ============================================================
-- PRODUCT_UPDATED (products update)
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_product_updated_audit()
RETURNS TRIGGER AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT org_id INTO v_org_id FROM public.stores WHERE id = NEW.store_id;

  INSERT INTO public.audit_logs (actor_id, org_id, store_id, action, resource_type, resource_id, resource_name, changes)
  VALUES (
    auth.uid(), v_org_id, NEW.store_id, 'PRODUCT_UPDATED', 'product', NEW.id, NEW.name,
    jsonb_build_object('before', to_jsonb(OLD) - 'updated_at', 'after', to_jsonb(NEW) - 'updated_at')
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_product_updated ON public.products;
CREATE TRIGGER on_product_updated
  AFTER UPDATE ON public.products
  FOR EACH ROW
  WHEN (OLD IS DISTINCT FROM NEW)
  EXECUTE FUNCTION public.handle_product_updated_audit();

-- ============================================================
-- PRODUCT_DELETED (products delete)
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_product_deleted_audit()
RETURNS TRIGGER AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT org_id INTO v_org_id FROM public.stores WHERE id = OLD.store_id;

  INSERT INTO public.audit_logs (actor_id, org_id, store_id, action, resource_type, resource_id, resource_name, details)
  VALUES (auth.uid(), v_org_id, OLD.store_id, 'PRODUCT_DELETED', 'product', OLD.id, OLD.name, to_jsonb(OLD));

  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_product_deleted ON public.products;
CREATE TRIGGER on_product_deleted
  AFTER DELETE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_product_deleted_audit();

-- ============================================================
-- CATEGORY_CREATED (product_categories insert)
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_category_created_audit()
RETURNS TRIGGER AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT org_id INTO v_org_id FROM public.stores WHERE id = NEW.store_id;

  INSERT INTO public.audit_logs (actor_id, org_id, store_id, action, resource_type, resource_id, resource_name, details)
  VALUES (NEW.created_by, v_org_id, NEW.store_id, 'CATEGORY_CREATED', 'product_category', NEW.id, NEW.name, to_jsonb(NEW));

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_category_created ON public.product_categories;
CREATE TRIGGER on_category_created
  AFTER INSERT ON public.product_categories
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_category_created_audit();

-- ============================================================
-- CATEGORY_UPDATED (product_categories update)
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_category_updated_audit()
RETURNS TRIGGER AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT org_id INTO v_org_id FROM public.stores WHERE id = NEW.store_id;

  INSERT INTO public.audit_logs (actor_id, org_id, store_id, action, resource_type, resource_id, resource_name, changes)
  VALUES (
    auth.uid(), v_org_id, NEW.store_id, 'CATEGORY_UPDATED', 'product_category', NEW.id, NEW.name,
    jsonb_build_object('before', to_jsonb(OLD) - 'updated_at', 'after', to_jsonb(NEW) - 'updated_at')
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_category_updated ON public.product_categories;
CREATE TRIGGER on_category_updated
  AFTER UPDATE ON public.product_categories
  FOR EACH ROW
  WHEN (OLD IS DISTINCT FROM NEW)
  EXECUTE FUNCTION public.handle_category_updated_audit();

-- ============================================================
-- CATEGORY_DELETED (product_categories delete)
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_category_deleted_audit()
RETURNS TRIGGER AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT org_id INTO v_org_id FROM public.stores WHERE id = OLD.store_id;

  INSERT INTO public.audit_logs (actor_id, org_id, store_id, action, resource_type, resource_id, resource_name, details)
  VALUES (auth.uid(), v_org_id, OLD.store_id, 'CATEGORY_DELETED', 'product_category', OLD.id, OLD.name, to_jsonb(OLD));

  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_category_deleted ON public.product_categories;
CREATE TRIGGER on_category_deleted
  AFTER DELETE ON public.product_categories
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_category_deleted_audit();

-- ============================================================
-- STOCK_ADJUSTED (inventory_movements insert - non-sale/return types)
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_stock_adjusted_audit()
RETURNS TRIGGER AS $$
DECLARE
  v_org_id UUID;
  v_product_name TEXT;
BEGIN
  SELECT s.org_id, p.name INTO v_org_id, v_product_name
  FROM public.stores s
  JOIN public.products p ON p.id = NEW.product_id
  WHERE s.id = NEW.store_id;

  INSERT INTO public.audit_logs (actor_id, org_id, store_id, action, resource_type, resource_id, resource_name, changes, details)
  VALUES (
    NEW.created_by, v_org_id, NEW.store_id, 'STOCK_ADJUSTED', 'inventory_movement', NEW.id, v_product_name,
    jsonb_build_object(
      'movement_type', NEW.movement_type,
      'quantity', NEW.quantity,
      'quantity_before', NEW.quantity_before,
      'quantity_after', NEW.quantity_after
    ),
    jsonb_build_object('product_id', NEW.product_id, 'reason', NEW.reason, 'source_type', NEW.source_type)
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_stock_adjusted ON public.inventory_movements;
CREATE TRIGGER on_stock_adjusted
  AFTER INSERT ON public.inventory_movements
  FOR EACH ROW
  WHEN (NEW.movement_type IN ('adjustment', 'replenishment', 'transfer_in', 'transfer_out'))
  EXECUTE FUNCTION public.handle_stock_adjusted_audit();
