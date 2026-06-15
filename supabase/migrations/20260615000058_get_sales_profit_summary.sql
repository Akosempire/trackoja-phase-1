-- Migration: 056_get_sales_profit_summary.sql
-- Description: Adds get_sales_profit_summary, an estimated gross-profit
--   aggregation for a date range (revenue ex-tax and discounts, less the
--   products' current cost price). Powers the "Profit" stat on the new
--   mobile Home screen. Follows the same auth/permission pattern as the
--   other functions in 028_reports_functions.sql.
-- Author: TrackOja Team
-- Date: 2026-06-15

CREATE OR REPLACE FUNCTION public.get_sales_profit_summary(
  p_store_id UUID,
  p_date_from TIMESTAMPTZ,
  p_date_to TIMESTAMPTZ
)
RETURNS TABLE (
  gross_profit NUMERIC
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

  IF NOT public.user_has_permission(auth.uid(), p_store_id, 'reports:view') THEN
    RAISE EXCEPTION 'Permission denied: reports:view required';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(SUM(
      (si.quantity * si.unit_price - si.discount_amount) - (si.quantity * COALESCE(p.cost_price, 0))
    ), 0) AS gross_profit
  FROM public.sale_items si
  JOIN public.sales s ON s.id = si.sale_id
  LEFT JOIN public.products p ON p.id = si.product_id
  WHERE s.store_id = p_store_id
    AND s.status = 'completed'
    AND s.created_at >= p_date_from
    AND s.created_at < p_date_to;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_sales_profit_summary(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
