-- Migration: 042_devices_rbac_seed.sql
-- Description: Phase 9 RBAC additions - devices:view (all roles) and
--   devices:manage (Owner/Manager only) permissions per PHASE_9_DEVICES.md.
-- Author: TrackOja Team
-- Date: 2026-06-14

INSERT INTO public.permissions (name, resource, action, description, category) VALUES
  ('devices:view', 'devices', 'read', 'View registered devices, sessions, and transactions for a store', 'devices'),
  ('devices:manage', 'devices', 'manage', 'Register, update, and decommission devices', 'devices')
ON CONFLICT (name) DO NOTHING;

-- Owner and Manager already receive all permissions via the wildcard seeds in
-- 007_seed_initial_data.sql, so devices:view and devices:manage are
-- automatically granted to them.

-- Cashier and Inventory Officer: read-only device access (operate registered
-- devices, but cannot register, edit, or decommission them), matching the
-- inventory:view precedent.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r
JOIN public.permissions p ON TRUE
WHERE r.name IN ('cashier', 'inventory_officer') AND r.is_system = TRUE
  AND p.name = 'devices:view'
ON CONFLICT (role_id, permission_id) DO NOTHING;
