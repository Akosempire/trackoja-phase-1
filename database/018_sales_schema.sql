-- Migration: 018_sales_schema.sql
-- Description: Sales, sale items, sale payments, and the per-store sale
--   numbering counter (Phase 3 Sales Engine). All writes happen through the
--   create_sale/void_sale SECURITY DEFINER functions (018_sales_schema.sql
--   defines the tables only; 020_sales_functions.sql defines the functions).
-- Author: TrackOja Team
-- Date: 2026-06-14

-- ============================================================
-- SALES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  sale_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'voided')),
  customer_name TEXT,
  customer_phone TEXT,
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount_paid NUMERIC(14,2) NOT NULL DEFAULT 0,
  change_due NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_by UUID NOT NULL REFERENCES public.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  voided_at TIMESTAMP WITH TIME ZONE,
  voided_by UUID REFERENCES public.users(id),
  void_reason TEXT,
  UNIQUE(store_id, sale_number)
);

CREATE INDEX IF NOT EXISTS idx_sales_store ON public.sales(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_status ON public.sales(store_id, status);
CREATE INDEX IF NOT EXISTS idx_sales_created_by ON public.sales(created_by);

ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- SALE ITEMS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.sale_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  sku TEXT,
  quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON public.sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product ON public.sale_items(product_id);

ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- SALE PAYMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.sale_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('cash', 'card', 'transfer', 'other')),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  reference TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sale_payments_sale ON public.sale_payments(sale_id);

ALTER TABLE public.sale_payments ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- STORE SALE COUNTERS (internal - used by create_sale for sale_number)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.store_sale_counters (
  store_id UUID PRIMARY KEY REFERENCES public.stores(id) ON DELETE CASCADE,
  last_number BIGINT NOT NULL DEFAULT 0
);

ALTER TABLE public.store_sale_counters ENABLE ROW LEVEL SECURITY;
