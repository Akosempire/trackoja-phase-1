-- Migration: 051_fix_role_permissions_rls.sql
-- Description: role_permissions has RLS enabled (003_roles_permissions_schema.sql)
--   but no SELECT policy was ever added for it. With RLS enabled and zero
--   policies, Postgres denies all access to non-bypassrls roles, so
--   RbacService.getUserPermissions() (queried directly via PostgREST as the
--   authenticated user) always got an empty role_permissions result - every
--   permission check in the frontend (usePermissions/hasPermission) silently
--   returned false, hiding Products/Categories/Stock/Checkout/Sales/
--   Customers/Payments/Devices/Reports from the nav for every real user.
--   (RPC-based permission checks were unaffected since those run as
--   SECURITY DEFINER and bypass RLS.)
-- Fix: add a SELECT policy mirroring roles_visibility (010_fix_rls_recursion.sql) -
--   a role's permissions are visible if the role itself is visible (system
--   roles, or roles belonging to an org the user is a member of or owns).
-- Author: TrackOja Team
-- Date: 2026-06-15

CREATE POLICY role_permissions_visibility ON public.role_permissions
  FOR SELECT
  USING (
    role_id IN (
      SELECT id FROM public.roles
      WHERE is_system = TRUE
         OR org_id IN (SELECT public.get_user_org_ids(auth.uid()))
         OR org_id IN (SELECT public.get_owned_org_ids(auth.uid()))
    )
  );
