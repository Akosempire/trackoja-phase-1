-- Migration: 023_customers_schema.sql
-- Description: Phase 4 customers schema.
--   - customers: per-store buyer directory with running credit balance and
--     loyalty point balance.
--   - customer_credit_transactions / customer_loyalty_transactions: append-only
--     ledgers mirroring the inventory_movements pattern from Phase 2. Written
--     only via create_sale/void_sale/adjust_customer_credit/adjust_customer_loyalty
--     (025_customers_functions.sql).
--   - sales gains customer_id (FK -> customers, ON DELETE SET NULL) and
--     loyalty_points_earned.
--   - sale_payments.method gains 'credit'.
--   - store_settings gains loyalty_enabled / loyalty_earn_rate.
-- Author: TrackOja Team
-- Date: 2026-06-14

-- ============================================================
-- CUSTOMERS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  notes TEXT,
  credit_limit NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
  balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  loyalty_points INTEGER NOT NULL DEFAULT 0 CHECK (loyalty_points >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID NOT NULL REFERENCES public.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_store_phone ON public.customers(store_id, phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_store ON public.customers(store_id, name);
CREATE INDEX IF NOT EXISTS idx_customers_active ON public.customers(store_id, is_active);

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS handle_updated_at_customers ON public.customers;
CREATE TRIGGER handle_updated_at_customers BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================
-- CUSTOMER CREDIT TRANSACTIONS (append-only ledger)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.customer_credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('sale_credit', 'payment', 'adjustment', 'sale_void')),
  amount NUMERIC(14,2) NOT NULL,
  balance_before NUMERIC(14,2) NOT NULL,
  balance_after NUMERIC(14,2) NOT NULL,
  source_type TEXT,
  source_id UUID,
  notes TEXT,
  created_by UUID NOT NULL REFERENCES public.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_credit_txns_customer ON public.customer_credit_transactions(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_credit_txns_store ON public.customer_credit_transactions(store_id);

ALTER TABLE public.customer_credit_transactions ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- CUSTOMER LOYALTY TRANSACTIONS (append-only ledger)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.customer_loyalty_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('earn', 'redeem', 'adjustment', 'void')),
  points INTEGER NOT NULL,
  points_before INTEGER NOT NULL,
  points_after INTEGER NOT NULL,
  source_type TEXT,
  source_id UUID,
  notes TEXT,
  created_by UUID NOT NULL REFERENCES public.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_loyalty_txns_customer ON public.customer_loyalty_transactions(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_loyalty_txns_store ON public.customer_loyalty_transactions(store_id);

ALTER TABLE public.customer_loyalty_transactions ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- SALES: customer linkage + loyalty snapshot
-- ============================================================
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS loyalty_points_earned INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_sales_customer ON public.sales(customer_id);

-- ============================================================
-- SALE PAYMENTS: allow 'credit' as a payment method
-- ============================================================
ALTER TABLE public.sale_payments DROP CONSTRAINT IF EXISTS sale_payments_method_check;
ALTER TABLE public.sale_payments ADD CONSTRAINT sale_payments_method_check
  CHECK (method IN ('cash', 'card', 'transfer', 'other', 'credit'));

-- ============================================================
-- STORE SETTINGS: loyalty configuration
-- ============================================================
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS loyalty_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS loyalty_earn_rate NUMERIC(6,4) NOT NULL DEFAULT 0;
