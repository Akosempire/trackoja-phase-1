-- Migration: 059_restaurant_orders.sql
-- Extends the sales table with restaurant-specific order metadata:
-- order_type (dine_in / takeaway / delivery / standard),
-- order_status (new / preparing / ready / served — null for non-restaurant sales),
-- table_number (for dine-in orders).

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS order_type   TEXT DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS order_status TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS table_number TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_sales_order_status ON public.sales (store_id, order_status)
  WHERE order_status IS NOT NULL;

COMMENT ON COLUMN public.sales.order_type   IS 'standard | dine_in | takeaway | delivery';
COMMENT ON COLUMN public.sales.order_status IS 'null (retail) | new | preparing | ready | served';
COMMENT ON COLUMN public.sales.table_number IS 'Table identifier for dine-in orders';
