-- Migration: 075_backfill_org_product_entitlements.sql
-- Description: Every organization must hold a TrackOja entitlement.
--   Organizations created before the entitlement trigger existed (068) have none,
--   so the seat-limit guard refuses to add staff with "This business has no active
--   subscription" even though the business is legitimately subscribed. This
--   backfills them, deriving plan and status from their subscription where one
--   exists and otherwise placing them on the default paid tier in a trial state.
--
--   Idempotent: only touches organizations with no entitlement row at all.
-- Author: TrackOja Team
-- Date: 2026-09-26

INSERT INTO public.organization_products (
  org_id, product_id, plan_id, status, source,
  agreed_monthly_price, agreed_annual_price, agreed_user_limit,
  currency, trial_ends_at, activated_at, expires_at, metadata
)
SELECT
  o.id,
  tp.id,
  COALESCE(pp.id, dpp.id),
  CASE
    WHEN s.status = 'active'                 THEN 'active'
    WHEN s.status IN ('past_due', 'unpaid')  THEN 'past_due'
    WHEN s.status = 'paused'                 THEN 'suspended'
    WHEN s.status = 'canceled'               THEN 'cancelled'
    WHEN s.status = 'expired'                THEN 'expired'
    ELSE 'pending'
  END,
  CASE WHEN s.id IS NULL THEN 'trial' ELSE 'payment' END,
  COALESCE(pp.monthly_price, dpp.monthly_price),
  COALESCE(pp.annual_price, dpp.annual_price),
  COALESCE(pp.user_limit, dpp.user_limit),
  'NGN',
  COALESCE(s.trial_end, o.trial_ends_at, now() + INTERVAL '14 days'),
  COALESCE(s.start_date, now()),
  s.current_period_end,
  jsonb_build_object(
    'backfilled_by', '075',
    'had_subscription', s.id IS NOT NULL,
    'legacy_plan', sp.name
  )
FROM public.organizations o
JOIN public.platform_products tp ON tp.key = 'trackoja'
LEFT JOIN public.subscriptions s ON s.org_id = o.id
LEFT JOIN public.subscription_plans sp ON sp.id = s.plan_id
LEFT JOIN public.product_plans pp
  ON pp.product_id = tp.id
 AND pp.key = CASE lower(COALESCE(sp.name, ''))
                WHEN 'starter'      THEN 'starter'
                WHEN 'standard'     THEN 'standard'
                WHEN 'pro'          THEN 'premium'
                WHEN 'professional' THEN 'premium'
                WHEN 'premium'      THEN 'premium'
                WHEN 'free'         THEN 'starter'
                ELSE NULL
              END
LEFT JOIN public.product_plans dpp
  ON dpp.product_id = tp.id AND dpp.is_default = TRUE AND dpp.status = 'active'
WHERE NOT EXISTS (
  SELECT 1 FROM public.organization_products op WHERE op.org_id = o.id
)
ON CONFLICT (org_id, product_id) DO NOTHING;

-- Fail loudly if any organization is still uncovered, so this cannot silently
-- leave a business unable to add its staff.
DO $$
DECLARE
  v_uncovered INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_uncovered
  FROM public.organizations o
  WHERE NOT EXISTS (
    SELECT 1 FROM public.organization_products op WHERE op.org_id = o.id
  );

  IF v_uncovered > 0 THEN
    RAISE EXCEPTION 'Entitlement backfill incomplete: % organization(s) still have no product entitlement', v_uncovered;
  END IF;
END $$;
