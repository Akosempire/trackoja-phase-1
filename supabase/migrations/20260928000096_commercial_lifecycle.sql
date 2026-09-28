-- Migration: 096_commercial_lifecycle.sql
-- Production commercial lifecycle: immutable plan versions, authoritative
-- previews, resumable onboarding, minor-unit payment snapshots, invoices and
-- receipts. Existing legacy columns remain for compatibility; every new
-- financial authority uses integer minor units (kobo for NGN).

-- ============================================================
-- IMMUTABLE COMMERCIAL TERMS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.product_plan_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES public.product_plans(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES public.platform_products(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 0),
  plan_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  billing_cycle TEXT NOT NULL CHECK (billing_cycle IN ('monthly', 'annual')),
  amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
  setup_fee_minor BIGINT NOT NULL DEFAULT 0 CHECK (setup_fee_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'NGN' CHECK (currency ~ '^[A-Z]{3}$'),
  -- Trials are intentionally not sold until charging, invoicing, reporting and
  -- access semantics are all approved. Keeping explicit fields makes a later
  -- policy change additive rather than a billing rewrite.
  trial_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  trial_days INTEGER NOT NULL DEFAULT 0 CHECK (trial_days = 0),
  features JSONB NOT NULL DEFAULT '[]'::jsonb,
  limits JSONB NOT NULL DEFAULT '{}'::jsonb,
  entitlements JSONB NOT NULL DEFAULT '{}'::jsonb,
  activation_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_until TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (plan_id, billing_cycle, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS product_plan_versions_one_current
  ON public.product_plan_versions(plan_id, billing_cycle)
  WHERE status = 'active' AND effective_until IS NULL;
CREATE INDEX IF NOT EXISTS product_plan_versions_product
  ON public.product_plan_versions(product_id, status, billing_cycle);

COMMENT ON COLUMN public.product_plan_versions.amount_minor IS
  'Recurring amount in the currency minor unit. NGN values are kobo. Never naira.';
COMMENT ON COLUMN public.product_plan_versions.setup_fee_minor IS
  'One-off setup fee in the currency minor unit, snapshotted with the purchased terms.';
COMMENT ON COLUMN public.product_plan_versions.trial_days IS
  'Fixed at zero while trials are unsupported. Do not expose an editable trial control until the lifecycle is implemented.';

CREATE OR REPLACE FUNCTION public.refuse_plan_version_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Plan versions are immutable and cannot be deleted';
  END IF;
  -- Retirement is the only permitted update; purchased terms never change.
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.effective_until IS DISTINCT FROM OLD.effective_until THEN
    IF NEW.status = 'retired' AND NEW.effective_until IS NOT NULL
       AND (to_jsonb(NEW) - 'status' - 'effective_until') = (to_jsonb(OLD) - 'status' - 'effective_until') THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'Plan versions are immutable; publish a new version';
END;
$$;

DROP TRIGGER IF EXISTS protect_product_plan_versions ON public.product_plan_versions;
CREATE TRIGGER protect_product_plan_versions
  BEFORE UPDATE OR DELETE ON public.product_plan_versions
  FOR EACH ROW EXECUTE FUNCTION public.refuse_plan_version_mutation();

CREATE OR REPLACE FUNCTION public.snapshot_product_plan_version(p_plan_id UUID)
RETURNS SETOF public.product_plan_versions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_plan public.product_plans%ROWTYPE;
  v_product public.platform_products%ROWTYPE;
  v_cycle TEXT;
  v_price NUMERIC;
  v_latest public.product_plan_versions%ROWTYPE;
  v_version INTEGER;
  v_created public.product_plan_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_plan FROM public.product_plans WHERE id = p_plan_id;
  IF v_plan.id IS NULL OR v_plan.published_at IS NULL OR v_plan.status <> 'active' OR NOT v_plan.is_public THEN
    RETURN;
  END IF;
  SELECT * INTO v_product FROM public.platform_products WHERE id = v_plan.product_id;

  FOREACH v_cycle IN ARRAY ARRAY['monthly', 'annual'] LOOP
    v_price := CASE WHEN v_cycle = 'monthly' THEN v_plan.monthly_price ELSE v_plan.annual_price END;
    IF v_price IS NULL THEN CONTINUE; END IF;

    SELECT * INTO v_latest
    FROM public.product_plan_versions
    WHERE plan_id = v_plan.id AND billing_cycle = v_cycle AND status = 'active' AND effective_until IS NULL
    ORDER BY version DESC LIMIT 1;

    IF v_latest.id IS NOT NULL
       AND v_latest.amount_minor = round(v_price * 100)::BIGINT
       AND v_latest.setup_fee_minor = round(COALESCE(v_plan.setup_fee, 0) * 100)::BIGINT
       AND v_latest.display_name = v_plan.name
       AND v_latest.description IS NOT DISTINCT FROM v_plan.description
       AND v_latest.features = COALESCE(v_plan.features, '[]'::jsonb)
       AND v_latest.limits = jsonb_build_object('users', v_plan.user_limit, 'stores', v_plan.store_limit) THEN
      v_created := v_latest;
      RETURN NEXT v_created;
      CONTINUE;
    END IF;

    IF v_latest.id IS NOT NULL THEN
      -- The protection trigger permits exactly this retirement update.
      UPDATE public.product_plan_versions
      SET status = 'retired', effective_until = now()
      WHERE id = v_latest.id;
    END IF;

    SELECT COALESCE(MAX(version), 0) + 1 INTO v_version
    FROM public.product_plan_versions WHERE plan_id = v_plan.id AND billing_cycle = v_cycle;

    INSERT INTO public.product_plan_versions (
      plan_id, product_id, version, plan_key, display_name, description,
      billing_cycle, amount_minor, setup_fee_minor, currency, features, limits,
      entitlements, activation_policy, effective_from, metadata, created_by
    ) VALUES (
      v_plan.id, v_plan.product_id, v_version, v_plan.key, v_plan.name, v_plan.description,
      v_cycle, round(v_price * 100)::BIGINT, round(COALESCE(v_plan.setup_fee, 0) * 100)::BIGINT,
      upper(v_plan.currency), COALESCE(v_plan.features, '[]'::jsonb),
      jsonb_build_object('users', v_plan.user_limit, 'stores', v_plan.store_limit),
      jsonb_build_object('features', COALESCE(v_plan.features, '[]'::jsonb)),
      COALESCE(v_product.access_settings, '{}'::jsonb), COALESCE(v_plan.effective_from, now()),
      jsonb_build_object('source_plan_updated_at', v_plan.updated_at), auth.uid()
    ) RETURNING * INTO v_created;
    RETURN NEXT v_created;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.snapshot_published_plan_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.snapshot_product_plan_version(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS snapshot_published_plan ON public.product_plans;
CREATE TRIGGER snapshot_published_plan
  AFTER INSERT OR UPDATE OF name, description, monthly_price, annual_price, setup_fee,
    currency, user_limit, store_limit, features, status, is_public, published_at, effective_from
  ON public.product_plans
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_published_plan_trigger();

SELECT public.snapshot_product_plan_version(id)
FROM public.product_plans
WHERE published_at IS NOT NULL AND status = 'active' AND is_public;

-- ============================================================
-- PURCHASED VERSION AND PAYMENT SNAPSHOT
-- ============================================================

ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS plan_version_id UUID
  REFERENCES public.product_plan_versions(id) ON DELETE RESTRICT;
ALTER TABLE public.organization_products ADD COLUMN IF NOT EXISTS plan_version_id UUID
  REFERENCES public.product_plan_versions(id) ON DELETE RESTRICT;
ALTER TABLE public.subscription_transactions ADD COLUMN IF NOT EXISTS plan_version_id UUID
  REFERENCES public.product_plan_versions(id) ON DELETE RESTRICT;
ALTER TABLE public.subscription_transactions ADD COLUMN IF NOT EXISTS amount_minor BIGINT;
ALTER TABLE public.subscription_transactions ADD COLUMN IF NOT EXISTS recurring_amount_minor BIGINT;
ALTER TABLE public.subscription_transactions ADD COLUMN IF NOT EXISTS setup_fee_amount_minor BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.subscription_transactions ADD COLUMN IF NOT EXISTS provider_reference TEXT;
ALTER TABLE public.subscription_transactions ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE public.subscription_transactions ADD COLUMN IF NOT EXISTS verification_data JSONB;

ALTER TABLE public.subscription_transactions DROP CONSTRAINT IF EXISTS subscription_transactions_minor_amounts_check;
ALTER TABLE public.subscription_transactions ADD CONSTRAINT subscription_transactions_minor_amounts_check CHECK (
  (amount_minor IS NULL OR amount_minor >= 0) AND
  (recurring_amount_minor IS NULL OR recurring_amount_minor >= 0) AND
  setup_fee_amount_minor >= 0
);
CREATE INDEX IF NOT EXISTS subscription_transactions_plan_version
  ON public.subscription_transactions(plan_version_id, created_at DESC);

-- ============================================================
-- RESUMABLE ONBOARDING
-- ============================================================

CREATE TABLE IF NOT EXISTS public.onboarding_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.platform_products(id) ON DELETE RESTRICT,
  org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id UUID REFERENCES public.stores(id) ON DELETE SET NULL,
  selected_plan_version_id UUID REFERENCES public.product_plan_versions(id) ON DELETE RESTRICT,
  state TEXT NOT NULL DEFAULT 'account_ready' CHECK (state IN (
    'account_ready', 'business_created', 'business_profile_completed', 'plan_selected',
    'checkout_required', 'payment_pending', 'payment_verified', 'subscription_created',
    'access_activated', 'onboarding_completed'
  )),
  business_category TEXT,
  checkout_reference TEXT,
  completed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, product_id)
);

DROP TRIGGER IF EXISTS handle_updated_at_onboarding_progress ON public.onboarding_progress;
CREATE TRIGGER handle_updated_at_onboarding_progress BEFORE UPDATE ON public.onboarding_progress
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================
-- INVOICES AND RECEIPTS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.billing_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number TEXT NOT NULL UNIQUE,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES public.platform_products(id) ON DELETE RESTRICT,
  plan_version_id UUID NOT NULL REFERENCES public.product_plan_versions(id) ON DELETE RESTRICT,
  transaction_id UUID NOT NULL UNIQUE REFERENCES public.subscription_transactions(id) ON DELETE RESTRICT,
  billing_email TEXT,
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  subtotal_minor BIGINT NOT NULL CHECK (subtotal_minor >= 0),
  total_minor BIGINT NOT NULL CHECK (total_minor >= 0),
  status TEXT NOT NULL CHECK (status IN ('issued', 'paid', 'void')),
  is_test_data BOOLEAN NOT NULL DEFAULT FALSE,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.billing_invoice_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES public.billing_invoices(id) ON DELETE RESTRICT,
  line_type TEXT NOT NULL CHECK (line_type IN ('subscription', 'setup_fee', 'adjustment')),
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_amount_minor BIGINT NOT NULL CHECK (unit_amount_minor >= 0),
  total_amount_minor BIGINT NOT NULL CHECK (total_amount_minor >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.billing_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number TEXT NOT NULL UNIQUE,
  invoice_id UUID NOT NULL UNIQUE REFERENCES public.billing_invoices(id) ON DELETE RESTRICT,
  transaction_id UUID NOT NULL UNIQUE REFERENCES public.subscription_transactions(id) ON DELETE RESTRICT,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  payment_mode TEXT NOT NULL CHECK (payment_mode IN ('live', 'test', 'mock')),
  provider_reference TEXT,
  is_test_data BOOLEAN NOT NULL DEFAULT FALSE,
  paid_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS billing_invoices_org ON public.billing_invoices(org_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS billing_receipts_org ON public.billing_receipts(org_id, paid_at DESC);

-- ============================================================
-- CUSTOMER RPCS
-- ============================================================

CREATE OR REPLACE FUNCTION public.list_published_plan_versions(p_product_key TEXT DEFAULT 'trackoja')
RETURNS TABLE (
  plan_version_id UUID, plan_id UUID, version INTEGER, product_key TEXT, product_name TEXT,
  plan_key TEXT, display_name TEXT, description TEXT, billing_cycle TEXT,
  amount_minor BIGINT, setup_fee_minor BIGINT, currency TEXT, features JSONB,
  limits JSONB, activation_policy JSONB, effective_from TIMESTAMPTZ, is_default BOOLEAN, sort_order INTEGER
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT v.id, v.plan_id, v.version, pr.key, pr.name, v.plan_key, v.display_name,
    v.description, v.billing_cycle, v.amount_minor, v.setup_fee_minor, v.currency,
    v.features, v.limits, v.activation_policy, v.effective_from, p.is_default, p.sort_order
  FROM public.product_plan_versions v
  JOIN public.product_plans p ON p.id = v.plan_id
  JOIN public.platform_products pr ON pr.id = v.product_id
  WHERE pr.key = p_product_key AND pr.status = 'active' AND pr.visibility = 'public'
    AND p.status = 'active' AND p.is_public AND p.published_at IS NOT NULL
    AND v.status = 'active' AND v.effective_until IS NULL
    AND v.effective_from <= now()
  ORDER BY p.sort_order, v.display_name, v.billing_cycle;
$$;

CREATE OR REPLACE FUNCTION public.get_checkout_preview(p_plan_version_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_version public.product_plan_versions%ROWTYPE;
  v_org UUID;
  v_setup BIGINT;
  v_due BIGINT;
  v_has_paid BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT current_org_id INTO v_org FROM public.users WHERE id = auth.uid();
  IF v_org IS NULL THEN
    SELECT org_id INTO v_org FROM public.onboarding_progress
    WHERE user_id = auth.uid() ORDER BY created_at DESC LIMIT 1;
  END IF;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Create your business before choosing a plan'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = v_org AND owner_id = auth.uid()) THEN
    RAISE EXCEPTION 'Only the business owner can start checkout';
  END IF;
  SELECT * INTO v_version FROM public.product_plan_versions
  WHERE id = p_plan_version_id AND status = 'active' AND effective_until IS NULL;
  IF v_version.id IS NULL THEN RAISE EXCEPTION 'This plan version is not available'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.subscription_transactions t
    JOIN public.product_plan_versions pv ON pv.id = t.plan_version_id
    WHERE t.org_id = v_org AND pv.product_id = v_version.product_id AND t.status = 'success'
  ) INTO v_has_paid;
  v_setup := CASE WHEN v_has_paid THEN 0 ELSE v_version.setup_fee_minor END;
  v_due := v_version.amount_minor + v_setup;

  RETURN jsonb_build_object(
    'org_id', v_org, 'plan_version_id', v_version.id, 'plan_id', v_version.plan_id,
    'version', v_version.version, 'plan_name', v_version.display_name,
    'billing_cycle', v_version.billing_cycle, 'recurring_amount_minor', v_version.amount_minor,
    'setup_fee_minor', v_setup, 'amount_due_minor', v_due, 'currency', v_version.currency,
    'trial_supported', false, 'trial_days', 0,
    'next_billing_date', CASE WHEN v_due = 0 THEN NULL ELSE
      CASE WHEN v_version.billing_cycle = 'annual' THEN now() + interval '1 year' ELSE now() + interval '1 month' END END,
    'billing_email', (SELECT billing_email FROM public.organizations WHERE id = v_org),
    'is_first_purchase', NOT v_has_paid
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.start_plan_version_checkout(p_plan_version_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_preview JSONB;
  v_org UUID;
  v_version public.product_plan_versions%ROWTYPE;
  v_legacy public.subscription_plans%ROWTYPE;
  v_reference TEXT;
  v_txn public.subscription_transactions%ROWTYPE;
BEGIN
  v_preview := public.get_checkout_preview(p_plan_version_id);
  v_org := (v_preview->>'org_id')::UUID;
  SELECT * INTO v_version FROM public.product_plan_versions WHERE id = p_plan_version_id;

  -- Legacy subscription row remains a compatibility mirror only.
  SELECT * INTO v_legacy FROM public.subscription_plans WHERE lower(name) = lower(v_version.display_name) LIMIT 1;
  IF v_legacy.id IS NULL THEN
    INSERT INTO public.subscription_plans(name, description, price, currency, billing_interval, trial_days, feature_set, status)
    VALUES (v_version.display_name, v_version.description, v_version.amount_minor / 100.0,
      v_version.currency, CASE WHEN v_version.billing_cycle = 'annual' THEN 'yearly' ELSE 'monthly' END,
      0, jsonb_build_object('plan_version_id', v_version.id), 'active')
    RETURNING * INTO v_legacy;
  END IF;

  v_reference := 'TKO-' || upper(encode(gen_random_bytes(18), 'hex'));
  INSERT INTO public.subscription_transactions (
    org_id, plan_id, product_plan_id, plan_version_id, reference, amount, amount_minor,
    recurring_amount_minor, setup_fee_amount_minor, currency, status, created_by, billing_cycle
  ) VALUES (
    v_org, v_legacy.id, v_version.plan_id, v_version.id, v_reference,
    ((v_preview->>'amount_due_minor')::BIGINT / 100.0), (v_preview->>'amount_due_minor')::BIGINT,
    (v_preview->>'recurring_amount_minor')::BIGINT, (v_preview->>'setup_fee_minor')::BIGINT,
    v_version.currency, 'pending', auth.uid(), v_version.billing_cycle
  ) RETURNING * INTO v_txn;

  INSERT INTO public.onboarding_progress(user_id, product_id, org_id, selected_plan_version_id, state, checkout_reference)
  VALUES (auth.uid(), v_version.product_id, v_org, v_version.id, 'payment_pending', v_reference)
  ON CONFLICT (user_id, product_id) DO UPDATE SET
    selected_plan_version_id = EXCLUDED.selected_plan_version_id,
    state = 'payment_pending', checkout_reference = EXCLUDED.checkout_reference;

  RETURN jsonb_build_object('id', v_txn.id, 'reference', v_reference, 'preview', v_preview);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_onboarding(p_product_key TEXT DEFAULT 'trackoja')
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_product UUID; v_row public.onboarding_progress%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT id INTO v_product FROM public.platform_products WHERE key = p_product_key;
  IF v_product IS NULL THEN RAISE EXCEPTION 'Unknown product'; END IF;
  INSERT INTO public.onboarding_progress(user_id, product_id, state)
  VALUES (auth.uid(), v_product, 'account_ready') ON CONFLICT (user_id, product_id) DO NOTHING;
  SELECT * INTO v_row FROM public.onboarding_progress WHERE user_id = auth.uid() AND product_id = v_product;
  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_onboarding_business(
  p_business_name TEXT, p_store_name TEXT, p_business_category TEXT,
  p_billing_email TEXT DEFAULT NULL, p_timezone TEXT DEFAULT 'Africa/Lagos',
  p_product_key TEXT DEFAULT 'trackoja'
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user UUID := auth.uid(); v_product UUID; v_progress public.onboarding_progress%ROWTYPE;
  v_org UUID; v_store UUID; v_role UUID; v_slug TEXT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF length(trim(p_business_name)) < 2 OR length(trim(p_store_name)) < 2 THEN
    RAISE EXCEPTION 'Business and store names are required';
  END IF;
  SELECT id INTO v_product FROM public.platform_products WHERE key = p_product_key;
  IF v_product IS NULL THEN RAISE EXCEPTION 'Unknown product'; END IF;
  PERFORM public.get_my_onboarding(p_product_key);
  SELECT * INTO v_progress FROM public.onboarding_progress
  WHERE user_id = v_user AND product_id = v_product FOR UPDATE;
  IF v_progress.org_id IS NOT NULL THEN
    RETURN jsonb_build_object('org_id', v_progress.org_id, 'store_id', v_progress.store_id, 'state', v_progress.state, 'resumed', true);
  END IF;

  v_slug := trim(both '-' from regexp_replace(lower(p_business_name), '[^a-z0-9]+', '-', 'g')) || '-' || substr(encode(gen_random_bytes(6), 'hex'), 1, 12);
  INSERT INTO public.organizations(name, slug, owner_id, billing_email, billing_status, trial_ends_at, timezone, business_category)
  VALUES (trim(p_business_name), v_slug, v_user, NULLIF(trim(p_billing_email), ''), 'suspended', NULL, p_timezone, p_business_category)
  RETURNING id INTO v_org;
  INSERT INTO public.organization_members(org_id, user_id, role, accepted_at)
  VALUES (v_org, v_user, 'owner', now()) ON CONFLICT (org_id, user_id) DO NOTHING;

  INSERT INTO public.stores(org_id, name, slug, created_by, status, timezone, currency)
  VALUES (v_org, trim(p_store_name), trim(both '-' from regexp_replace(lower(p_store_name), '[^a-z0-9]+', '-', 'g')) || '-' || substr(encode(gen_random_bytes(4), 'hex'), 1, 8), v_user, 'active', p_timezone, 'NGN')
  RETURNING id INTO v_store;
  SELECT id INTO v_role FROM public.roles WHERE name = 'owner' AND is_system = true ORDER BY created_at LIMIT 1;
  IF v_role IS NULL THEN RAISE EXCEPTION 'Owner role is not configured'; END IF;
  INSERT INTO public.store_members(store_id, user_id, role_id, status, accepted_at)
  VALUES (v_store, v_user, v_role, 'active', now()) ON CONFLICT (store_id, user_id) DO NOTHING;
  INSERT INTO public.store_settings(store_id) VALUES (v_store) ON CONFLICT (store_id) DO NOTHING;
  UPDATE public.users SET current_org_id = v_org, current_store_id = v_store WHERE id = v_user;
  INSERT INTO public.organization_products(org_id, product_id, status, source, currency)
  VALUES (v_org, v_product, 'pending', 'payment', 'NGN') ON CONFLICT (org_id, product_id) DO NOTHING;
  UPDATE public.onboarding_progress SET org_id = v_org, store_id = v_store,
    business_category = p_business_category, state = 'business_profile_completed'
  WHERE id = v_progress.id;
  RETURN jsonb_build_object('org_id', v_org, 'store_id', v_store, 'state', 'business_profile_completed', 'resumed', false);
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
    'has_access', COALESCE(v_ent.status = 'active' AND (v_ent.expires_at IS NULL OR v_ent.expires_at > now()), false),
    'is_test_data', COALESCE((v_ent.metadata->>'is_test_data')::BOOLEAN, false)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_my_billing_documents(p_limit INTEGER DEFAULT 50)
RETURNS TABLE (
  invoice_id UUID, invoice_number TEXT, receipt_id UUID, receipt_number TEXT,
  plan_name TEXT, billing_cycle TEXT, total_minor BIGINT, currency TEXT,
  status TEXT, is_test_data BOOLEAN, issued_at TIMESTAMPTZ, paid_at TIMESTAMPTZ,
  reference TEXT, billing_email TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.id, i.invoice_number, r.id, r.receipt_number, v.display_name, v.billing_cycle,
    i.total_minor, i.currency, i.status, i.is_test_data, i.issued_at, r.paid_at,
    t.reference, i.billing_email
  FROM public.billing_invoices i
  JOIN public.product_plan_versions v ON v.id = i.plan_version_id
  JOIN public.subscription_transactions t ON t.id = i.transaction_id
  LEFT JOIN public.billing_receipts r ON r.invoice_id = i.id
  WHERE i.org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  ORDER BY i.issued_at DESC LIMIT LEAST(GREATEST(p_limit, 1), 100);
$$;

-- ============================================================
-- SUCCESS FULFILMENT: DOCUMENTS + VERSION LINKS + ONBOARDING
-- ============================================================

CREATE OR REPLACE FUNCTION public.on_verified_subscription_payment()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_invoice UUID; v_product UUID; v_version public.product_plan_versions%ROWTYPE; v_email TEXT;
BEGIN
  IF NEW.status <> 'success' OR OLD.status = 'success' OR NEW.plan_version_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_version FROM public.product_plan_versions WHERE id = NEW.plan_version_id;
  v_product := v_version.product_id;
  SELECT billing_email INTO v_email FROM public.organizations WHERE id = NEW.org_id;

  UPDATE public.subscriptions SET plan_version_id = NEW.plan_version_id WHERE id = NEW.subscription_id;
  UPDATE public.organization_products SET plan_version_id = NEW.plan_version_id,
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('is_test_data', NEW.is_test_data, 'payment_reference', NEW.reference)
  WHERE org_id = NEW.org_id AND product_id = v_product;

  INSERT INTO public.billing_invoices(
    invoice_number, org_id, product_id, plan_version_id, transaction_id, billing_email,
    currency, subtotal_minor, total_minor, status, is_test_data, paid_at, metadata
  ) VALUES (
    'INV-' || to_char(now(), 'YYYYMM') || '-' || upper(substr(replace(NEW.id::TEXT, '-', ''), 1, 10)),
    NEW.org_id, v_product, NEW.plan_version_id, NEW.id, v_email, NEW.currency,
    NEW.amount_minor, NEW.amount_minor, 'paid', NEW.is_test_data, NEW.paid_at,
    jsonb_build_object('payment_mode', NEW.payment_mode, 'environment', NEW.environment, 'reference', NEW.reference)
  ) ON CONFLICT (transaction_id) DO UPDATE SET paid_at = EXCLUDED.paid_at
  RETURNING id INTO v_invoice;

  INSERT INTO public.billing_invoice_lines(invoice_id, line_type, description, unit_amount_minor, total_amount_minor)
  VALUES (v_invoice, 'subscription', v_version.display_name || ' - ' || v_version.billing_cycle,
    NEW.recurring_amount_minor, NEW.recurring_amount_minor)
  ON CONFLICT DO NOTHING;
  IF NEW.setup_fee_amount_minor > 0 THEN
    INSERT INTO public.billing_invoice_lines(invoice_id, line_type, description, unit_amount_minor, total_amount_minor)
    VALUES (v_invoice, 'setup_fee', 'Setup fee', NEW.setup_fee_amount_minor, NEW.setup_fee_amount_minor)
    ON CONFLICT DO NOTHING;
  END IF;

  INSERT INTO public.billing_receipts(
    receipt_number, invoice_id, transaction_id, org_id, amount_minor, currency,
    payment_mode, provider_reference, is_test_data, paid_at
  ) VALUES (
    'RCT-' || to_char(now(), 'YYYYMM') || '-' || upper(substr(replace(NEW.id::TEXT, '-', ''), 1, 10)),
    v_invoice, NEW.id, NEW.org_id, NEW.amount_minor, NEW.currency, NEW.payment_mode,
    COALESCE(NEW.provider_reference, NEW.gateway_reference), NEW.is_test_data, NEW.paid_at
  ) ON CONFLICT (transaction_id) DO NOTHING;

  UPDATE public.onboarding_progress SET state = 'onboarding_completed', completed_at = now(), checkout_reference = NEW.reference
  WHERE user_id = NEW.created_by AND product_id = v_product;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS verified_subscription_payment ON public.subscription_transactions;
CREATE TRIGGER verified_subscription_payment
  AFTER UPDATE OF status ON public.subscription_transactions
  FOR EACH ROW EXECUTE FUNCTION public.on_verified_subscription_payment();

-- ============================================================
-- RLS AND GRANTS
-- ============================================================

ALTER TABLE public.product_plan_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_plan_versions_public_read ON public.product_plan_versions;
CREATE POLICY product_plan_versions_public_read ON public.product_plan_versions FOR SELECT TO authenticated
  USING (status IN ('active', 'retired'));
DROP POLICY IF EXISTS onboarding_progress_own ON public.onboarding_progress;
CREATE POLICY onboarding_progress_own ON public.onboarding_progress FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_platform_admin(auth.uid()));
DROP POLICY IF EXISTS billing_invoices_org_read ON public.billing_invoices;
CREATE POLICY billing_invoices_org_read ON public.billing_invoices FOR SELECT TO authenticated
  USING (org_id IN (SELECT public.get_user_org_ids(auth.uid())) OR public.is_platform_admin(auth.uid()));
DROP POLICY IF EXISTS billing_invoice_lines_org_read ON public.billing_invoice_lines;
CREATE POLICY billing_invoice_lines_org_read ON public.billing_invoice_lines FOR SELECT TO authenticated
  USING (invoice_id IN (SELECT id FROM public.billing_invoices));
DROP POLICY IF EXISTS billing_receipts_org_read ON public.billing_receipts;
CREATE POLICY billing_receipts_org_read ON public.billing_receipts FOR SELECT TO authenticated
  USING (org_id IN (SELECT public.get_user_org_ids(auth.uid())) OR public.is_platform_admin(auth.uid()));

REVOKE ALL ON FUNCTION public.snapshot_product_plan_version(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.snapshot_product_plan_version(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_published_plan_versions(TEXT) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_checkout_preview(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_checkout_preview(UUID) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.start_plan_version_checkout(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_plan_version_checkout(UUID) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_my_onboarding(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_onboarding(TEXT) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_onboarding_business(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_onboarding_business(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_my_commercial_access(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_commercial_access(TEXT) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_my_billing_documents(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_billing_documents(INTEGER) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_platform_commercial_transactions(p_limit INTEGER DEFAULT 100)
RETURNS TABLE(
  reference TEXT, business_name TEXT, product_name TEXT, plan_name TEXT, plan_version INTEGER,
  amount_minor BIGINT, currency TEXT, status TEXT, payment_mode TEXT, environment TEXT,
  is_test_data BOOLEAN, failure_reason TEXT, created_at TIMESTAMPTZ, paid_at TIMESTAMPTZ,
  invoice_number TEXT, receipt_number TEXT
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.require_platform_permission('platform:view_payments');
  RETURN QUERY
  SELECT t.reference, o.name, p.name, v.display_name, v.version_number,
    t.amount_minor, t.currency, t.status, t.payment_mode, t.environment,
    COALESCE(t.is_test_data, false), t.failure_reason, t.created_at, t.paid_at,
    i.invoice_number, r.receipt_number
  FROM public.subscription_transactions t
  JOIN public.organizations o ON o.id = t.org_id
  LEFT JOIN public.product_plan_versions v ON v.id = t.plan_version_id
  LEFT JOIN public.products p ON p.id = v.product_id
  LEFT JOIN public.billing_invoices i ON i.transaction_id = t.id
  LEFT JOIN public.billing_receipts r ON r.transaction_id = t.id
  ORDER BY t.created_at DESC LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
END;
$$;
REVOKE ALL ON FUNCTION public.list_platform_commercial_transactions(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_platform_commercial_transactions(INTEGER) TO authenticated, service_role;

-- The original settlement gate predates immutable plan versions. Replace it so
-- fulfilment proves the gateway returned the exact commercial snapshot and exact
-- minor-unit amount attached to the pending attempt.
CREATE OR REPLACE FUNCTION public.settle_verified_payment(
  p_reference TEXT, p_gateway_data JSONB, p_paid_at TIMESTAMPTZ,
  p_payment_mode TEXT, p_environment TEXT, p_gateway_amount NUMERIC,
  p_gateway_currency TEXT, p_gateway_reference TEXT DEFAULT NULL,
  p_settled_by TEXT DEFAULT 'webhook'
) RETURNS public.subscriptions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_txn public.subscription_transactions;
  v_sub public.subscriptions;
  v_mismatches TEXT[] := ARRAY[]::TEXT[];
  v_gateway_org TEXT := COALESCE(p_gateway_data->>'org_id', p_gateway_data#>>'{metadata,org_id}');
  v_gateway_version TEXT := p_gateway_data#>>'{metadata,plan_version_id}';
BEGIN
  IF p_settled_by IS NULL OR p_settled_by NOT IN ('webhook', 'callback', 'mock') THEN
    RAISE EXCEPTION 'Unknown settlement path: %', COALESCE(p_settled_by, '(none)');
  END IF;
  SELECT * INTO v_txn FROM public.subscription_transactions WHERE reference = p_reference FOR UPDATE;
  IF v_txn.id IS NULL THEN RAISE EXCEPTION 'Transaction not found for reference %', p_reference; END IF;
  IF v_txn.status = 'success' THEN
    SELECT * INTO v_sub FROM public.subscriptions WHERE org_id = v_txn.org_id;
    RETURN v_sub;
  END IF;
  IF v_txn.status <> 'pending' THEN
    RAISE EXCEPTION 'Transaction % is % and cannot be settled', p_reference, v_txn.status;
  END IF;

  IF v_txn.payment_mode IS NULL THEN
    v_mismatches := v_mismatches || 'the attempt was never initialized against a gateway';
  ELSIF v_txn.payment_mode IS DISTINCT FROM p_payment_mode THEN
    v_mismatches := v_mismatches || format('mode is %s but settlement is %s', v_txn.payment_mode, p_payment_mode);
  END IF;
  IF v_txn.environment IS DISTINCT FROM p_environment THEN
    v_mismatches := v_mismatches || format('environment is %s but settlement is %s', v_txn.environment, p_environment);
  END IF;
  IF v_txn.amount_minor IS NULL OR p_gateway_amount IS NULL
     OR v_txn.amount_minor <> round(p_gateway_amount * 100)::BIGINT THEN
    v_mismatches := v_mismatches || format('expected %s minor units but gateway reports %s',
      COALESCE(v_txn.amount_minor::TEXT, 'nothing'), COALESCE(round(p_gateway_amount * 100)::TEXT, 'nothing'));
  END IF;
  IF v_txn.currency IS NULL OR upper(btrim(p_gateway_currency)) IS DISTINCT FROM upper(btrim(v_txn.currency)) THEN
    v_mismatches := v_mismatches || format('expected %s but gateway reports %s',
      COALESCE(v_txn.currency, 'nothing'), COALESCE(p_gateway_currency, 'nothing'));
  END IF;
  IF v_gateway_org IS NULL OR v_gateway_org IS DISTINCT FROM v_txn.org_id::TEXT THEN
    v_mismatches := v_mismatches || 'gateway business does not match the pending attempt';
  END IF;
  IF v_txn.plan_version_id IS NULL OR v_gateway_version IS NULL
     OR v_gateway_version IS DISTINCT FROM v_txn.plan_version_id::TEXT THEN
    v_mismatches := v_mismatches || 'gateway plan version does not match the pending attempt';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.product_plan_versions WHERE id = v_txn.plan_version_id) THEN
    v_mismatches := v_mismatches || 'the purchased plan version does not exist';
  END IF;

  IF array_length(v_mismatches, 1) IS NOT NULL THEN
    UPDATE public.subscription_transactions SET status = 'failed',
      failure_reason = array_to_string(v_mismatches, '; '),
      verification_data = COALESCE(p_gateway_data, '{}'::jsonb), updated_at = now()
    WHERE id = v_txn.id;
    RAISE EXCEPTION 'Payment % refused: %', p_reference, array_to_string(v_mismatches, '; ');
  END IF;

  UPDATE public.subscription_transactions SET verified_at = now(), settled_by = p_settled_by,
    gateway_reference = COALESCE(p_gateway_reference, gateway_reference),
    provider_reference = COALESCE(p_gateway_reference, provider_reference),
    verification_data = COALESCE(p_gateway_data, '{}'::jsonb),
    paystack_data = COALESCE(p_gateway_data, paystack_data), failure_reason = NULL
  WHERE id = v_txn.id;
  v_sub := public.activate_subscription(p_reference, p_gateway_data, p_paid_at);
  RETURN v_sub;
END;
$$;

REVOKE ALL ON FUNCTION public.settle_verified_payment(TEXT, JSONB, TIMESTAMPTZ, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_verified_payment(TEXT, JSONB, TIMESTAMPTZ, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT) TO service_role;
