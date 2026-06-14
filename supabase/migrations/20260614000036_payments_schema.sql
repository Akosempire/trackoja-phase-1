-- Migration: 036_payments_schema.sql
-- Description: Phase 8 payments infrastructure schema.
--   - sales gains refunded_amount (running total of refunds processed).
--   - sale_items gains refunded_quantity (running total returned to stock).
--   - sale_payments gains verification_status/verified_by/verified_at for
--     manual reconciliation of non-cash payments.
--   - refunds: append-only ledger of refunds processed against a sale.
-- Author: TrackOja Team
-- Date: 2026-06-14

-- ============================================================
-- SALES: running refund total
-- ============================================================
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS refunded_amount NUMERIC(14,2) NOT NULL DEFAULT 0;

-- ============================================================
-- SALE ITEMS: running returned-quantity total
-- ============================================================
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS refunded_quantity NUMERIC(14,3) NOT NULL DEFAULT 0;

-- ============================================================
-- SALE PAYMENTS: verification status for manual reconciliation
-- ============================================================
ALTER TABLE public.sale_payments ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'verified';
ALTER TABLE public.sale_payments DROP CONSTRAINT IF EXISTS sale_payments_verification_status_check;
ALTER TABLE public.sale_payments ADD CONSTRAINT sale_payments_verification_status_check
  CHECK (verification_status IN ('verified', 'pending', 'rejected'));

ALTER TABLE public.sale_payments ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES public.users(id);
ALTER TABLE public.sale_payments ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP WITH TIME ZONE;

-- ============================================================
-- REFUNDS (append-only)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  reason TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('cash', 'card', 'transfer', 'other', 'credit')),
  items JSONB,
  created_by UUID NOT NULL REFERENCES public.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refunds_sale ON public.refunds(sale_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_refunds_store ON public.refunds(store_id, created_at DESC);

ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;
