-- Migration: 073_platform_my_permissions.sql
-- Description: Lets the signed-in platform user discover their own effective
--   platform permissions so the admin UI can hide what they cannot use.
--   This is a convenience for rendering only: every mutating function still
--   re-checks the permission server-side, so hiding a control is never the
--   security boundary.
-- Author: TrackOja Team
-- Date: 2026-09-26

CREATE OR REPLACE FUNCTION public.get_my_platform_permissions()
RETURNS TABLE (
  is_platform_admin BOOLEAN,
  is_super_admin BOOLEAN,
  developer_mode BOOLEAN,
  permissions JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  RETURN QUERY
  SELECT
    public.is_platform_admin(v_uid),
    public.is_platform_super_admin(v_uid),
    public.developer_mode_enabled(v_uid),
    COALESCE((
      SELECT jsonb_agg(p.key ORDER BY p.key)
      FROM public.platform_permissions p
      WHERE public.platform_user_has_permission(v_uid, p.key)
    ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_platform_permissions() TO authenticated;

COMMENT ON FUNCTION public.get_my_platform_permissions() IS
  'Effective platform permissions for the caller. Rendering aid only; enforcement happens inside each function.';
