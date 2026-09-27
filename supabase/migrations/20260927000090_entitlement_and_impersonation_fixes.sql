-- Migration: 090_entitlement_and_impersonation_fixes.sql
-- Description: Closes the two defects 089 left open. Both were recorded there as
--   KNOWN LIMITATIONS and asserted by 089's own verification (steps 15 and 41),
--   so neither is a guess: each was reproduced against this database before this
--   migration was written.
--
--   1. READ-ONLY IMPERSONATION WAS NOT ACTUALLY ENFORCED.
--      065 wrote block_writes_while_impersonating() with the predicate
--
--        IF public.is_impersonating() AND auth.uid() IS NOT NULL
--           AND NOT public.is_platform_admin(auth.uid()) THEN ...
--
--      and 089 attached it to 20 tenant business tables. The predicate is
--      self-defeating: is_impersonating() matches only a session whose
--      admin_user_id = auth.uid(), and nothing but a platform admin can ever own
--      an impersonation session (start_impersonation_session refuses anyone
--      else), so the final clause exempted every caller the first clause could
--      match. The trigger therefore fired for exactly one transient case: an
--      admin whose platform_admins row was suspended or revoked mid-session.
--
--      Reproduced live on 2026-09-27 before this migration: with an active
--      read_only session owned by the super admin
--      aac84346-9e10-493f-865c-7f3bef18909e, `UPDATE public.organizations SET
--      name = name` returned "NOT BLOCKED". The same statement as a
--      non-platform-admin in the same situation was refused.
--
--      The exemption is removed. The guard now refuses a write from the owner of
--      any active, unexpired impersonation session, and keeps the
--      `auth.uid() IS NOT NULL` guard so that a caller with no JWT - a
--      service_role webhook, a migration, the seed path - is never blocked.
--
--   2. A PAID ACTIVATION COULD GRANT ACCESS THAT NEVER EXPIRES.
--      089 made activate_subscription() write the organization_products
--      entitlement, but took its expires_at from subscriptions.current_period_end.
--      An organization with no subscriptions row has no period end to copy, so
--      the entitlement was written status='active' with expires_at = NULL, and
--      enforce_seat_limit() reads expires_at IS NULL as "never expires". Two
--      production organizations are in that state today
--      (8223cd0a-45ce-4e7e-8814-ff935955ec6f "Smoke Test Org" and
--      cf25cb4d-2a10-4c40-a220-1db91b2bbf76 "Akos Store"); both were created
--      before the Phase-6 organization triggers and were given their entitlement
--      by the 075 backfill, which copies s.current_period_end from a
--      subscriptions row that does not exist.
--
--      activate_subscription() is now self-sufficient: when the UPDATE of
--      subscriptions matches nothing it INSERTs the missing row from the
--      transaction's own plan, and the entitlement's expires_at comes from that
--      row. The two affected organizations are then backfilled so the existing
--      contradiction is cleared as well.
--
--   Every statement is idempotent: the migration can be re-run against the same
--   database without error, and the backfill in section 4 is a clean no-op on a
--   second run because its selection predicate is empty once it has run.
--
--   3. REVOKE ... FROM PUBLIC WAS NEVER ENOUGH IN THIS PROJECT (section 5).
--      Found while fixing defect 2, and the most severe of the three. This
--      project carries
--
--        ALTER DEFAULT PRIVILEGES IN SCHEMA public
--          GRANT EXECUTE ON FUNCTIONS TO postgres, anon, authenticated, service_role;
--
--      (read back from pg_default_acl: `postgres=X | anon=X | authenticated=X |
--      service_role=X` for defaclobjtype 'f' in schema public, for both the
--      postgres and supabase_admin grantors). Every function created by a
--      migration therefore stays executable by anon and authenticated no matter
--      what the migration does with PUBLIC, because those grants are explicit
--      entries in pg_proc.proacl and are not the PUBLIC pseudo-role.
--
--      089 hardened create_audit_log/log_activity and activate_subscription
--      with `REVOKE ALL ... FROM PUBLIC` believing that made them internal. It
--      did not: the live ACL of activate_subscription read
--      `{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}`.
--      Any authenticated customer could call initiate_subscription_checkout -
--      correctly client-callable - and then call activate_subscription with the
--      reference it returns, activating a paid subscription without paying.
--
--      Section 5 revokes EXECUTE from anon and authenticated explicitly, on the
--      three server-to-server entry points and on every function in public that
--      is used as a trigger function (33 of them, none of which any client can
--      legitimately call), plus the two private helpers that carry no
--      permission check of their own. Every function that a migration granted
--      to authenticated on purpose, and every RLS predicate helper, is left
--      exactly as it was.
--
--   None of the three functions changes its name, argument list or return type,
--   so no DROP FUNCTION is needed, no dependent policy or trigger has to be
--   recreated and no caller or GRANT has to change.
-- Author: TrackOja Team
-- Date: 2026-09-27

-- ============================================================
-- 1. THE IMPERSONATION GUARD REFUSES THE SESSION'S OWNER
-- ============================================================
-- The predicate is reduced to the one condition that is both necessary and
-- sufficient: the caller owns an active, unexpired impersonation session.
--
--   * is_impersonating() already means exactly "auth.uid() owns a session with
--     status = 'active' AND expires_at > now()", and impersonation_sessions.mode
--     is constrained to 'read_only', so that one call is the whole read-only
--     check.
--   * auth.uid() IS NOT NULL is kept deliberately. The trigger is attached to 20
--     tenant tables, several of which are written by service_role webhooks, by
--     migrations and by the seed path - contexts with no request JWT. A NULL
--     caller can never own a session (admin_user_id = NULL is never true), and
--     the explicit guard keeps that from depending on the helper's internals.
--   * The platform-admin exemption is gone. It was the defect: the only caller
--     who can be impersonating is a platform admin.
--
-- The exception message is byte-for-byte the text 065 shipped, because callers
-- and verification assert on it: 'Impersonation is read-only'.
--
-- Signature, return type, LANGUAGE, SECURITY DEFINER and search_path are all
-- unchanged, so the 20 triggers 089 created keep resolving to this function by
-- name and are not recreated here (they are counted in section 2 instead).

CREATE OR REPLACE FUNCTION public.block_writes_while_impersonating()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND public.is_impersonating() THEN
    RAISE EXCEPTION 'Impersonation is read-only';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- The guard is a trigger function: nothing calls it through the API. PostgreSQL
-- does not check EXECUTE on a trigger function when the trigger fires (the
-- privilege is checked when the trigger is created, by the table owner), so
-- revoking the PUBLIC EXECUTE that PostgreSQL grants by default costs nothing
-- and removes one more way to probe the guard. It is re-granted to nobody.
REVOKE ALL ON FUNCTION public.block_writes_while_impersonating() FROM PUBLIC;

COMMENT ON FUNCTION public.block_writes_while_impersonating() IS
  'BEFORE INSERT OR UPDATE OR DELETE guard on the 20 tenant business tables migration 089 attached it to. '
  'Refuses the write with the exact message "Impersonation is read-only" whenever the caller (auth.uid()) owns '
  'an active, unexpired impersonation_sessions row. Before 090 the predicate also required the caller NOT to be '
  'a platform admin, which disabled the guard entirely because only a platform admin can own an impersonation '
  'session; the exemption was removed here. A caller with no JWT (service_role webhook, migration, seed) is '
  'never blocked, because auth.uid() is NULL. KNOWN LIMITATION: the guard covers only the 20 tables 089 '
  'attached it to, so an impersonating admin can still write to any table outside that list.';

-- ============================================================
-- 2. THE 20 TRIGGERS ARE STILL ATTACHED
-- ============================================================
-- CREATE OR REPLACE FUNCTION keeps the OID, so every existing trigger keeps
-- pointing at the new body and nothing has to be re-attached. This is asserted
-- rather than assumed: a missing trigger would silently restore the defect, and
-- the list is the same one 089 used.
DO $$
DECLARE
  v_tables TEXT[] := ARRAY[
    'sales', 'sale_items', 'sale_payments', 'products', 'product_variants',
    'product_categories', 'customers', 'inventory_movements', 'stock_lots',
    'stores', 'store_members', 'organization_members', 'organizations',
    'expenses', 'suppliers', 'purchases', 'tailoring_jobs', 'material_quotes',
    'refunds', 'devices'
  ];
  v_attached INTEGER;
  v_missing TEXT;
BEGIN
  SELECT count(*) INTO v_attached
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND NOT t.tgisinternal
    AND t.tgname = 'block_writes_while_impersonating'
    AND c.relname = ANY (v_tables);

  SELECT string_agg(x.tbl, ', ' ORDER BY x.tbl) INTO v_missing
  FROM unnest(v_tables) AS x(tbl)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND NOT t.tgisinternal
      AND t.tgname = 'block_writes_while_impersonating'
      AND c.relname = x.tbl
  );

  IF v_attached <> array_length(v_tables, 1) OR v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'The impersonation write guard is attached to % of % tenant tables; missing: %',
      v_attached, array_length(v_tables, 1), COALESCE(v_missing, 'none');
  END IF;

  RAISE NOTICE 'Impersonation write guard confirmed on all % tenant business tables', v_attached;
END $$;

-- ============================================================
-- 3. activate_subscription IS SELF-SUFFICIENT
-- ============================================================
-- 089's body copied expires_at from subscriptions.current_period_end, and the
-- UPDATE that produces that value matches nothing when the organization has no
-- subscriptions row. The entitlement was then written 'active' with
-- expires_at = NULL - the state enforce_seat_limit() reads as "never expires".
--
-- The only change to the body is immediately after that UPDATE: when it returned
-- no row, the missing subscriptions row is created from the transaction's own
-- plan. The period is the one the function already computes from the legacy
-- plan's billing_interval (+1 year for yearly, +1 month otherwise); for an
-- organization that already has a row nothing about the period logic moves.
--
--   * plan_id comes from the transaction (v_plan), which is the only plan a
--     payment carries, and subscriptions.plan_id is NOT NULL with an FK to
--     subscription_plans, so it is the one value that must be supplied.
--   * start_date and current_period_start are COALESCE(p_paid_at, now()): the
--     period starts when the money arrived when the webhook knows, and now()
--     when it does not.
--   * trial_end is NULL, matching the UPDATE path: a paid activation is not a
--     trial.
--   * status is 'active' and cancel_at_period_end FALSE, matching the UPDATE path.
--   * metadata records that the row was created by the activation itself rather
--     than by initiate_subscription_checkout, so a billing reviewer can tell the
--     two apart.
--   * expires_at is taken from COALESCE(current_period_end, v_period_end). The
--     UPDATE always writes current_period_end and so does the INSERT, so the
--     COALESCE is unreachable today; it is there so that no future edit to this
--     body can reintroduce an entitled row with no expiry.
--
-- Idempotency is untouched: an already-successful transaction returns at the
-- same early exit, writing no second subscription and no second entitlement.

CREATE OR REPLACE FUNCTION public.activate_subscription(
  p_reference TEXT,
  p_paystack_data JSONB,
  p_paid_at TIMESTAMP WITH TIME ZONE
)
RETURNS public.subscriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_txn public.subscription_transactions;
  v_plan public.subscription_plans;
  v_subscription public.subscriptions;
  v_period_end TIMESTAMP WITH TIME ZONE;
  v_product_id UUID;
  v_product_plan public.product_plans;
BEGIN
  SELECT * INTO v_txn FROM public.subscription_transactions WHERE reference = p_reference FOR UPDATE;
  IF v_txn IS NULL THEN
    RAISE EXCEPTION 'Transaction not found for reference %', p_reference;
  END IF;

  -- Idempotent: if already processed, return the existing subscription unchanged.
  IF v_txn.status = 'success' THEN
    SELECT * INTO v_subscription FROM public.subscriptions WHERE org_id = v_txn.org_id;
    RETURN v_subscription;
  END IF;

  SELECT * INTO v_plan FROM public.subscription_plans WHERE id = v_txn.plan_id;
  IF v_plan IS NULL THEN
    RAISE EXCEPTION 'Plan not found for transaction %', p_reference;
  END IF;

  v_period_end := CASE v_plan.billing_interval
    WHEN 'yearly' THEN now() + INTERVAL '1 year'
    ELSE now() + INTERVAL '1 month'
  END;

  UPDATE public.subscriptions
  SET
    plan_id = v_plan.id,
    status = 'active',
    trial_end = NULL,
    current_period_start = now(),
    current_period_end = v_period_end,
    cancel_at_period_end = FALSE,
    ended_at = NULL
  WHERE org_id = v_txn.org_id
  RETURNING * INTO v_subscription;

  -- An organization that predates the Phase-6 subscription triggers has no row
  -- to update, and there is then no current_period_end to copy onto the
  -- entitlement. Creating the row here is what makes this function able to keep
  -- its own promise: a paid activation always produces an expiring entitlement.
  IF v_subscription.id IS NULL THEN
    INSERT INTO public.subscriptions (
      org_id, plan_id, status, start_date, trial_end,
      current_period_start, current_period_end, cancel_at_period_end, metadata
    ) VALUES (
      v_txn.org_id,
      v_plan.id,
      'active',
      COALESCE(p_paid_at, now()),
      NULL,
      COALESCE(p_paid_at, now()),
      v_period_end,
      FALSE,
      jsonb_build_object(
        'created_by', 'activate_subscription',
        'reason', 'organization had no subscriptions row when its payment was confirmed',
        'reference', v_txn.reference
      )
    )
    RETURNING * INTO v_subscription;
  END IF;

  UPDATE public.organizations
  SET subscription_plan_id = v_plan.id, billing_status = 'active', trial_ends_at = NULL
  WHERE id = v_txn.org_id;

  UPDATE public.subscription_transactions
  SET status = 'success', subscription_id = v_subscription.id, paystack_data = p_paystack_data, paid_at = p_paid_at
  WHERE id = v_txn.id;

  -- ----------------------------------------------------------
  -- Entitlement: the row every platform metric and access check reads.
  -- ----------------------------------------------------------
  v_product_id := v_txn.product_id;

  IF v_product_id IS NULL THEN
    -- Legacy transaction created before 069 added product attribution.
    SELECT p.id INTO v_product_id
    FROM public.platform_products p
    WHERE p.key = 'trackoja';
  END IF;

  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'Cannot record the entitlement for reference %: the transaction has no product and the trackoja product is not configured', p_reference;
  END IF;

  -- The legacy plan is the only plan reference a payment carries. It is mapped
  -- onto the product's own plan ladder by key first, then by name, so the
  -- published 'starter' plan wins over any same-named variant.
  SELECT * INTO v_product_plan
  FROM public.product_plans pp
  WHERE pp.product_id = v_product_id
    AND (lower(pp.key) = lower(v_plan.name) OR lower(pp.name) = lower(v_plan.name))
  ORDER BY (lower(pp.key) = lower(v_plan.name)) DESC,
           pp.is_default DESC,
           pp.sort_order ASC,
           pp.created_at ASC
  LIMIT 1;

  INSERT INTO public.organization_products AS op (
    org_id, product_id, plan_id, status, source,
    agreed_monthly_price, agreed_annual_price, agreed_user_limit, currency,
    trial_ends_at, activated_at, expires_at, cancelled_at, is_sandbox, metadata
  ) VALUES (
    v_txn.org_id,
    v_product_id,
    v_product_plan.id,
    'active',
    'payment',
    -- NULL when no product plan matched: the agreed price is unknown, not zero.
    v_product_plan.monthly_price,
    v_product_plan.annual_price,
    v_product_plan.user_limit,
    COALESCE(v_product_plan.currency, v_txn.currency, 'NGN'),
    NULL,
    now(),
    COALESCE(v_subscription.current_period_end, v_period_end),
    NULL,
    COALESCE(v_txn.is_sandbox, FALSE),
    jsonb_build_object(
      'reference', v_txn.reference,
      'legacy_plan', v_plan.name,
      'billing_interval', v_plan.billing_interval,
      'subscription_id', v_subscription.id,
      'activated_by', 'activate_subscription'
    )
  )
  ON CONFLICT (org_id, product_id) DO UPDATE
  SET plan_id = EXCLUDED.plan_id,
      status = 'active',
      source = 'payment',
      agreed_monthly_price = EXCLUDED.agreed_monthly_price,
      agreed_annual_price = EXCLUDED.agreed_annual_price,
      agreed_user_limit = EXCLUDED.agreed_user_limit,
      currency = EXCLUDED.currency,
      trial_ends_at = NULL,
      activated_at = now(),
      expires_at = EXCLUDED.expires_at,
      cancelled_at = NULL,
      is_sandbox = EXCLUDED.is_sandbox,
      metadata = op.metadata || EXCLUDED.metadata;

  RETURN v_subscription;
END;
$$;

REVOKE ALL ON FUNCTION public.activate_subscription(TEXT, JSONB, TIMESTAMP WITH TIME ZONE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_subscription(TEXT, JSONB, TIMESTAMP WITH TIME ZONE) TO service_role;

COMMENT ON FUNCTION public.activate_subscription(TEXT, JSONB, TIMESTAMP WITH TIME ZONE) IS
  'Marks a Paystack charge successful and activates both the legacy subscription and the organization_products '
  'entitlement that platform metrics and the seat-limit trigger read. Idempotent per transaction reference. '
  'Self-sufficient since 090: when the organization has no subscriptions row, the row is created from the '
  'transaction''s own plan, so the entitlement it writes always carries a non-NULL expires_at. '
  'service_role ONLY: EXECUTE is revoked from anon and authenticated by name (section 5), because this project '
  'grants EXECUTE on new public functions to those roles through ALTER DEFAULT PRIVILEGES and a REVOKE ... '
  'FROM PUBLIC does not remove that grant.';

-- ============================================================
-- 4. BACKFILL THE ORGANIZATIONS ALREADY IN THE CONTRADICTORY STATE
-- ============================================================
-- Two production organizations hold an entitlement with no expiry at all and no
-- subscriptions row to take one from: 8223cd0a-45ce-4e7e-8814-ff935955ec6f
-- ("Smoke Test Org") and cf25cb4d-2a10-4c40-a220-1db91b2bbf76 ("Akos Store").
-- Both predate the Phase-6 organization triggers and received their entitlement
-- from the 075 backfill, which derives everything from a subscriptions row that
-- does not exist.
--
-- WHAT WAS FOUND (verified against this database before the migration ran): the
-- defect's symptom is exact, but the status the task description assumed is not
-- what is stored. Both entitlements are status = 'pending' / source = 'trial'
-- with trial_ends_at set and expires_at NULL - 075's own CASE maps a missing
-- subscription to 'pending', never to 'active'. The NULL expiry is the defect;
-- 'active' is not required for it. The selection below therefore accepts
-- 'pending' as well as 'active', which is what makes it select exactly these two
-- production rows and nothing else: the three live businesses also carry a NULL
-- expires_at on a trial entitlement, but each already has a subscriptions row,
-- so the NOT EXISTS clause excludes them.
--
-- Only expires_at is moved on the entitlement. The entitlement's status is
-- deliberately NOT changed: 'pending' plus an expired trial_ends_at (Akos Store,
-- 2026-07-12) currently denies seats, and flipping it to 'active' would grant
-- access to a business whose trial lapsed. That is an access decision this
-- migration is not authorised to make, so it is left exactly as found.
--
-- The backfill stamps its provenance on the rows it writes, following 075 and
-- activate_subscription, so its blast radius is provable after the fact:
--   subscriptions.metadata->>'backfilled_by' = '090'
--   organization_products.metadata->>'backfilled_expiry_by' = '090'
--
-- Idempotent: the SELECT predicate is "an entitlement with no expiry whose
-- organization has no subscriptions row", which is empty once this has run, so a
-- second run returns at the NOTICE below without writing anything.
DO $$
DECLARE
  v_orgs UUID[];
  v_expected_orgs INTEGER;
  v_expected_expiries INTEGER;
  v_subs_before INTEGER;
  v_nulls_before INTEGER;
  v_inserted INTEGER;
  v_updated INTEGER;
  v_subs_after INTEGER;
  v_nulls_after INTEGER;
  v_remaining INTEGER;
BEGIN
  SELECT array_agg(DISTINCT op.org_id) INTO v_orgs
  FROM public.organization_products op
  WHERE op.expires_at IS NULL
    AND op.status IN ('active', 'pending')
    AND NOT EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.org_id = op.org_id);

  IF v_orgs IS NULL OR array_length(v_orgs, 1) IS NULL THEN
    RAISE NOTICE '090 backfill: every organization with an unexpiring entitlement already has a subscriptions row; nothing to do';
    RETURN;
  END IF;

  v_expected_orgs := array_length(v_orgs, 1);

  SELECT count(*) INTO v_expected_expiries
  FROM public.organization_products op
  WHERE op.org_id = ANY (v_orgs)
    AND op.expires_at IS NULL
    AND op.status IN ('active', 'pending');

  SELECT count(*) INTO v_subs_before FROM public.subscriptions;
  SELECT count(*) INTO v_nulls_before FROM public.organization_products WHERE expires_at IS NULL;

  -- One subscriptions row per affected organization, on the organization's own
  -- entitlement plan matched onto the legacy subscription_plans ladder by key
  -- first and name second, falling back to the cheapest active legacy plan only
  -- when the entitlement's plan has no counterpart there at all.
  INSERT INTO public.subscriptions (
    org_id, plan_id, status, start_date, trial_end,
    current_period_start, current_period_end, cancel_at_period_end, metadata
  )
  SELECT
    e.org_id,
    COALESCE(
      (SELECT lp.id
       FROM public.subscription_plans lp
       WHERE lower(lp.name) = lower(pp.key)
          OR lower(lp.name) = lower(pp.name)
       ORDER BY (lower(lp.name) = lower(pp.key)) DESC,
                (lp.status = 'active') DESC,
                lp.price ASC,
                lp.created_at ASC
       LIMIT 1),
      (SELECT lp.id
       FROM public.subscription_plans lp
       WHERE lp.status = 'active'
       ORDER BY lp.price ASC, lp.created_at ASC
       LIMIT 1)
    ),
    'active',
    now(),
    NULL,
    now(),
    now() + INTERVAL '1 month',
    FALSE,
    jsonb_build_object(
      'backfilled_by', '090',
      'reason', 'the organization held an entitlement with no expiry and no subscriptions row to take one from',
      'entitlement_plan_key', pp.key
    )
  FROM (
    SELECT DISTINCT ON (op.org_id) op.org_id, op.plan_id
    FROM public.organization_products op
    WHERE op.org_id = ANY (v_orgs)
      AND op.expires_at IS NULL
      AND op.status IN ('active', 'pending')
    ORDER BY op.org_id,
             (op.status = 'active') DESC,
             op.activated_at ASC NULLS LAST,
             op.created_at ASC
  ) e
  LEFT JOIN public.product_plans pp ON pp.id = e.plan_id
  ON CONFLICT (org_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted <> v_expected_orgs THEN
    RAISE EXCEPTION
      '090 backfill wrote % subscriptions rows for % affected organization(s); exactly one row per organization is expected',
      v_inserted, v_expected_orgs;
  END IF;

  -- The entitlement now carries the period end of the row just created. The
  -- WHERE clause is the same exact condition, so no other entitlement can move.
  UPDATE public.organization_products op
  SET expires_at = s.current_period_end,
      metadata = COALESCE(op.metadata, '{}'::jsonb)
                 || jsonb_build_object('backfilled_expiry_by', '090')
  FROM public.subscriptions s
  WHERE s.org_id = op.org_id
    AND op.org_id = ANY (v_orgs)
    AND op.expires_at IS NULL
    AND op.status IN ('active', 'pending');

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated <> v_expected_expiries THEN
    RAISE EXCEPTION
      '090 backfill cleared the expiry of % entitlement(s) but % matched the condition',
      v_updated, v_expected_expiries;
  END IF;

  SELECT count(*) INTO v_subs_after FROM public.subscriptions;
  SELECT count(*) INTO v_nulls_after FROM public.organization_products WHERE expires_at IS NULL;

  -- The two arithmetic identities below are the "no other row was touched"
  -- assertion: the subscription table grew by exactly the rows this block wrote,
  -- and exactly the entitlements this block targeted stopped being NULL.
  IF v_subs_after <> v_subs_before + v_inserted THEN
    RAISE EXCEPTION
      '090 backfill changed the subscriptions table by % rows but wrote %; another organization was modified',
      v_subs_after - v_subs_before, v_inserted;
  END IF;

  IF v_nulls_after <> v_nulls_before - v_updated THEN
    RAISE EXCEPTION
      '090 backfill cleared % entitlement expiry date(s) but the count of NULL expiries moved by %; another entitlement was modified',
      v_updated, v_nulls_before - v_nulls_after;
  END IF;

  SELECT count(*) INTO v_remaining
  FROM public.organization_products op
  WHERE op.expires_at IS NULL
    AND op.status IN ('active', 'pending')
    AND NOT EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.org_id = op.org_id);

  IF v_remaining <> 0 THEN
    RAISE EXCEPTION
      '090 backfill left % organization product(s) with an unexpiring entitlement and no subscriptions row', v_remaining;
  END IF;

  RAISE NOTICE
    '090 backfill: % organization(s) given a subscriptions row, % entitlement(s) given an expiry; subscriptions % -> %',
    v_inserted, v_updated, v_subs_before, v_subs_after;
END $$;

-- ============================================================
-- 5. EXECUTE IS REVOKED FROM anon AND authenticated, NOT FROM PUBLIC
-- ============================================================
-- READ THIS BEFORE WRITING ANOTHER `REVOKE ... FROM PUBLIC` IN THIS PROJECT.
--
-- `REVOKE ALL ON FUNCTION ... FROM PUBLIC` removes only the PUBLIC pseudo-role
-- entry (`=X/postgres`). It does not touch a grant that names `anon` or
-- `authenticated` directly. This project grants EXECUTE on every new function in
-- schema public straight to those roles:
--
--   SELECT defaclobjtype, defaclacl
--   FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace
--   WHERE n.nspname = 'public' AND d.defaclobjtype = 'f';
--   -- postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres
--
-- measured on this database, for both the postgres and the supabase_admin
-- grantor, and confirmed by
--
--   SELECT proacl FROM pg_proc WHERE proname = 'activate_subscription';
--
-- which read `{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}`
-- even after 031 and 089 had both revoked it from PUBLIC. The consequence was
-- severe: an authenticated user of any business could call
-- initiate_subscription_checkout (correctly client-callable) and then call
-- activate_subscription with the reference it returned, marking their own
-- subscription paid.
--
-- A revoke therefore has to name anon and authenticated. A `REVOKE ... FROM
-- PUBLIC` may stay in a migration for documentation, but it is not a control.

-- ------------------------------------------------------------
-- 5.1 The three server-to-server entry points
-- ------------------------------------------------------------
-- Each of these is reached only by an Edge Function or a provider webhook
-- holding the service_role key, and each is given a privilege a client must
-- never hold: activate_subscription and mark_subscription_transaction_failed
-- decide that a payment succeeded, and handle_opay_webhook is the provider
-- callback itself.
--
-- Guarded with to_regprocedure so the file stays runnable if a signature is
-- absent or has been re-issued under a different one, and asserted afterwards so
-- a silent failure to revoke cannot pass as success. Idempotent: revoking twice
-- is a no-op, and service_role keeps EXECUTE either way.
DO $$
DECLARE
  v_signature TEXT;
  v_signatures TEXT[] := ARRAY[
    'public.activate_subscription(text, jsonb, timestamp with time zone)',
    'public.mark_subscription_transaction_failed(text, jsonb)',
    'public.handle_opay_webhook(text, text, jsonb)'
  ];
  v_revoked INTEGER := 0;
  v_absent INTEGER := 0;
BEGIN
  FOREACH v_signature IN ARRAY v_signatures LOOP
    IF to_regprocedure(v_signature) IS NULL THEN
      v_absent := v_absent + 1;
      RAISE NOTICE '090 privileges: % is not present in this database; skipped', v_signature;
      CONTINUE;
    END IF;

    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_signature);

    IF has_function_privilege('anon', v_signature, 'EXECUTE')
       OR has_function_privilege('authenticated', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION
        'Could not revoke EXECUTE on % from anon/authenticated. A REVOKE ... FROM PUBLIC does not do this in this project; name the roles.',
        v_signature;
    END IF;

    IF NOT has_function_privilege('service_role', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'Revoking % from anon/authenticated also removed service_role; the webhook would stop working', v_signature;
    END IF;

    v_revoked := v_revoked + 1;
  END LOOP;

  RAISE NOTICE '090 privileges: % server-to-server function(s) locked to service_role, % absent',
    v_revoked, v_absent;
END $$;

-- ------------------------------------------------------------
-- 5.2 Every trigger function in schema public
-- ------------------------------------------------------------
-- 33 functions in this database are trigger functions: enforce_seat_limit,
-- block_writes_while_impersonating, handle_updated_at, handle_new_auth_user,
-- handle_new_organization_subscription, handle_new_organization_product_entitlement
-- and the twenty-seven handle_*_audit writers. Not one of them has a call site in
-- src/ or in an Edge Function, and not one was ever granted to a client role by a
-- migration: their anon/authenticated EXECUTE is purely the default privilege.
--
-- Revoking it is safe by construction rather than by argument. PostgreSQL checks
-- EXECUTE on a trigger function when the trigger is CREATED, against the table
-- owner; it is not checked again when the trigger fires. The executor invokes the
-- function directly. Calling one through PostgREST was never useful anyway - a
-- trigger function invoked as an ordinary function raises
-- "trigger functions can only be called as triggers".
--
-- This is derived from pg_trigger rather than hardcoded, so a trigger added by a
-- later migration is covered by a re-run of this file.
DO $$
DECLARE
  v_rec RECORD;
  v_revoked INTEGER := 0;
  v_already INTEGER := 0;
BEGIN
  FOR v_rec IN
    SELECT DISTINCT p.oid,
           format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) AS signature
    FROM pg_trigger t
    JOIN pg_proc p ON p.oid = t.tgfoid
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND NOT t.tgisinternal
  LOOP
    IF NOT (has_function_privilege('anon', v_rec.oid, 'EXECUTE')
            OR has_function_privilege('authenticated', v_rec.oid, 'EXECUTE')) THEN
      v_already := v_already + 1;
      CONTINUE;
    END IF;

    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_rec.signature);

    IF has_function_privilege('anon', v_rec.oid, 'EXECUTE')
       OR has_function_privilege('authenticated', v_rec.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Could not revoke EXECUTE on trigger function % from anon/authenticated', v_rec.signature;
    END IF;

    v_revoked := v_revoked + 1;
  END LOOP;

  RAISE NOTICE '090 privileges: % trigger function(s) locked down, % already clean',
    v_revoked, v_already;
END $$;

-- ------------------------------------------------------------
-- 5.3 Two private helpers that carry no permission check of their own
-- ------------------------------------------------------------
-- _apply_inventory_movement_internal is the stock-mutation core that
-- apply_inventory_movement, create_sale, process_refund and the customer
-- functions all delegate to. 020 describes it as "a private helper ... with no
-- permission [check]" and revoked it from PUBLIC - which, per the heading above,
-- left it executable by anon and authenticated. It takes p_created_by as an
-- argument, so any anonymous caller could have written arbitrary inventory
-- movements, and through them stock levels, attributed to anybody.
--
-- Every caller of it is a SECURITY DEFINER function, which runs as the owner and
-- therefore needs no grant. The only other references in the repository are
-- string assertions in tests/, which do not execute it.
--
-- redact_secret_keys is revoked from anon only: 089 granted it to authenticated
-- and service_role on purpose, and that decision is not this migration's to
-- overturn. It is a pure redaction helper, so the anon grant was the artifact.
DO $$
DECLARE
  v_rec RECORD;
  v_expected INTEGER := 0;
BEGIN
  FOR v_rec IN
    SELECT t.signature, t.role_name
    FROM unnest(
      ARRAY[
        'public._apply_inventory_movement_internal(uuid, uuid, text, numeric, text, text, uuid, uuid)',
        'public._apply_inventory_movement_internal(uuid, uuid, text, numeric, text, text, uuid, uuid)',
        'public.redact_secret_keys(jsonb)'
      ],
      ARRAY['anon', 'authenticated', 'anon']
    ) AS t(signature, role_name)
  LOOP
    IF to_regprocedure(v_rec.signature) IS NULL THEN
      RAISE NOTICE '090 privileges: % is not present in this database; skipped', v_rec.signature;
      CONTINUE;
    END IF;

    v_expected := v_expected + 1;

    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, %I', v_rec.signature, v_rec.role_name);

    IF has_function_privilege(v_rec.role_name, v_rec.signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'Could not revoke EXECUTE on % from %', v_rec.signature, v_rec.role_name;
    END IF;
  END LOOP;

  IF v_expected = 3 THEN
    IF NOT has_function_privilege('service_role',
           'public._apply_inventory_movement_internal(uuid, uuid, text, numeric, text, text, uuid, uuid)', 'EXECUTE') THEN
      RAISE EXCEPTION 'service_role lost EXECUTE on _apply_inventory_movement_internal';
    END IF;

    -- 089's own decision, kept: redact_secret_keys stays executable by
    -- authenticated and service_role.
    IF NOT has_function_privilege('authenticated', 'public.redact_secret_keys(jsonb)', 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated lost EXECUTE on redact_secret_keys, which 089 granted deliberately';
    END IF;
  END IF;

  RAISE NOTICE '090 privileges: private helpers locked down (% revoke(s) applied)', v_expected;
END $$;

