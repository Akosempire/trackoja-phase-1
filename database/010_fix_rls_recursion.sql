-- Migration: 010_fix_rls_recursion.sql
-- Description: Fix infinite recursion in RLS policies. Several policies queried
--   the same (or a mutually-dependent) RLS-protected table from within their own
--   USING/WITH CHECK clauses (e.g. store_members_visibility queries store_members;
--   organizations <-> organization_members reference each other). Postgres cannot
--   resolve this and raises "infinite recursion detected in policy for relation".
--   Fix: SECURITY DEFINER helper functions that bypass RLS for these membership
--   lookups, used in place of the direct subqueries.
-- Author: TrackOja Team
-- Date: 2026-06-12

-- ============================================================
-- HELPER FUNCTIONS (SECURITY DEFINER - bypass RLS)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_user_org_ids(p_user_id UUID)
RETURNS SETOF UUID
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT org_id FROM public.organization_members WHERE user_id = p_user_id;
$$;

CREATE OR REPLACE FUNCTION public.get_owned_org_ids(p_user_id UUID)
RETURNS SETOF UUID
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT id FROM public.organizations WHERE owner_id = p_user_id;
$$;

CREATE OR REPLACE FUNCTION public.get_user_active_store_ids(p_user_id UUID)
RETURNS SETOF UUID
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT store_id FROM public.store_members WHERE user_id = p_user_id AND status = 'active';
$$;

GRANT EXECUTE ON FUNCTION public.get_user_org_ids(UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_owned_org_ids(UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_user_active_store_ids(UUID) TO authenticated, anon;

-- ============================================================
-- ORGANIZATIONS
-- ============================================================
DROP POLICY IF EXISTS org_isolation_select ON public.organizations;
CREATE POLICY org_isolation_select ON public.organizations
  FOR SELECT
  USING (
    id IN (SELECT public.get_user_org_ids(auth.uid()))
    OR owner_id = auth.uid()
  );

-- ============================================================
-- STORES
-- ============================================================
DROP POLICY IF EXISTS stores_user_isolation ON public.stores;
CREATE POLICY stores_user_isolation ON public.stores
  FOR SELECT
  USING (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
    OR org_id IN (SELECT public.get_owned_org_ids(auth.uid()))
  );

DROP POLICY IF EXISTS stores_create ON public.stores;
CREATE POLICY stores_create ON public.stores
  FOR INSERT
  WITH CHECK (
    (created_by = auth.uid() AND org_id IN (SELECT public.get_user_org_ids(auth.uid())))
    OR org_id IN (SELECT public.get_owned_org_ids(auth.uid()))
  );

DROP POLICY IF EXISTS stores_update ON public.stores;
CREATE POLICY stores_update ON public.stores
  FOR UPDATE
  USING (
    id IN (SELECT public.get_user_active_store_ids(auth.uid()))
    OR org_id IN (SELECT public.get_owned_org_ids(auth.uid()))
  )
  WITH CHECK (
    id IN (SELECT public.get_user_active_store_ids(auth.uid()))
    OR org_id IN (SELECT public.get_owned_org_ids(auth.uid()))
  );

-- ============================================================
-- STORE_MEMBERS
-- ============================================================
DROP POLICY IF EXISTS store_members_visibility ON public.store_members;
CREATE POLICY store_members_visibility ON public.store_members
  FOR SELECT
  USING (
    store_id IN (SELECT public.get_user_active_store_ids(auth.uid()))
    OR store_id IN (
      SELECT id FROM public.stores
      WHERE org_id IN (SELECT public.get_owned_org_ids(auth.uid()))
    )
  );

DROP POLICY IF EXISTS store_members_invite ON public.store_members;
CREATE POLICY store_members_invite ON public.store_members
  FOR INSERT
  WITH CHECK (
    store_id IN (SELECT public.get_user_active_store_ids(auth.uid()))
    OR store_id IN (
      SELECT id FROM public.stores
      WHERE org_id IN (SELECT public.get_owned_org_ids(auth.uid()))
    )
  );

DROP POLICY IF EXISTS store_members_update ON public.store_members;
CREATE POLICY store_members_update ON public.store_members
  FOR UPDATE
  USING (
    user_id = auth.uid()
    OR store_id IN (SELECT public.get_user_active_store_ids(auth.uid()))
  );

-- ============================================================
-- USERS
-- ============================================================
DROP POLICY IF EXISTS users_read_own_profile ON public.users;
CREATE POLICY users_read_own_profile ON public.users
  FOR SELECT
  USING (
    id = auth.uid()
    OR id IN (
      SELECT user_id FROM public.store_members
      WHERE store_id IN (SELECT public.get_user_active_store_ids(auth.uid()))
    )
  );

-- ============================================================
-- ORGANIZATION_MEMBERS
-- ============================================================
DROP POLICY IF EXISTS org_members_visibility ON public.organization_members;
CREATE POLICY org_members_visibility ON public.organization_members
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR org_id IN (SELECT public.get_owned_org_ids(auth.uid()))
  );

DROP POLICY IF EXISTS organization_members_insert_self ON public.organization_members;
CREATE POLICY organization_members_insert_self ON public.organization_members
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND org_id IN (SELECT public.get_owned_org_ids(auth.uid()))
  );

-- ============================================================
-- AUDIT_LOGS
-- ============================================================
DROP POLICY IF EXISTS audit_logs_visibility ON public.audit_logs;
CREATE POLICY audit_logs_visibility ON public.audit_logs
  FOR SELECT
  USING (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
    OR org_id IN (SELECT public.get_owned_org_ids(auth.uid()))
  );

-- ============================================================
-- ROLES
-- ============================================================
DROP POLICY IF EXISTS roles_visibility ON public.roles;
CREATE POLICY roles_visibility ON public.roles
  FOR SELECT
  USING (
    is_system = TRUE
    OR org_id IN (SELECT public.get_user_org_ids(auth.uid()))
    OR org_id IN (SELECT public.get_owned_org_ids(auth.uid()))
  );
