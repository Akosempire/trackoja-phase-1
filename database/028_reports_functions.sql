-- Migration: 028_reports_functions.sql
-- Description: Phase 5 reporting functions (read-only aggregations).
--   All functions are SECURITY DEFINER / STABLE and require
--   user_has_permission(auth.uid(), p_store_id, 'reports:view') - already
--   granted to Owner, Manager, Cashier, and Inventory Officer in
--   007_seed_initial_data.sql. No new permissions, RLS policies, or audit
--   triggers are introduced (read-only, and no new tables).
--   - get_sales_summary: revenue/discount/tax/transaction totals for a date range.
--   - get_sales_by_payment_method: per-method totals for a date range.
--   - get_top_products: top N products by revenue for a date range.
--   - get_inventory_valuation: point-in-time stock value snapshot.
--   - get_customer_balances_summary: point-in-time receivables/loyalty snapshot.
-- Author: TrackOja Team
-- Date: 2026-06-14

-- ============================================================
-- GET_SALES_SUMMARY
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_sales_summary(
  p_store_id UUID,
  p_date_from TIMESTAMPTZ,
  p_date_to TIMESTAMPTZ
)
RETURNS TABLE (
  total_revenue NUMERIC,
  discount_total NUMERIC,
  tax_total NUMERIC,
  transaction_count BIGINT,
  voided_count BIGINT,
  average_sale NUMERIC
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
    COALESCE(SUM(s.total) FILTER (WHERE s.status = 'completed'), 0) AS total_revenue,
    COALESCE(SUM(s.discount_total) FILTER (WHERE s.status = 'completed'), 0) AS discount_total,
    COALESCE(SUM(s.tax_total) FILTER (WHERE s.status = 'completed'), 0) AS tax_total,
    COUNT(*) FILTER (WHERE s.status = 'completed') AS transaction_count,
    COUNT(*) FILTER (WHERE s.status = 'voided') AS voided_count,
    CASE WHEN COUNT(*) FILTER (WHERE s.status = 'completed') > 0
      THEN ROUND(SUM(s.total) FILTER (WHERE s.status = 'completed') / COUNT(*) FILTER (WHERE s.status = 'completed'), 2)
      ELSE 0
    END AS average_sale
  FROM public.sales s
  WHERE s.store_id = p_store_id
    AND s.created_at >= p_date_from
    AND s.created_at < p_date_to;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_sales_summary(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

-- ============================================================
-- GET_SALES_BY_PAYMENT_METHOD
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_sales_by_payment_method(
  p_store_id UUID,
  p_date_from TIMESTAMPTZ,
  p_date_to TIMESTAMPTZ
)
RETURNS TABLE (
  method TEXT,
  amount NUMERIC,
  transaction_count BIGINT
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
    sp.method,
    SUM(sp.amount) AS amount,
    COUNT(*) AS transaction_count
  FROM public.sale_payments sp
  JOIN public.sales s ON s.id = sp.sale_id
  WHERE s.store_id = p_store_id
    AND s.status = 'completed'
    AND s.created_at >= p_date_from
    AND s.created_at < p_date_to
  GROUP BY sp.method
  ORDER BY SUM(sp.amount) DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_sales_by_payment_method(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

-- ============================================================
-- GET_TOP_PRODUCTS
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_top_products(
  p_store_id UUID,
  p_date_from TIMESTAMPTZ,
  p_date_to TIMESTAMPTZ,
  p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
  product_id UUID,
  product_name TEXT,
  sku TEXT,
  quantity_sold NUMERIC,
  revenue NUMERIC
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
    si.product_id,
    si.product_name,
    si.sku,
    SUM(si.quantity) AS quantity_sold,
    SUM(si.line_total) AS revenue
  FROM public.sale_items si
  JOIN public.sales s ON s.id = si.sale_id
  WHERE s.store_id = p_store_id
    AND s.status = 'completed'
    AND s.created_at >= p_date_from
    AND s.created_at < p_date_to
  GROUP BY si.product_id, si.product_name, si.sku
  ORDER BY SUM(si.line_total) DESC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_top_products(UUID, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER) TO authenticated;

-- ============================================================
-- GET_INVENTORY_VALUATION
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_inventory_valuation(
  p_store_id UUID
)
RETURNS TABLE (
  product_count BIGINT,
  total_stock_qty NUMERIC,
  total_cost_value NUMERIC,
  total_retail_value NUMERIC,
  low_stock_count BIGINT
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
    COUNT(*) AS product_count,
    COALESCE(SUM(p.stock_qty), 0) AS total_stock_qty,
    COALESCE(SUM(p.stock_qty * p.cost_price), 0) AS total_cost_value,
    COALESCE(SUM(p.stock_qty * p.selling_price), 0) AS total_retail_value,
    COUNT(*) FILTER (WHERE p.stock_qty <= p.reorder_level) AS low_stock_count
  FROM public.products p
  WHERE p.store_id = p_store_id
    AND p.track_inventory = TRUE
    AND p.status = 'active';
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_inventory_valuation(UUID) TO authenticated;

-- ============================================================
-- GET_CUSTOMER_BALANCES_SUMMARY
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_customer_balances_summary(
  p_store_id UUID
)
RETURNS TABLE (
  total_receivables NUMERIC,
  customers_with_balance BIGINT,
  total_loyalty_points BIGINT
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
    COALESCE(SUM(c.balance), 0) AS total_receivables,
    COUNT(*) FILTER (WHERE c.balance > 0) AS customers_with_balance,
    COALESCE(SUM(c.loyalty_points), 0)::BIGINT AS total_loyalty_points
  FROM public.customers c
  WHERE c.store_id = p_store_id
    AND c.is_active = TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_balances_summary(UUID) TO authenticated;
