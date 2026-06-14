-- Migration: 045_devices_audit_triggers.sql
-- Description: Database-layer audit logging for Phase 9 device events, following
--   the pattern established in 011_audit_log_triggers.sql /
--   017_inventory_audit_triggers.sql. Covers DEVICE_REGISTERED,
--   DEVICE_STATUS_CHANGED, and DEVICE_TRANSACTION_RECORDED.
-- Author: TrackOja Team
-- Date: 2026-06-14

-- ============================================================
-- DEVICE_REGISTERED (devices insert)
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_device_registered_audit()
RETURNS TRIGGER AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT org_id INTO v_org_id FROM public.stores WHERE id = NEW.store_id;

  INSERT INTO public.audit_logs (actor_id, org_id, store_id, action, resource_type, resource_id, resource_name, details)
  VALUES (NEW.created_by, v_org_id, NEW.store_id, 'DEVICE_REGISTERED', 'device', NEW.id, NEW.name, to_jsonb(NEW));

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_device_registered ON public.devices;
CREATE TRIGGER on_device_registered
  AFTER INSERT ON public.devices
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_device_registered_audit();

-- ============================================================
-- DEVICE_STATUS_CHANGED (devices update where status changes)
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_device_status_changed_audit()
RETURNS TRIGGER AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT org_id INTO v_org_id FROM public.stores WHERE id = NEW.store_id;

  INSERT INTO public.audit_logs (actor_id, org_id, store_id, action, resource_type, resource_id, resource_name, changes)
  VALUES (
    auth.uid(), v_org_id, NEW.store_id, 'DEVICE_STATUS_CHANGED', 'device', NEW.id, NEW.name,
    jsonb_build_object('before', OLD.status, 'after', NEW.status)
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_device_status_changed ON public.devices;
CREATE TRIGGER on_device_status_changed
  AFTER UPDATE ON public.devices
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.handle_device_status_changed_audit();

-- ============================================================
-- DEVICE_TRANSACTION_RECORDED (device_transactions insert)
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_device_transaction_recorded_audit()
RETURNS TRIGGER AS $$
DECLARE
  v_org_id UUID;
  v_device_name TEXT;
BEGIN
  SELECT s.org_id, d.name INTO v_org_id, v_device_name
  FROM public.stores s
  JOIN public.devices d ON d.id = NEW.device_id
  WHERE s.id = NEW.store_id;

  INSERT INTO public.audit_logs (actor_id, org_id, store_id, action, resource_type, resource_id, resource_name, changes, details)
  VALUES (
    NEW.created_by, v_org_id, NEW.store_id, 'DEVICE_TRANSACTION_RECORDED', 'device_transaction', NEW.id, v_device_name,
    jsonb_build_object('transaction_type', NEW.transaction_type, 'amount', NEW.amount, 'status', NEW.status),
    jsonb_build_object('device_id', NEW.device_id, 'sale_id', NEW.sale_id)
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_device_transaction_recorded ON public.device_transactions;
CREATE TRIGGER on_device_transaction_recorded
  AFTER INSERT ON public.device_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_device_transaction_recorded_audit();
