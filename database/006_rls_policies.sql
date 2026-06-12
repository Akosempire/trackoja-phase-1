-- Migration: 006_rls_policies.sql
-- Description: Row Level Security policies for tenant isolation
-- Author: TrackOja Team
-- Date: 2026-06-11

-- ============================================================
-- ORGANIZATIONS RLS POLICIES
-- ============================================================
-- Users can only see their own organizations
CREATE POLICY org_isolation_select ON public.organizations
  FOR SELECT
  USING (
    id IN (
      SELECT org_id FROM public.organization_members
      WHERE user_id = auth.uid()
    )
    OR owner_id = auth.uid()
  );

CREATE POLICY org_update_owner_only ON public.organizations
  FOR UPDATE
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- ============================================================
-- STORES RLS POLICIES
-- ============================================================
-- Users can only see stores in their organizations
CREATE POLICY stores_user_isolation ON public.stores
  FOR SELECT
  USING (
    org_id IN (
      SELECT org_id FROM public.organization_members
      WHERE user_id = auth.uid()
    )
    OR org_id IN (
      SELECT id FROM public.organizations
      WHERE owner_id = auth.uid()
    )
  );

-- Users can create stores in their org
CREATE POLICY stores_create ON public.stores
  FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND org_id IN (
      SELECT org_id FROM public.organization_members
      WHERE user_id = auth.uid()
    )
    OR org_id IN (
      SELECT id FROM public.organizations
      WHERE owner_id = auth.uid()
    )
  );

-- Users can update stores they are members of
CREATE POLICY stores_update ON public.stores
  FOR UPDATE
  USING (
    id IN (
      SELECT store_id FROM public.store_members
      WHERE user_id = auth.uid()
        AND status = 'active'
    )
    OR org_id IN (
      SELECT id FROM public.organizations
      WHERE owner_id = auth.uid()
    )
  )
  WITH CHECK (
    id IN (
      SELECT store_id FROM public.store_members
      WHERE user_id = auth.uid()
        AND status = 'active'
    )
    OR org_id IN (
      SELECT id FROM public.organizations
      WHERE owner_id = auth.uid()
    )
  );

-- ============================================================
-- STORE_MEMBERS RLS POLICIES
-- ============================================================
-- Users can see members in stores they are members of
CREATE POLICY store_members_visibility ON public.store_members
  FOR SELECT
  USING (
    store_id IN (
      SELECT store_id FROM public.store_members
      WHERE user_id = auth.uid()
        AND status = 'active'
    )
    OR store_id IN (
      SELECT id FROM public.stores
      WHERE org_id IN (
        SELECT id FROM public.organizations
        WHERE owner_id = auth.uid()
      )
    )
  );

-- Users can invite members to stores they manage
CREATE POLICY store_members_invite ON public.store_members
  FOR INSERT
  WITH CHECK (
    store_id IN (
      SELECT store_id FROM public.store_members
      WHERE user_id = auth.uid()
        AND status = 'active'
    )
    OR store_id IN (
      SELECT id FROM public.stores
      WHERE org_id IN (
        SELECT id FROM public.organizations
        WHERE owner_id = auth.uid()
      )
    )
  );

-- Users can manage their own memberships
CREATE POLICY store_members_update ON public.store_members
  FOR UPDATE
  USING (
    user_id = auth.uid()
    OR store_id IN (
      SELECT store_id FROM public.store_members
      WHERE user_id = auth.uid()
        AND status = 'active'
    )
  );

-- ============================================================
-- USERS RLS POLICIES
-- ============================================================
-- Users can only read their own profile and profiles of users in their org
CREATE POLICY users_read_own_profile ON public.users
  FOR SELECT
  USING (
    id = auth.uid()
    OR id IN (
      SELECT user_id FROM public.store_members
      WHERE store_id IN (
        SELECT store_id FROM public.store_members
        WHERE user_id = auth.uid()
      )
    )
  );

-- Users can update their own profile
CREATE POLICY users_update_own_profile ON public.users
  FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ============================================================
-- ORGANIZATION_MEMBERS RLS POLICIES
-- ============================================================
CREATE POLICY org_members_visibility ON public.organization_members
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR org_id IN (
      SELECT id FROM public.organizations
      WHERE owner_id = auth.uid()
    )
  );

-- ============================================================
-- AUDIT_LOGS RLS POLICIES
-- ============================================================
-- Users can see audit logs for their organizations only
CREATE POLICY audit_logs_visibility ON public.audit_logs
  FOR SELECT
  USING (
    org_id IN (
      SELECT org_id FROM public.organization_members
      WHERE user_id = auth.uid()
    )
    OR org_id IN (
      SELECT id FROM public.organizations
      WHERE owner_id = auth.uid()
    )
  );

-- ============================================================
-- ROLES RLS POLICIES
-- ============================================================
CREATE POLICY roles_visibility ON public.roles
  FOR SELECT
  USING (
    is_system = TRUE
    OR org_id IN (
      SELECT org_id FROM public.organization_members
      WHERE user_id = auth.uid()
    )
    OR org_id IN (
      SELECT id FROM public.organizations
      WHERE owner_id = auth.uid()
    )
  );

-- ============================================================
-- PERMISSIONS RLS POLICIES (public read)
-- ============================================================
CREATE POLICY permissions_public_read ON public.permissions
  FOR SELECT
  USING (true);

-- ============================================================
-- USER_SESSIONS RLS POLICIES
-- ============================================================
CREATE POLICY user_sessions_own_only ON public.user_sessions
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY user_sessions_insert_own ON public.user_sessions
  FOR INSERT
  WITH CHECK (user_id = auth.uid());
