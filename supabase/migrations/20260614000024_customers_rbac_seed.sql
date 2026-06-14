-- Migration: 024_customers_rbac_seed.sql
-- Description: Phase 4 RBAC additions - customer:view/create/update/delete/manage_credit
--   permissions and role assignments per PHASE_4_CUSTOMERS.md section 5.
-- Author: TrackOja Team
-- Date: 2026-06-14

-- ============================================================
-- NEW PERMISSIONS
-- ============================================================
INSERT INTO public.permissions (name, resource, action, description, category) VALUES
  ('customer:view', 'customers', 'read', 'View customer directory, balances, and loyalty points', 'customers'),
  ('customer:create', 'customers', 'create', 'Create a new customer', 'customers'),
  ('customer:update', 'customers', 'update', 'Update customer details', 'customers'),
  ('customer:delete', 'customers', 'delete', 'Delete a customer', 'customers'),
  ('customer:manage_credit', 'customers', 'manage', 'Record credit payments and adjust loyalty points', 'customers')
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- ROLE ASSIGNMENTS (per PHASE_4_CUSTOMERS.md section 5)
-- ============================================================

-- Owner and Manager already receive all permissions via the wildcard seeds in
-- 007_seed_initial_data.sql, so the new permissions above are automatically
-- granted to them.

-- Cashier: view and create customers (lookup/register at checkout)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r
JOIN public.permissions p ON TRUE
WHERE r.name = 'cashier' AND r.is_system = TRUE
  AND p.name IN ('customer:view', 'customer:create')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Inventory Officer: no customer permissions (out of scope for this role)
