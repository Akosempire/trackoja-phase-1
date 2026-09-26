-- Migration: 072_platform_developer_mode_functions.sql
-- Description: Restricted developer mode, end to end. Developer mode is granted
--   only by a platform super admin, to an existing platform admin, and never as
--   a signup option. It must never bypass payment verification, subscription
--   enforcement, tenant isolation, or production permissions for a real
--   customer account: overrides are permitted only against sandbox records
--   (organizations.is_sandbox = TRUE) and public.assert_sandbox_override()
--   raises on anything else, so the restriction is executable rather than
--   documented. Impersonation is read-only, time-limited, explicitly initiated,
--   and audited at both ends. Diagnostics are redacted: no secret keys, tokens,
--   passwords, payment provider payloads, webhook signatures, or raw metadata
--   blobs ever leave the database, and owner/actor emails are masked.
-- Author: TrackOja Team
-- Date: 2026-09-26

-- ============================================================
-- PLATFORM-SCOPED AUDIT ROWS
-- ============================================================
-- A developer grant, a revocation, or a developer session belongs to a platform
-- admin - not to a customer business - so there is no organization to attribute
-- it to. audit_logs.org_id was NOT NULL, which made those security events
-- impossible to record, and attributing them to a customer's org_id would leak
-- platform activity into that business's own audit view. Relaxing the column is
-- what lets "every grant is audited" be true rather than aspirational; nothing
-- else changes - existing rows keep their org_id, and every org-scoped writer is
-- untouched. Rows with a NULL org_id are invisible to the tenant RLS policy and
-- are read only by platform-side functions.

ALTER TABLE public.audit_logs ALTER COLUMN org_id DROP NOT NULL;

-- ============================================================
-- SANDBOX OVERRIDE GUARD
-- ============================================================
-- The single chokepoint every developer-mode override must pass through.
-- It is deliberately narrow: it grants nothing, it only refuses. A sandbox
-- record is the sole place a test override may be applied, and the platform
-- setting developer.sandbox_required fails closed - if it is ever set to
-- anything other than true, overrides stop working entirely instead of becoming
-- available on real customer accounts.

CREATE OR REPLACE FUNCTION public.assert_sandbox_override(p_org_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_is_sandbox BOOLEAN;
  v_setting JSONB;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.developer_mode_enabled(v_actor) THEN
    RAISE EXCEPTION 'Developer mode not granted';
  END IF;

  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'Developer overrides require an explicit sandbox organization';
  END IF;

  SELECT o.is_sandbox INTO v_is_sandbox
  FROM public.organizations o
  WHERE o.id = p_org_id;

  IF v_is_sandbox IS NULL THEN
    RAISE EXCEPTION 'Organization not found: %', p_org_id;
  END IF;

  SELECT ps.value INTO v_setting
  FROM public.platform_settings ps
  WHERE ps.key = 'developer.sandbox_required';

  IF v_setting IS NOT NULL AND v_setting <> 'true'::jsonb THEN
    RAISE EXCEPTION 'Developer overrides are disabled: the platform setting developer.sandbox_required is not true';
  END IF;

  IF v_is_sandbox = FALSE THEN
    RAISE EXCEPTION 'Developer overrides are restricted to sandbox organizations (organizations.is_sandbox = TRUE); % is a real customer account', p_org_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.assert_sandbox_override(UUID) TO authenticated;

COMMENT ON FUNCTION public.assert_sandbox_override(UUID) IS
  'Mandatory gate for every developer-mode override: raises unless the target is a sandbox organization. '
  'No payment verification, subscription, tenant isolation, or production permission check is ever bypassed for a real customer account.';

-- ============================================================
-- MY DEVELOPER STATUS
-- ============================================================
-- Anyone may ask about themselves. There is no platform gate here on purpose:
-- this drives the caller's own UI and reveals nothing about anyone else.

CREATE OR REPLACE FUNCTION public.get_my_developer_status()
RETURNS TABLE (
  is_platform_admin BOOLEAN,
  is_super_admin BOOLEAN,
  developer_mode BOOLEAN,
  granted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  active_session_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  RETURN QUERY
  SELECT
    public.is_platform_admin(v_user_id),
    public.is_platform_super_admin(v_user_id),
    public.developer_mode_enabled(v_user_id),
    (SELECT g.granted_at
       FROM public.developer_access_grants g
      WHERE g.user_id = v_user_id AND g.status = 'active'
      ORDER BY g.granted_at DESC
      LIMIT 1),
    (SELECT g.expires_at
       FROM public.developer_access_grants g
      WHERE g.user_id = v_user_id AND g.status = 'active'
      ORDER BY g.granted_at DESC
      LIMIT 1),
    (SELECT s.id
       FROM public.developer_sessions s
      WHERE s.user_id = v_user_id AND s.status = 'active'
      ORDER BY s.started_at DESC
      LIMIT 1);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_developer_status() TO authenticated;

-- ============================================================
-- DEVELOPER SESSIONS
-- ============================================================
-- A session can only be opened while an unrevoked, unexpired grant exists, so
-- revoking a grant costs the user their access immediately. Opening a session
-- never widens what the user may do: it is what makes their sandbox work
-- journalled and time-bounded.

CREATE OR REPLACE FUNCTION public.start_developer_session()
RETURNS public.developer_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_session public.developer_sessions;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.developer_mode_enabled(v_user_id) THEN
    RAISE EXCEPTION 'Developer mode not granted';
  END IF;

  -- A user may only ever have one open developer session.
  UPDATE public.developer_sessions AS s
  SET status = 'ended',
      ended_at = now(),
      last_seen_at = now()
  WHERE s.user_id = v_user_id
    AND s.status = 'active';

  INSERT INTO public.developer_sessions (user_id, status, started_at, last_seen_at, metadata)
  VALUES (
    v_user_id,
    'active',
    now(),
    now(),
    jsonb_build_object('opened_by', 'start_developer_session', 'overrides', 'sandbox_only')
  )
  RETURNING * INTO v_session;

  RETURN v_session;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_developer_session() TO authenticated;

CREATE OR REPLACE FUNCTION public.end_developer_session()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  UPDATE public.developer_sessions AS s
  SET status = 'ended',
      ended_at = now(),
      last_seen_at = now()
  WHERE s.user_id = v_user_id
    AND s.status = 'active';
END;
$$;

GRANT EXECUTE ON FUNCTION public.end_developer_session() TO authenticated;

-- ============================================================
-- DEVELOPER ACCESS GRANTS
-- ============================================================
-- Developer mode is never a signup option and never a business-side permission.
-- A super admin may only hand it to a user who is already an active platform
-- admin, so it can never be attached to an arbitrary business user, and the
-- grant carries a reason and an expiry.

CREATE OR REPLACE FUNCTION public.grant_developer_mode(
  p_user_id UUID,
  p_reason TEXT,
  p_valid_days INTEGER DEFAULT 30
)
RETURNS public.developer_access_grants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_admin public.platform_admins;
  v_valid_days INTEGER;
  v_expires_at TIMESTAMPTZ;
  v_grant public.developer_access_grants;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.is_platform_super_admin(v_actor) THEN
    RAISE EXCEPTION 'Permission denied: platform super admin required';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Target user is required';
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'A reason of at least 10 characters is required to grant developer mode';
  END IF;

  v_valid_days := COALESCE(p_valid_days, 30);
  IF v_valid_days < 1 OR v_valid_days > 3650 THEN
    RAISE EXCEPTION 'Developer mode validity must be between 1 and 3650 days';
  END IF;

  -- Developer mode is never handed to an arbitrary business user: the target
  -- must already be an active platform admin.
  SELECT pa.* INTO v_admin
  FROM public.platform_admins pa
  WHERE pa.user_id = p_user_id
    AND pa.status = 'active'
  LIMIT 1;

  IF v_admin.id IS NULL THEN
    RAISE EXCEPTION 'Developer mode may only be granted to an existing active platform admin (user %)', p_user_id;
  END IF;

  v_expires_at := now() + make_interval(days => v_valid_days);

  -- At most one active grant per user: supersede whatever was there before.
  UPDATE public.developer_access_grants AS g
  SET status = 'revoked',
      revoked_at = now(),
      revoked_by = v_actor,
      reason = 'Superseded by a new grant: ' || btrim(p_reason)
  WHERE g.user_id = p_user_id
    AND g.status = 'active';

  INSERT INTO public.developer_access_grants (user_id, status, granted_by, granted_at, expires_at, reason)
  VALUES (p_user_id, 'active', v_actor, now(), v_expires_at, btrim(p_reason))
  RETURNING * INTO v_grant;

  -- The grant is only effective while developer:access is held as well.
  INSERT INTO public.platform_admin_permissions (user_id, permission_key, granted_by)
  VALUES (p_user_id, 'developer:access', v_actor)
  ON CONFLICT (user_id, permission_key) DO NOTHING;

  -- Platform-scoped event: it belongs to a platform admin, not to a customer
  -- business, so org_id stays NULL on purpose.
  INSERT INTO public.audit_logs (
    actor_id, org_id, action, resource_type, resource_id, resource_name, status, details
  ) VALUES (
    v_actor,
    NULL,
    'DEVELOPER_MODE_GRANTED',
    'user',
    p_user_id,
    NULL,
    'success',
    jsonb_build_object(
      'grant_id', v_grant.id,
      'reason', btrim(p_reason),
      'valid_days', v_valid_days,
      'expires_at', v_grant.expires_at,
      'target_admin_level', v_admin.level,
      'sandbox_only_overrides', TRUE
    )
  );

  RETURN v_grant;
END;
$$;

GRANT EXECUTE ON FUNCTION public.grant_developer_mode(UUID, TEXT, INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_developer_mode(
  p_user_id UUID,
  p_reason TEXT
)
RETURNS public.developer_access_grants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_grant public.developer_access_grants;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.is_platform_super_admin(v_actor) THEN
    RAISE EXCEPTION 'Permission denied: platform super admin required';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Target user is required';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required to revoke developer mode';
  END IF;

  UPDATE public.developer_access_grants AS g
  SET status = 'revoked',
      revoked_at = now(),
      revoked_by = v_actor,
      reason = btrim(p_reason)
  WHERE g.user_id = p_user_id
    AND g.status = 'active'
  RETURNING * INTO v_grant;

  IF v_grant.id IS NULL THEN
    RAISE EXCEPTION 'No active developer grant for user %', p_user_id;
  END IF;

  -- A revoked grant must not leave an open session behind.
  UPDATE public.developer_sessions AS s
  SET status = 'ended',
      ended_at = now(),
      last_seen_at = now()
  WHERE s.user_id = p_user_id
    AND s.status = 'active';

  DELETE FROM public.platform_admin_permissions
  WHERE user_id = p_user_id
    AND permission_key = 'developer:access';

  INSERT INTO public.audit_logs (
    actor_id, org_id, action, resource_type, resource_id, resource_name, status, details
  ) VALUES (
    v_actor,
    NULL,
    'DEVELOPER_MODE_REVOKED',
    'user',
    p_user_id,
    NULL,
    'success',
    jsonb_build_object(
      'grant_id', v_grant.id,
      'reason', btrim(p_reason),
      'revoked_at', v_grant.revoked_at,
      'expires_at', v_grant.expires_at,
      'sessions_ended', TRUE
    )
  );

  RETURN v_grant;
END;
$$;

GRANT EXECUTE ON FUNCTION public.revoke_developer_mode(UUID, TEXT) TO authenticated;

-- Super admins only: this lists who holds developer mode, who gave it to them,
-- and why. These emails are returned unmasked on purpose - revoking access
-- requires knowing whose it is - and this function is gated to super admins,
-- carries no secrets, and is never exposed to a business account.

CREATE OR REPLACE FUNCTION public.list_developer_grants()
RETURNS TABLE (
  user_id UUID,
  email TEXT,
  status TEXT,
  level TEXT,
  granted_by_email TEXT,
  granted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  reason TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Permission denied: platform super admin required';
  END IF;

  RETURN QUERY
  SELECT
    g.user_id,
    u.email,
    g.status,
    pa.level,
    gb.email,
    g.granted_at,
    g.expires_at,
    g.revoked_at,
    g.reason
  FROM public.developer_access_grants g
  LEFT JOIN public.users u ON u.id = g.user_id
  LEFT JOIN public.platform_admins pa ON pa.user_id = g.user_id
  LEFT JOIN public.users gb ON gb.id = g.granted_by
  ORDER BY g.granted_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_developer_grants() TO authenticated;

-- ============================================================
-- DEVELOPER DIAGNOSTICS (REDACTED)
-- ============================================================
-- Read-only troubleshooting. It answers "what does this business actually have"
-- without ever handing the caller the means to act as that customer: no session
-- material, no tokens, no provider payloads, no raw metadata blobs, no
-- transaction references. A non-sandbox business can still be inspected because
-- support needs that, but override_allowed is FALSE for it and no act-as
-- capability is included anywhere in the payload.

CREATE OR REPLACE FUNCTION public.get_developer_diagnostics(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_org public.organizations;
  v_owner_email_masked TEXT;
  v_entitlements JSONB;
  v_subscription_status TEXT;
  v_subscription_plan TEXT;
  v_period_end TIMESTAMPTZ;
  v_trial_end TIMESTAMPTZ;
  v_pending BIGINT := 0;
  v_succeeded BIGINT := 0;
  v_failed BIGINT := 0;
  v_flags JSONB;
  v_recent_errors JSONB;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.developer_mode_enabled(v_actor) THEN
    RAISE EXCEPTION 'Developer mode not granted';
  END IF;

  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'Organization is required';
  END IF;

  SELECT o.* INTO v_org
  FROM public.organizations o
  WHERE o.id = p_org_id;

  IF v_org.id IS NULL THEN
    RAISE EXCEPTION 'Organization not found: %', p_org_id;
  END IF;

  -- Redaction: emails leave this function masked (o***@e***.com), never whole.
  SELECT CASE
           WHEN u.email IS NULL THEN NULL
           WHEN regexp_replace(u.email, '^([^@])[^@]*@([^.@])[^.]*\.(.*)$', '\1***@\2***.\3') = u.email
             THEN left(u.email, 1) || '***@***'
           ELSE regexp_replace(u.email, '^([^@])[^@]*@([^.@])[^.]*\.(.*)$', '\1***@\2***.\3')
         END
  INTO v_owner_email_masked
  FROM public.users u
  WHERE u.id = v_org.owner_id;

  SELECT COALESCE(jsonb_agg(x.entitlement ORDER BY x.product_key), '[]'::jsonb)
  INTO v_entitlements
  FROM (
    SELECT pp.key AS product_key,
           jsonb_build_object(
             'product_key', pp.key,
             'product_name', pp.name,
             'plan_key', pl.key,
             'plan_name', pl.name,
             'status', op.status,
             'agreed_user_limit', op.agreed_user_limit,
             'expires_at', op.expires_at,
             'is_sandbox', op.is_sandbox
           ) AS entitlement
    FROM public.organization_products op
    JOIN public.platform_products pp ON pp.id = op.product_id
    LEFT JOIN public.product_plans pl ON pl.id = op.plan_id
    WHERE op.org_id = p_org_id
  ) x;

  SELECT s.status, sp.name, s.current_period_end, s.trial_end
  INTO v_subscription_status, v_subscription_plan, v_period_end, v_trial_end
  FROM public.subscriptions s
  LEFT JOIN public.subscription_plans sp ON sp.id = s.plan_id
  WHERE s.org_id = p_org_id
  LIMIT 1;

  -- Status counts only. subscription_transactions.paystack_data (the provider
  -- payload) and every reference are deliberately never read here.
  SELECT
    COUNT(*) FILTER (WHERE t.status = 'pending'),
    COUNT(*) FILTER (WHERE t.status = 'success'),
    COUNT(*) FILTER (WHERE t.status = 'failed')
  INTO v_pending, v_succeeded, v_failed
  FROM public.subscription_transactions t
  WHERE t.org_id = p_org_id;

  SELECT COALESCE(jsonb_agg(x.flag ORDER BY x.flag ->> 'key'), '[]'::jsonb)
  INTO v_flags
  FROM (
    SELECT jsonb_build_object(
             'key', ff.key,
             'description', ff.description,
             'enabled', ff.enabled,
             'scope', ff.scope,
             'is_sandbox', ff.is_sandbox
           ) AS flag
    FROM public.feature_flags ff
    WHERE ff.scope = 'platform'
       OR ff.org_id = p_org_id
  ) x;

  -- The last ten failed/attempted audit rows for the business. changes and
  -- details are excluded because they can carry payload fragments.
  SELECT COALESCE(jsonb_agg(x.err ORDER BY x.created_at DESC), '[]'::jsonb)
  INTO v_recent_errors
  FROM (
    SELECT a.created_at AS created_at,
           jsonb_build_object(
             'action', a.action,
             'resource_type', a.resource_type,
             'resource_name', a.resource_name,
             'status', a.status,
             'created_at', a.created_at,
             'actor_email', CASE
                              WHEN au.email IS NULL THEN NULL
                              WHEN regexp_replace(au.email, '^([^@])[^@]*@([^.@])[^.]*\.(.*)$', '\1***@\2***.\3') = au.email
                                THEN left(au.email, 1) || '***@***'
                              ELSE regexp_replace(au.email, '^([^@])[^@]*@([^.@])[^.]*\.(.*)$', '\1***@\2***.\3')
                            END
           ) AS err
    FROM public.audit_logs a
    LEFT JOIN public.users au ON au.id = a.actor_id
    WHERE a.org_id = p_org_id
      AND a.status IN ('failed', 'attempted')
    ORDER BY a.created_at DESC
    LIMIT 10
  ) x;

  RETURN jsonb_build_object(
    'redacted', TRUE,
    'generated_at', now(),
    'org', jsonb_build_object(
      'id', v_org.id,
      'name', v_org.name,
      'slug', v_org.slug,
      'is_sandbox', v_org.is_sandbox,
      'billing_status', v_org.billing_status,
      'created_at', v_org.created_at,
      'owner_email', v_owner_email_masked
    ),
    'override_policy', jsonb_build_object(
      'sandbox_only', TRUE,
      'override_allowed', COALESCE(v_org.is_sandbox, FALSE),
      'act_as_customer', FALSE,
      'note', 'Diagnostics are read-only. Overrides are permitted only on sandbox organizations and this payload contains nothing that would let a caller act as the customer.'
    ),
    'entitlements', v_entitlements,
    'subscription', jsonb_build_object(
      'status', v_subscription_status,
      'plan_name', v_subscription_plan,
      'current_period_end', v_period_end,
      'trial_end', v_trial_end
    ),
    'payment_events', jsonb_build_object(
      'pending', v_pending,
      'success', v_succeeded,
      'failed', v_failed
    ),
    'feature_flags', v_flags,
    'recent_errors', v_recent_errors,
    'excluded', jsonb_build_array(
      'secret_keys', 'api_tokens', 'passwords', 'payment_provider_payloads',
      'webhook_signatures', 'raw_metadata', 'transaction_references'
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_developer_diagnostics(UUID) TO authenticated;

COMMENT ON FUNCTION public.get_developer_diagnostics(UUID) IS
  'Redacted, read-only diagnostics for one business. Emails are masked, provider payloads and raw metadata are excluded, '
  'and it exposes no act-as capability; override_allowed is true only for sandbox organizations.';

-- ============================================================
-- SANDBOX BUSINESSES
-- ============================================================
-- Sandbox records are the only place a test override may be applied, so they
-- are always unmistakably marked: the [SANDBOX] name prefix, is_sandbox = TRUE
-- on both the organization and its entitlement, and a slug suffix that keeps
-- them out of the way of real businesses.

CREATE OR REPLACE FUNCTION public.create_sandbox_business(
  p_name TEXT,
  p_owner_email TEXT DEFAULT NULL
)
RETURNS public.organizations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_name TEXT;
  v_slug TEXT;
  v_billing_email TEXT;
  v_org public.organizations;
  v_product public.platform_products;
  v_plan public.product_plans;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.developer_mode_enabled(v_actor) THEN
    RAISE EXCEPTION 'Developer mode not granted';
  END IF;

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'A sandbox business name is required';
  END IF;

  v_billing_email := NULLIF(btrim(COALESCE(p_owner_email, '')), '');

  -- Obvious test marker: a sandbox must never be mistakable for a customer.
  v_name := btrim(p_name);
  IF v_name NOT LIKE '[SANDBOX] %' THEN
    v_name := '[SANDBOX] ' || v_name;
  END IF;

  v_slug := trim(both '-' FROM lower(regexp_replace(v_name, '[^a-zA-Z0-9]+', '-', 'g')));
  IF v_slug = '' THEN
    v_slug := 'sandbox';
  END IF;
  v_slug := left(v_slug, 40) || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);

  WHILE EXISTS (SELECT 1 FROM public.organizations o WHERE o.slug = v_slug) LOOP
    v_slug := left(v_slug, 40) || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  END LOOP;

  -- The caller owns what they create; a sandbox needs its own creation path.
  INSERT INTO public.organizations (
    name, slug, owner_id, billing_email, billing_status, trial_ends_at, is_sandbox
  ) VALUES (
    v_name, v_slug, v_actor, v_billing_email, 'trial', NULL, TRUE
  )
  RETURNING * INTO v_org;

  SELECT p.* INTO v_product
  FROM public.platform_products p
  WHERE p.key = 'trackoja';

  IF v_product.id IS NULL THEN
    RAISE EXCEPTION 'The TrackOja product is not configured; a sandbox entitlement cannot be created';
  END IF;

  SELECT pl.* INTO v_plan
  FROM public.product_plans pl
  WHERE pl.product_id = v_product.id
    AND pl.status = 'active'
  ORDER BY pl.is_default DESC, pl.sort_order ASC
  LIMIT 1;

  -- Provisioning an entitlement with no verified payment is an override, so it
  -- may only ever land on a sandbox record. This raises if it would not.
  PERFORM public.assert_sandbox_override(v_org.id);

  INSERT INTO public.organization_products (
    org_id, product_id, plan_id, status, source,
    agreed_monthly_price, agreed_user_limit, currency,
    activated_at, expires_at, is_sandbox, metadata
  ) VALUES (
    v_org.id, v_product.id, v_plan.id, 'active', 'manual',
    0, v_plan.user_limit, COALESCE(v_plan.currency, 'NGN'),
    now(), NULL, TRUE,
    jsonb_build_object('product_key', v_product.key, 'plan_key', v_plan.key, 'sandbox', TRUE)
  )
  ON CONFLICT (org_id, product_id) DO UPDATE
  SET plan_id = EXCLUDED.plan_id,
      status = 'active',
      source = 'manual',
      agreed_monthly_price = EXCLUDED.agreed_monthly_price,
      agreed_user_limit = EXCLUDED.agreed_user_limit,
      currency = EXCLUDED.currency,
      activated_at = COALESCE(public.organization_products.activated_at, EXCLUDED.activated_at),
      expires_at = NULL,
      is_sandbox = TRUE,
      metadata = public.organization_products.metadata || EXCLUDED.metadata,
      updated_at = now();

  PERFORM public.create_audit_log(
    v_actor,
    v_org.id,
    NULL,
    'SANDBOX_BUSINESS_CREATED',
    'organization',
    v_org.id,
    v_org.name,
    NULL,
    jsonb_build_object(
      'is_sandbox', TRUE,
      'slug', v_org.slug,
      'billing_status', v_org.billing_status,
      'entitlement_product_key', v_product.key,
      'entitlement_plan_key', v_plan.key,
      'created_through', 'developer_mode'
    )
  );

  RETURN v_org;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_sandbox_business(TEXT, TEXT) TO authenticated;

-- Sandbox businesses only, and only for a user who holds developer mode.
-- These are test records, so they are listed with their owner email rather than
-- a masked one - they are not customer accounts.

CREATE OR REPLACE FUNCTION public.list_sandbox_businesses()
RETURNS TABLE (
  org_id UUID,
  name TEXT,
  slug TEXT,
  owner_email TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF NOT public.developer_mode_enabled(auth.uid()) THEN
    RAISE EXCEPTION 'Developer mode not granted';
  END IF;

  RETURN QUERY
  SELECT
    o.id,
    o.name,
    o.slug,
    u.email,
    o.created_at
  FROM public.organizations o
  LEFT JOIN public.users u ON u.id = o.owner_id
  WHERE o.is_sandbox = TRUE
  ORDER BY o.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_sandbox_businesses() TO authenticated;

-- ============================================================
-- IMPERSONATION (READ-ONLY)
-- ============================================================
-- Support access to a real customer account. It is a separate permission from
-- developer mode, it is explicitly started by a named admin for a stated reason,
-- it expires, it is always mode 'read_only' (the table's CHECK constraint allows
-- nothing else and block_writes_while_impersonating() refuses business writes
-- during it), and both ends are audited.

CREATE OR REPLACE FUNCTION public.start_impersonation(
  p_org_id UUID,
  p_reason TEXT,
  p_minutes INTEGER DEFAULT 15
)
RETURNS public.impersonation_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := public.require_platform_permission('platform:impersonate');
  v_org public.organizations;
  v_minutes INTEGER;
  v_session public.impersonation_sessions;
BEGIN
  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'A reason of at least 10 characters is required to start impersonation';
  END IF;

  v_minutes := LEAST(GREATEST(COALESCE(p_minutes, 15), 1), 60);

  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'Organization is required';
  END IF;

  SELECT o.* INTO v_org
  FROM public.organizations o
  WHERE o.id = p_org_id;

  IF v_org.id IS NULL THEN
    RAISE EXCEPTION 'Organization not found: %', p_org_id;
  END IF;

  -- One live support session at a time, so a second context can never be
  -- confused with the first.
  IF EXISTS (
    SELECT 1
    FROM public.impersonation_sessions s
    WHERE s.admin_user_id = v_actor
      AND s.status = 'active'
  ) THEN
    RAISE EXCEPTION 'You already have an active impersonation session; end it first';
  END IF;

  -- A sandbox business is reached through developer mode, not by impersonating
  -- a customer. The refusal holds for sandbox records unless the caller
  -- genuinely holds developer mode.
  IF v_org.is_sandbox = TRUE AND NOT public.developer_mode_enabled(v_actor) THEN
    RAISE EXCEPTION 'Sandbox businesses are reached through developer mode, not impersonation';
  END IF;

  INSERT INTO public.impersonation_sessions (
    admin_user_id, target_org_id, target_user_id, mode, reason, status, started_at, expires_at
  ) VALUES (
    v_actor, p_org_id, v_org.owner_id, 'read_only', btrim(p_reason), 'active',
    now(), now() + make_interval(mins => v_minutes)
  )
  RETURNING * INTO v_session;

  PERFORM public.create_audit_log(
    v_actor,
    p_org_id,
    NULL,
    'IMPERSONATION_STARTED',
    'organization',
    p_org_id,
    v_org.name,
    NULL,
    jsonb_build_object(
      'session_id', v_session.id,
      'reason', btrim(p_reason),
      'minutes', v_minutes,
      'mode', 'read_only',
      'expires_at', v_session.expires_at
    )
  );

  RETURN v_session;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_impersonation(UUID, TEXT, INTEGER) TO authenticated;

COMMENT ON FUNCTION public.start_impersonation(UUID, TEXT, INTEGER) IS
  'Starts a read-only, time-limited, audited support session. Requires platform:impersonate and a stated reason; '
  'duration is clamped to 1-60 minutes and a second live session is refused.';

CREATE OR REPLACE FUNCTION public.end_impersonation(p_session_id UUID DEFAULT NULL)
RETURNS public.impersonation_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_session public.impersonation_sessions;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_session_id IS NULL THEN
    -- The caller's own live session.
    SELECT s.* INTO v_session
    FROM public.impersonation_sessions s
    WHERE s.admin_user_id = v_actor
      AND s.status = 'active'
    ORDER BY s.started_at DESC
    LIMIT 1;
  ELSE
    -- Their own session, or any session when the caller is a platform admin.
    SELECT s.* INTO v_session
    FROM public.impersonation_sessions s
    WHERE s.id = p_session_id
      AND (s.admin_user_id = v_actor OR public.is_platform_admin(v_actor))
    LIMIT 1;
  END IF;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'No impersonation session found to end';
  END IF;

  IF v_session.status <> 'active' THEN
    RAISE EXCEPTION 'Impersonation session % is not active', v_session.id;
  END IF;

  UPDATE public.impersonation_sessions AS s
  SET status = 'ended',
      ended_at = now(),
      ended_reason = 'Ended by the impersonating admin'
  WHERE s.id = v_session.id
  RETURNING * INTO v_session;

  PERFORM public.create_audit_log(
    v_actor,
    v_session.target_org_id,
    NULL,
    'IMPERSONATION_ENDED',
    'organization',
    v_session.target_org_id,
    v_session.ended_reason,
    NULL,
    jsonb_build_object(
      'session_id', v_session.id,
      'started_at', v_session.started_at,
      'ended_at', v_session.ended_at,
      'mode', v_session.mode
    )
  );

  RETURN v_session;
END;
$$;

GRANT EXECUTE ON FUNCTION public.end_impersonation(UUID) TO authenticated;

-- No platform gate: this is what drives the persistent in-app indicator, and it
-- only ever reports the caller's own session.

CREATE OR REPLACE FUNCTION public.get_active_impersonation()
RETURNS TABLE (
  session_id UUID,
  org_id UUID,
  org_name TEXT,
  expires_at TIMESTAMPTZ,
  seconds_remaining INTEGER,
  reason TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.target_org_id,
    o.name,
    s.expires_at,
    GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (s.expires_at - now())))::INTEGER),
    s.reason
  FROM public.impersonation_sessions s
  JOIN public.organizations o ON o.id = s.target_org_id
  WHERE s.admin_user_id = auth.uid()
    AND s.status = 'active'
    AND s.expires_at > now()
  ORDER BY s.started_at DESC
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_active_impersonation() TO authenticated;

-- ============================================================
-- MAINTENANCE
-- ============================================================
-- Idempotent cleanup with no gate: it can only ever take access away, so there
-- is nothing to authorise. Expiring the grants first is what makes the session
-- sweep correct - a session cannot outlive the grant behind it.

CREATE OR REPLACE FUNCTION public.expire_stale_developer_state()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_changed BIGINT := 0;
  v_rows BIGINT := 0;
BEGIN
  UPDATE public.developer_access_grants AS g
  SET status = 'expired'
  WHERE g.status = 'active'
    AND g.expires_at IS NOT NULL
    AND g.expires_at <= now();
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_changed := v_changed + v_rows;

  -- A developer session cannot outlive the grant that justified it.
  UPDATE public.developer_sessions AS s
  SET status = 'expired',
      ended_at = COALESCE(s.ended_at, now()),
      last_seen_at = now()
  WHERE s.status = 'active'
    AND NOT public.developer_mode_enabled(s.user_id);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_changed := v_changed + v_rows;

  -- Over-time impersonation sessions are closed out, never left live.
  UPDATE public.impersonation_sessions AS s
  SET status = 'expired',
      ended_at = COALESCE(s.ended_at, now()),
      ended_reason = COALESCE(s.ended_reason, 'Expired automatically')
  WHERE s.status = 'active'
    AND s.expires_at <= now();
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_changed := v_changed + v_rows;

  RETURN v_changed::INTEGER;
END;
$$;

GRANT EXECUTE ON FUNCTION public.expire_stale_developer_state() TO authenticated;

COMMENT ON FUNCTION public.expire_stale_developer_state() IS
  'Maintenance sweep: expires lapsed developer grants, developer sessions that outlived their grant, '
  'and over-time impersonation sessions. Returns the number of rows changed.';
