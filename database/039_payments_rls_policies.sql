-- Migration: 039_payments_rls_policies.sql
-- Description: Row Level Security policy for refunds (Phase 8). Read access
--   requires store membership plus the sales:view permission, mirroring
--   021_sales_rls_policies.sql. No INSERT/UPDATE/DELETE policies - all writes
--   happen via the SECURITY DEFINER process_refund function
--   (038_payments_functions.sql).
-- Author: TrackOja Team
-- Date: 2026-06-14

-- ============================================================
-- REFUNDS (read-only from the application layer)
-- ============================================================
CREATE POLICY refunds_select ON public.refunds
  FOR SELECT
  USING (
    store_id IN (SELECT public.get_user_active_store_ids(auth.uid()))
    AND public.user_has_permission(auth.uid(), store_id, 'sales:view')
  );
