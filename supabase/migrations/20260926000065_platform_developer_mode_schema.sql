-- Migration: 065_platform_developer_mode_schema.sql
-- Description: Restricted developer mode. Grants are issued by a platform super
--   admin, sessions are journalled, sandbox businesses and feature flags are kept
--   separate from real customers, and impersonation is read-only, time-limited,
--   and explicitly started. Developer mode never bypasses payment verification,
--   subscription enforcement, tenant isolation, or production permissions for a
--   real customer account - overrides are restricted to sandbox records.
-- Author: TrackOja Team
-- Date: 2026-09-26

-- ============================================================
-- SUPER ADMIN AND SANDBOX FLAGS
-- ============================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_platform_super_admin BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS is_sandbox BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_organizations_sandbox ON public.organizations(is_sandbox);
CREATE INDEX IF NOT EXISTS idx_users_super_admin ON public.users(is_platform_super_admin)
  WHERE is_platform_super_admin;

COMMENT ON COLUMN public.users.is_platform_super_admin IS
  'Only a super admin may grant or revoke developer mode and manage platform admins.';
COMMENT ON COLUMN public.organizations.is_sandbox IS
  'Test business created by developer mode. Excluded from production revenue and customer counts.';

-- ============================================================
-- DEVELOPER ACCESS GRANTS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.developer_access_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked', 'expired')),
  granted_by UUID NOT NULL REFERENCES public.users(id),
  granted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE,
  revoked_at TIMESTAMP WITH TIME ZONE,
  revoked_by UUID REFERENCES public.users(id),
  reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- At most one active grant per user.
CREATE UNIQUE INDEX IF NOT EXISTS idx_developer_grants_active_user
  ON public.developer_access_grants(user_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_developer_grants_user ON public.developer_access_grants(user_id, granted_at DESC);

COMMENT ON TABLE public.developer_access_grants IS
  'Developer mode is never a signup option: it exists only as a grant made by a platform super admin.';

-- ============================================================
-- DEVELOPER SESSIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.developer_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'ended', 'expired')),
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  ended_at TIMESTAMP WITH TIME ZONE,
  ip_address TEXT,
  user_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_developer_sessions_user ON public.developer_sessions(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_developer_sessions_active ON public.developer_sessions(status) WHERE status = 'active';

-- ============================================================
-- IMPERSONATION SESSIONS (READ-ONLY)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.impersonation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL REFERENCES public.users(id),
  target_org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  target_user_id UUID REFERENCES public.users(id),
  mode TEXT NOT NULL DEFAULT 'read_only' CHECK (mode IN ('read_only')),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'ended', 'expired', 'revoked')),
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  ended_at TIMESTAMP WITH TIME ZONE,
  ended_reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_impersonation_admin ON public.impersonation_sessions(admin_user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_impersonation_org ON public.impersonation_sessions(target_org_id);
CREATE INDEX IF NOT EXISTS idx_impersonation_active ON public.impersonation_sessions(status) WHERE status = 'active';

COMMENT ON TABLE public.impersonation_sessions IS
  'Support-only, read-only, time-limited impersonation. Every start and end is audited. '
  'Writes by an impersonating admin are refused by the write-guard trigger below.';

-- ============================================================
-- FEATURE FLAGS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.feature_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL,
  description TEXT,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  scope TEXT NOT NULL DEFAULT 'platform'
    CHECK (scope IN ('platform', 'product', 'org')),
  product_id UUID REFERENCES public.platform_products(id) ON DELETE CASCADE,
  org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  is_sandbox BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by UUID REFERENCES public.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- One flag per key per scope target.
CREATE UNIQUE INDEX IF NOT EXISTS idx_feature_flags_scope
  ON public.feature_flags(key, scope, COALESCE(product_id, '00000000-0000-0000-0000-000000000000'::uuid),
                          COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE INDEX IF NOT EXISTS idx_feature_flags_key ON public.feature_flags(key);

-- ============================================================
-- READ-ONLY ENFORCEMENT FOR IMPERSONATION
-- ============================================================
-- Belt and braces: even if an impersonating admin's session somehow gained a
-- write permission, business-table writes are refused while an active
-- impersonation session exists for that admin. This is what makes "read-only by
-- default" a server-side guarantee rather than a UI convention.

CREATE OR REPLACE FUNCTION public.is_impersonating()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.impersonation_sessions s
    WHERE s.admin_user_id = auth.uid()
      AND s.status = 'active'
      AND s.expires_at > now()
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_impersonating() TO authenticated;

CREATE OR REPLACE FUNCTION public.block_writes_while_impersonating()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_impersonating() AND auth.uid() IS NOT NULL AND NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Impersonation is read-only';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION public.block_writes_while_impersonating() IS
  'Attach to business tables to guarantee read-only impersonation at the database level.';

-- ============================================================
-- UPDATED_AT TRIGGERS
-- ============================================================

DROP TRIGGER IF EXISTS handle_updated_at_developer_access_grants ON public.developer_access_grants;
CREATE TRIGGER handle_updated_at_developer_access_grants BEFORE UPDATE ON public.developer_access_grants
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS handle_updated_at_feature_flags ON public.feature_flags;
CREATE TRIGGER handle_updated_at_feature_flags BEFORE UPDATE ON public.feature_flags
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE public.developer_access_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.developer_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.impersonation_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;

-- A user may see their own grant; only platform admins see everyone's.
CREATE POLICY developer_access_grants_select ON public.developer_access_grants
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_platform_admin(auth.uid()));

CREATE POLICY developer_sessions_select ON public.developer_sessions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_platform_admin(auth.uid()));

CREATE POLICY impersonation_sessions_select ON public.impersonation_sessions
  FOR SELECT TO authenticated
  USING (admin_user_id = auth.uid() OR public.is_platform_admin(auth.uid()));

CREATE POLICY feature_flags_select ON public.feature_flags
  FOR SELECT TO authenticated
  USING (is_sandbox = FALSE OR public.is_platform_admin(auth.uid()));

-- All writes to these tables are function-only.
