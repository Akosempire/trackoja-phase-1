-- TrackOja onboarding and free trial rollout.
-- Requires earlier project migrations through 20260928000102.
-- Run this entire file in Supabase SQL Editor before deploying the matching frontend.
-- Safe to rerun; existing configuration and agreed paid subscriptions are preserved.
BEGIN;

-- SOURCE: 20260929000001_onboarding_business_creation_fix.sql
-- gen_random_bytes belongs to pgcrypto, normally installed in Supabase's
-- extensions schema. These SECURITY DEFINER functions had search_path=public,
-- so creating a business slug (and later a checkout reference) could fail.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

DO $$
DECLARE
  v_crypto_schema NAME;
BEGIN
  SELECT n.nspname INTO v_crypto_schema
  FROM pg_catalog.pg_extension AS e
  JOIN pg_catalog.pg_namespace AS n ON n.oid = e.extnamespace
  WHERE e.extname = 'pgcrypto';

  IF v_crypto_schema IS NULL THEN
    RAISE EXCEPTION 'pgcrypto is required for onboarding and checkout';
  END IF;

  -- Both functions qualify their table and application-function references,
  -- so only pg_catalog and pgcrypto's real schema are needed here.
  EXECUTE format(
    'ALTER FUNCTION public.create_onboarding_business(text,text,text,text,text,text) SET search_path = pg_catalog, %I',
    v_crypto_schema
  );
  EXECUTE format(
    'ALTER FUNCTION public.start_plan_version_checkout(uuid) SET search_path = pg_catalog, %I',
    v_crypto_schema
  );
END;
$$;


-- SOURCE: 20260929000002_free_trial_billing.sql
-- Trials reuse organization_products. No payments or invoices are fabricated.

INSERT INTO public.platform_settings(key, value, category, description) VALUES
  ('billing.payment_system', '"DISABLED"', 'payments', 'DISABLED, TEST or LIVE. TEST is restricted to internal sandbox purchases.'),
  ('billing.trial_enabled', 'true', 'payments', 'Allow eligible owners to start a free trial.'),
  ('billing.default_trial_days', '14', 'payments', 'Duration granted to new trials. Existing trial dates are preserved.')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.validate_billing_settings()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.key = 'billing.payment_system' AND NEW.value NOT IN ('"DISABLED"'::jsonb, '"TEST"'::jsonb, '"LIVE"'::jsonb) THEN
    RAISE EXCEPTION 'Choose DISABLED, TEST or LIVE';
  ELSIF NEW.key = 'billing.trial_enabled' AND jsonb_typeof(NEW.value) <> 'boolean' THEN
    RAISE EXCEPTION 'Trial availability must be true or false';
  ELSIF NEW.key = 'billing.default_trial_days' THEN
    IF jsonb_typeof(NEW.value) <> 'number' OR NEW.value::text !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Trial duration must be a whole number of days';
    END IF;
    IF (NEW.value::text)::integer NOT BETWEEN 1 AND 365 THEN RAISE EXCEPTION 'Trial duration must be from 1 to 365 days'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS validate_billing_settings ON public.platform_settings;
CREATE TRIGGER validate_billing_settings BEFORE INSERT OR UPDATE ON public.platform_settings
FOR EACH ROW EXECUTE FUNCTION public.validate_billing_settings();

CREATE OR REPLACE FUNCTION public.get_billing_availability()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'payment_system', COALESCE((SELECT value #>> '{}' FROM public.platform_settings WHERE key = 'billing.payment_system'), 'DISABLED'),
    'trial_enabled', COALESCE((SELECT value = 'true'::jsonb FROM public.platform_settings WHERE key = 'billing.trial_enabled'), false),
    'trial_days', COALESCE((SELECT (value::text)::integer FROM public.platform_settings WHERE key = 'billing.default_trial_days'), 0)
  );
$$;
REVOKE ALL ON FUNCTION public.get_billing_availability() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_billing_availability() TO anon, authenticated, service_role;

ALTER TABLE public.organization_products DROP CONSTRAINT IF EXISTS organization_products_status_check;
ALTER TABLE public.organization_products ADD CONSTRAINT organization_products_status_check
  CHECK (status IN ('pending', 'trialing', 'active', 'past_due', 'suspended', 'expired', 'cancelled'));
ALTER TABLE public.organization_products ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ;
ALTER TABLE public.organization_products ADD COLUMN IF NOT EXISTS trial_activated_by UUID REFERENCES public.users(id);

-- Internal predicate shared by entry routing, entitlement reads and seat checks.
CREATE OR REPLACE FUNCTION public.product_entitlement_has_access(p_org UUID, p_product UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.organization_products op
    WHERE op.org_id = p_org AND op.product_id = p_product AND (
      (op.status = 'active' AND (op.expires_at IS NULL OR op.expires_at > now()))
      OR (op.status = 'trialing' AND op.source = 'trial' AND op.trial_ends_at IS NOT NULL
        AND (op.trial_ends_at > now() OR public.get_billing_availability()->>'payment_system' <> 'LIVE'))
    ));
$$;
REVOKE ALL ON FUNCTION public.product_entitlement_has_access(UUID, UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.start_product_trial(p_plan_version_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor UUID := auth.uid(); v_org UUID; v_version public.product_plan_versions%ROWTYPE;
  v_ent public.organization_products%ROWTYPE; v_config JSONB; v_end TIMESTAMPTZ;
  v_plan public.product_plans%ROWTYPE; v_product_key TEXT;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  v_config := public.get_billing_availability();
  IF NOT (v_config->>'trial_enabled')::boolean THEN RAISE EXCEPTION 'Free trials are currently unavailable'; END IF;
  SELECT current_org_id INTO v_org FROM public.users WHERE id = v_actor;
  -- Serialise all activations for this business, including double-clicks.
  PERFORM 1 FROM public.organizations WHERE id = v_org AND owner_id = v_actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Only the business owner can start a trial'; END IF;
  SELECT v.* INTO v_version FROM public.product_plan_versions v
    JOIN public.product_plans pp ON pp.id = v.plan_id
    JOIN public.platform_products p ON p.id = v.product_id
    WHERE v.id = p_plan_version_id AND v.status = 'active' AND v.effective_until IS NULL
      AND v.effective_from <= now() AND pp.status = 'active' AND pp.is_public
      AND pp.published_at IS NOT NULL AND p.status = 'active' AND p.visibility = 'public';
  IF NOT FOUND THEN RAISE EXCEPTION 'This plan is not available for a trial'; END IF;
  SELECT * INTO v_plan FROM public.product_plans WHERE id = v_version.plan_id;
  SELECT key INTO v_product_key FROM public.platform_products WHERE id = v_version.product_id;
  SELECT * INTO v_ent FROM public.organization_products
    WHERE org_id = v_org AND product_id = v_version.product_id FOR UPDATE;
  IF v_ent.trial_started_at IS NOT NULL THEN
    IF v_ent.status = 'trialing' THEN
      RETURN jsonb_build_object('plan_name', COALESCE(v_ent.metadata->>'trial_plan_name', v_plan.name),
        'trial_ends_at', v_ent.trial_ends_at, 'trial_days', v_ent.metadata->'trial_days', 'resumed', true);
    END IF;
    RAISE EXCEPTION 'This business has already used its trial. Contact support for assistance';
  END IF;
  IF v_ent.status IS NOT NULL AND v_ent.status <> 'pending' THEN
    RAISE EXCEPTION 'An existing subscription cannot be replaced by a free trial';
  END IF;
  IF EXISTS (SELECT 1 FROM public.subscription_transactions t WHERE t.org_id = v_org AND t.status = 'success') THEN
    RAISE EXCEPTION 'This business already has a payment history. Contact support to change its plan';
  END IF;
  IF (v_version.limits->>'users')::integer > 0 AND
    (SELECT count(DISTINCT sm.user_id) FROM public.store_members sm JOIN public.stores st ON st.id = sm.store_id
      WHERE st.org_id = v_org AND sm.status = 'active') > (v_version.limits->>'users')::integer THEN
    RAISE EXCEPTION 'This plan has fewer seats than your current team. Choose a larger plan';
  END IF;
  v_end := now() + make_interval(days => (v_config->>'trial_days')::integer);
  INSERT INTO public.organization_products(org_id, product_id, plan_id, status, source,
    agreed_monthly_price, agreed_annual_price, agreed_user_limit, currency,
    trial_started_at, trial_ends_at, trial_activated_by, activated_at, expires_at, is_sandbox, metadata)
  VALUES (v_org, v_version.product_id, v_version.plan_id, 'trialing', 'trial',
    CASE WHEN v_version.billing_cycle = 'monthly' THEN v_version.amount_minor / 100.0 ELSE v_plan.monthly_price END,
    CASE WHEN v_version.billing_cycle = 'annual' THEN v_version.amount_minor / 100.0 ELSE v_plan.annual_price END,
    (v_version.limits->>'users')::integer, v_version.currency,
    now(), v_end, v_actor, now(), v_end, (SELECT is_sandbox FROM public.organizations WHERE id = v_org),
    jsonb_build_object('plan_version_id', v_version.id, 'billing_cycle', v_version.billing_cycle,
      'trial_days', (v_config->>'trial_days')::integer, 'trial_plan_name', v_version.display_name,
      'features', v_version.features, 'limits', v_version.limits, 'entitlements', v_version.entitlements))
  ON CONFLICT (org_id, product_id) DO UPDATE SET
    plan_id = EXCLUDED.plan_id, status = 'trialing', source = 'trial',
    agreed_monthly_price = EXCLUDED.agreed_monthly_price, agreed_annual_price = EXCLUDED.agreed_annual_price,
    agreed_user_limit = EXCLUDED.agreed_user_limit, currency = EXCLUDED.currency,
    trial_started_at = EXCLUDED.trial_started_at, trial_ends_at = EXCLUDED.trial_ends_at,
    trial_activated_by = EXCLUDED.trial_activated_by, activated_at = EXCLUDED.activated_at,
    expires_at = EXCLUDED.expires_at, metadata = organization_products.metadata || EXCLUDED.metadata
  RETURNING * INTO v_ent;
  -- Compatibility columns describe a trial, never a paid subscription.
  IF v_product_key = 'trackoja' THEN
    UPDATE public.organizations SET billing_status = 'trial', trial_ends_at = v_end WHERE id = v_org;
    UPDATE public.subscriptions SET status = 'trialing', trial_end = v_end,
      current_period_end = v_end, metadata = metadata || jsonb_build_object('trial_plan_version_id', v_version.id)
      WHERE org_id = v_org AND status = 'trialing';
  END IF;
  UPDATE public.onboarding_progress SET selected_plan_version_id = v_version.id,
    state = 'onboarding_completed', completed_at = now(), checkout_reference = NULL
    WHERE user_id = v_actor AND product_id = v_version.product_id AND org_id = v_org;
  PERFORM public.create_audit_log(v_actor, v_org, NULL, 'PRODUCT_TRIAL_STARTED',
    'organization_product', v_ent.id, v_version.display_name, NULL,
    jsonb_build_object('plan_version_id', v_version.id, 'trial_ends_at', v_end));
  RETURN jsonb_build_object('plan_name', v_version.display_name, 'trial_ends_at', v_end,
    'trial_days', (v_config->>'trial_days')::integer, 'resumed', false);
END;
$$;
REVOKE ALL ON FUNCTION public.start_product_trial(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_product_trial(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.extend_product_trial(p_entitlement_id UUID, p_days INTEGER, p_reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor UUID; v_ent public.organization_products%ROWTYPE; v_end TIMESTAMPTZ;
BEGIN
  v_actor := public.require_platform_permission('platform:manage_payments');
  IF p_days IS NULL OR p_days NOT BETWEEN 1 AND 365 OR length(trim(COALESCE(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'Provide 1–365 days and a reason of at least 10 characters';
  END IF;
  SELECT * INTO v_ent FROM public.organization_products WHERE id = p_entitlement_id FOR UPDATE;
  IF v_ent.id IS NULL OR v_ent.source <> 'trial' OR v_ent.trial_started_at IS NULL OR v_ent.status NOT IN ('trialing', 'expired') THEN
    RAISE EXCEPTION 'Only a trial can be extended';
  END IF;
  v_end := greatest(now(), v_ent.trial_ends_at) + make_interval(days => p_days);
  UPDATE public.organization_products SET status = 'trialing', trial_ends_at = v_end, expires_at = v_end WHERE id = v_ent.id;
  IF v_ent.product_id = (SELECT id FROM public.platform_products WHERE key = 'trackoja') THEN
    UPDATE public.organizations SET trial_ends_at = v_end WHERE id = v_ent.org_id AND billing_status = 'trial';
    UPDATE public.subscriptions SET trial_end = v_end, current_period_end = v_end WHERE org_id = v_ent.org_id AND status = 'trialing';
  END IF;
  PERFORM public.create_audit_log(v_actor, v_ent.org_id, NULL, 'PRODUCT_TRIAL_EXTENDED',
    'organization_product', v_ent.id, NULL,
    jsonb_build_object('previous_end', v_ent.trial_ends_at, 'new_end', v_end), jsonb_build_object('reason', trim(p_reason)));
END;
$$;
REVOKE ALL ON FUNCTION public.extend_product_trial(UUID, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.extend_product_trial(UUID, INTEGER, TEXT) TO authenticated;

-- All checkout entry points, including older clients, are stopped before they
-- can create a pending payment when the platform is disabled.
CREATE OR REPLACE FUNCTION public.guard_subscription_payment_creation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_mode TEXT := public.get_billing_availability()->>'payment_system';
BEGIN
  IF v_mode = 'DISABLED' THEN RAISE EXCEPTION 'Online subscription payments are not available yet. Start a free trial'; END IF;
  IF v_mode = 'TEST' THEN
    PERFORM public.require_platform_permission('developer:access');
    IF NOT public.developer_mode_enabled(auth.uid()) THEN RAISE EXCEPTION 'An active developer grant is required for test payments'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = NEW.org_id AND is_sandbox) THEN
      RAISE EXCEPTION 'Test payments require a sandbox business';
    END IF;
    NEW.is_test_data := true;
    NEW.payment_mode := 'test';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_subscription_payment_creation ON public.subscription_transactions;
CREATE TRIGGER guard_subscription_payment_creation BEFORE INSERT ON public.subscription_transactions
FOR EACH ROW EXECUTE FUNCTION public.guard_subscription_payment_creation();



-- SOURCE: 20260929000003_trial_access_rules.sql
-- Route, entitlement and seat decisions share the same trial policy.

CREATE OR REPLACE FUNCTION public.resolve_my_trackoja_entry()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user UUID := auth.uid();
  v_profile public.users%ROWTYPE;
  v_is_platform_admin BOOLEAN := false;
  v_product UUID;
  v_org UUID;
  v_store UUID;
  v_org_count INTEGER := 0;
  v_role TEXT;
  v_progress public.onboarding_progress%ROWTYPE;
  v_entitlement public.organization_products%ROWTYPE;
  v_has_access BOOLEAN := false;
  v_merchant_kind TEXT;
  v_merchant_destination TEXT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT * INTO v_profile FROM public.users WHERE id = v_user;
  IF v_profile.id IS NULL THEN RAISE EXCEPTION 'User profile is not ready'; END IF;
  v_is_platform_admin := COALESCE(v_profile.is_platform_admin, false);

  SELECT id INTO v_product FROM public.platform_products WHERE key = 'trackoja';
  IF v_product IS NULL THEN RAISE EXCEPTION 'TrackOja product is not configured'; END IF;

  SELECT count(DISTINCT o.id) INTO v_org_count
  FROM public.organizations o
  LEFT JOIN public.organization_members om ON om.org_id = o.id AND om.user_id = v_user
  WHERE o.owner_id = v_user OR om.user_id = v_user;

  SELECT o.id INTO v_org
  FROM public.organizations o
  LEFT JOIN public.organization_members om ON om.org_id = o.id AND om.user_id = v_user
  WHERE o.id = v_profile.current_org_id AND (o.owner_id = v_user OR om.user_id = v_user);

  IF v_org IS NULL AND v_org_count = 1 THEN
    SELECT o.id INTO v_org
    FROM public.organizations o
    LEFT JOIN public.organization_members om ON om.org_id = o.id AND om.user_id = v_user
    WHERE o.owner_id = v_user OR om.user_id = v_user
    ORDER BY o.created_at
    LIMIT 1;
  ELSIF v_org IS NULL AND v_org_count > 1 THEN
    RETURN jsonb_build_object(
      'kind', CASE WHEN v_is_platform_admin THEN 'platform_admin' ELSE 'workspace_selection_required' END,
      'destination', CASE WHEN v_is_platform_admin THEN '/platform' ELSE '/workspace' END,
      'merchant_kind', 'workspace_selection_required',
      'merchant_destination', '/workspace',
      'has_access', false,
      'current_org_id', NULL,
      'current_store_id', NULL,
      'organization_count', v_org_count,
      'is_invited_user', false
    );
  END IF;

  IF v_org IS NULL THEN
    SELECT * INTO v_progress
    FROM public.onboarding_progress
    WHERE user_id = v_user AND product_id = v_product
    ORDER BY created_at DESC
    LIMIT 1;

    v_merchant_kind := CASE WHEN v_progress.id IS NULL THEN 'new_user' ELSE 'onboarding_in_progress' END;
    RETURN jsonb_build_object(
      'kind', CASE WHEN v_is_platform_admin THEN 'platform_admin' ELSE v_merchant_kind END,
      'destination', CASE WHEN v_is_platform_admin THEN '/platform' ELSE '/onboarding' END,
      'merchant_kind', v_merchant_kind,
      'merchant_destination', '/onboarding',
      'has_access', false,
      'current_org_id', NULL,
      'current_store_id', NULL,
      'organization_count', 0,
      'is_invited_user', false,
      'onboarding_state', COALESCE(v_progress.state, 'account_ready')
    );
  END IF;

  SELECT om.role INTO v_role
  FROM public.organization_members om
  WHERE om.org_id = v_org AND om.user_id = v_user;

  IF v_role IS NULL AND EXISTS (
    SELECT 1 FROM public.organizations WHERE id = v_org AND owner_id = v_user
  ) THEN
    v_role := 'owner';
  END IF;

  SELECT sm.store_id INTO v_store
  FROM public.store_members sm
  JOIN public.stores s ON s.id = sm.store_id
  WHERE sm.user_id = v_user AND sm.status = 'active' AND s.org_id = v_org
  ORDER BY sm.accepted_at NULLS LAST, sm.created_at
  LIMIT 1;

  IF v_store IS NULL AND v_role = 'owner' THEN
    SELECT id INTO v_store
    FROM public.stores
    WHERE org_id = v_org AND status = 'active'
    ORDER BY created_at
    LIMIT 1;
  END IF;

  UPDATE public.users
  SET current_org_id = v_org,
      current_store_id = CASE
        WHEN current_store_id IN (
          SELECT s.id
          FROM public.stores s
          WHERE s.org_id = v_org
            AND (
              v_role = 'owner'
              OR EXISTS (
                SELECT 1 FROM public.store_members sm
                WHERE sm.store_id = s.id AND sm.user_id = v_user AND sm.status = 'active'
              )
            )
        ) THEN current_store_id
        ELSE v_store
      END
  WHERE id = v_user;

  SELECT current_store_id INTO v_store FROM public.users WHERE id = v_user;

  SELECT * INTO v_entitlement
  FROM public.organization_products
  WHERE org_id = v_org AND product_id = v_product;

  v_has_access := public.product_entitlement_has_access(v_org, v_product);

  IF NOT v_has_access AND v_entitlement.trial_started_at IS NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.subscriptions s
      WHERE s.org_id = v_org
        AND (
          (s.status = 'active' AND (s.current_period_end IS NULL OR s.current_period_end > now()))
          OR (s.status = 'trialing' AND s.trial_end IS NOT NULL AND s.trial_end > now())
        )
    ) INTO v_has_access;
  END IF;

  IF NOT v_has_access AND v_entitlement.trial_started_at IS NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.organizations o
      WHERE o.id = v_org
        AND (
          o.billing_status = 'active'
          OR (o.billing_status = 'trial' AND o.trial_ends_at IS NOT NULL AND o.trial_ends_at > now())
        )
    ) INTO v_has_access;
  END IF;

  SELECT * INTO v_progress
  FROM public.onboarding_progress
  WHERE user_id = v_user AND product_id = v_product
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_has_access THEN
    v_merchant_kind := CASE WHEN v_role = 'owner' THEN 'existing_user' ELSE 'invited_user' END;
    v_merchant_destination := '/dashboard';
  ELSIF v_progress.id IS NOT NULL
    AND v_progress.org_id = v_org
    AND v_progress.state <> 'onboarding_completed'
    AND v_role = 'owner' THEN
    v_merchant_kind := 'onboarding_in_progress';
    v_merchant_destination := '/onboarding';
  ELSE
    v_merchant_kind := CASE WHEN v_role = 'owner' THEN 'billing_action_required' ELSE 'access_restricted' END;
    v_merchant_destination := '/billing';
  END IF;

  RETURN jsonb_build_object(
    'kind', CASE WHEN v_is_platform_admin THEN 'platform_admin' ELSE v_merchant_kind END,
    'destination', CASE WHEN v_is_platform_admin THEN '/platform' ELSE v_merchant_destination END,
    'merchant_kind', v_merchant_kind,
    'merchant_destination', v_merchant_destination,
    'has_access', v_has_access,
    'current_org_id', v_org,
    'current_store_id', v_store,
    'organization_count', v_org_count,
    'role', v_role,
    'is_invited_user', v_role <> 'owner',
    'onboarding_state', v_progress.state,
    'entitlement_status', v_entitlement.status
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_commercial_access(p_product_key TEXT DEFAULT 'trackoja')
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org UUID; v_product UUID; v_ent public.organization_products%ROWTYPE; v_state TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT current_org_id INTO v_org FROM public.users WHERE id = auth.uid();
  SELECT id INTO v_product FROM public.platform_products WHERE key = p_product_key;
  SELECT state INTO v_state FROM public.onboarding_progress WHERE user_id = auth.uid() AND product_id = v_product;
  SELECT * INTO v_ent FROM public.organization_products WHERE org_id = v_org AND product_id = v_product;
  RETURN jsonb_build_object(
    'org_id', v_org, 'onboarding_state', COALESCE(v_state, 'account_ready'),
    'entitlement_status', v_ent.status,
    'has_access', public.product_entitlement_has_access(v_org, v_product),
    'is_test_data', COALESCE((v_ent.metadata->>'is_test_data')::BOOLEAN, false)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_entitlement(p_product_key TEXT DEFAULT 'trackoja')
RETURNS TABLE (
  org_id UUID,
  org_name TEXT,
  product_key TEXT,
  product_name TEXT,
  plan_id UUID,
  plan_key TEXT,
  plan_name TEXT,
  status TEXT,
  source TEXT,
  agreed_monthly_price NUMERIC,
  agreed_annual_price NUMERIC,
  agreed_user_limit INTEGER,
  agreed_store_limit INTEGER,
  billing_cycle TEXT,
  currency TEXT,
  trial_ends_at TIMESTAMPTZ,
  activated_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  seats_used BIGINT,
  stores_used BIGINT,
  days_remaining INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_org_id UUID;
  v_org_name TEXT;
  v_product public.platform_products;
  v_ent public.organization_products;
  v_plan public.product_plans;
  v_seats BIGINT;
  v_stores BIGINT;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_product_key IS NULL OR btrim(p_product_key) = '' THEN
    RAISE EXCEPTION 'Unknown product: %', COALESCE(p_product_key, '(none)');
  END IF;

  SELECT pr.* INTO v_product
  FROM public.platform_products pr
  WHERE pr.key = btrim(p_product_key);

  IF v_product.id IS NULL THEN
    RAISE EXCEPTION 'Unknown product: %', p_product_key;
  END IF;

  -- Use the selected workspace, not whichever owned business was created first.
  SELECT o.id, o.name INTO v_org_id, v_org_name
  FROM public.users u JOIN public.organizations o ON o.id = u.current_org_id
  WHERE u.id = v_actor AND (o.owner_id = v_actor OR EXISTS (
    SELECT 1 FROM public.organization_members om WHERE om.org_id = o.id AND om.user_id = v_actor));

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No business is linked to your account';
  END IF;

  SELECT op.* INTO v_ent
  FROM public.organization_products op
  WHERE op.org_id = v_org_id
    AND op.product_id = v_product.id;

  -- No entitlement for this product: an empty set, deliberately. See the note
  -- above - the caller must be able to tell this apart from a plan with no dates.
  IF v_ent.id IS NULL THEN
    RETURN;
  END IF;

  SELECT pp.* INTO v_plan
  FROM public.product_plans pp
  WHERE pp.id = v_ent.plan_id;

  -- enforce_seat_limit's own count, minus the <> NEW.user_id term that excludes
  -- the not-yet-existing row the trigger is about to insert.
  SELECT COUNT(DISTINCT sm.user_id) INTO v_seats
  FROM public.store_members sm
  JOIN public.stores s ON s.id = sm.store_id
  WHERE s.org_id = v_org_id
    AND sm.status = 'active'
    AND sm.user_id IS NOT NULL;

  SELECT COUNT(*) INTO v_stores
  FROM public.stores s
  WHERE s.org_id = v_org_id;

  RETURN QUERY
  SELECT
    v_org_id,
    v_org_name,
    v_product.key,
    v_product.name,
    v_ent.plan_id,
    v_plan.key,
    v_plan.name,
    v_ent.status,
    v_ent.source,
    v_ent.agreed_monthly_price,
    v_ent.agreed_annual_price,
    v_ent.agreed_user_limit,
    -- The store cap the plan sells, not a column on the entitlement: 063 gave
    -- organization_products no agreed_store_limit, and adding one is a schema
    -- change outside this migration's brief.
    v_plan.store_limit,
    COALESCE(v_ent.metadata->>'billing_cycle', v_plan.billing_cycle, 'monthly'),
    v_ent.currency,
    v_ent.trial_ends_at,
    v_ent.activated_at,
    v_ent.expires_at,
    v_ent.cancelled_at,
    COALESCE(v_seats, 0),
    COALESCE(v_stores, 0),
    -- Whole days: floor, so a date 0.5 days away is 0 (due today) and 0.5 days
    -- past is -1. NULL only when the entitlement has neither date at all.
    CASE
      WHEN COALESCE(v_ent.expires_at, v_ent.trial_ends_at) IS NULL THEN NULL
      ELSE floor(EXTRACT(EPOCH FROM (COALESCE(v_ent.expires_at, v_ent.trial_ends_at) - now())) / 86400)::INTEGER
    END;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_seat_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_is_sandbox BOOLEAN;
  v_limit INTEGER;
  v_used INTEGER;
  v_has_live_entitlement BOOLEAN;
BEGIN
  IF NEW.status <> 'active' OR NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT o.id, o.is_sandbox INTO v_org_id, v_is_sandbox
  FROM public.stores s
  JOIN public.organizations o ON o.id = s.org_id
  WHERE s.id = NEW.store_id;

  IF v_org_id IS NULL OR v_is_sandbox THEN
    RETURN NEW;
  END IF;

  PERFORM 1 FROM public.organizations WHERE id = v_org_id FOR UPDATE;

  IF EXISTS (SELECT 1 FROM public.organizations WHERE id = v_org_id AND owner_id = NEW.user_id)
    AND NOT EXISTS (SELECT 1 FROM public.store_members sm JOIN public.stores s ON s.id = sm.store_id
      WHERE s.org_id = v_org_id AND sm.user_id = NEW.user_id AND sm.status = 'active') THEN
    RETURN NEW;
  END IF;

  SELECT
    EXISTS (
      SELECT 1 FROM public.organization_products op
      WHERE op.org_id = v_org_id AND op.product_id = (SELECT id FROM public.platform_products WHERE key = 'trackoja')
        AND (
          (op.status = 'active' AND (op.expires_at IS NULL OR op.expires_at > now()))
          OR (op.status = 'trialing' AND public.product_entitlement_has_access(op.org_id, op.product_id))
          OR (op.status = 'pending' AND op.trial_ends_at > now())
        )
    ),
    MAX(NULLIF(op.agreed_user_limit, -1))
  INTO v_has_live_entitlement, v_limit
  FROM public.organization_products op
  WHERE op.org_id = v_org_id AND op.product_id = (SELECT id FROM public.platform_products WHERE key = 'trackoja')
    AND (
      (op.status = 'active' AND (op.expires_at IS NULL OR op.expires_at > now()))
      OR (op.status = 'trialing' AND public.product_entitlement_has_access(op.org_id, op.product_id))
          OR (op.status = 'pending' AND op.trial_ends_at > now())
    );

  IF NOT COALESCE(v_has_live_entitlement, FALSE) THEN
    RAISE EXCEPTION 'This business has no active subscription. Choose a plan before adding users.';
  END IF;

  IF v_limit IS NOT NULL THEN
    SELECT COUNT(DISTINCT sm.user_id) INTO v_used
    FROM public.store_members sm
    JOIN public.stores s ON s.id = sm.store_id
    WHERE s.org_id = v_org_id
      AND sm.status = 'active'
      AND sm.user_id IS NOT NULL
      AND sm.user_id <> NEW.user_id;

    IF v_used + 1 > v_limit THEN
      RAISE EXCEPTION 'Seat limit reached for this plan (%). Upgrade to add more users.', v_limit;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- A trial end is enforced at request time; no background sweep is required.
-- The existing role and tenant checks remain mandatory.
CREATE OR REPLACE FUNCTION public.user_has_permission(p_user_id UUID, p_store_id UUID, p_permission_name TEXT)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.store_members sm
    JOIN public.role_permissions rp ON rp.role_id = sm.role_id
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE sm.user_id = p_user_id AND sm.store_id = p_store_id
      AND sm.status = 'active' AND p.name = p_permission_name
  ) AND NOT EXISTS (
    SELECT 1 FROM public.organization_products op
    JOIN public.platform_products pp ON pp.id = op.product_id AND pp.key = 'trackoja'
    JOIN public.stores s ON s.org_id = op.org_id
    WHERE s.id = p_store_id AND op.source = 'trial' AND op.trial_started_at IS NOT NULL
      AND NOT public.product_entitlement_has_access(op.org_id, op.product_id)
  );
$$;
-- Store-scoped RLS reads also honour explicit trial expiry. Billing and workspace
-- selection still use organization membership so owners can renew or seek help.
CREATE OR REPLACE FUNCTION public.get_user_active_store_ids(p_user_id UUID)
RETURNS SETOF UUID LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT sm.store_id FROM public.store_members sm JOIN public.stores s ON s.id = sm.store_id
  WHERE sm.user_id = p_user_id AND sm.status = 'active' AND NOT EXISTS (
    SELECT 1 FROM public.organization_products op JOIN public.platform_products pp ON pp.id = op.product_id
    WHERE op.org_id = s.org_id AND pp.key = 'trackoja' AND op.trial_started_at IS NOT NULL
      AND op.source = 'trial' AND NOT public.product_entitlement_has_access(op.org_id, op.product_id)
  );
$$;


-- SOURCE: 20260929000004_trial_admin_reporting.sql
-- Include explicit trials in admin reporting and expose IDs for audited extensions.

CREATE OR REPLACE FUNCTION public.get_platform_overview_v2(p_product_key TEXT DEFAULT NULL)
RETURNS TABLE (
  total_businesses BIGINT,
  active_subscriptions BIGINT,
  trialing_subscriptions BIGINT,
  past_due_subscriptions BIGINT,
  expiring_within_30d BIGINT,
  failed_payments_30d BIGINT,
  revenue_30d NUMERIC,
  sandbox_businesses BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_product_id UUID;
BEGIN
  PERFORM public.require_platform_permission('platform:view');

  IF p_product_key IS NOT NULL THEN
    SELECT id INTO v_product_id FROM public.platform_products WHERE key = p_product_key;
    IF v_product_id IS NULL THEN
      RAISE EXCEPTION 'Unknown product: %', p_product_key;
    END IF;
  END IF;

  RETURN QUERY
  WITH entitlements AS (
    SELECT op.*
    FROM public.organization_products op
    JOIN public.organizations o ON o.id = op.org_id
    WHERE o.is_sandbox = FALSE
      AND (v_product_id IS NULL OR op.product_id = v_product_id)
  )
  SELECT
    (SELECT COUNT(DISTINCT op.org_id) FROM entitlements op),
    (SELECT COUNT(*) FROM entitlements op WHERE op.status = 'active'),
    (SELECT COUNT(*) FROM entitlements op WHERE (op.status = 'trialing' AND public.product_entitlement_has_access(op.org_id, op.product_id)) OR (op.status = 'pending' AND op.source = 'trial' AND op.trial_ends_at > now())),
    (SELECT COUNT(*) FROM entitlements op WHERE op.status = 'past_due'),
    (SELECT COUNT(*) FROM entitlements op
      WHERE op.status IN ('active', 'pending', 'trialing')
        AND op.expires_at IS NOT NULL
        AND op.expires_at BETWEEN now() AND now() + INTERVAL '30 days'),
    (SELECT COUNT(*) FROM public.subscription_transactions st
      WHERE st.is_sandbox = FALSE AND st.is_test_data = FALSE AND COALESCE(st.payment_mode, 'live') <> 'test'
        AND st.status = 'failed'
        AND st.created_at >= now() - INTERVAL '30 days'
        AND (v_product_id IS NULL OR st.product_id = v_product_id)),
    (SELECT COALESCE(SUM(st.amount), 0) FROM public.subscription_transactions st
      WHERE st.is_sandbox = FALSE AND st.is_test_data = FALSE AND COALESCE(st.payment_mode, 'live') <> 'test'
        AND st.status = 'success'
        AND st.created_at >= now() - INTERVAL '30 days'
        AND (v_product_id IS NULL OR st.product_id = v_product_id)),
    (SELECT COUNT(*) FROM public.organizations o WHERE o.is_sandbox = TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_platform_products()
RETURNS TABLE (
  id UUID,
  key TEXT,
  name TEXT,
  tagline TEXT,
  description TEXT,
  status TEXT,
  visibility TEXT,
  features JSONB,
  onboarding_note TEXT,
  access_settings JSONB,
  plan_count BIGINT,
  business_count BIGINT,
  sort_order INTEGER,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_platform_permission('platform:view');

  RETURN QUERY
  SELECT
    p.id, p.key, p.name, p.tagline, p.description, p.status, p.visibility,
    p.features, p.onboarding_note, p.access_settings,
    (SELECT COUNT(*) FROM public.product_plans pp WHERE pp.product_id = p.id),
    (SELECT COUNT(*) FROM public.organization_products op
      WHERE op.product_id = p.id AND op.status IN ('active', 'pending', 'trialing')),
    p.sort_order, p.updated_at
  FROM public.platform_products p
  ORDER BY p.sort_order, p.name;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_platform_users(
  p_product_key TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
  user_id UUID,
  email TEXT,
  full_name TEXT,
  is_platform_admin BOOLEAN,
  platform_level TEXT,
  developer_mode BOOLEAN,
  org_id UUID,
  org_name TEXT,
  is_sandbox BOOLEAN,
  store_role TEXT,
  entitled_products JSONB,
  seat_limit INTEGER,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_product_id UUID;
BEGIN
  PERFORM public.require_platform_permission('platform:manage_users');

  IF p_product_key IS NOT NULL THEN
    SELECT id INTO v_product_id FROM public.platform_products WHERE key = p_product_key;
  END IF;

  RETURN QUERY
  SELECT
    u.id,
    u.email,
    NULLIF(trim(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''),
    u.is_platform_admin,
    pa.level,
    public.developer_mode_enabled(u.id),
    o.id,
    o.name,
    COALESCE(o.is_sandbox, FALSE),
    (SELECT r.name
       FROM public.store_members sm
       JOIN public.roles r ON r.id = sm.role_id
      WHERE sm.user_id = u.id AND sm.status = 'active'
      ORDER BY sm.created_at LIMIT 1),
    COALESCE((
      SELECT jsonb_agg(DISTINCT pr.key)
      FROM public.organization_products op
      JOIN public.platform_products pr ON pr.id = op.product_id
      WHERE op.org_id = o.id
        AND public.product_entitlement_has_access(op.org_id, op.product_id)
        AND (v_product_id IS NULL OR op.product_id = v_product_id)
    ), '[]'::jsonb),
    (SELECT MAX(op.agreed_user_limit) FROM public.organization_products op
      WHERE op.org_id = o.id AND public.product_entitlement_has_access(op.org_id, op.product_id)),
    u.last_login_at,
    u.created_at
  FROM public.users u
  LEFT JOIN public.platform_admins pa ON pa.user_id = u.id
  LEFT JOIN public.organizations o ON o.id = u.current_org_id
  WHERE (
      p_search IS NULL
      OR u.email ILIKE '%' || p_search || '%'
      OR COALESCE(u.first_name, '') ILIKE '%' || p_search || '%'
      OR COALESCE(u.last_name, '') ILIKE '%' || p_search || '%'
    )
    AND (
      v_product_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.organization_products op
        WHERE op.org_id = o.id AND op.product_id = v_product_id
      )
      OR u.is_platform_admin = TRUE
    )
  ORDER BY u.created_at DESC
  LIMIT COALESCE(p_limit, 100);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_product_plans(p_product_key TEXT DEFAULT NULL)
RETURNS TABLE (
  id UUID,
  product_id UUID,
  product_key TEXT,
  product_name TEXT,
  key TEXT,
  name TEXT,
  description TEXT,
  monthly_price NUMERIC,
  annual_price NUMERIC,
  currency TEXT,
  user_limit INTEGER,
  features JSONB,
  onboarding_note TEXT,
  status TEXT,
  is_default BOOLEAN,
  is_public BOOLEAN,
  sort_order INTEGER,
  subscriber_count BIGINT,
  updated_at TIMESTAMPTZ,
  billing_cycle TEXT,
  setup_fee NUMERIC,
  trial_days INTEGER,
  store_limit INTEGER,
  published_at TIMESTAMPTZ,
  effective_from TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_platform_permission('platform:view');

  RETURN QUERY
  SELECT
    pp.id, pp.product_id, pr.key, pr.name, pp.key, pp.name, pp.description,
    pp.monthly_price, pp.annual_price, pp.currency, pp.user_limit, pp.features,
    pp.onboarding_note, pp.status, pp.is_default, pp.is_public, pp.sort_order,
    (SELECT COUNT(*) FROM public.organization_products op
      WHERE op.plan_id = pp.id AND op.status IN ('active', 'pending', 'trialing')),
    pp.updated_at,
    pp.billing_cycle,
    pp.setup_fee,
    pp.trial_days,
    pp.store_limit,
    pp.published_at,
    pp.effective_from
  FROM public.product_plans pp
  JOIN public.platform_products pr ON pr.id = pp.product_id
  WHERE p_product_key IS NULL OR pr.key = p_product_key
  ORDER BY pr.sort_order, pp.sort_order, pp.name;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_platform_business(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  PERFORM public.require_platform_permission('platform:manage_businesses');

  SELECT jsonb_build_object(
    'organization', (
      SELECT jsonb_build_object(
        'id', o.id, 'name', o.name, 'slug', o.slug, 'billing_status', o.billing_status,
        'billing_email', o.billing_email,
        'business_category', COALESCE(o.business_category, 'general_retail'),
        'is_sandbox', o.is_sandbox, 'trial_ends_at', o.trial_ends_at,
        'owner_email', u.email, 'owner_name',
          NULLIF(trim(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''),
        'created_at', o.created_at
      )
      FROM public.organizations o
      LEFT JOIN public.users u ON u.id = o.owner_id
      WHERE o.id = p_org_id
    ),
    'products', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', op.id, 'trial_started_at', op.trial_started_at, 'product_key', pr.key, 'product_name', pr.name,
        'plan_key', pp.key, 'plan_name', pp.name,
        'status', op.status, 'source', op.source,
        'agreed_user_limit', op.agreed_user_limit,
        'agreed_monthly_price', op.agreed_monthly_price,
        'currency', op.currency,
        'trial_ends_at', op.trial_ends_at,
        'expires_at', op.expires_at,
        'is_sandbox', op.is_sandbox
      ) ORDER BY pr.sort_order)
      FROM public.organization_products op
      JOIN public.platform_products pr ON pr.id = op.product_id
      LEFT JOIN public.product_plans pp ON pp.id = op.plan_id
      WHERE op.org_id = p_org_id
    ), '[]'::jsonb),
    'stores', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'status', s.status)
             ORDER BY s.created_at)
      FROM public.stores s WHERE s.org_id = p_org_id
    ), '[]'::jsonb),
    'staff', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'user_id', sm.user_id, 'email', su.email, 'role', r.name, 'status', sm.status,
        'store_name', s.name) ORDER BY sm.created_at)
      FROM public.store_members sm
      JOIN public.stores s ON s.id = sm.store_id
      LEFT JOIN public.roles r ON r.id = sm.role_id
      LEFT JOIN public.users su ON su.id = sm.user_id
      WHERE s.org_id = p_org_id
    ), '[]'::jsonb),
    'seat_used', (
      SELECT COUNT(DISTINCT sm.user_id)
      FROM public.store_members sm
      JOIN public.stores s ON s.id = sm.store_id
      WHERE s.org_id = p_org_id AND sm.status = 'active' AND sm.user_id IS NOT NULL
    ),
    'payments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'reference', st.reference, 'amount', st.amount, 'currency', st.currency,
        'status', st.status, 'created_at', st.created_at, 'paid_at', st.paid_at,
        'is_sandbox', st.is_sandbox) ORDER BY st.created_at DESC)
      FROM (
        SELECT * FROM public.subscription_transactions
        WHERE org_id = p_org_id ORDER BY created_at DESC LIMIT 20
      ) st
    ), '[]'::jsonb),
    'support_notes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', n.id, 'note_type', n.note_type, 'body', n.body,
        'admin_email', au.email, 'created_at', n.created_at) ORDER BY n.created_at DESC)
      FROM (
        SELECT * FROM public.platform_support_notes
        WHERE org_id = p_org_id ORDER BY created_at DESC LIMIT 20
      ) n
      LEFT JOIN public.users au ON au.id = n.admin_user_id
    ), '[]'::jsonb),
    'adjustments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id, 'adjustment_type', a.adjustment_type, 'reason', a.reason,
        'created_at', a.created_at) ORDER BY a.created_at DESC)
      FROM (
        SELECT * FROM public.subscription_adjustments
        WHERE org_id = p_org_id ORDER BY created_at DESC LIMIT 20
      ) a
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;


COMMIT;
