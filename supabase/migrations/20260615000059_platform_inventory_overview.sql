-- Migration: 057_platform_inventory_overview.sql
-- Description: Phase 7 platform dashboard addition.
--   get_platform_inventory_overview: cross-organization product, staff and
--   inventory-value totals for the Platform Owner dashboard. SECURITY
--   DEFINER / STABLE, requires is_platform_admin(auth.uid()).
-- Author: TrackOja Team
-- Date: 2026-06-15

CREATE OR REPLACE FUNCTION public.get_platform_inventory_overview()
RETURNS TABLE (
  total_products BIGINT,
  total_staff BIGINT,
  inventory_value_cost NUMERIC,
  inventory_value_retail NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Permission denied: platform admin required';
  END IF;

  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM public.products WHERE status != 'archived') AS total_products,
    (SELECT COUNT(*) FROM public.store_members WHERE status = 'active') AS total_staff,
    (SELECT COALESCE(SUM(stock_qty * cost_price), 0) FROM public.products WHERE status = 'active' AND track_inventory) AS inventory_value_cost,
    (SELECT COALESCE(SUM(stock_qty * selling_price), 0) FROM public.products WHERE status = 'active' AND track_inventory) AS inventory_value_retail;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_platform_inventory_overview() TO authenticated;
