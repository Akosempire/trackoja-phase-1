-- Migration: 040_payments_audit_triggers.sql
-- Description: Database-layer audit logging for Phase 8 payment events,
--   following the pattern established in 022_sales_audit_triggers.sql.
--   REFUND_PROCESSED fires when process_refund inserts a refunds row.
--   PAYMENT_VERIFIED fires when verify_sale_payment transitions a payment
--   from 'pending' to 'verified' or 'rejected'.
-- Author: TrackOja Team
-- Date: 2026-06-14

-- ============================================================
-- REFUND_PROCESSED (refunds insert from process_refund)
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_refund_processed_audit()
RETURNS TRIGGER AS $$
DECLARE
  v_org_id UUID;
  v_sale_number TEXT;
BEGIN
  SELECT org_id INTO v_org_id FROM public.stores WHERE id = NEW.store_id;
  SELECT sale_number INTO v_sale_number FROM public.sales WHERE id = NEW.sale_id;

  INSERT INTO public.audit_logs (actor_id, org_id, store_id, action, resource_type, resource_id, resource_name, details)
  VALUES (
    NEW.created_by, v_org_id, NEW.store_id, 'REFUND_PROCESSED', 'refund', NEW.id, v_sale_number,
    jsonb_build_object('sale_id', NEW.sale_id, 'amount', NEW.amount, 'method', NEW.method, 'reason', NEW.reason)
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_refund_processed ON public.refunds;
CREATE TRIGGER on_refund_processed
  AFTER INSERT ON public.refunds
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_refund_processed_audit();

-- ============================================================
-- PAYMENT_VERIFIED (sale_payments update from verify_sale_payment)
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_payment_verified_audit()
RETURNS TRIGGER AS $$
DECLARE
  v_org_id UUID;
  v_store_id UUID;
  v_sale_number TEXT;
BEGIN
  SELECT s.store_id, s.sale_number, st.org_id INTO v_store_id, v_sale_number, v_org_id
  FROM public.sales s
  JOIN public.stores st ON st.id = s.store_id
  WHERE s.id = NEW.sale_id;

  INSERT INTO public.audit_logs (actor_id, org_id, store_id, action, resource_type, resource_id, resource_name, changes, details)
  VALUES (
    NEW.verified_by, v_org_id, v_store_id, 'PAYMENT_VERIFIED', 'sale_payment', NEW.id, v_sale_number,
    jsonb_build_object('before', jsonb_build_object('verification_status', OLD.verification_status), 'after', jsonb_build_object('verification_status', NEW.verification_status)),
    jsonb_build_object('method', NEW.method, 'amount', NEW.amount)
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_payment_verified ON public.sale_payments;
CREATE TRIGGER on_payment_verified
  AFTER UPDATE ON public.sale_payments
  FOR EACH ROW
  WHEN (OLD.verification_status = 'pending' AND NEW.verification_status IN ('verified', 'rejected'))
  EXECUTE FUNCTION public.handle_payment_verified_audit();
