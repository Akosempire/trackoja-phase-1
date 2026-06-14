-- Migration: 016_inventory_rls_policies.sql
-- Description: Row Level Security policies for product_categories, products, and
--   inventory_movements. Read access follows the Phase 1 pattern (any active
--   member of the store). Write access additionally requires the relevant
--   product:*/category:* permission via user_has_permission(). inventory_movements
--   has no INSERT/UPDATE/DELETE policy - rows are only written via the
--   SECURITY DEFINER apply_inventory_movement() function (append-only ledger).
-- Author: TrackOja Team
-- Date: 2026-06-13

-- ============================================================
-- PRODUCT_CATEGORIES
-- ============================================================
CREATE POLICY product_categories_select ON public.product_categories
  FOR SELECT
  USING (store_id IN (SELECT public.get_user_active_store_ids(auth.uid())));

CREATE POLICY product_categories_insert ON public.product_categories
  FOR INSERT
  WITH CHECK (
    store_id IN (SELECT public.get_user_active_store_ids(auth.uid()))
    AND public.user_has_permission(auth.uid(), store_id, 'category:create')
  );

CREATE POLICY product_categories_update ON public.product_categories
  FOR UPDATE
  USING (
    store_id IN (SELECT public.get_user_active_store_ids(auth.uid()))
    AND public.user_has_permission(auth.uid(), store_id, 'category:update')
  )
  WITH CHECK (
    store_id IN (SELECT public.get_user_active_store_ids(auth.uid()))
    AND public.user_has_permission(auth.uid(), store_id, 'category:update')
  );

CREATE POLICY product_categories_delete ON public.product_categories
  FOR DELETE
  USING (
    store_id IN (SELECT public.get_user_active_store_ids(auth.uid()))
    AND public.user_has_permission(auth.uid(), store_id, 'category:delete')
  );

-- ============================================================
-- PRODUCTS
-- ============================================================
CREATE POLICY products_select ON public.products
  FOR SELECT
  USING (store_id IN (SELECT public.get_user_active_store_ids(auth.uid())));

CREATE POLICY products_insert ON public.products
  FOR INSERT
  WITH CHECK (
    store_id IN (SELECT public.get_user_active_store_ids(auth.uid()))
    AND public.user_has_permission(auth.uid(), store_id, 'product:create')
  );

CREATE POLICY products_update ON public.products
  FOR UPDATE
  USING (
    store_id IN (SELECT public.get_user_active_store_ids(auth.uid()))
    AND public.user_has_permission(auth.uid(), store_id, 'product:update')
  )
  WITH CHECK (
    store_id IN (SELECT public.get_user_active_store_ids(auth.uid()))
    AND public.user_has_permission(auth.uid(), store_id, 'product:update')
  );

CREATE POLICY products_delete ON public.products
  FOR DELETE
  USING (
    store_id IN (SELECT public.get_user_active_store_ids(auth.uid()))
    AND public.user_has_permission(auth.uid(), store_id, 'product:delete')
  );

-- ============================================================
-- INVENTORY_MOVEMENTS (read-only from the application layer)
-- ============================================================
CREATE POLICY inventory_movements_select ON public.inventory_movements
  FOR SELECT
  USING (store_id IN (SELECT public.get_user_active_store_ids(auth.uid())));
