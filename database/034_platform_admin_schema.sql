-- Migration: 034_platform_admin_schema.sql
-- Description: Phase 7 platform-admin flag and authorization helper.
--   - users.is_platform_admin: marks a user as a TrackOja platform owner with
--     cross-organization read access. Granted manually via SQL - see
--     PHASE_7_PLATFORM_DASHBOARD.md section 5.
--   - is_platform_admin(p_user_id): SECURITY DEFINER helper used by every
--     function in 035_platform_dashboard_functions.sql to gate access.
-- Author: TrackOja Team
-- Date: 2026-06-14

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- ============================================================
-- IS_PLATFORM_ADMIN
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_platform_admin(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN;
BEGIN
  SELECT is_platform_admin INTO v_is_admin FROM public.users WHERE id = p_user_id;
  RETURN COALESCE(v_is_admin, FALSE);
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_platform_admin(UUID) TO authenticated;
