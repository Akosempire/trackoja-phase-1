-- Migration: 043_devices_functions.sql
-- Description: Phase 9 device session and transaction functions per
--   PHASE_9_DEVICES.md. Device CRUD itself uses direct RLS-gated table access
--   (see 044_devices_rls_policies.sql), mirroring the products table. Sessions
--   and transactions go through SECURITY DEFINER functions because they have
--   side effects on the parent devices row and enforce one-way status
--   transitions.
-- Author: TrackOja Team
-- Date: 2026-06-14

-- ============================================================
-- START_DEVICE_SESSION
-- ============================================================
CREATE OR REPLACE FUNCTION public.start_device_session(p_device_id UUID)
RETURNS public.device_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device public.devices;
  v_session public.device_sessions;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_device FROM public.devices WHERE id = p_device_id;
  IF v_device IS NULL THEN
    RAISE EXCEPTION 'Device not found';
  END IF;

  IF NOT public.user_has_permission(auth.uid(), v_device.store_id, 'devices:view') THEN
    RAISE EXCEPTION 'Permission denied: devices:view required';
  END IF;

  IF v_device.status = 'decommissioned' THEN
    RAISE EXCEPTION 'Cannot start a session on a decommissioned device';
  END IF;

  INSERT INTO public.device_sessions (device_id, store_id, user_id)
  VALUES (v_device.id, v_device.store_id, auth.uid())
  RETURNING * INTO v_session;

  UPDATE public.devices SET last_seen_at = now() WHERE id = v_device.id;

  RETURN v_session;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_device_session(UUID) TO authenticated;

-- ============================================================
-- END_DEVICE_SESSION
-- ============================================================
CREATE OR REPLACE FUNCTION public.end_device_session(p_session_id UUID)
RETURNS public.device_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.device_sessions;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_session FROM public.device_sessions WHERE id = p_session_id FOR UPDATE;
  IF v_session IS NULL THEN
    RAISE EXCEPTION 'Session not found';
  END IF;

  IF v_session.status <> 'active' THEN
    RAISE EXCEPTION 'Session is not active';
  END IF;

  IF v_session.user_id <> auth.uid() AND NOT public.user_has_permission(auth.uid(), v_session.store_id, 'devices:manage') THEN
    RAISE EXCEPTION 'Permission denied: must be the session owner or hold devices:manage';
  END IF;

  UPDATE public.device_sessions
  SET status = 'ended', ended_at = now()
  WHERE id = p_session_id
  RETURNING * INTO v_session;

  RETURN v_session;
END;
$$;

GRANT EXECUTE ON FUNCTION public.end_device_session(UUID) TO authenticated;

-- ============================================================
-- RECORD_DEVICE_HEARTBEAT
-- ============================================================
CREATE OR REPLACE FUNCTION public.record_device_heartbeat(
  p_session_id UUID,
  p_battery_level INTEGER DEFAULT NULL,
  p_connectivity TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
)
RETURNS public.device_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.device_sessions;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_session FROM public.device_sessions WHERE id = p_session_id FOR UPDATE;
  IF v_session IS NULL THEN
    RAISE EXCEPTION 'Session not found';
  END IF;

  IF v_session.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Permission denied: must be the session owner';
  END IF;

  IF v_session.status <> 'active' THEN
    RAISE EXCEPTION 'Session is not active';
  END IF;

  IF p_battery_level IS NOT NULL AND (p_battery_level < 0 OR p_battery_level > 100) THEN
    RAISE EXCEPTION 'Invalid battery level: %', p_battery_level;
  END IF;

  IF p_connectivity IS NOT NULL AND p_connectivity NOT IN ('online', 'offline', 'bluetooth', 'wifi', 'cellular') THEN
    RAISE EXCEPTION 'Invalid connectivity value: %', p_connectivity;
  END IF;

  UPDATE public.device_sessions
  SET last_heartbeat_at = now(),
      metadata = COALESCE(p_metadata, metadata)
  WHERE id = p_session_id
  RETURNING * INTO v_session;

  UPDATE public.devices
  SET last_seen_at = now(),
      battery_level = COALESCE(p_battery_level, battery_level),
      connectivity = COALESCE(p_connectivity, connectivity)
  WHERE id = v_session.device_id;

  RETURN v_session;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_device_heartbeat(UUID, INTEGER, TEXT, JSONB) TO authenticated;

-- ============================================================
-- RECORD_DEVICE_TRANSACTION
-- ============================================================
CREATE OR REPLACE FUNCTION public.record_device_transaction(
  p_device_id UUID,
  p_transaction_type TEXT,
  p_amount NUMERIC DEFAULT NULL,
  p_currency TEXT DEFAULT 'NGN',
  p_session_id UUID DEFAULT NULL,
  p_sale_id UUID DEFAULT NULL,
  p_sale_payment_id UUID DEFAULT NULL,
  p_refund_id UUID DEFAULT NULL,
  p_external_ref TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
)
RETURNS public.device_transactions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device public.devices;
  v_session public.device_sessions;
  v_transaction public.device_transactions;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_device FROM public.devices WHERE id = p_device_id;
  IF v_device IS NULL THEN
    RAISE EXCEPTION 'Device not found';
  END IF;

  IF NOT public.user_has_permission(auth.uid(), v_device.store_id, 'devices:view') THEN
    RAISE EXCEPTION 'Permission denied: devices:view required';
  END IF;

  IF p_transaction_type NOT IN ('payment_request', 'payment_confirmation', 'refund', 'reconciliation', 'status_check') THEN
    RAISE EXCEPTION 'Invalid transaction type: %', p_transaction_type;
  END IF;

  IF p_session_id IS NOT NULL THEN
    SELECT * INTO v_session FROM public.device_sessions WHERE id = p_session_id;
    IF v_session IS NULL OR v_session.device_id <> p_device_id THEN
      RAISE EXCEPTION 'Session does not belong to this device';
    END IF;
  END IF;

  INSERT INTO public.device_transactions (
    device_id, store_id, session_id, sale_id, sale_payment_id, refund_id,
    transaction_type, amount, currency, external_ref, metadata, created_by
  ) VALUES (
    v_device.id, v_device.store_id, p_session_id, p_sale_id, p_sale_payment_id, p_refund_id,
    p_transaction_type, p_amount, COALESCE(p_currency, 'NGN'), p_external_ref, COALESCE(p_metadata, '{}'::jsonb), auth.uid()
  )
  RETURNING * INTO v_transaction;

  RETURN v_transaction;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_device_transaction(UUID, TEXT, NUMERIC, TEXT, UUID, UUID, UUID, UUID, TEXT, JSONB) TO authenticated;

-- ============================================================
-- UPDATE_DEVICE_TRANSACTION_STATUS
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_device_transaction_status(
  p_transaction_id UUID,
  p_status TEXT,
  p_external_ref TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
)
RETURNS public.device_transactions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transaction public.device_transactions;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_status NOT IN ('success', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid status: %', p_status;
  END IF;

  SELECT * INTO v_transaction FROM public.device_transactions WHERE id = p_transaction_id FOR UPDATE;
  IF v_transaction IS NULL THEN
    RAISE EXCEPTION 'Device transaction not found';
  END IF;

  IF NOT public.user_has_permission(auth.uid(), v_transaction.store_id, 'devices:view') THEN
    RAISE EXCEPTION 'Permission denied: devices:view required';
  END IF;

  IF v_transaction.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending transactions can be updated';
  END IF;

  UPDATE public.device_transactions
  SET status = p_status,
      external_ref = COALESCE(p_external_ref, external_ref),
      metadata = COALESCE(p_metadata, metadata),
      completed_at = now()
  WHERE id = p_transaction_id
  RETURNING * INTO v_transaction;

  RETURN v_transaction;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_device_transaction_status(UUID, TEXT, TEXT, JSONB) TO authenticated;
