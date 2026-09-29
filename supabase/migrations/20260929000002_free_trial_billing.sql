-- Trials reuse organization_products. No payments or invoices are fabricated.
BEGIN;

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

COMMIT;
