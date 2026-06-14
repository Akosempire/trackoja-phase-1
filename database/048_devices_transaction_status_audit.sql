-- Migration: 048_devices_transaction_status_audit.sql
-- Description: Phase 10 audit logging for device_transactions status
--   transitions, per PHASE_10_OPAY.md. Covers both
--   update_device_transaction_status() (Phase 9, auth.uid()-driven) and
--   handle_opay_webhook() (Phase 10, service_role-driven, auth.uid() IS
--   NULL - falls back to NEW.created_by as the actor).
-- Author: TrackOja Team
-- Date: 2026-06-14

CREATE OR REPLACE FUNCTION public.handle_device_transaction_status_changed_audit()
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
    COALESCE(auth.uid(), NEW.created_by), v_org_id, NEW.store_id, 'DEVICE_TRANSACTION_STATUS_CHANGED', 'device_transaction', NEW.id, v_device_name,
    jsonb_build_object('before', OLD.status, 'after', NEW.status),
    jsonb_build_object('transaction_type', NEW.transaction_type, 'external_ref', NEW.external_ref)
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_device_transaction_status_changed ON public.device_transactions;
CREATE TRIGGER on_device_transaction_status_changed
  AFTER UPDATE ON public.device_transactions
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.handle_device_transaction_status_changed_audit();
