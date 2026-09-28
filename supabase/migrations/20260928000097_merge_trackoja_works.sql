-- TrackOja Works was an unused placeholder product. Consolidate it into the
-- single TrackOja product while preserving any records that may have been
-- created against the placeholder before this migration runs.

DO $$
DECLARE
  v_trackoja UUID;
  v_works UUID;
BEGIN
  SELECT id INTO v_trackoja FROM public.platform_products WHERE key = 'trackoja';
  SELECT id INTO v_works FROM public.platform_products WHERE key = 'trackoja_works';
  IF v_trackoja IS NULL THEN RAISE EXCEPTION 'Canonical TrackOja product is missing'; END IF;
  IF v_works IS NULL THEN RETURN; END IF;

  -- Retain any accidentally-created Works plans as retired historical plans.
  -- Their keys are namespaced before moving them to avoid colliding with the
  -- active TrackOja catalogue.
  UPDATE public.product_plans
  SET key = 'merged-works-' || substr(replace(id::TEXT, '-', ''), 1, 8) || '-' || key,
      name = name || ' (legacy merged)', status = 'retired', is_public = false, is_default = false
  WHERE product_id = v_works;
  UPDATE public.product_plans SET product_id = v_trackoja WHERE product_id = v_works;
  UPDATE public.product_plan_revisions SET product_id = v_trackoja WHERE product_id = v_works;

  -- Immutable versions stay immutable to application code. A controlled data
  -- migration may only correct their product owner; all purchased terms remain
  -- byte-for-byte unchanged.
  ALTER TABLE public.product_plan_versions DISABLE TRIGGER protect_product_plan_versions;
  UPDATE public.product_plan_versions SET product_id = v_trackoja WHERE product_id = v_works;
  ALTER TABLE public.product_plan_versions ENABLE TRIGGER protect_product_plan_versions;

  -- If a business somehow has both entitlements, preserve the strongest real
  -- access and retain the Works record identifier in audit metadata.
  UPDATE public.organization_products canonical
  SET status = CASE WHEN legacy.status = 'active' THEN 'active' ELSE canonical.status END,
      plan_id = COALESCE(canonical.plan_id, legacy.plan_id),
      agreed_monthly_price = COALESCE(canonical.agreed_monthly_price, legacy.agreed_monthly_price),
      agreed_annual_price = COALESCE(canonical.agreed_annual_price, legacy.agreed_annual_price),
      agreed_user_limit = COALESCE(canonical.agreed_user_limit, legacy.agreed_user_limit),
      activated_at = COALESCE(canonical.activated_at, legacy.activated_at),
      expires_at = COALESCE(canonical.expires_at, legacy.expires_at),
      metadata = canonical.metadata || jsonb_build_object('merged_trackoja_works_entitlement_id', legacy.id)
  FROM public.organization_products legacy
  WHERE canonical.product_id = v_trackoja AND legacy.product_id = v_works
    AND canonical.org_id = legacy.org_id;

  UPDATE public.subscription_adjustments adjustment
  SET organization_product_id = canonical.id, product_id = v_trackoja
  FROM public.organization_products legacy
  JOIN public.organization_products canonical
    ON canonical.org_id = legacy.org_id AND canonical.product_id = v_trackoja
  WHERE adjustment.organization_product_id = legacy.id AND legacy.product_id = v_works;

  DELETE FROM public.organization_products legacy
  USING public.organization_products canonical
  WHERE legacy.product_id = v_works AND canonical.product_id = v_trackoja
    AND legacy.org_id = canonical.org_id;
  UPDATE public.organization_products SET product_id = v_trackoja WHERE product_id = v_works;

  -- One resumable onboarding row is enough for the unified product.
  DELETE FROM public.onboarding_progress legacy
  USING public.onboarding_progress canonical
  WHERE legacy.product_id = v_works AND canonical.product_id = v_trackoja
    AND legacy.user_id = canonical.user_id;
  UPDATE public.onboarding_progress SET product_id = v_trackoja WHERE product_id = v_works;

  -- Remove duplicate scoped flags, then retarget every remaining historical row.
  DELETE FROM public.feature_flags legacy
  USING public.feature_flags canonical
  WHERE legacy.product_id = v_works AND canonical.product_id = v_trackoja
    AND legacy.key = canonical.key AND legacy.scope = canonical.scope
    AND legacy.org_id IS NOT DISTINCT FROM canonical.org_id;
  UPDATE public.feature_flags SET product_id = v_trackoja WHERE product_id = v_works;
  UPDATE public.activation_keys SET product_id = v_trackoja WHERE product_id = v_works;
  UPDATE public.platform_support_notes SET product_id = v_trackoja WHERE product_id = v_works;
  UPDATE public.subscription_adjustments SET product_id = v_trackoja WHERE product_id = v_works;
  UPDATE public.subscription_transactions SET product_id = v_trackoja WHERE product_id = v_works;
  UPDATE public.billing_invoices SET product_id = v_trackoja WHERE product_id = v_works;

  DELETE FROM public.platform_settings WHERE key = 'products.trackoja_works.visible';
  DELETE FROM public.feature_flags WHERE key = 'trackoja_works_beta' AND product_id IS NULL;
  DELETE FROM public.platform_products WHERE id = v_works;
END;
$$;

COMMENT ON TABLE public.platform_products IS
  'Product catalogue. TrackOja is currently the single customer product; add another row only for a separately approved and priced product.';

