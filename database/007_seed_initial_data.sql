-- Migration: 007_seed_initial_data.sql
-- Description: Seed system roles and permissions for Phase 1
-- Author: TrackOja Team
-- Date: 2026-06-11

-- ============================================================
-- SYSTEM ROLES
-- ============================================================
-- These are template roles that will be copied to each organization

-- Owner role - full access
INSERT INTO public.roles (name, description, is_system, level)
VALUES ('owner', 'Store owner with full access', TRUE, 1)
ON CONFLICT (org_id, name) DO NOTHING;

-- Manager role - almost full access except deletion
INSERT INTO public.roles (name, description, is_system, level)
VALUES ('manager', 'Store manager with administrative access', TRUE, 2)
ON CONFLICT (org_id, name) DO NOTHING;

-- Cashier role - sales focused
INSERT INTO public.roles (name, description, is_system, level)
VALUES ('cashier', 'Cashier with checkout and sales access', TRUE, 3)
ON CONFLICT (org_id, name) DO NOTHING;

-- Inventory Officer role - inventory focused
INSERT INTO public.roles (name, description, is_system, level)
VALUES ('inventory_officer', 'Inventory officer with stock management access', TRUE, 4)
ON CONFLICT (org_id, name) DO NOTHING;

-- ============================================================
-- ASSIGN PERMISSIONS TO ROLES
-- ============================================================

-- Owner gets all permissions
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r
JOIN public.permissions p ON TRUE
WHERE r.name = 'owner' AND r.is_system = TRUE
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Manager gets all except store delete
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r
JOIN public.permissions p ON TRUE
WHERE r.name = 'manager' AND r.is_system = TRUE
  AND p.name NOT IN ('store:delete')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Cashier gets sales and inventory view
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r
JOIN public.permissions p ON TRUE
WHERE r.name = 'cashier' AND r.is_system = TRUE
  AND p.name IN ('sales:create', 'inventory:view', 'store:read', 'reports:view')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Inventory Officer gets inventory management
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r
JOIN public.permissions p ON TRUE
WHERE r.name = 'inventory_officer' AND r.is_system = TRUE
  AND p.name IN ('inventory:view', 'store:read', 'reports:view')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================================================
-- VERIFY SETUP
-- ============================================================
-- Queries to verify the seed data

-- SELECT COUNT(*) FROM public.roles WHERE is_system = TRUE;
-- SELECT COUNT(*) FROM public.permissions;
-- SELECT r.name, COUNT(p.id) as permission_count
-- FROM public.roles r
-- LEFT JOIN public.role_permissions rp ON r.id = rp.role_id
-- LEFT JOIN public.permissions p ON rp.permission_id = p.id
-- WHERE r.is_system = TRUE
-- GROUP BY r.name;
