-- Migration: 021_sales_rls_policies.sql
-- Description: Row Level Security policies for sales, sale_items, and
--   sale_payments (Phase 3). Read access requires store membership plus the
--   sales:view permission. No INSERT/UPDATE/DELETE policies exist on any of
--   these tables - all writes happen via the SECURITY DEFINER create_sale and
--   void_sale functions (020_sales_functions.sql). store_sale_counters has RLS
--   enabled with no policies (no client access; only the SECURITY DEFINER
--   functions touch it).
-- Author: TrackOja Team
-- Date: 2026-06-14

-- ============================================================
-- SALES (read-only from the application layer)
-- ============================================================
CREATE POLICY sales_select ON public.sales
  FOR SELECT
  USING (
    store_id IN (SELECT public.get_user_active_store_ids(auth.uid()))
    AND public.user_has_permission(auth.uid(), store_id, 'sales:view')
  );

-- ============================================================
-- SALE_ITEMS (read-only from the application layer)
-- ============================================================
CREATE POLICY sale_items_select ON public.sale_items
  FOR SELECT
  USING (
    sale_id IN (
      SELECT s.id FROM public.sales s
      WHERE s.store_id IN (SELECT public.get_user_active_store_ids(auth.uid()))
        AND public.user_has_permission(auth.uid(), s.store_id, 'sales:view')
    )
  );

-- ============================================================
-- SALE_PAYMENTS (read-only from the application layer)
-- ============================================================
CREATE POLICY sale_payments_select ON public.sale_payments
  FOR SELECT
  USING (
    sale_id IN (
      SELECT s.id FROM public.sales s
      WHERE s.store_id IN (SELECT public.get_user_active_store_ids(auth.uid()))
        AND public.user_has_permission(auth.uid(), s.store_id, 'sales:view')
    )
  );
