-- Migration: 068_platform_products_seed.sql
-- Description: Seeds the multi-product catalogue and the agreed TrackOja pricing
--   ladder, backfills existing subscriptions into per-product entitlements,
--   corrects the Starter seat limit to the agreed two logins, and retires the
--   legacy plans that are no longer sold.
--
--   TrackOja:      Starter N5,000 / N50,000 (2 seats) -> Standard N22,500 /
--                  N225,000 (5) -> Professional N45,000 / N450,000 (10) ->
--                  Premium N90,000 / N900,000 (15) -> Enterprise custom.
--   TrackOja Works: product row only. No plans, prices, features, or limits are
--                  invented here - they stay unset until they are defined.
--
-- Author: TrackOja Team
-- Date: 2026-09-26

-- ============================================================
-- PRODUCTS
-- ============================================================

INSERT INTO public.platform_products
  (key, name, tagline, description, status, visibility, features, onboarding_note, access_settings, sort_order)
VALUES
  (
    'trackoja',
    'TrackOja',
    'Run your business, all in one place.',
    'Business management platform for small and growing businesses: sales, products, '
      'stock, customers, suppliers, staff, payments, and reports from your phone.',
    'active',
    'public',
    '[
      {"key":"sales","label":"Sales and expenses"},
      {"key":"inventory","label":"Products and stock"},
      {"key":"customers","label":"Customers and suppliers"},
      {"key":"reports","label":"Accounting and reports"},
      {"key":"pos","label":"POS"},
      {"key":"advanced_inventory","label":"Advanced inventory"},
      {"key":"receivables_payables","label":"Receivables and payables","upcoming":true},
      {"key":"staff","label":"Staff management"},
      {"key":"performance_reports","label":"Performance reports"},
      {"key":"branches","label":"Branches"},
      {"key":"multi_location_stock","label":"Multi-location stock"},
      {"key":"approvals","label":"Approvals","upcoming":true},
      {"key":"budgeting","label":"Budgeting","upcoming":true},
      {"key":"financial_analysis","label":"Deeper financial analysis","upcoming":true},
      {"key":"multi_company","label":"Multiple companies","upcoming":true},
      {"key":"integrations","label":"Integrations"},
      {"key":"executive_reporting","label":"Executive reporting"},
      {"key":"dedicated_support","label":"Dedicated support"}
    ]'::jsonb,
    'Standard customers add and manage their own products - no setup fee. Assisted '
      'implementation on higher tiers is scoped and quoted.',
    '{"requires_verified_payment": true, "requires_activation_key": false, "self_serve": true, "trial_days": 14}'::jsonb,
    1
  ),
  (
    'trackoja_works',
    'TrackOja Works',
    NULL,
    NULL,
    'inactive',
    'private',
    '[]'::jsonb,
    NULL,
    '{"requires_verified_payment": true, "requires_activation_key": true, "self_serve": false, "trial_days": 0}'::jsonb,
    2
  )
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- TRACKOJA PLANS (agreed ladder)
-- ============================================================

INSERT INTO public.product_plans
  (product_id, key, name, description, monthly_price, annual_price, currency,
   user_limit, features, onboarding_note, status, is_default, is_public, sort_order)
SELECT
  p.id, v.key, v.name, v.description, v.monthly_price, v.annual_price, 'NGN',
  v.user_limit, v.features, v.onboarding_note, 'active', v.is_default, TRUE, v.sort_order
FROM public.platform_products p
CROSS JOIN (VALUES
  (
    'starter', 'Starter',
    'For a single owner getting organised, with room for one team member.',
    5000::numeric, 50000::numeric, 2,
    '[{"key":"sales","label":"Sales recording and checkout"},
      {"key":"inventory","label":"Products and stock"},
      {"key":"customers","label":"Customers and credit records"},
      {"key":"reports","label":"Sales and inventory reports"},
      {"key":"expenses","label":"Expenses and supplier records","upcoming":true}]'::jsonb,
    'No setup fee when you add and manage your products yourself.',
    TRUE, 1
  ),
  (
    'standard', 'Standard',
    'For a single shop getting its sales, stock, and customers into one place.',
    22500::numeric, 225000::numeric, 5,
    '[{"key":"sales","label":"Sales recording and checkout"},
      {"key":"inventory","label":"Products and stock"},
      {"key":"customers","label":"Customers and credit records"},
      {"key":"reports","label":"Sales and inventory reports"},
      {"key":"expenses","label":"Expenses and supplier records","upcoming":true}]'::jsonb,
    'No setup fee when you add and manage your products yourself.',
    FALSE, 2
  ),
  (
    'professional', 'Professional',
    'For busier shops that need staff controls and deeper inventory.',
    45000::numeric, 450000::numeric, 10,
    '[{"key":"sales","label":"Everything in Standard"},
      {"key":"pos","label":"POS device support"},
      {"key":"advanced_inventory","label":"Advanced inventory"},
      {"key":"receivables_payables","label":"Receivables and payables","upcoming":true},
      {"key":"staff","label":"Staff management"},
      {"key":"performance_reports","label":"Performance reports"}]'::jsonb,
    'Implementation is scoped and quoted based on the help required.',
    FALSE, 3
  ),
  (
    'premium', 'Premium',
    'For growing businesses running more than one location.',
    90000::numeric, 900000::numeric, 15,
    '[{"key":"branches","label":"Branches"},
      {"key":"multi_location_stock","label":"Multi-location stock"},
      {"key":"approvals","label":"Approvals","upcoming":true},
      {"key":"budgeting","label":"Budgeting","upcoming":true},
      {"key":"financial_analysis","label":"Deeper financial analysis","upcoming":true}]'::jsonb,
    'Implementation is scoped and quoted based on the help required.',
    FALSE, 4
  ),
  (
    'enterprise', 'Enterprise',
    'For groups that need several companies and tailored workflows.',
    NULL, NULL, NULL,
    '[{"key":"multi_company","label":"Multiple companies","upcoming":true},
      {"key":"integrations","label":"Integrations"},
      {"key":"executive_reporting","label":"Executive reporting"},
      {"key":"dedicated_support","label":"Dedicated support"}]'::jsonb,
    'Custom implementation.',
    FALSE, 5
  )
) AS v(key, name, description, monthly_price, annual_price, user_limit, features, onboarding_note, is_default, sort_order)
WHERE p.key = 'trackoja'
ON CONFLICT (product_id, key) DO NOTHING;

-- TrackOja Works deliberately gets no plans. Add them through the Plans admin
-- area once its pricing is defined; nothing is copied from TrackOja.

-- ============================================================
-- BACKFILL EXISTING SUBSCRIPTIONS INTO PRODUCT ENTITLEMENTS
-- ============================================================
-- Every current subscriber owns TrackOja, and only TrackOja. No TrackOja Works
-- entitlement is created for anyone.

INSERT INTO public.organization_products
  (org_id, product_id, plan_id, status, source, agreed_monthly_price, agreed_user_limit,
   currency, trial_ends_at, activated_at, expires_at, metadata)
SELECT
  s.org_id,
  tp.id,
  pp.id,
  CASE s.status
    WHEN 'trialing' THEN 'pending'
    WHEN 'active'   THEN 'active'
    WHEN 'past_due' THEN 'past_due'
    WHEN 'unpaid'   THEN 'past_due'
    WHEN 'paused'   THEN 'suspended'
    WHEN 'canceled' THEN 'cancelled'
    WHEN 'expired'  THEN 'expired'
    ELSE 'pending'
  END,
  'payment',
  sp.price,
  pp.user_limit,
  COALESCE(sp.currency, 'NGN'),
  s.trial_end,
  s.start_date,
  s.current_period_end,
  jsonb_build_object('backfilled_from', 'subscriptions', 'subscription_id', s.id, 'legacy_plan', sp.name)
FROM public.subscriptions s
JOIN public.platform_products tp ON tp.key = 'trackoja'
LEFT JOIN public.subscription_plans sp ON sp.id = s.plan_id
LEFT JOIN public.product_plans pp
  ON pp.product_id = tp.id
 AND pp.key = CASE lower(COALESCE(sp.name, ''))
                WHEN 'starter'      THEN 'starter'
                WHEN 'standard'     THEN 'standard'
                WHEN 'pro'          THEN 'professional'
                WHEN 'professional' THEN 'professional'
                WHEN 'premium'      THEN 'premium'
                WHEN 'free'         THEN 'starter'
                ELSE NULL
              END
ON CONFLICT (org_id, product_id) DO NOTHING;

-- ============================================================
-- CORRECT THE STARTER SEAT LIMIT
-- ============================================================
-- Agreed: Starter is two logins - the owner/admin plus one user.

UPDATE public.subscription_plans
SET feature_set = feature_set || jsonb_build_object('team_members', 2)
WHERE name = 'Starter';

-- ============================================================
-- RETIRE LEGACY PLANS THAT ARE NO LONGER SOLD
-- ============================================================
-- Free: there is no permanent free tier; new businesses get a dated trial on the
-- paid entry tier instead. Pro (N15,000): not part of the agreed ladder.
-- Existing subscribers keep their rows and invoices; only new selection is blocked.

UPDATE public.subscription_plans
SET status = 'inactive'
WHERE name IN ('Free', 'Pro');

-- ============================================================
-- NEW ORGANIZATION -> TRIAL ON THE PAID ENTRY TIER
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_organization_subscription()
RETURNS TRIGGER AS $$
DECLARE
  v_entry_plan_id UUID;
BEGIN
  -- Trial only: no permanent free tier. A new business starts on the paid entry
  -- tier in 'trialing' state, bounded by organizations.trial_ends_at. Access is
  -- withdrawn at the end of the trial unless a payment is verified.
  SELECT id INTO v_entry_plan_id
  FROM public.subscription_plans
  WHERE name = 'Starter' AND status = 'active'
  LIMIT 1;

  IF v_entry_plan_id IS NOT NULL THEN
    INSERT INTO public.subscriptions (
      org_id, plan_id, status, trial_end, current_period_start, current_period_end
    ) VALUES (
      NEW.id, v_entry_plan_id, 'trialing', NEW.trial_ends_at, now(), NEW.trial_ends_at
    )
    ON CONFLICT (org_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- NEW ORGANIZATION -> TRACKOJA ENTITLEMENT
-- ============================================================
-- Entitlements are created per product. Only TrackOja's is created here: a
-- TrackOja trial must never grant TrackOja Works.

CREATE OR REPLACE FUNCTION public.handle_new_organization_product_entitlement()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.organization_products (
    org_id, product_id, plan_id, status, source,
    agreed_monthly_price, agreed_annual_price, agreed_user_limit,
    currency, trial_ends_at, metadata
  )
  SELECT
    NEW.id,
    tp.id,
    pp.id,
    'pending',
    'trial',
    pp.monthly_price,
    pp.annual_price,
    pp.user_limit,
    COALESCE(pp.currency, 'NGN'),
    NEW.trial_ends_at,
    jsonb_build_object('auto', 'new_organization', 'product_key', tp.key)
  FROM public.platform_products tp
  LEFT JOIN public.product_plans pp
    ON pp.product_id = tp.id AND pp.is_default = TRUE AND pp.status = 'active'
  WHERE tp.key = 'trackoja'
  ON CONFLICT (org_id, product_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_organization_created_product_entitlement ON public.organizations;
CREATE TRIGGER on_organization_created_product_entitlement
  AFTER INSERT ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_organization_product_entitlement();

-- ============================================================
-- PLATFORM SETTINGS: BILLING BASELINE
-- ============================================================
-- Non-secret configuration only. Payment credentials remain server-side.

INSERT INTO public.platform_settings (key, value, description, category) VALUES
  ('billing.trial_days', '14'::jsonb,
   'Length of the free trial a new business receives on the paid entry tier.', 'payments'),
  ('billing.annual_months_free', '2'::jsonb,
   'Months of discount applied to annual billing. Annual = monthly x (12 - this).', 'payments'),
  ('billing.currency', '"NGN"'::jsonb,
   'Default billing currency for new plans.', 'payments'),
  ('products.trackoja.visible', 'true'::jsonb,
   'Whether TrackOja is advertised publicly.', 'products'),
  ('products.trackoja_works.visible', 'false'::jsonb,
   'Whether TrackOja Works is advertised publicly. Off until its pricing is defined.', 'products'),
  ('activation.keys_enabled', 'true'::jsonb,
   'Allow activation keys for offline or manually approved purchases.', 'activation'),
  ('developer.sandbox_required', 'true'::jsonb,
   'Developer-mode overrides must target sandbox records only.', 'developer')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- FEATURE FLAGS
-- ============================================================

INSERT INTO public.feature_flags (key, description, enabled, scope) VALUES
  ('multi_product_admin', 'Show the multi-product admin areas.', TRUE, 'platform'),
  ('trackoja_works_beta', 'Expose TrackOja Works.', FALSE, 'platform'),
  ('activation_keys', 'Enable activation key issuance and redemption.', TRUE, 'platform')
ON CONFLICT DO NOTHING;
