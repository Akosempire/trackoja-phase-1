-- Migration: 091_platform_admin_management.sql
-- Description: Let the platform be administered from the product.
--   Until now `platform_admins` had no INSERT, UPDATE or DELETE path at all: a
--   platform admin could only be appointed by running SQL by hand, and the five
--   product roles (owner, admin, support, developer, finance operator) therefore
--   existed as a CHECK constraint and nothing else.
--
--   Three mutations are added, all restricted to a platform owner and all
--   audited, plus a read function shaped for the screen that consumes it.
--
--   Two details matter more than they look:
--     * `platform_user_has_permission` gives a non-super-admin EXACTLY the keys
--       granted to them and nothing else, so granting a level without seeding
--       permissions produces an admin who can do nothing. Each level therefore
--       gets a documented baseline.
--     * every RLS SELECT policy on the platform tables still keys on
--       `users.is_platform_admin`, so that legacy column has to be kept in step
--       or a newly appointed admin passes the RPC gates and can read no table.
--
-- Author: TrackOja Team
-- Date: 2026-09-27

-- ============================================================
-- LEVEL BASELINES
-- ============================================================
-- The keys each level starts with. Deliberately small: a level is a starting
-- point, and anything beyond the baseline is a deliberate extra grant.

CREATE OR REPLACE FUNCTION public.platform_level_baseline(p_level TEXT)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_level
    WHEN 'super_admin'      THEN ARRAY[]::TEXT[]
    WHEN 'admin'            THEN ARRAY['platform:view', 'platform:manage_businesses', 'platform:support']
    WHEN 'support'          THEN ARRAY['platform:view', 'platform:support']
    WHEN 'finance_operator' THEN ARRAY['platform:view', 'platform:view_payments', 'platform:manage_subscriptions']
    WHEN 'developer'        THEN ARRAY['platform:view', 'developer:access']
    ELSE NULL
  END;
$$;

COMMENT ON FUNCTION public.platform_level_baseline(TEXT) IS
  'The permission keys a platform level starts with. Returns NULL for an unknown level so callers can reject it.';

-- Internal helper: this project grants EXECUTE on new public functions directly
-- to anon and authenticated via ALTER DEFAULT PRIVILEGES, so naming the roles is
-- what actually removes the grant.
REVOKE ALL ON FUNCTION public.platform_level_baseline(TEXT) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- APPOINT A PLATFORM ADMIN
-- ============================================================

CREATE OR REPLACE FUNCTION public.grant_platform_admin(
  p_user_id UUID,
  p_level TEXT,
  p_note TEXT DEFAULT NULL
)
RETURNS public.platform_admins
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor    UUID := auth.uid();
  v_baseline TEXT[];
  v_email    TEXT;
  v_existing public.platform_admins;
  v_row      public.platform_admins;
BEGIN
  IF NOT public.is_platform_super_admin(v_actor) THEN
    RAISE EXCEPTION 'Permission denied: platform super admin required';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Target user is required';
  END IF;

  v_baseline := public.platform_level_baseline(p_level);
  IF v_baseline IS NULL THEN
    RAISE EXCEPTION 'Invalid platform level: %', COALESCE(p_level, '(none)');
  END IF;

  SELECT email INTO v_email FROM public.users WHERE id = p_user_id;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Unknown user: %', p_user_id;
  END IF;

  SELECT * INTO v_existing FROM public.platform_admins WHERE user_id = p_user_id;

  IF v_existing.id IS NOT NULL AND v_existing.status = 'active' THEN
    RAISE EXCEPTION 'That user is already an active platform admin; change their level instead';
  END IF;

  IF v_existing.id IS NOT NULL THEN
    -- Reactivate the existing row: user_id is UNIQUE, so a second row is impossible.
    UPDATE public.platform_admins
       SET level      = p_level,
           status     = 'active',
           note       = COALESCE(p_note, note),
           granted_by = v_actor,
           granted_at = now(),
           revoked_at = NULL,
           updated_at = now()
     WHERE id = v_existing.id
     RETURNING * INTO v_row;
  ELSE
    INSERT INTO public.platform_admins (user_id, level, status, note, granted_by)
    VALUES (p_user_id, p_level, 'active', p_note, v_actor)
    RETURNING * INTO v_row;
  END IF;

  -- Seed the level's baseline. A super admin holds everything implicitly, so it
  -- gets no rows rather than eighteen.
  DELETE FROM public.platform_admin_permissions WHERE user_id = p_user_id;
  INSERT INTO public.platform_admin_permissions (user_id, permission_key, granted_by)
  SELECT p_user_id, granted_key, v_actor
  FROM unnest(v_baseline) AS granted_key
  ON CONFLICT (user_id, permission_key) DO NOTHING;

  -- Keep the legacy flags in step: the platform RLS policies still read them.
  UPDATE public.users
     SET is_platform_admin       = TRUE,
         is_platform_super_admin = (p_level = 'super_admin'),
         updated_at              = now()
   WHERE id = p_user_id;

  PERFORM public.create_audit_log(
    v_actor, NULL, NULL,
    'PLATFORM_ADMIN_GRANTED', 'platform_admin', p_user_id, v_email,
    jsonb_build_object('previous', NULL, 'new', jsonb_build_object('level', p_level)),
    jsonb_build_object('note', p_note, 'baseline_permissions', to_jsonb(v_baseline))
  );

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.grant_platform_admin(UUID, TEXT, TEXT) IS
  'Appoints a platform admin at a given level, seeds that level''s baseline permissions and sets the legacy platform flags. Restricted to a platform owner. Audited.';

REVOKE ALL ON FUNCTION public.grant_platform_admin(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_platform_admin(UUID, TEXT, TEXT) TO authenticated;

-- ============================================================
-- CHANGE A PLATFORM ADMIN'S LEVEL
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_platform_admin_level(
  p_user_id UUID,
  p_level TEXT,
  p_note TEXT DEFAULT NULL
)
RETURNS public.platform_admins
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor     UUID := auth.uid();
  v_baseline  TEXT[];
  v_email     TEXT;
  v_existing  public.platform_admins;
  v_row       public.platform_admins;
  v_owners    INTEGER;
BEGIN
  IF NOT public.is_platform_super_admin(v_actor) THEN
    RAISE EXCEPTION 'Permission denied: platform super admin required';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Target user is required';
  END IF;

  v_baseline := public.platform_level_baseline(p_level);
  IF v_baseline IS NULL THEN
    RAISE EXCEPTION 'Invalid platform level: %', COALESCE(p_level, '(none)');
  END IF;

  SELECT * INTO v_existing
  FROM public.platform_admins
  WHERE user_id = p_user_id AND status = 'active';

  IF v_existing.id IS NULL THEN
    RAISE EXCEPTION 'Target user is not a platform admin';
  END IF;

  -- The platform must always have an owner, or nobody can manage it again.
  IF v_existing.level = 'super_admin' AND p_level <> 'super_admin' THEN
    SELECT count(*) INTO v_owners
    FROM public.platform_admins
    WHERE level = 'super_admin' AND status = 'active';

    IF v_owners <= 1 THEN
      RAISE EXCEPTION 'This is the only platform owner; promote another account before changing this one';
    END IF;
  END IF;

  UPDATE public.platform_admins
     SET level      = p_level,
         note       = COALESCE(p_note, note),
         updated_at = now()
   WHERE id = v_existing.id
   RETURNING * INTO v_row;

  /*
   * Permissions follow the level. Moving to super_admin clears the explicit rows
   * because the level already implies every key; moving away from it seeds the
   * new level's baseline so the account is not left able to do nothing at all.
   */
  DELETE FROM public.platform_admin_permissions WHERE user_id = p_user_id;
  INSERT INTO public.platform_admin_permissions (user_id, permission_key, granted_by)
  SELECT p_user_id, granted_key, v_actor
  FROM unnest(v_baseline) AS granted_key
  ON CONFLICT (user_id, permission_key) DO NOTHING;

  UPDATE public.users
     SET is_platform_admin       = TRUE,
         is_platform_super_admin = (p_level = 'super_admin'),
         updated_at              = now()
   WHERE id = p_user_id;

  SELECT email INTO v_email FROM public.users WHERE id = p_user_id;

  PERFORM public.create_audit_log(
    v_actor, NULL, NULL,
    'PLATFORM_ADMIN_LEVEL_CHANGED', 'platform_admin', p_user_id, v_email,
    jsonb_build_object(
      'previous', jsonb_build_object('level', v_existing.level),
      'new', jsonb_build_object('level', p_level)
    ),
    jsonb_build_object('note', p_note, 'baseline_permissions', to_jsonb(v_baseline))
  );

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.set_platform_admin_level(UUID, TEXT, TEXT) IS
  'Changes a platform admin''s level, reseeding permissions for the new level. Refuses to demote the last platform owner. Restricted to a platform owner. Audited.';

REVOKE ALL ON FUNCTION public.set_platform_admin_level(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_platform_admin_level(UUID, TEXT, TEXT) TO authenticated;

-- ============================================================
-- REVOKE PLATFORM ACCESS
-- ============================================================

CREATE OR REPLACE FUNCTION public.revoke_platform_admin(
  p_user_id UUID,
  p_reason TEXT
)
RETURNS public.platform_admins
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor    UUID := auth.uid();
  v_email    TEXT;
  v_existing public.platform_admins;
  v_row      public.platform_admins;
  v_owners   INTEGER;
BEGIN
  IF NOT public.is_platform_super_admin(v_actor) THEN
    RAISE EXCEPTION 'Permission denied: platform super admin required';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Target user is required';
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'A reason is required to revoke platform access';
  END IF;

  IF p_user_id = v_actor THEN
    RAISE EXCEPTION 'You cannot revoke your own platform access';
  END IF;

  SELECT * INTO v_existing
  FROM public.platform_admins
  WHERE user_id = p_user_id AND status = 'active';

  IF v_existing.id IS NULL THEN
    RAISE EXCEPTION 'Target user is not a platform admin';
  END IF;

  IF v_existing.level = 'super_admin' THEN
    SELECT count(*) INTO v_owners
    FROM public.platform_admins
    WHERE level = 'super_admin' AND status = 'active';

    IF v_owners <= 1 THEN
      RAISE EXCEPTION 'This is the only platform owner; promote another account before revoking it';
    END IF;
  END IF;

  UPDATE public.platform_admins
     SET status     = 'revoked',
         revoked_at = now(),
         updated_at = now()
   WHERE id = v_existing.id
   RETURNING * INTO v_row;

  DELETE FROM public.platform_admin_permissions WHERE user_id = p_user_id;

  -- Developer mode is meaningless without platform access, so it goes too rather
  -- than remaining as a grant that can no longer be used or seen.
  UPDATE public.developer_access_grants
     SET status     = 'revoked',
         revoked_at = now(),
         revoked_by = v_actor,
         updated_at = now()
   WHERE user_id = p_user_id AND status = 'active';

  UPDATE public.developer_sessions
     SET status   = 'ended',
         ended_at = now()
   WHERE user_id = p_user_id AND status = 'active';

  -- Both legacy flags, so the RLS path closes as well as the permission path.
  UPDATE public.users
     SET is_platform_admin       = FALSE,
         is_platform_super_admin = FALSE,
         updated_at              = now()
   WHERE id = p_user_id;

  SELECT email INTO v_email FROM public.users WHERE id = p_user_id;

  PERFORM public.create_audit_log(
    v_actor, NULL, NULL,
    'PLATFORM_ADMIN_REVOKED', 'platform_admin', p_user_id, v_email,
    jsonb_build_object('previous', jsonb_build_object('level', v_existing.level, 'status', 'active'),
                       'new', jsonb_build_object('level', v_existing.level, 'status', 'revoked')),
    jsonb_build_object('reason', btrim(p_reason), 'developer_access_revoked', TRUE)
  );

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.revoke_platform_admin(UUID, TEXT) IS
  'Revokes platform access: clears permissions, revokes developer mode, ends developer sessions and clears both legacy platform flags. Refuses self-revocation and the last platform owner. Restricted to a platform owner. Audited.';

REVOKE ALL ON FUNCTION public.revoke_platform_admin(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_platform_admin(UUID, TEXT) TO authenticated;

-- ============================================================
-- READ: THE ROSTER, SHAPED FOR THE SCREEN
-- ============================================================
-- The pre-existing list_platform_admin_accounts is left untouched so anything
-- depending on its shape keeps working; this returns what a management screen
-- needs, including who granted each account and whether it is still active.

CREATE OR REPLACE FUNCTION public.list_platform_admin_accounts_v2()
RETURNS TABLE(
  user_id UUID,
  email TEXT,
  full_name TEXT,
  level TEXT,
  status TEXT,
  permissions JSONB,
  permission_count INTEGER,
  developer_mode BOOLEAN,
  granted_by_email TEXT,
  granted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  note TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_platform_permission('platform:manage_users');

  RETURN QUERY
  SELECT
    pa.user_id,
    u.email::TEXT,
    NULLIF(btrim(concat_ws(' ', u.first_name, u.last_name)), '')::TEXT AS full_name,
    pa.level,
    pa.status,
    COALESCE((
      SELECT jsonb_agg(p.key ORDER BY p.key)
      FROM public.platform_permissions p
      WHERE public.platform_user_has_permission(pa.user_id, p.key)
    ), '[]'::JSONB) AS permissions,
    COALESCE((
      SELECT count(*)::INTEGER
      FROM public.platform_permissions p
      WHERE public.platform_user_has_permission(pa.user_id, p.key)
    ), 0) AS permission_count,
    public.developer_mode_enabled(pa.user_id) AS developer_mode,
    (SELECT g.email::TEXT FROM public.users g WHERE g.id = pa.granted_by) AS granted_by_email,
    pa.granted_at,
    pa.revoked_at,
    pa.note
  FROM public.platform_admins pa
  JOIN public.users u ON u.id = pa.user_id
  -- Owners first, then the active accounts, then by email: the accounts that can
  -- change the platform are the ones worth seeing first.
  ORDER BY
    (pa.level = 'super_admin' AND pa.status = 'active') DESC,
    (pa.status = 'active') DESC,
    u.email;
END;
$$;

COMMENT ON FUNCTION public.list_platform_admin_accounts_v2() IS
  'The platform admin roster with effective permission counts, developer-mode state and who granted each account. Requires platform:manage_users.';

REVOKE ALL ON FUNCTION public.list_platform_admin_accounts_v2() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_platform_admin_accounts_v2() TO authenticated;
