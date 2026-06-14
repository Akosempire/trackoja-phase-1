-- Migration: 046_devices_session_token_auth.sql
-- Description: Phase 10 session_token-based device authentication per
--   PHASE_10_OPAY.md. Adds device_sessions.expires_at (set by
--   start_device_session, redefined here), and three SECURITY DEFINER
--   functions - device_heartbeat_by_token, record_device_transaction_by_token,
--   end_device_session_by_token - granted to anon/authenticated. These are
--   the session_token-authenticated counterparts of the auth.uid()-based
--   functions from 043_devices_functions.sql, for a device client (e.g. an
--   OPay terminal) calling the API directly without a Supabase user session.
-- Author: TrackOja Team
-- Date: 2026-06-14

-- ============================================================
-- DEVICE_SESSIONS.EXPIRES_AT
-- ============================================================
ALTER TABLE public.device_sessions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE;

-- ============================================================
-- START_DEVICE_SESSION (redefined to set expires_at)
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

  INSERT INTO public.device_sessions (device_id, store_id, user_id, expires_at)
  VALUES (v_device.id, v_device.store_id, auth.uid(), now() + interval '24 hours')
  RETURNING * INTO v_session;

  UPDATE public.devices SET last_seen_at = now() WHERE id = v_device.id;

  RETURN v_session;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_device_session(UUID) TO authenticated;

-- ============================================================
-- DEVICE_HEARTBEAT_BY_TOKEN
-- ============================================================
CREATE OR REPLACE FUNCTION public.device_heartbeat_by_token(
  p_session_token UUID,
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
  SELECT * INTO v_session FROM public.device_sessions WHERE session_token = p_session_token FOR UPDATE;
  IF v_session IS NULL OR v_session.status <> 'active'
     OR (v_session.expires_at IS NOT NULL AND v_session.expires_at <= now()) THEN
    RAISE EXCEPTION 'Invalid or expired session token';
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
  WHERE id = v_session.id
  RETURNING * INTO v_session;

  UPDATE public.devices
  SET last_seen_at = now(),
      battery_level = COALESCE(p_battery_level, battery_level),
      connectivity = COALESCE(p_connectivity, connectivity)
  WHERE id = v_session.device_id;

  RETURN v_session;
END;
$$;

GRANT EXECUTE ON FUNCTION public.device_heartbeat_by_token(UUID, INTEGER, TEXT, JSONB) TO anon, authenticated;

-- ============================================================
-- RECORD_DEVICE_TRANSACTION_BY_TOKEN
-- ============================================================
CREATE OR REPLACE FUNCTION public.record_device_transaction_by_token(
  p_session_token UUID,
  p_transaction_type TEXT,
  p_amount NUMERIC DEFAULT NULL,
  p_currency TEXT DEFAULT 'NGN',
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
  v_session public.device_sessions;
  v_transaction public.device_transactions;
BEGIN
  SELECT * INTO v_session FROM public.device_sessions WHERE session_token = p_session_token;
  IF v_session IS NULL OR v_session.status <> 'active'
     OR (v_session.expires_at IS NOT NULL AND v_session.expires_at <= now()) THEN
    RAISE EXCEPTION 'Invalid or expired session token';
  END IF;

  IF p_transaction_type NOT IN ('payment_request', 'payment_confirmation', 'refund', 'reconciliation', 'status_check') THEN
    RAISE EXCEPTION 'Invalid transaction type: %', p_transaction_type;
  END IF;

  INSERT INTO public.device_transactions (
    device_id, store_id, session_id, sale_id, sale_payment_id, refund_id,
    transaction_type, amount, currency, external_ref, metadata, created_by
  ) VALUES (
    v_session.device_id, v_session.store_id, v_session.id, p_sale_id, p_sale_payment_id, p_refund_id,
    p_transaction_type, p_amount, COALESCE(p_currency, 'NGN'), p_external_ref, COALESCE(p_metadata, '{}'::jsonb), v_session.user_id
  )
  RETURNING * INTO v_transaction;

  RETURN v_transaction;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_device_transaction_by_token(UUID, TEXT, NUMERIC, TEXT, UUID, UUID, UUID, TEXT, JSONB) TO anon, authenticated;

-- ============================================================
-- END_DEVICE_SESSION_BY_TOKEN
-- ============================================================
CREATE OR REPLACE FUNCTION public.end_device_session_by_token(p_session_token UUID)
RETURNS public.device_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.device_sessions;
BEGIN
  SELECT * INTO v_session FROM public.device_sessions WHERE session_token = p_session_token FOR UPDATE;
  IF v_session IS NULL OR v_session.status <> 'active'
     OR (v_session.expires_at IS NOT NULL AND v_session.expires_at <= now()) THEN
    RAISE EXCEPTION 'Invalid or expired session token';
  END IF;

  UPDATE public.device_sessions
  SET status = 'ended', ended_at = now()
  WHERE id = v_session.id
  RETURNING * INTO v_session;

  RETURN v_session;
END;
$$;

GRANT EXECUTE ON FUNCTION public.end_device_session_by_token(UUID) TO anon, authenticated;
