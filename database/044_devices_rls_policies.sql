-- Migration: 044_devices_rls_policies.sql
-- Description: Row Level Security policies for devices, device_sessions, and
--   device_transactions per PHASE_9_DEVICES.md. devices supports direct
--   RLS-gated INSERT/UPDATE (mirroring products), with select/manage split
--   between devices:view and devices:manage. device_sessions and
--   device_transactions are select-only - all writes go through the
--   SECURITY DEFINER functions in 043_devices_functions.sql.
-- Author: TrackOja Team
-- Date: 2026-06-14

-- ============================================================
-- DEVICES
-- ============================================================
CREATE POLICY devices_select ON public.devices
  FOR SELECT
  USING (
    store_id IN (SELECT public.get_user_active_store_ids(auth.uid()))
    AND public.user_has_permission(auth.uid(), store_id, 'devices:view')
  );

CREATE POLICY devices_insert ON public.devices
  FOR INSERT
  WITH CHECK (
    store_id IN (SELECT public.get_user_active_store_ids(auth.uid()))
    AND public.user_has_permission(auth.uid(), store_id, 'devices:manage')
  );

CREATE POLICY devices_update ON public.devices
  FOR UPDATE
  USING (
    store_id IN (SELECT public.get_user_active_store_ids(auth.uid()))
    AND public.user_has_permission(auth.uid(), store_id, 'devices:manage')
  )
  WITH CHECK (
    store_id IN (SELECT public.get_user_active_store_ids(auth.uid()))
    AND public.user_has_permission(auth.uid(), store_id, 'devices:manage')
  );

-- ============================================================
-- DEVICE_SESSIONS (read-only from the application layer)
-- ============================================================
CREATE POLICY device_sessions_select ON public.device_sessions
  FOR SELECT
  USING (
    store_id IN (SELECT public.get_user_active_store_ids(auth.uid()))
    AND public.user_has_permission(auth.uid(), store_id, 'devices:view')
  );

-- ============================================================
-- DEVICE_TRANSACTIONS (read-only from the application layer)
-- ============================================================
CREATE POLICY device_transactions_select ON public.device_transactions
  FOR SELECT
  USING (
    store_id IN (SELECT public.get_user_active_store_ids(auth.uid()))
    AND public.user_has_permission(auth.uid(), store_id, 'devices:view')
  );
