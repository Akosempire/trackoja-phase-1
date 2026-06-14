-- Migration: 014_inventory_rbac_seed.sql
-- Description: Phase 2 RBAC additions - product/category/inventory permissions,
--   role assignments per PHASE_2_INVENTORY.md, and a SECURITY DEFINER helper
--   (user_has_permission) used by RLS policies and the inventory movement function
--   to resolve a user's permissions for a given store without RLS recursion.
-- Author: TrackOja Team
-- Date: 2026-06-13

-- ============================================================
-- NEW PERMISSIONS
-- ============================================================
INSERT INTO public.permissions (name, resource, action, description, category) VALUES
  ('product:create', 'products', 'create', 'Create a new product', 'inventory'),
  ('product:update', 'products', 'update', 'Update product details', 'inventory'),
  ('product:delete', 'products', 'delete', 'Delete or archive a product', 'inventory'),
  ('category:create', 'product_categories', 'create', 'Create a product category', 'inventory'),
  ('category:update', 'product_categories', 'update', 'Update a product category', 'inventory'),
  ('category:delete', 'product_categories', 'delete', 'Delete a product category', 'inventory'),
  ('inventory:adjust', 'inventory_movements', 'create', 'Record stock adjustments and movements', 'inventory')
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- ROLE ASSIGNMENTS (per PHASE_2_INVENTORY.md section 4)
-- ============================================================

-- Owner and Manager already receive all permissions via the wildcard seeds in
-- 007_seed_initial_data.sql (Manager excludes only 'store:delete'), so the new
-- permissions above are automatically granted to them.

-- Inventory Officer: product/category management + stock adjustments
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r
JOIN public.permissions p ON TRUE
WHERE r.name = 'inventory_officer' AND r.is_system = TRUE
  AND p.name IN ('product:create', 'product:update', 'category:create', 'category:update', 'inventory:adjust')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Cashier: read-only, no new permissions (relies on existing inventory:view)

-- ============================================================
-- PERMISSION RESOLUTION HELPER (SECURITY DEFINER, bypasses RLS)
-- ============================================================
CREATE OR REPLACE FUNCTION public.user_has_permission(p_user_id UUID, p_store_id UUID, p_permission_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.store_members sm
    JOIN public.role_permissions rp ON rp.role_id = sm.role_id
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE sm.user_id = p_user_id
      AND sm.store_id = p_store_id
      AND sm.status = 'active'
      AND p.name = p_permission_name
  );
$$;

GRANT EXECUTE ON FUNCTION public.user_has_permission(UUID, UUID, TEXT) TO authenticated, anon;
