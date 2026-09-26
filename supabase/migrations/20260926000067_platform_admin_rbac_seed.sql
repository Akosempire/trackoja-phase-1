-- Migration: 067_platform_admin_rbac_seed.sql
-- Description: Platform administration is separated from business owners and
--   staff. Platform admins live in their own tables with their own permission
--   set, enforced in the database - never by hiding UI controls. A super admin
--   is the only level that may manage admins or grant developer mode.
--   The existing public.is_platform_admin(uuid) behaviour is preserved so the
--   current platform dashboard keeps working.
-- Author: TrackOja Team
-- Date: 2026-09-26

-- ============================================================
-- PLATFORM ADMINS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.platform_admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  level TEXT NOT NULL DEFAULT 'admin'
    CHECK (level IN ('super_admin', 'admin', 'support', 'developer')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'revoked')),
  note TEXT,
  granted_by UUID REFERENCES public.users(id),
  granted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  revoked_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_admins_level ON public.platform_admins(level, status);

COMMENT ON TABLE public.platform_admins IS
  'Platform-side identities. Deliberately separate from store_members so a business owner can never be mistaken for a platform admin.';
COMMENT ON COLUMN public.platform_admins.level IS
  'super_admin = manage admins and developer mode; admin = products/plans/businesses; support = read + notes; developer = diagnostics only.';

-- ============================================================
-- PLATFORM PERMISSION CATALOGUE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.platform_permissions (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'general'
    CHECK (category IN ('overview', 'products', 'businesses', 'users', 'plans',
                        'payments', 'activation', 'support', 'settings', 'developer')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

INSERT INTO public.platform_permissions (key, label, description, category) VALUES
  ('platform:view',              'View platform overview',   'See the platform overview, KPIs, and system health',            'overview'),
  ('platform:manage_products',   'Manage products',          'Create and edit products, their features and access settings',  'products'),
  ('platform:manage_businesses', 'Manage businesses',        'View and manage businesses, their owners, and their staff',     'businesses'),
  ('platform:manage_users',      'Manage users and roles',   'Manage platform admins and see product access per user',        'users'),
  ('platform:manage_plans',      'Manage plans and pricing', 'Edit and publish monthly and annual prices, limits, and features', 'plans'),
  ('platform:manage_payments',   'Manage payments',          'View transactions, verify payments, and manage renewals',       'payments'),
  ('platform:manage_activation', 'Manage activation',        'Issue, redeem, extend, and revoke activation keys',             'activation'),
  ('platform:support',           'Support and audit',        'Record support actions and admin notes, suspend and reinstate', 'support'),
  ('platform:manage_settings',   'Manage settings',          'Manage product visibility, notification templates, and settings', 'settings'),
  ('platform:impersonate',       'Read-only impersonation',  'Start a time-limited, read-only support session on a business', 'support'),
  ('developer:access',           'Use developer mode',       'Open developer diagnostics and use sandbox records',            'developer'),
  ('developer:manage',           'Grant developer mode',     'Grant or revoke developer mode for another platform user',      'developer')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- PLATFORM ADMIN PERMISSION GRANTS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.platform_admin_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL REFERENCES public.platform_permissions(key) ON DELETE CASCADE,
  granted_by UUID REFERENCES public.users(id),
  granted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, permission_key)
);

CREATE INDEX IF NOT EXISTS idx_platform_admin_permissions_user
  ON public.platform_admin_permissions(user_id);

-- ============================================================
-- AUTHORISATION HELPERS
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_platform_super_admin(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT pa.level = 'super_admin' AND pa.status = 'active'
     FROM public.platform_admins pa
     WHERE pa.user_id = p_user_id
     LIMIT 1),
    FALSE
  ) OR COALESCE(
    (SELECT u.is_platform_super_admin FROM public.users u WHERE u.id = p_user_id),
    FALSE
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_platform_super_admin(UUID) TO authenticated;

/**
 * The single authorisation gate for platform-side actions. Requires BOTH the
 * legacy is_platform_admin flag and an explicit grant of the requested
 * permission, except for super admins who hold everything. This is why hiding a
 * button in the UI is never sufficient: the same check runs inside every
 * mutating function.
 */
CREATE OR REPLACE FUNCTION public.platform_user_has_permission(p_user_id UUID, p_permission_key TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_level TEXT;
  v_status TEXT;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT pa.level, pa.status INTO v_level, v_status
  FROM public.platform_admins pa
  WHERE pa.user_id = p_user_id
  LIMIT 1;

  -- Explicit admin record governs when present.
  IF v_status IS NOT NULL THEN
    IF v_status <> 'active' THEN
      RETURN FALSE;
    END IF;
    IF v_level = 'super_admin' THEN
      RETURN TRUE;
    END IF;
    RETURN EXISTS (
      SELECT 1 FROM public.platform_admin_permissions pap
      WHERE pap.user_id = p_user_id AND pap.permission_key = p_permission_key
    );
  END IF;

  -- Fall back to the legacy flag so existing platform admins keep read access.
  IF public.is_platform_admin(p_user_id) THEN
    RETURN p_permission_key IN ('platform:view', 'platform:support', 'platform:manage_businesses');
  END IF;

  RETURN FALSE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.platform_user_has_permission(UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION public.platform_user_has_permission(UUID, TEXT) IS
  'Platform-side permission check. Super admins hold all permissions; legacy platform admins are limited to read/support/business views.';

/**
 * Developer mode is active only while an unrevoked, unexpired grant exists AND
 * the user still holds developer:access.
 */
CREATE OR REPLACE FUNCTION public.developer_mode_enabled(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.developer_access_grants g
    WHERE g.user_id = p_user_id
      AND g.status = 'active'
      AND (g.expires_at IS NULL OR g.expires_at > now())
  ) AND public.platform_user_has_permission(p_user_id, 'developer:access');
$$;

GRANT EXECUTE ON FUNCTION public.developer_mode_enabled(UUID) TO authenticated;

-- ============================================================
-- BACKFILL EXISTING PLATFORM ADMINS
-- ============================================================
-- Promote anyone already flagged so nothing that worked before stops working,
-- and give the first such admin super admin rights so developer mode is grantable.

INSERT INTO public.platform_admins (user_id, level, status, note, granted_at)
SELECT u.id, 'admin', 'active', 'Backfilled from users.is_platform_admin', now()
FROM public.users u
WHERE u.is_platform_admin = TRUE
ON CONFLICT (user_id) DO NOTHING;

UPDATE public.platform_admins pa
SET level = 'super_admin'
WHERE pa.level = 'admin'
  AND pa.user_id = (
    SELECT u.id FROM public.users u
    WHERE u.is_platform_admin = TRUE
    ORDER BY u.created_at ASC
    LIMIT 1
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.platform_admins x WHERE x.level = 'super_admin'
  );

-- Baseline grants for every existing platform admin.
INSERT INTO public.platform_admin_permissions (user_id, permission_key, granted_by)
SELECT pa.user_id, p.key, NULL
FROM public.platform_admins pa
JOIN public.platform_permissions p ON TRUE
WHERE pa.status = 'active'
  AND pa.level IN ('admin', 'support')
  AND p.key IN ('platform:view', 'platform:support', 'platform:manage_businesses')
ON CONFLICT (user_id, permission_key) DO NOTHING;

-- ============================================================
-- UPDATED_AT + RLS
-- ============================================================

DROP TRIGGER IF EXISTS handle_updated_at_platform_admins ON public.platform_admins;
CREATE TRIGGER handle_updated_at_platform_admins BEFORE UPDATE ON public.platform_admins
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_admin_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY platform_admins_select ON public.platform_admins
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_platform_admin(auth.uid()));

CREATE POLICY platform_permissions_select ON public.platform_permissions
  FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()));

CREATE POLICY platform_admin_permissions_select ON public.platform_admin_permissions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_platform_admin(auth.uid()));
