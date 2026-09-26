-- Migration: 074_platform_products_plan_ladder.sql
-- Description: Finalises the agreed TrackOja ladder: Starter, Standard, Premium,
--   Custom.
--
--   - The N90,000 tier is retired. It was seeded in 068 and has no subscribers,
--     so there is nothing to migrate; it is kept under key premium_90k for
--     history only.
--   - Professional is renamed Premium. Its identity is unchanged: same row, same
--     N45,000 / N450,000 prices, same 10-seat limit, and its own features. Only
--     the key and name change.
--   - Enterprise is renamed Custom.
--   - Branches, multi-location stock, approvals, budgeting, and deeper financial
--     analysis leave the ladder for now, so they are removed from the product
--     feature catalogue rather than left advertised with nothing behind them.
--
--   Note: this is a data migration applied by an operator, so it writes no
--   product_plan_revisions rows (changed_by requires a real actor). This file is
--   the record of the change; subsequent edits go through upsert_product_plan,
--   which journals automatically.
-- Author: TrackOja Team
-- Date: 2026-09-26

-- ============================================================
-- RETIRE AND FREE THE N90,000 TIER
-- ============================================================

-- Rename first so the 'premium' key is free for the N45,000 tier below.
UPDATE public.product_plans pp
SET key = 'premium_90k',
    status = 'retired',
    is_public = FALSE,
    updated_at = now()
FROM public.platform_products p
WHERE pp.product_id = p.id
  AND p.key = 'trackoja'
  AND pp.key = 'premium';

-- ============================================================
-- RENAME PROFESSIONAL -> PREMIUM, ENTERPRISE -> CUSTOM
-- ============================================================

UPDATE public.product_plans pp
SET key = 'premium',
    name = 'Premium',
    description = 'For busier shops that need staff controls and deeper inventory.',
    status = 'active',
    is_public = TRUE,
    sort_order = 3,
    updated_at = now()
FROM public.platform_products p
WHERE pp.product_id = p.id
  AND p.key = 'trackoja'
  AND pp.key = 'professional';

UPDATE public.product_plans pp
SET key = 'custom',
    name = 'Custom',
    description = 'For groups that need tailored workflows and dedicated support.',
    status = 'active',
    is_public = TRUE,
    sort_order = 4,
    updated_at = now()
FROM public.platform_products p
WHERE pp.product_id = p.id
  AND p.key = 'trackoja'
  AND pp.key = 'enterprise';

-- Publish the remaining tiers and fix ordering.
UPDATE public.product_plans pp
SET is_public = TRUE, updated_at = now()
FROM public.platform_products p
WHERE pp.product_id = p.id
  AND p.key = 'trackoja'
  AND pp.key IN ('starter', 'standard');

UPDATE public.product_plans pp
SET sort_order = 1, updated_at = now()
FROM public.platform_products p
WHERE pp.product_id = p.id AND p.key = 'trackoja' AND pp.key = 'starter';

UPDATE public.product_plans pp
SET sort_order = 2, updated_at = now()
FROM public.platform_products p
WHERE pp.product_id = p.id AND p.key = 'trackoja' AND pp.key = 'standard';

-- ============================================================
-- PRODUCT FEATURE CATALOGUE FOR TRACKOJA
-- ============================================================
-- Reflects exactly what the four published tiers offer. The retired N90,000
-- tier's features are gone from the catalogue, so no pricing page or admin
-- screen can advertise them.

UPDATE public.platform_products
SET features = '[
      {"key":"sales","label":"Sales recording and checkout"},
      {"key":"inventory","label":"Products and stock"},
      {"key":"customers","label":"Customers and credit records"},
      {"key":"reports","label":"Sales and inventory reports"},
      {"key":"expenses","label":"Expenses and supplier records","upcoming":true},
      {"key":"pos","label":"POS device support"},
      {"key":"advanced_inventory","label":"Advanced inventory"},
      {"key":"receivables_payables","label":"Receivables and payables","upcoming":true},
      {"key":"staff","label":"Staff management"},
      {"key":"performance_reports","label":"Performance reports"},
      {"key":"multi_company","label":"Multiple companies","upcoming":true},
      {"key":"integrations","label":"Integrations"},
      {"key":"executive_reporting","label":"Executive reporting"},
      {"key":"dedicated_support","label":"Dedicated support"}
    ]'::jsonb,
    updated_at = now()
WHERE key = 'trackoja';

-- ============================================================
-- PLATFORM SETTINGS
-- ============================================================

INSERT INTO public.platform_settings (key, value, description, category)
VALUES (
  'products.trackoja.tiers_public',
  '["starter","standard","premium","custom"]'::jsonb,
  'Plan keys advertised publicly for TrackOja, in display order.',
  'products'
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

-- ============================================================
-- VERIFY THE RESULT
-- ============================================================
-- Fails loudly rather than silently shipping a ladder that does not match the
-- agreed figures. Runs as part of the migration.

DO $$
DECLARE
  v_expected RECORD;
  v_count INTEGER;
BEGIN
  FOR v_expected IN
    SELECT * FROM (VALUES
      ('starter',  5000::numeric,  50000::numeric,  2),
      ('standard', 22500::numeric, 225000::numeric, 5),
      ('premium',  45000::numeric, 450000::numeric, 10)
    ) AS t(plan_key, monthly, annual, seats)
  LOOP
    SELECT COUNT(*) INTO v_count
    FROM public.product_plans pp
    JOIN public.platform_products p ON p.id = pp.product_id
    WHERE p.key = 'trackoja'
      AND pp.key = v_expected.plan_key
      AND pp.monthly_price = v_expected.monthly
      AND pp.annual_price = v_expected.annual
      AND pp.user_limit = v_expected.seats
      AND pp.status = 'active'
      AND pp.is_public = TRUE;

    IF v_count <> 1 THEN
      RAISE EXCEPTION 'Ladder check failed for %: expected one active public tier at % / % with % seats',
        v_expected.plan_key, v_expected.monthly, v_expected.annual, v_expected.seats;
    END IF;
  END LOOP;

  SELECT COUNT(*) INTO v_count
  FROM public.product_plans pp
  JOIN public.platform_products p ON p.id = pp.product_id
  WHERE p.key = 'trackoja' AND pp.key = 'custom'
    AND pp.monthly_price IS NULL AND pp.annual_price IS NULL
    AND pp.status = 'active';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Ladder check failed: Custom must be active with NULL prices';
  END IF;

  -- The retired tier must no longer be sellable.
  SELECT COUNT(*) INTO v_count
  FROM public.product_plans pp
  JOIN public.platform_products p ON p.id = pp.product_id
  WHERE p.key = 'trackoja' AND pp.status = 'active' AND pp.is_public = TRUE;

  IF v_count <> 4 THEN
    RAISE EXCEPTION 'Ladder check failed: expected exactly 4 active public tiers, found %', v_count;
  END IF;
END $$;
