-- Migration: 047_opay_webhook_functions.sql
-- Description: Phase 10 OPay webhook handling per PHASE_10_OPAY.md.
--   handle_opay_webhook() is called by the opay-webhook Edge Function
--   (service_role) when OPay confirms/fails/cancels a payment_request
--   device_transaction. Resolves the device_transactions row by
--   external_ref, applies a one-way status transition (idempotent if already
--   resolved), and - for transactions linked to a sale_payments row - updates
--   that row's verification_status, reusing the Phase 8 column with no
--   further schema changes.
-- Author: TrackOja Team
-- Date: 2026-06-14

CREATE OR REPLACE FUNCTION public.handle_opay_webhook(
  p_external_ref TEXT,
  p_status TEXT,
  p_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS public.device_transactions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transaction public.device_transactions;
BEGIN
  IF p_status NOT IN ('success', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid status: %', p_status;
  END IF;

  SELECT * INTO v_transaction FROM public.device_transactions WHERE external_ref = p_external_ref FOR UPDATE;
  IF v_transaction IS NULL THEN
    RAISE EXCEPTION 'Device transaction not found for reference: %', p_external_ref;
  END IF;

  -- Idempotent: a duplicate webhook delivery for an already-resolved
  -- transaction is a no-op, not an error.
  IF v_transaction.status <> 'pending' THEN
    RETURN v_transaction;
  END IF;

  UPDATE public.device_transactions
  SET status = p_status,
      metadata = metadata || jsonb_build_object('opay_webhook', p_payload),
      completed_at = now()
  WHERE id = v_transaction.id
  RETURNING * INTO v_transaction;

  IF v_transaction.sale_payment_id IS NOT NULL AND p_status IN ('success', 'failed') THEN
    UPDATE public.sale_payments
    SET verification_status = CASE WHEN p_status = 'success' THEN 'verified' ELSE 'rejected' END,
        verified_at = now()
    WHERE id = v_transaction.sale_payment_id;
  END IF;

  RETURN v_transaction;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_opay_webhook(TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_opay_webhook(TEXT, TEXT, JSONB) TO service_role;
