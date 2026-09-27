-- Migration: 092_billing_single_source.sql
-- Description: Makes published product_plans the single source of truth for
--   billing, so the public pricing page, the customer Billing page and checkout
--   all read one catalogue instead of three (BILLING_SINGLE_SOURCE.md).
--
--   The defect being closed is measured, not assumed. Today three surfaces read
--   three sources: the public pricing page reads hard-coded literals, the
--   customer Billing page reads the legacy subscription_plans table through
--   SubscriptionService.getPlans(), and the platform console reads product_plans.
--   product_plans already holds five rows - starter, standard, premium, custom
--   and a retired premium_90k - but nothing customer-facing can read them, so a
--   customer can only ever buy Starter: initiate_subscription_checkout takes a
--   LEGACY plan id, and the only active legacy plan is Starter.
--
--   Seven changes, in the order the file makes them:
--
--   1. product_plans gains the five columns the brief needs and the catalogue
--      does not have - setup_fee, trial_days, store_limit, published_at,
--      effective_from - and every currently customer-visible row is backfilled
--      so nothing that is visible today disappears tomorrow.
--   2. upsert_product_plan accepts setup_fee, trial_days and store_limit, and
--      stops being able to publish: publishing is a separate deliberate act.
--   3. list_product_plans returns the new columns, appended.
--   4. list_published_plans(product_key) - the one read every customer-facing
--      surface uses. Tenant-facing: gated on a session, not on platform:view.
--   5. get_my_entitlement(product_key) - a business's own entitlement and real
--      usage, with the seat count taken the same way enforce_seat_limit takes it.
--   6. publish_product_plan(product_key, plan_key, note, effective_from) - the
--      deliberate draft -> published step, journaled and audited.
--   7. start_plan_checkout(plan_id, billing_cycle) - checkout by PRODUCT plan id,
--      writing the legacy mirror row and the pending transaction that the
--      existing Paystack webhook already knows how to settle.
--
--   Three things are deliberately NOT touched:
--     * initiate_subscription_checkout keeps its signature and body, so anything
--       still calling the legacy checkout keeps working.
--     * activate_subscription keeps its signature and body. It is the webhook's
--       only entry point and 090's hardening of it is not reopened here.
--     * enforce_seat_limit keeps its signature and body, and no RLS policy moves.
--   No function in this file changes the argument list or return type of an
--   existing caller's dependency: every change is either an appended column or a
--   new function.
--
--   Discipline this project requires (090 section 5): a `REVOKE ... FROM PUBLIC`
--   is not a control here, because pg_default_acl grants EXECUTE on every new
--   public function straight to anon and authenticated:
--
--     postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres
--
--   Every REVOKE in this file therefore names PUBLIC, anon and authenticated
--   explicitly, and section 8 asserts the resulting ACL rather than trusting it.
--
--   Every statement is idempotent: the columns are added with IF NOT EXISTS, the
--   constraints are dropped before they are added, the two functions whose return
--   shape changes are dropped before they are recreated, the backfill's selection
--   predicate is empty on a second run, and section 8 checks the ACLs it claims
--   to have set. Re-running the whole file against the same database is a no-op
--   that writes no row.
-- Author: TrackOja Team
-- Date: 2026-09-27

-- ============================================================
-- 1. product_plans GAINS THE FIVE MISSING COLUMNS
-- ============================================================
-- The brief requires a one-off implementation fee, an explicit trial length, a
-- store cap, and effective dates. None of the five exists today.
--
-- Four of them are additive and NULL-tolerant, so the five existing rows are
-- untouched by the ALTER itself. `trial_days` is NOT NULL DEFAULT 0, which
-- classifies every existing row as "no trial" rather than guessing a length:
-- the audit found trial length stored in two inert settings
-- (platform_settings.billing.trial_days and
-- platform_products.access_settings.trial_days, both 14, neither read by any
-- code), and the redesigned flow reads trial days from the plan. Copying 14 into
-- five rows here would invent a commitment nobody made.

ALTER TABLE public.product_plans
  ADD COLUMN IF NOT EXISTS setup_fee NUMERIC(14,2);

ALTER TABLE public.product_plans DROP CONSTRAINT IF EXISTS product_plans_setup_fee_check;
ALTER TABLE public.product_plans
  ADD CONSTRAINT product_plans_setup_fee_check
  CHECK (setup_fee IS NULL OR setup_fee >= 0);

ALTER TABLE public.product_plans
  ADD COLUMN IF NOT EXISTS trial_days INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.product_plans DROP CONSTRAINT IF EXISTS product_plans_trial_days_check;
ALTER TABLE public.product_plans
  ADD CONSTRAINT product_plans_trial_days_check
  CHECK (trial_days >= 0);

-- store_limit carries the same semantics as user_limit (-1 unlimited, NULL
-- custom, positive cap) and, like user_limit, is validated at the function
-- boundary rather than by a CHECK: the two must stay interchangeable, and only
-- one of them can carry a constraint without the reader wondering why they
-- differ. upsert_product_plan rejects 0 and every value below -1.
ALTER TABLE public.product_plans
  ADD COLUMN IF NOT EXISTS store_limit INTEGER;

-- published_at is the publication stamp and effective_from the date the price
-- becomes chargeable. They are separate on purpose: a plan can be announced
-- today and take effect on the first of next month.
ALTER TABLE public.product_plans
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE public.product_plans
  ADD COLUMN IF NOT EXISTS effective_from TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN public.product_plans.setup_fee IS
  'One-off implementation fee, charged once on activation. Distinct from a monthly price and NULL when there is none.';
COMMENT ON COLUMN public.product_plans.trial_days IS
  'Trial length in days for this plan. 0 means no trial. This is the value the redesigned flow reads; the two older '
  'trial_days settings (platform_settings.billing, platform_products.access_settings) are inert.';
COMMENT ON COLUMN public.product_plans.store_limit IS
  'Billable stores. -1 = unlimited, NULL = custom, positive = hard cap. Same semantics as user_limit.';
COMMENT ON COLUMN public.product_plans.published_at IS
  'When the plan was deliberately published. NULL means draft: the plan is invisible to every customer-facing '
  'surface even when status is active and is_public is true. Set by publish_product_plan, never by an edit.';
COMMENT ON COLUMN public.product_plans.effective_from IS
  'When the plan''s price becomes chargeable. A plan is customer-visible only when published_at IS NOT NULL and '
  'effective_from <= now(), so a future date announces a plan without selling it yet.';

-- ------------------------------------------------------------
-- 1.1 Backfill: nothing currently visible may disappear
-- ------------------------------------------------------------
-- Customer-visible today is exactly `status = 'active' AND is_public = true`,
-- which the RLS policy on product_plans partially mirrors. Those rows are stamped
-- with both dates so the stricter published set is a superset of what customers
-- can already read. Rows that are retired or private keep NULL published_at and
-- therefore stay invisible - in particular the retired, private premium_90k row,
-- which is history and must not resurface as a buyable tier.
--
-- The predicate `AND (published_at IS NULL OR effective_from IS NULL)` makes the
-- second run of this file touch zero rows, which is what "a clean no-op" means:
-- without it the UPDATE would rewrite identical values, fire the updated_at
-- trigger on four rows and bump their revision timestamps for no reason.

DO $$
DECLARE
  v_visible INTEGER;
  v_published INTEGER;
  v_written INTEGER;
BEGIN
  SELECT count(*) INTO v_visible
  FROM public.product_plans
  WHERE status = 'active' AND is_public = TRUE;

  UPDATE public.product_plans
     SET published_at   = COALESCE(published_at, now()),
         effective_from = COALESCE(effective_from, now())
   WHERE status = 'active'
     AND is_public = TRUE
     AND (published_at IS NULL OR effective_from IS NULL);

  GET DIAGNOSTICS v_written = ROW_COUNT;

  SELECT count(*) INTO v_published
  FROM public.product_plans
  WHERE status = 'active' AND is_public = TRUE AND published_at IS NOT NULL;

  -- Not an assertion about how many plans the business should sell - that is a
  -- commercial decision - but about the backfill's own completeness: every row
  -- that was visible is now published.
  IF v_published <> v_visible THEN
    RAISE EXCEPTION
      '092 backfill published % of the % customer-visible product plan(s); every visible plan must be published',
      v_published, v_visible;
  END IF;

  RAISE NOTICE '092 backfill: % customer-visible product plan(s) published; % row(s) stamped by this run',
    v_published, v_written;
END $$;

-- ============================================================
-- 2. upsert_product_plan ACCEPTS THE THREE NEW FIELDS
-- ============================================================
-- A new argument changes the signature, so the old function is dropped first.
--
-- WHERE THE NEW ARGUMENTS GO, AND WHY NOT WHERE THE BRIEF SAID. The brief
-- describes the current signature as "15 arguments ending p_note" and asks for
-- the three new ones to be appended after it. Read back from the database, the
-- live signature is 15 arguments ending p_billing_cycle - p_note is the
-- fourteenth, and 089 appended p_billing_cycle after it:
--
--   p_product_key, p_plan_key, p_name, p_description, p_monthly_price,
--   p_annual_price, p_user_limit, p_features, p_onboarding_note, p_status,
--   p_is_default, p_is_public, p_sort_order, p_note, p_billing_cycle
--
-- Inserting the new arguments between p_note and p_billing_cycle would satisfy
-- "in that order" while breaking the instruction that actually matters: every
-- existing 15-argument call would silently re-map its trailing arguments, and
-- the app's savePlan passes p_billing_cycle as its last value. They are appended
-- after p_billing_cycle instead, in the order asked for - setup_fee, trial_days,
-- store_limit - so the previous 15 arguments keep their exact positions and
-- names, and named-argument callers are unaffected either way.
--
-- There is deliberately NO publish parameter. Publishing stamps published_at and
-- effective_from and is a separate, deliberate act (section 6), which is what
-- makes "preview before publishing" and the revision history meaningful. An edit
-- therefore leaves published_at exactly as it was - a live plan stays live after
-- a typo fix - because `published_at` is absent from the ON CONFLICT DO UPDATE
-- list below. That absence is the mechanism, not an oversight, and the
-- verification calls upsert_product_plan against a published plan to prove it.
--
-- The three new values are journaled in product_plan_revisions alongside the
-- prices, so the pricing history records the fee, the trial length and the store
-- cap as well as the numbers.

DROP FUNCTION IF EXISTS public.upsert_product_plan(
  TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, INTEGER, JSONB, TEXT, TEXT, BOOLEAN, BOOLEAN, INTEGER, TEXT, TEXT
);

CREATE OR REPLACE FUNCTION public.upsert_product_plan(
  p_product_key TEXT,
  p_plan_key TEXT,
  p_name TEXT,
  p_description TEXT DEFAULT NULL,
  p_monthly_price NUMERIC DEFAULT NULL,
  p_annual_price NUMERIC DEFAULT NULL,
  p_user_limit INTEGER DEFAULT NULL,
  p_features JSONB DEFAULT NULL,
  p_onboarding_note TEXT DEFAULT NULL,
  p_status TEXT DEFAULT 'active',
  p_is_default BOOLEAN DEFAULT FALSE,
  p_is_public BOOLEAN DEFAULT TRUE,
  p_sort_order INTEGER DEFAULT NULL,
  p_note TEXT DEFAULT NULL,
  p_billing_cycle TEXT DEFAULT 'monthly',
  p_setup_fee NUMERIC DEFAULT NULL,
  p_trial_days INTEGER DEFAULT 0,
  p_store_limit INTEGER DEFAULT NULL
)
RETURNS public.product_plans
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := public.require_platform_permission('platform:manage_plans');
  v_product_id UUID;
  v_existing public.product_plans;
  v_row public.product_plans;
  v_previous JSONB;
  v_billing_cycle TEXT := lower(btrim(COALESCE(NULLIF(p_billing_cycle, ''), 'monthly')));
BEGIN
  IF p_status NOT IN ('active', 'inactive', 'draft', 'retired') THEN
    RAISE EXCEPTION 'Invalid plan status: %', p_status;
  END IF;
  IF p_monthly_price IS NOT NULL AND p_monthly_price < 0 THEN
    RAISE EXCEPTION 'Monthly price cannot be negative';
  END IF;
  IF p_annual_price IS NOT NULL AND p_annual_price < 0 THEN
    RAISE EXCEPTION 'Annual price cannot be negative';
  END IF;
  IF p_user_limit IS NOT NULL AND p_user_limit <> -1 AND p_user_limit < 1 THEN
    RAISE EXCEPTION 'User limit must be positive, -1 for unlimited, or NULL for custom';
  END IF;
  IF p_setup_fee IS NOT NULL AND p_setup_fee < 0 THEN
    RAISE EXCEPTION 'Setup fee cannot be negative';
  END IF;
  IF p_trial_days IS NOT NULL AND p_trial_days < 0 THEN
    RAISE EXCEPTION 'Trial days cannot be negative';
  END IF;
  -- Deliberately worded exactly like the user_limit check: the two limits are
  -- the same concept applied to different resources, and a caller reading the
  -- error should not have to learn a second vocabulary.
  IF p_store_limit IS NOT NULL AND p_store_limit <> -1 AND p_store_limit < 1 THEN
    RAISE EXCEPTION 'Store limit must be positive, -1 for unlimited, or NULL for custom';
  END IF;
  IF v_billing_cycle NOT IN ('monthly', 'annual', 'custom') THEN
    RAISE EXCEPTION 'Invalid billing cycle: %', p_billing_cycle;
  END IF;

  SELECT id INTO v_product_id FROM public.platform_products WHERE key = p_product_key;
  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'Unknown product: %', p_product_key;
  END IF;

  SELECT * INTO v_existing
  FROM public.product_plans
  WHERE product_id = v_product_id AND key = p_plan_key;

  IF v_existing.id IS NOT NULL THEN
    v_previous := jsonb_build_object(
      'name', v_existing.name,
      'monthly_price', v_existing.monthly_price,
      'annual_price', v_existing.annual_price,
      'user_limit', v_existing.user_limit,
      'status', v_existing.status,
      'features', v_existing.features,
      'billing_cycle', v_existing.billing_cycle,
      'setup_fee', v_existing.setup_fee,
      'trial_days', v_existing.trial_days,
      'store_limit', v_existing.store_limit
    );
  END IF;

  IF p_is_default THEN
    UPDATE public.product_plans SET is_default = FALSE
    WHERE product_id = v_product_id AND is_default = TRUE AND key <> p_plan_key;
  END IF;

  -- published_at and effective_from are absent from both column lists. A new
  -- plan therefore starts as a draft (the columns default to NULL) and an
  -- existing plan keeps whatever publication state it already had.
  INSERT INTO public.product_plans AS t
    (product_id, key, name, description, monthly_price, annual_price, user_limit,
     features, onboarding_note, status, is_default, is_public, sort_order, created_by,
     billing_cycle, setup_fee, trial_days, store_limit)
  VALUES
    (v_product_id, p_plan_key, p_name, p_description, p_monthly_price, p_annual_price,
     p_user_limit, COALESCE(p_features, '[]'::jsonb), p_onboarding_note, p_status,
     p_is_default, p_is_public, COALESCE(p_sort_order, 0), v_actor,
     v_billing_cycle, p_setup_fee, COALESCE(p_trial_days, 0), p_store_limit)
  ON CONFLICT (product_id, key) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    monthly_price = EXCLUDED.monthly_price,
    annual_price = EXCLUDED.annual_price,
    user_limit = EXCLUDED.user_limit,
    features = COALESCE(p_features, t.features),
    onboarding_note = EXCLUDED.onboarding_note,
    status = EXCLUDED.status,
    is_default = EXCLUDED.is_default,
    is_public = EXCLUDED.is_public,
    sort_order = COALESCE(p_sort_order, t.sort_order),
    billing_cycle = EXCLUDED.billing_cycle,
    setup_fee = EXCLUDED.setup_fee,
    trial_days = EXCLUDED.trial_days,
    store_limit = EXCLUDED.store_limit,
    updated_at = now()
  RETURNING * INTO v_row;

  -- Journal the change. Existing subscribers are unaffected: their agreed prices
  -- live on organization_products and are never rewritten by a plan edit.
  -- Publication state is not journaled here - publish_product_plan writes its own
  -- 'published' revision - so this row records the edit and nothing more.
  INSERT INTO public.product_plan_revisions
    (plan_id, product_id, changed_by, change_type, previous_values, new_values, note)
  VALUES (
    v_row.id,
    v_product_id,
    v_actor,
    CASE WHEN v_existing.id IS NULL THEN 'created' ELSE 'updated' END,
    v_previous,
    jsonb_build_object(
      'name', v_row.name,
      'monthly_price', v_row.monthly_price,
      'annual_price', v_row.annual_price,
      'user_limit', v_row.user_limit,
      'status', v_row.status,
      'features', v_row.features,
      'billing_cycle', v_row.billing_cycle,
      'setup_fee', v_row.setup_fee,
      'trial_days', v_row.trial_days,
      'store_limit', v_row.store_limit
    ),
    p_note
  );

  INSERT INTO public.audit_logs (actor_id, resource_type, resource_id, action, status, details)
  VALUES (v_actor, 'product_plan', v_row.id,
          CASE WHEN v_existing.id IS NULL THEN 'PLAN_CREATED' ELSE 'PLAN_UPDATED' END,
          'success',
          jsonb_build_object('product_key', p_product_key, 'plan_key', p_plan_key,
                             'billing_cycle', v_row.billing_cycle,
                             'previous', v_previous, 'note', p_note));

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.upsert_product_plan(
  TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, INTEGER, JSONB, TEXT, TEXT, BOOLEAN, BOOLEAN, INTEGER, TEXT, TEXT, NUMERIC, INTEGER, INTEGER
) IS
  'Creates or edits a product plan and journals the change. Extended by 092 with setup_fee, trial_days and '
  'store_limit, appended after p_billing_cycle so the previous 15 arguments keep their positions and names. '
  'There is no publish argument: an edit never changes published_at, so a live plan stays visible. '
  'Requires platform:manage_plans.';

REVOKE ALL ON FUNCTION public.upsert_product_plan(
  TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, INTEGER, JSONB, TEXT, TEXT, BOOLEAN, BOOLEAN, INTEGER, TEXT, TEXT, NUMERIC, INTEGER, INTEGER
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_product_plan(
  TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, INTEGER, JSONB, TEXT, TEXT, BOOLEAN, BOOLEAN, INTEGER, TEXT, TEXT, NUMERIC, INTEGER, INTEGER
) TO authenticated;

-- ============================================================
-- 3. list_product_plans RETURNS THE NEW COLUMNS
-- ============================================================
-- Appending columns changes the function's RETURNS TABLE, which CREATE OR
-- REPLACE cannot do, so the function is dropped first - ditto for upsert above.
-- The five new columns are appended after billing_cycle and every existing column
-- keeps its name and position, so a caller that reads columns by name (the
-- console's listPlans does) is unaffected. This function is the ADMIN read: it
-- requires platform:view and returns drafts, retired rows and subscriber counts,
-- which is exactly what a customer-facing catalogue must not.

DROP FUNCTION IF EXISTS public.list_product_plans(TEXT);

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
      WHERE op.plan_id = pp.id AND op.status IN ('active', 'pending')),
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

COMMENT ON FUNCTION public.list_product_plans(TEXT) IS
  'The platform console''s plan catalogue, including drafts, retired rows and subscriber counts. Requires '
  'platform:view, so no customer can call it. Extended by 092 with setup_fee, trial_days, store_limit, '
  'published_at and effective_from, appended so existing columns keep their positions.';

REVOKE ALL ON FUNCTION public.list_product_plans(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_product_plans(TEXT) TO authenticated;

-- ============================================================
-- 4. list_published_plans: THE ONE CUSTOMER-FACING CATALOGUE
-- ============================================================
-- This is the function the public pricing page and the customer Billing page
-- both read, which is what makes them unable to disagree. Its definition of
-- "published" is the whole point of the redesign, so it is stated once, here,
-- and nowhere else in the product:
--
--   status = 'active' AND is_public = true AND published_at IS NOT NULL
--     AND effective_from <= now()
--
--   * status and is_public are the operator's intent.
--   * published_at is the deliberate act: a plan edited into a perfect state is
--     still invisible until somebody publishes it.
--   * effective_from is the date: a plan can be announced today and start selling
--     on the first of next month, and it is not buyable until then. A NULL
--     effective_from fails `<= now()`, so an unpublished row cannot leak out
--     through the date test either.
--
-- Gated on being customer-facing rather than on a platform permission, because
-- the caller is a customer, not an administrator: requiring platform:view here is
-- what made the published catalogue unreachable from the Billing page in the
-- first place.
--
-- GRANTED TO anon AS WELL AS authenticated, and this is the ONLY function in this
-- migration that is. The public pricing page renders inside GuestRoute, which
-- redirects any signed-in user away from it, so the only people who ever read that
-- page are anonymous visitors holding the anon role. With EXECUTE granted to
-- authenticated alone every real visitor would be refused and the marketing page
-- would show its "prices unavailable" state permanently.
--
-- Granting it to anon is safe by construction, not by argument: the function is
-- SECURITY DEFINER so it is not limited by RLS, and it filters to exactly
-- `status = 'active' AND is_public = true AND published_at IS NOT NULL AND
-- effective_from <= now()`. Everything it can return is pricing this product
-- already advertises publicly. It takes a product key and returns plan rows -
-- no tenant data, no per-customer figures, no entitlement, no usage. Nothing
-- caller-scoped is reachable through it: it does not read auth.uid() at all.
--
-- get_my_entitlement IS caller-scoped and is therefore NOT granted to anon; the
-- rule is asserted role by role in section 8 rather than left to a comment.
--
-- Costs, seat counts, the on-boarding note and both dates are returned together
-- so one round trip fills a pricing card and a Billing page row. Custom pricing
-- (NULL prices) is included: it is a real, published tier that is sold by
-- conversation, and the page needs to show it to offer the conversation.

CREATE OR REPLACE FUNCTION public.list_published_plans(p_product_key TEXT DEFAULT 'trackoja')
RETURNS TABLE (
  id UUID,
  product_key TEXT,
  product_name TEXT,
  key TEXT,
  name TEXT,
  description TEXT,
  monthly_price NUMERIC,
  annual_price NUMERIC,
  currency TEXT,
  billing_cycle TEXT,
  user_limit INTEGER,
  store_limit INTEGER,
  features JSONB,
  onboarding_note TEXT,
  setup_fee NUMERIC,
  trial_days INTEGER,
  is_default BOOLEAN,
  sort_order INTEGER,
  published_at TIMESTAMPTZ,
  effective_from TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_product_id UUID;
BEGIN
  IF p_product_key IS NULL OR btrim(p_product_key) = '' THEN
    RAISE EXCEPTION 'Unknown product: %', COALESCE(p_product_key, '(none)');
  END IF;

  SELECT pr.id INTO v_product_id
  FROM public.platform_products pr
  WHERE pr.key = btrim(p_product_key);

  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'Unknown product: %', p_product_key;
  END IF;

  RETURN QUERY
  SELECT
    pp.id,
    pr.key AS product_key,
    pr.name AS product_name,
    pp.key,
    pp.name,
    pp.description,
    pp.monthly_price,
    pp.annual_price,
    pp.currency,
    pp.billing_cycle,
    pp.user_limit,
    pp.store_limit,
    pp.features,
    pp.onboarding_note,
    pp.setup_fee,
    pp.trial_days,
    pp.is_default,
    pp.sort_order,
    pp.published_at,
    pp.effective_from
  FROM public.product_plans pp
  JOIN public.platform_products pr ON pr.id = pp.product_id
  WHERE pp.product_id = v_product_id
    AND pp.status = 'active'
    AND pp.is_public = TRUE
    AND pp.published_at IS NOT NULL
    AND pp.effective_from <= now()
  -- Cheapest first within a tier, and a negotiated plan (no monthly price) last:
  -- "Custom" is an enquiry, not the entry price.
  ORDER BY pp.sort_order, pp.monthly_price NULLS LAST;
END;
$$;

COMMENT ON FUNCTION public.list_published_plans(TEXT) IS
  'The single customer-facing catalogue: every plan with status=active, is_public, a published_at and an '
  'effective_from that has arrived. Read by the public pricing page and the customer Billing page so the two '
  'cannot disagree. Granted to anon as well as authenticated because the public pricing page renders for '
  'anonymous visitors; it returns only published prices and no tenant data. '
  'No other function added by 092 is granted to anon.';

-- The PUBLIC pseudo-role entry is removed and the grant is then named explicitly
-- for both roles. See the note above for why anon is deliberate here.
REVOKE ALL ON FUNCTION public.list_published_plans(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_published_plans(TEXT) TO anon, authenticated;

-- ============================================================
-- 5. get_my_entitlement: WHAT THIS BUSINESS ACTUALLY HAS
-- ============================================================
-- The Billing page's "what your plan includes" needs three things that exist in
-- three places and are readable today by nobody who should read them:
--   * the entitlement itself - organization_products, which is the row that
--     grants access and whose agreed_user_limit enforce_seat_limit enforces;
--   * the plan it points at - product_plans, which a customer can half-read
--     through RLS but which has no tenant-facing projection;
--   * real usage - seats and stores, which the customer must see to know whether
--     their next hire will be refused.
-- get_platform_business is the nearest existing function and it is admin-only and
-- returns the wrong shape.
--
-- TWO DETAILS CARRY THE WEIGHT:
--
-- 1. seats_used MUST equal what enforce_seat_limit counts, or the customer is
--    told they have room and the trigger refuses the invitation. The trigger's
--    count, read from 069, is
--
--      SELECT COUNT(DISTINCT sm.user_id) FROM store_members sm
--        JOIN stores s ON s.id = sm.store_id
--       WHERE s.org_id = <org> AND sm.status = 'active' AND sm.user_id IS NOT NULL
--         AND sm.user_id <> NEW.user_id
--
--    The only term that is not reproducible here is `<> NEW.user_id`, which
--    excludes the row being inserted - a row that is by definition not a member
--    yet, so it cannot appear in a count of current members either. The predicate
--    below is therefore the trigger's own predicate, and the verification proves
--    it behaviourally as well as textually: it fills the org's last free seat and
--    then shows the trigger refusing the next one at exactly the seat count this
--    function reports.
--
-- 2. NO ENTITLEMENT MUST RETURN NO ROW, not a row of nulls. "You have no plan"
--    and "you have a plan with no dates" are different facts and the page must be
--    able to tell them apart; a row full of NULLs cannot express the difference.
--    So a missing organization_products row returns an empty set.
--
-- days_remaining is whole days to COALESCE(expires_at, trial_ends_at): an active
-- paid entitlement counts down to its period end, a trial counts down to its trial
-- end, and an entitlement with neither (allowed by the schema, and 090 had to
-- backfill two of them) reports NULL rather than inventing a date. It is negative
-- once the date has passed, because "3 days ago" is information.

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

  -- The caller's business. Membership (organization_members) is the linkage the
  -- rest of the product uses - get_user_org_ids and every RLS predicate read it -
  -- so it is the linkage used here. A caller who belongs to more than one
  -- business gets the one they own, then the one they joined first: deterministic,
  -- and the business whose billing they are allowed to act on.
  SELECT o.id, o.name INTO v_org_id, v_org_name
  FROM public.organization_members om
  JOIN public.organizations o ON o.id = om.org_id
  WHERE om.user_id = v_actor
  ORDER BY (o.owner_id = v_actor) DESC,
           om.joined_at ASC NULLS LAST,
           o.created_at ASC,
           o.id ASC
  LIMIT 1;

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
    COALESCE(v_plan.billing_cycle, 'monthly'),
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

COMMENT ON FUNCTION public.get_my_entitlement(TEXT) IS
  'The calling user''s own organization_products entitlement for a product, with the plan it points at and live '
  'seat and store usage. seats_used is counted exactly as enforce_seat_limit counts it, so the number shown is '
  'the number enforced. Returns NO ROW when the organization holds no entitlement for the product.';

REVOKE ALL ON FUNCTION public.get_my_entitlement(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_entitlement(TEXT) TO authenticated;

-- ============================================================
-- 6. publish_product_plan: THE DELIBERATE DRAFT -> PUBLISHED STEP
-- ============================================================
-- Everything in section 2 makes an edit leave publication alone; this is the one
-- function that changes it. Splitting "save" from "publish" is what makes the
-- preview, the effective date and the change history real rather than decorative.
--
-- Two rules the brief fixes precisely:
--   * published_at is COALESCE(published_at, now()): publishing an already
--     published plan does not move its original publication date, so re-publishing
--     after an edit does not rewrite history or briefly unpublish anything.
--   * effective_from is COALESCE(p_effective_from, now()), and a p_effective_from
--     before today is refused rather than silently rounded up. A backdated price
--     change would retroactively alter what existing customers were charged, and
--     the snapshot on organization_products exists precisely so that never
--     happens silently.
--
-- A published plan is forced to status = 'active' and left is_public as the
-- operator set it: publishing a retired tier would make it buyable again, so the
-- operator has to say both things. The revision row uses the change_type the
-- product_plan_revisions CHECK already allows and that nothing had ever written -
-- 'published' - and the audit row carries the before/after pair, so a reviewer can
-- see what was live and what became live.

CREATE OR REPLACE FUNCTION public.publish_product_plan(
  p_product_key TEXT,
  p_plan_key TEXT,
  p_note TEXT DEFAULT NULL,
  p_effective_from TIMESTAMP WITH TIME ZONE DEFAULT NULL
)
RETURNS public.product_plans
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := public.require_platform_permission('platform:manage_plans');
  v_product public.platform_products;
  v_existing public.product_plans;
  v_row public.product_plans;
  v_previous JSONB;
  v_effective TIMESTAMP WITH TIME ZONE;
BEGIN
  IF p_product_key IS NULL OR btrim(p_product_key) = '' THEN
    RAISE EXCEPTION 'Unknown product: %', COALESCE(p_product_key, '(none)');
  END IF;

  SELECT pr.* INTO v_product
  FROM public.platform_products pr
  WHERE pr.key = btrim(p_product_key);

  IF v_product.id IS NULL THEN
    RAISE EXCEPTION 'Unknown product: %', p_product_key;
  END IF;

  SELECT * INTO v_existing
  FROM public.product_plans pp
  WHERE pp.product_id = v_product.id AND pp.key = p_plan_key
  FOR UPDATE;

  IF v_existing.id IS NULL THEN
    RAISE EXCEPTION 'Unknown plan % for product %', p_plan_key, v_product.key;
  END IF;

  -- "In the past" means a whole calendar day, not an instant: publishing at
  -- 09:00 with an effective time of 08:00 the same morning is a same-day
  -- correction, not a backdating of history.
  IF p_effective_from IS NOT NULL AND p_effective_from < date_trunc('day', now()) THEN
    RAISE EXCEPTION 'The effective date cannot be in the past';
  END IF;

  v_previous := jsonb_build_object(
    'status', v_existing.status,
    'is_public', v_existing.is_public,
    'published_at', v_existing.published_at,
    'effective_from', v_existing.effective_from,
    'monthly_price', v_existing.monthly_price,
    'annual_price', v_existing.annual_price,
    'setup_fee', v_existing.setup_fee,
    'trial_days', v_existing.trial_days
  );

  UPDATE public.product_plans
     SET status = 'active',
         published_at = COALESCE(published_at, now()),
         effective_from = COALESCE(p_effective_from, now())
   WHERE id = v_existing.id
  RETURNING * INTO v_row;

  INSERT INTO public.product_plan_revisions
    (plan_id, product_id, changed_by, change_type, previous_values, new_values, note)
  VALUES (
    v_row.id,
    v_product.id,
    v_actor,
    'published',
    v_previous,
    jsonb_build_object(
      'status', v_row.status,
      'is_public', v_row.is_public,
      'published_at', v_row.published_at,
      'effective_from', v_row.effective_from,
      'monthly_price', v_row.monthly_price,
      'annual_price', v_row.annual_price,
      'setup_fee', v_row.setup_fee,
      'trial_days', v_row.trial_days
    ),
    p_note
  );

  -- Platform-scoped event: org_id is NULL because publishing a plan concerns no
  -- single business. The before/after pair is the reason this row exists.
  PERFORM public.create_audit_log(
    v_actor,
    NULL,
    NULL,
    'PLAN_PUBLISHED',
    'product_plan',
    v_row.id,
    v_product.key || '/' || v_row.key,
    jsonb_build_object(
      'previous', v_previous,
      'new', jsonb_build_object(
        'status', v_row.status,
        'is_public', v_row.is_public,
        'published_at', v_row.published_at,
        'effective_from', v_row.effective_from
      )
    ),
    jsonb_build_object(
      'product_key', v_product.key,
      'plan_key', v_row.key,
      'plan_name', v_row.name,
      'note', p_note,
      'already_published', v_existing.published_at IS NOT NULL
    )
  );

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.publish_product_plan(TEXT, TEXT, TEXT, TIMESTAMPTZ) IS
  'Publishes a product plan: status=active, published_at COALESCEd so the original publication date is never '
  'rewritten, and effective_from from the argument or now(). Refuses a backdated effective date. Writes a '
  '''published'' product_plan_revisions row and a PLAN_PUBLISHED audit row. Requires platform:manage_plans.';

REVOKE ALL ON FUNCTION public.publish_product_plan(TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_product_plan(TEXT, TEXT, TEXT, TIMESTAMPTZ) TO authenticated;

-- ============================================================
-- 7. start_plan_checkout: CHECKOUT BY PRODUCT PLAN ID
-- ============================================================
-- The purchase path that replaces the legacy-only checkout for customers. The old
-- function takes a LEGACY subscription_plans id, and the only active legacy plan
-- is Starter, so Standard and Premium exist, are published, and cannot be bought.
-- This one takes a product_plans id and therefore reaches every published tier.
--
-- initiate_subscription_checkout IS NOT MODIFIED OR REMOVED. It keeps its
-- signature, its body and its GRANT, so anything still calling the legacy path
-- keeps working unchanged.
--
-- AUTHORISATION, in the order the messages are checkable:
--   * 'Authentication required' - no session, no checkout.
--   * 'An organisation is required' - the caller must own exactly one business.
--     "Owns" is organizations.owner_id = auth.uid(), the same column
--     initiate_subscription_checkout authorises on, and more than one is refused
--     rather than guessed at because this function has no org argument and must
--     not pick a business to bill on the caller's behalf.
--   * 'Only the organization owner can manage billing' - the product's own
--     sentence, raised for a caller who belongs to a business without owning it.
--     A member who is not the owner is told the real reason instead of being told
--     they have no business, and the explicit assertion after the SELECT states
--     the authorisation even though the SELECT already applied it.
--   * 'Unknown plan' - the id must name a PUBLISHED, PUBLIC plan with an effective
--     date that has arrived. A draft, a retired tier or an unpublished row is
--     unknown to a buyer, which is the same definition list_published_plans uses,
--     so nothing can be bought that the pricing page does not show.
--   * 'Unsupported billing cycle: %' - monthly or annual only.
--   * 'This plan has no % price; contact sales to arrange terms' - added by this
--     migration, and the one message not in the brief's list. A published plan may
--     have no price in the chosen cycle (the Custom tier has no price at all), and
--     subscription_transactions.amount is NOT NULL. Without this the customer would
--     meet a raw constraint violation on a card-payment path; with it they are told
--     what to do. Nothing about the brief's five messages changes.
--
-- THE LEGACY MIRROR. Eight live subscriptions and organizations.billing_status
-- depend on the legacy subscriptions row, and that row's plan_id is a NOT NULL FK
-- to subscription_plans. The legacy table stops being a catalogue the customer
-- reads and becomes a mirror kept for existing readers, resolved by the product
-- plan's NAME case-insensitively and created when absent. activate_subscription
-- then bridges the two by matching that same name, which is why the mirror carries
-- the product plan's own name rather than a synthesised one.
--
-- KNOWN LIMITATION, stated rather than hidden: subscription_plans.name is UNIQUE,
-- so the mirror is one row per name and cannot represent two cycles of the same
-- plan at once. When the mirror already exists (Starter: ₦5,000 monthly) an annual
-- purchase reuses it rather than rewriting a row eight live subscriptions point at,
-- and the transaction carries the ANNUAL price because that is what is being
-- bought. activate_subscription, which this migration may not change, derives the
-- period from the legacy row's billing_interval, so such a purchase would activate
-- a monthly period. Fixing that properly means either a per-cycle mirror row or a
-- change to activate_subscription; both are out of this migration's scope and are
-- reported rather than attempted. For a plan with no legacy row at all - Standard,
-- Premium and Custom, which are exactly the tiers that cannot be bought today - the
-- mirror is created on the chosen cycle and the limitation does not arise.
--
-- THE TRANSACTION is written the way initiate_subscription_checkout writes it:
-- same 'sub_' || uuid-without-dashes reference format, same pending status, same
-- v_legacy.price-style amount, same created_by. Two attribution columns 069 added
-- are set that the legacy path leaves to their defaults, because this function
-- knows them: product_id is the plan's own product, which is what
-- activate_subscription reads to decide which entitlement to grant, and is_sandbox
-- follows the business, so a sandbox payment is never counted as revenue.

CREATE OR REPLACE FUNCTION public.start_plan_checkout(
  p_plan_id UUID,
  p_billing_cycle TEXT DEFAULT 'monthly'
)
RETURNS public.subscription_transactions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_cycle TEXT := lower(btrim(COALESCE(NULLIF(p_billing_cycle, ''), 'monthly')));
  v_owned INTEGER;
  v_org public.organizations;
  v_plan public.product_plans;
  v_product_key TEXT;
  v_amount NUMERIC;
  v_legacy public.subscription_plans;
  v_reference TEXT;
  v_txn public.subscription_transactions;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT count(*) INTO v_owned
  FROM public.organizations o
  WHERE o.owner_id = v_actor;

  IF v_owned = 0 THEN
    -- A member who is not the owner is told the real reason. Anything else is a
    -- caller with no business to bill at all.
    IF EXISTS (SELECT 1 FROM public.organization_members om WHERE om.user_id = v_actor) THEN
      RAISE EXCEPTION 'Only the organization owner can manage billing';
    END IF;
    RAISE EXCEPTION 'An organisation is required';
  ELSIF v_owned > 1 THEN
    -- No org argument and no way to guess, so the caller must say which business.
    RAISE EXCEPTION 'An organisation is required';
  END IF;

  SELECT o.* INTO v_org
  FROM public.organizations o
  WHERE o.owner_id = v_actor
  ORDER BY o.created_at ASC, o.id ASC
  LIMIT 1;

  -- The SELECT already applied this, and stating it keeps the authorisation
  -- legible next to the product's own sentence, exactly as
  -- initiate_subscription_checkout states its own.
  IF v_org.owner_id IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Only the organization owner can manage billing';
  END IF;

  SELECT pp.* INTO v_plan
  FROM public.product_plans pp
  WHERE pp.id = p_plan_id
    AND pp.status = 'active'
    AND pp.is_public = TRUE
    AND pp.published_at IS NOT NULL
    AND pp.effective_from <= now();

  IF v_plan.id IS NULL THEN
    RAISE EXCEPTION 'Unknown plan';
  END IF;

  IF v_cycle NOT IN ('monthly', 'annual') THEN
    RAISE EXCEPTION 'Unsupported billing cycle: %', p_billing_cycle;
  END IF;

  SELECT pr.key INTO v_product_key
  FROM public.platform_products pr
  WHERE pr.id = v_plan.product_id;

  v_amount := CASE v_cycle
    WHEN 'annual' THEN COALESCE(v_plan.annual_price, v_plan.monthly_price)
    ELSE COALESCE(v_plan.monthly_price, v_plan.annual_price)
  END;

  IF v_amount IS NULL THEN
    RAISE EXCEPTION 'This plan has no % price; contact sales to arrange terms', v_cycle;
  END IF;

  -- ----------------------------------------------------------
  -- The legacy mirror, resolved by name and created when absent.
  -- ----------------------------------------------------------
  SELECT * INTO v_legacy
  FROM public.subscription_plans sp
  WHERE lower(sp.name) = lower(v_plan.name)
  -- Prefer a live mirror over a retired one, then the cheapest, then the oldest:
  -- deterministic, and it will not adopt a same-named row by accident.
  ORDER BY (sp.status = 'active') DESC, sp.price ASC, sp.created_at ASC
  LIMIT 1;

  IF v_legacy.id IS NULL THEN
    INSERT INTO public.subscription_plans (
      name, description, price, currency, billing_interval, trial_days, feature_set, status
    ) VALUES (
      v_plan.name,
      v_plan.description,
      v_amount,
      COALESCE(v_plan.currency, 'NGN'),
      CASE WHEN v_cycle = 'annual' THEN 'yearly' ELSE 'monthly' END,
      COALESCE(v_plan.trial_days, 0),
      jsonb_build_object('user_limit', v_plan.user_limit, 'store_limit', v_plan.store_limit),
      'active'
    )
    -- name is UNIQUE. A concurrent checkout that created the same mirror first
    -- must not turn a purchase into a duplicate-key error, so the loser re-reads.
    ON CONFLICT (name) DO NOTHING
    RETURNING * INTO v_legacy;
  END IF;

  IF v_legacy.id IS NULL THEN
    SELECT * INTO v_legacy
    FROM public.subscription_plans sp
    WHERE lower(sp.name) = lower(v_plan.name)
    ORDER BY (sp.status = 'active') DESC, sp.price ASC, sp.created_at ASC
    LIMIT 1;
  END IF;

  -- ----------------------------------------------------------
  -- The pending transaction. Reference format identical to
  -- initiate_subscription_checkout so the existing webhook matches it unchanged.
  -- ----------------------------------------------------------
  v_reference := 'sub_' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.subscription_transactions (
    org_id, plan_id, reference, amount, currency, status, created_by, product_id, is_sandbox
  ) VALUES (
    v_org.id, v_legacy.id, v_reference, v_amount,
    COALESCE(v_plan.currency, v_legacy.currency, 'NGN'),
    'pending', v_actor, v_plan.product_id, COALESCE(v_org.is_sandbox, FALSE)
  )
  RETURNING * INTO v_txn;

  RETURN v_txn;
END;
$$;

COMMENT ON FUNCTION public.start_plan_checkout(UUID, TEXT) IS
  'Starts a checkout against a PUBLISHED product plan, by plan id and billing cycle. Creates or reuses the legacy '
  'subscription_plans mirror row (the FK target of the subscription a payment produces) and records the pending '
  'subscription_transactions row the existing Paystack webhook settles through activate_subscription. '
  'Owner-only: the caller must own exactly one business. Requires a session.';

REVOKE ALL ON FUNCTION public.start_plan_checkout(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_plan_checkout(UUID, TEXT) TO authenticated;

-- ============================================================
-- 8. THE PRIVILEGE SURFACE, ASSERTED RATHER THAN ASSUMED
-- ============================================================
-- Section 5 of 090 documents the trap this block exists to avoid: this project
-- carries ALTER DEFAULT PRIVILEGES granting EXECUTE on every new public function
-- to anon and authenticated, so `REVOKE ... FROM PUBLIC` removes nothing that
-- matters and a function "revoked" that way stays callable by an anonymous
-- client. Every REVOKE above names the roles. This asserts the result instead of
-- trusting it, and asserts that the three functions this migration promised not
-- to touch still have the signature and the privilege they had before.
--
-- The rule is stated per role rather than as a blanket "anon may execute
-- nothing", because list_published_plans is a DELIBERATE exception: the public
-- pricing page is only ever rendered for anonymous visitors, so revoking anon
-- there would leave the marketing site with no prices. The exception is exactly
-- one function wide and is asserted to stay that wide - the three other new
-- tenant functions are checked for anon EXECUTE one by one.

DO $$
DECLARE
  v_signature TEXT;
  v_authenticated_signatures TEXT[] := ARRAY[
    'public.list_published_plans(text)',
    'public.get_my_entitlement(text)',
    'public.publish_product_plan(text,text,text,timestamp with time zone)',
    'public.start_plan_checkout(uuid,text)',
    'public.upsert_product_plan(text,text,text,text,numeric,numeric,integer,jsonb,text,text,boolean,boolean,integer,text,text,numeric,integer,integer)',
    'public.list_product_plans(text)'
  ];
  -- The one function an anonymous visitor must be able to call, and the only one.
  v_anon_signature CONSTANT TEXT := 'public.list_published_plans(text)';
  v_client_secrets TEXT[] := ARRAY[
    'public.get_my_entitlement(text)',
    'public.publish_product_plan(text,text,text,timestamp with time zone)',
    'public.start_plan_checkout(uuid,text)',
    'public.upsert_product_plan(text,text,text,text,numeric,numeric,integer,jsonb,text,text,boolean,boolean,integer,text,text,numeric,integer,integer)',
    'public.list_product_plans(text)'
  ];
BEGIN
  FOREACH v_signature IN ARRAY v_authenticated_signatures LOOP
    IF to_regprocedure(v_signature) IS NULL THEN
      RAISE EXCEPTION '092 privileges: % does not exist after this migration ran', v_signature;
    END IF;

    IF NOT has_function_privilege('authenticated', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION '092 privileges: authenticated lost EXECUTE on %, which every one of these functions needs', v_signature;
    END IF;
  END LOOP;

  -- The deliberate exception: the public pricing page reads this as an anonymous
  -- visitor, so anon EXECUTE is required rather than tolerated.
  IF NOT has_function_privilege('anon', v_anon_signature, 'EXECUTE') THEN
    RAISE EXCEPTION '092 privileges: anon cannot execute %. The public pricing page renders for anonymous visitors and would show no prices.', v_anon_signature;
  END IF;

  -- And nothing else. Each of these is checked by name, so a future DEFAULT
  -- PRIVILEGES grant that leaks one of them to anon fails the migration rather
  -- than passing quietly: get_my_entitlement is caller-scoped, publish and
  -- start_plan_checkout write, and list_product_plans exposes drafts.
  FOREACH v_signature IN ARRAY v_client_secrets LOOP
    IF has_function_privilege('anon', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION '092 privileges: anon can execute %. A REVOKE ... FROM PUBLIC does not remove the ALTER DEFAULT PRIVILEGES grant; the role must be named. Only list_published_plans may be anon-callable.', v_signature;
    END IF;
  END LOOP;

  -- initiate_subscription_checkout is deliberately untouched: same signature, same
  -- grant, still callable by a signed-in customer.
  IF to_regprocedure('public.initiate_subscription_checkout(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION '092: initiate_subscription_checkout(uuid,uuid) is missing; the legacy checkout must keep working';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.initiate_subscription_checkout(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '092: initiate_subscription_checkout lost its authenticated grant';
  END IF;

  -- activate_subscription and enforce_seat_limit keep their exact signatures.
  -- Changing either return shape would break the Paystack webhook and every
  -- store_members insert respectively, and neither is touched here.
  IF to_regprocedure('public.activate_subscription(text,jsonb,timestamp with time zone)') IS NULL THEN
    RAISE EXCEPTION '092: activate_subscription(text,jsonb,timestamptz) is missing';
  END IF;
  IF has_function_privilege('authenticated', 'public.activate_subscription(text,jsonb,timestamp with time zone)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.activate_subscription(text,jsonb,timestamp with time zone)', 'EXECUTE') THEN
    RAISE EXCEPTION '092: activate_subscription regained EXECUTE for a client role; 090 locked it to service_role';
  END IF;
  IF to_regprocedure('public.enforce_seat_limit()') IS NULL THEN
    RAISE EXCEPTION '092: enforce_seat_limit() is missing';
  END IF;

  RAISE NOTICE '092 privileges: % function(s) granted to authenticated, 1 of them (%) also to anon', array_length(v_authenticated_signatures, 1), v_anon_signature;
END $$;

-- ------------------------------------------------------------
-- 8.1 The published catalogue, stated once as a fact
-- ------------------------------------------------------------
-- Not a hard assertion - how many tiers the business sells is a commercial
-- decision, not a migration's - but a NOTICE that makes the migration's own
-- effect visible in the apply log. The verification asserts the exact numbers.
DO $$
DECLARE
  v_published INTEGER;
  v_unpublished INTEGER;
BEGIN
  SELECT count(*) INTO v_published
  FROM public.product_plans
  WHERE status = 'active' AND is_public = TRUE AND published_at IS NOT NULL AND effective_from <= now();

  SELECT count(*) INTO v_unpublished
  FROM public.product_plans
  WHERE status = 'active' AND is_public = TRUE AND published_at IS NULL;

  RAISE NOTICE '092: % published plan(s) are visible to customers; % visible-but-unpublished row(s) remain invisible',
    v_published, v_unpublished;
END $$;
