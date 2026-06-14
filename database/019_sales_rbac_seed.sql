-- Migration: 019_sales_rbac_seed.sql
-- Description: Phase 3 RBAC additions - sales:view and sales:void permissions,
--   and role assignments per PHASE_3_SALES.md section 5. sales:create already
--   exists (007_seed_initial_data.sql).
-- Author: TrackOja Team
-- Date: 2026-06-14

-- ============================================================
-- NEW PERMISSIONS
-- ============================================================
INSERT INTO public.permissions (name, resource, action, description, category) VALUES
  ('sales:view', 'sales', 'read', 'View sales history and receipts', 'sales'),
  ('sales:void', 'sales', 'update', 'Void a completed sale', 'sales')
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- ROLE ASSIGNMENTS (per PHASE_3_SALES.md section 5)
-- ============================================================

-- Owner and Manager already receive all permissions via the wildcard seeds in
-- 007_seed_initial_data.sql (Manager excludes only 'store:delete'), so
-- sales:view and sales:void are automatically granted to them.

-- Cashier: sales:view in addition to existing sales:create
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r
JOIN public.permissions p ON TRUE
WHERE r.name = 'cashier' AND r.is_system = TRUE
  AND p.name = 'sales:view'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Inventory Officer: sales:view (read-only)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r
JOIN public.permissions p ON TRUE
WHERE r.name = 'inventory_officer' AND r.is_system = TRUE
  AND p.name = 'sales:view'
ON CONFLICT (role_id, permission_id) DO NOTHING;
