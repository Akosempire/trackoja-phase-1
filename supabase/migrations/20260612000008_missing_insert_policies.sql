-- Migration: 008_missing_insert_policies.sql
-- Description: Add missing INSERT RLS policies required by signup and onboarding flows
-- Author: TrackOja Team
-- Date: 2026-06-12

-- ============================================================
-- USERS RLS POLICIES
-- ============================================================
-- A user may create their own profile row during signup
CREATE POLICY users_insert_own_profile ON public.users
  FOR INSERT
  WITH CHECK (id = auth.uid());

-- ============================================================
-- ORGANIZATIONS RLS POLICIES
-- ============================================================
-- A user may create an organization they own
CREATE POLICY organizations_insert_owner ON public.organizations
  FOR INSERT
  WITH CHECK (owner_id = auth.uid());

-- ============================================================
-- ORGANIZATION_MEMBERS RLS POLICIES
-- ============================================================
-- A user may add themselves as a member of an organization they own
-- (used when onboarding creates the initial owner membership)
CREATE POLICY organization_members_insert_self ON public.organization_members
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND org_id IN (
      SELECT id FROM public.organizations WHERE owner_id = auth.uid()
    )
  );
