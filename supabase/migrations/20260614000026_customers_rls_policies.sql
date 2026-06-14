-- Migration: 026_customers_rls_policies.sql
-- Description: Row Level Security policies for customers and the customer
--   credit/loyalty ledgers. customers follows the products pattern (per-action
--   permission checks via user_has_permission). The ledgers are read-only from
--   the application layer - rows are only written via create_sale/void_sale/
--   adjust_customer_credit/adjust_customer_loyalty (SECURITY DEFINER).
-- Author: TrackOja Team
-- Date: 2026-06-14

-- ============================================================
-- CUSTOMERS
-- ============================================================
CREATE POLICY customers_select ON public.customers
  FOR SELECT
  USING (
    store_id IN (SELECT public.get_user_active_store_ids(auth.uid()))
    AND public.user_has_permission(auth.uid(), store_id, 'customer:view')
  );

CREATE POLICY customers_insert ON public.customers
  FOR INSERT
  WITH CHECK (
    store_id IN (SELECT public.get_user_active_store_ids(auth.uid()))
    AND public.user_has_permission(auth.uid(), store_id, 'customer:create')
  );

CREATE POLICY customers_update ON public.customers
  FOR UPDATE
  USING (
    store_id IN (SELECT public.get_user_active_store_ids(auth.uid()))
    AND public.user_has_permission(auth.uid(), store_id, 'customer:update')
  )
  WITH CHECK (
    store_id IN (SELECT public.get_user_active_store_ids(auth.uid()))
    AND public.user_has_permission(auth.uid(), store_id, 'customer:update')
  );

CREATE POLICY customers_delete ON public.customers
  FOR DELETE
  USING (
    store_id IN (SELECT public.get_user_active_store_ids(auth.uid()))
    AND public.user_has_permission(auth.uid(), store_id, 'customer:delete')
  );

-- ============================================================
-- CUSTOMER_CREDIT_TRANSACTIONS (read-only from the application layer)
-- ============================================================
CREATE POLICY customer_credit_transactions_select ON public.customer_credit_transactions
  FOR SELECT
  USING (
    store_id IN (SELECT public.get_user_active_store_ids(auth.uid()))
    AND public.user_has_permission(auth.uid(), store_id, 'customer:view')
  );

-- ============================================================
-- CUSTOMER_LOYALTY_TRANSACTIONS (read-only from the application layer)
-- ============================================================
CREATE POLICY customer_loyalty_transactions_select ON public.customer_loyalty_transactions
  FOR SELECT
  USING (
    store_id IN (SELECT public.get_user_active_store_ids(auth.uid()))
    AND public.user_has_permission(auth.uid(), store_id, 'customer:view')
  );
