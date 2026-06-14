-- Migration: 049_fix_owner_manager_permissions.sql
-- Description: Fixes a bug where Owner and Manager are missing every
--   permission introduced after 007_seed_initial_data.sql (Phases 2-9).
--   007 granted Owner/Manager "all permissions" as a one-time snapshot at
--   that point in the migration sequence; later migrations (014, 019, 024,
--   037, 042) assumed - incorrectly - that this snapshot was a live wildcard
--   that would automatically cover permissions they were about to insert.
--   It does not: on a fresh database, Owner ends up with only the original
--   11 Phase 1 permissions, and Manager with 10 - missing product/category
--   management, inventory:adjust, sales:view/void, all customer:*,
--   devices:view/manage, and sales:refund. This grants Owner all permissions
--   and Manager all permissions except store:delete, matching
--   RBAC_MATRIX.md.
-- Author: TrackOja Team
-- Date: 2026-06-14

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r
JOIN public.permissions p ON TRUE
WHERE r.name = 'owner' AND r.is_system = TRUE
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r
JOIN public.permissions p ON TRUE
WHERE r.name = 'manager' AND r.is_system = TRUE
  AND p.name NOT IN ('store:delete')
ON CONFLICT (role_id, permission_id) DO NOTHING;
