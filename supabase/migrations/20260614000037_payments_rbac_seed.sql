-- Migration: 037_payments_rbac_seed.sql
-- Description: Phase 8 RBAC addition - sales:refund permission, granted to
--   Owner and Manager only, per PHASE_8_PAYMENTS.md section 2.
-- Author: TrackOja Team
-- Date: 2026-06-14

-- ============================================================
-- NEW PERMISSIONS
-- ============================================================
INSERT INTO public.permissions (name, resource, action, description, category) VALUES
  ('sales:refund', 'sales', 'refund', 'Process refunds and verify pending payments for a completed sale', 'sales')
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- ROLE ASSIGNMENTS
-- ============================================================

-- Owner and Manager already receive all permissions via the wildcard seeds in
-- 007_seed_initial_data.sql, so sales:refund is automatically granted to them.

-- Cashier and Inventory Officer: no refund/verification access.
