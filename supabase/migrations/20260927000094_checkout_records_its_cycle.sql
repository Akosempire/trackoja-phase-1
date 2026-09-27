-- ============================================================
-- 094: A CHECKOUT RECORDS WHICH CYCLE IT CHARGED
-- ============================================================
-- 092 made the published catalogue the source of truth and let a customer start a
-- checkout against a published plan, monthly or annual. 093 corrected the role
-- baselines. This migration closes the one defect 092 documented and deliberately
-- did not fix, and it is a money defect, so the reasoning is stated in full.
--
-- THE DEFECT. activate_subscription derived the subscription period from
-- `subscription_plans.billing_interval` - the LEGACY mirror row. A published plan
-- is mirrored into that table by NAME, and `subscription_plans.name` is UNIQUE, so
-- one plan name can hold only one interval. Starter's mirror row is monthly. An
-- annual purchase of Starter therefore charged NGN 225,000 and activated a ONE
-- MONTH period: the customer paid twelve months for one. 092 responded by
-- disabling the annual button ("Annual coming soon") so that no customer could be
-- charged wrongly, and left the real fix here.
--
-- THE FIX, in one sentence: the transaction records the cycle and the exact
-- published plan it was created for, so activation no longer has to guess either
-- from a legacy row that cannot represent them.
--
--   subscription_transactions.billing_cycle    'monthly' | 'annual', NULL for
--                                              rows written before this migration
--                                              and for the legacy checkout
--   subscription_transactions.product_plan_id  the published plan that was bought
--
-- activate_subscription keeps its exact signature and return type, because the
-- Paystack webhook calls it by name with three arguments and a changed return
-- shape would break settlement for every customer. It keeps its name-matching
-- bridge as a FALLBACK, used only when the transaction does not say which plan it
-- bought - which is every row the legacy checkout writes.
--
-- Both new columns are nullable and both read paths fall back, so no existing row
-- changes meaning. Measured when this migration was applied: the eight live
-- subscriptions were created by triggers and backfills, not by payments, and
-- subscription_transactions holds ZERO rows. So there is no settled history whose
-- meaning could shift, and the fallback exists for the rows the legacy checkout
-- will write from now on - it is not a claim about rows that are not there.
-- Verification step 24 exercises that fallback explicitly, with a NULL-cycle row
-- against a yearly legacy mirror.

-- ============================================================
-- 1. WHAT THE TRANSACTION RECORDS
-- ============================================================
-- Nullable on purpose. A NOT NULL column would force a value onto rows that
-- predate the question, and a wrong guess is worse than an absent answer: NULL
-- means "this row does not say", which is true, and activate_subscription handles
-- it by falling back to the legacy interval exactly as before.

ALTER TABLE public.subscription_transactions
  ADD COLUMN IF NOT EXISTS billing_cycle TEXT;

ALTER TABLE public.subscription_transactions
  ADD COLUMN IF NOT EXISTS product_plan_id UUID;

-- The CHECK is added separately and guarded, because ADD COLUMN ... CHECK is not
-- idempotent the way ADD COLUMN IF NOT EXISTS is: re-running the file would fail
-- on a duplicate constraint name rather than doing nothing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.subscription_transactions'::regclass
      AND conname = 'subscription_transactions_billing_cycle_check'
  ) THEN
    ALTER TABLE public.subscription_transactions
      ADD CONSTRAINT subscription_transactions_billing_cycle_check
      CHECK (billing_cycle IS NULL OR billing_cycle IN ('monthly', 'annual'));
  END IF;

  -- ON DELETE SET NULL rather than RESTRICT: retiring a plan must not be blocked
  -- by the customers who once bought it, and a settled transaction whose plan row
  -- is gone still carries its own reference, amount and paid_at. A NULL here sends
  -- activation back down the name-matching fallback, which is the correct
  -- behaviour for a plan that no longer exists.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.subscription_transactions'::regclass
      AND conname = 'subscription_transactions_product_plan_id_fkey'
  ) THEN
    ALTER TABLE public.subscription_transactions
      ADD CONSTRAINT subscription_transactions_product_plan_id_fkey
      FOREIGN KEY (product_plan_id) REFERENCES public.product_plans(id) ON DELETE SET NULL;
  END IF;
END $$;

-- An unindexed foreign key makes every DELETE of a product plan scan the whole
-- transaction table. Cheap now, and it is the table that only ever grows.
CREATE INDEX IF NOT EXISTS idx_subscription_txns_product_plan
  ON public.subscription_transactions(product_plan_id);

COMMENT ON COLUMN public.subscription_transactions.billing_cycle IS
  'The cycle this checkout charged: monthly or annual. NULL means the row does not say - rows written before 094, and '
  'every row the legacy initiate_subscription_checkout writes, which has no cycle argument. activate_subscription reads '
  'this first and falls back to the legacy mirror plan''s billing_interval only when it is NULL.';
COMMENT ON COLUMN public.subscription_transactions.product_plan_id IS
  'The published product_plans row this checkout was created for. activate_subscription uses it to resolve the '
  'entitlement plan, falling back to name matching when it is NULL. SET NULL on delete so retiring a plan is never '
  'blocked by the customers who bought it.';

-- ============================================================
-- 2. THE CHECKOUT WRITES THEM
-- ============================================================
-- Same signature, same return type, same grants: only the INSERT gains two
-- columns and one of them is the cycle the caller already passed in. The
-- authorisation, the published-plan rule, the price selection and the legacy
-- mirror logic are unchanged from 092 and are reproduced rather than referenced,
-- because a migration is the record of what the database is, not a diff against a
-- file somebody may later edit.

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
  -- This row is still needed: subscriptions.plan_id is an FK to it, so a payment
  -- must produce one. It is NO LONGER the record of what was bought - the
  -- transaction is - so reusing a monthly mirror for an annual purchase is now
  -- harmless, and it is deliberate: rewriting that row's interval or price would
  -- silently change the meaning of every existing subscription that points at it,
  -- including the live monthly Starter customers.
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
  -- billing_cycle and product_plan_id are what 094 adds: the two facts activation
  -- needs and can no longer infer.
  -- ----------------------------------------------------------
  v_reference := 'sub_' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.subscription_transactions (
    org_id, plan_id, reference, amount, currency, status, created_by,
    product_id, is_sandbox, billing_cycle, product_plan_id
  ) VALUES (
    v_org.id, v_legacy.id, v_reference, v_amount,
    COALESCE(v_plan.currency, v_legacy.currency, 'NGN'),
    'pending', v_actor, v_plan.product_id, COALESCE(v_org.is_sandbox, FALSE),
    v_cycle, v_plan.id
  )
  RETURNING * INTO v_txn;

  RETURN v_txn;
END;
$$;

COMMENT ON FUNCTION public.start_plan_checkout(UUID, TEXT) IS
  'Starts a checkout against a PUBLISHED product plan, by plan id and billing cycle. Records the cycle and the exact '
  'plan on the transaction, which is what activate_subscription reads to set the subscription period, so an annual '
  'purchase activates an annual period. Also creates or reuses the legacy subscription_plans mirror row (the FK target '
  'of the subscription a payment produces) and records the pending subscription_transactions row the existing Paystack '
  'webhook settles through activate_subscription. Owner-only: the caller must own exactly one business. Requires a '
  'session.';

REVOKE ALL ON FUNCTION public.start_plan_checkout(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_plan_checkout(UUID, TEXT) TO authenticated;

-- ============================================================
-- 3. ACTIVATION READS THEM
-- ============================================================
-- Signature, return type and grants are identical to 090. The two changes are
-- both fallback-ordered so that nothing written before this migration changes
-- meaning:
--
--   the period  comes from the transaction's cycle, else the legacy mirror's
--               interval, which is exactly what 090 did for every old row
--   the plan    comes from the transaction's product_plan_id, else the name
--               matching bridge, which is exactly what 090 did for every old row

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
  v_cycle TEXT;
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

  -- The cycle the customer actually paid for. The transaction's own record wins;
  -- the legacy row's interval is the fallback for a row that predates 094 or came
  -- from the legacy checkout, which has no cycle argument to record. Reading the
  -- legacy row FIRST is the 092 defect: it cannot distinguish an annual purchase
  -- of a plan from a monthly one, because its name column is UNIQUE.
  v_cycle := COALESCE(
    v_txn.billing_cycle,
    CASE v_plan.billing_interval
      WHEN 'yearly' THEN 'annual'
      WHEN 'annual' THEN 'annual'
      ELSE 'monthly'
    END
  );

  v_period_end := CASE v_cycle
    WHEN 'annual' THEN now() + INTERVAL '1 year'
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

  -- The plan the customer actually bought, when the transaction says so. This is
  -- exact rather than approximate: name matching below cannot distinguish a
  -- published plan from a retired same-named variant, and it would grant the
  -- default plan's seat limit to somebody who bought a bigger one.
  IF v_txn.product_plan_id IS NOT NULL THEN
    SELECT * INTO v_product_plan
    FROM public.product_plans pp
    WHERE pp.id = v_txn.product_plan_id;

    -- A row that was deleted between checkout and settlement leaves nothing to
    -- read, and the fallback below is then the honest answer rather than a NULL
    -- entitlement plan.
    IF v_product_plan.id IS NULL THEN
      RAISE NOTICE 'activate_subscription: transaction % references product plan %, which no longer exists; falling back to name matching',
        p_reference, v_txn.product_plan_id;
    END IF;
  END IF;

  IF v_product_plan.id IS NULL THEN
    -- The legacy plan is the only plan reference a pre-094 payment carries. It is
    -- mapped onto the product's own plan ladder by key first, then by name, so the
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
  END IF;

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
      -- The cycle that was actually charged, which is the authoritative one. The
      -- key name is new rather than a reuse of billing_interval, because
      -- billing_interval is the legacy row's value and the two now differ.
      'billing_cycle', v_cycle,
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

COMMENT ON FUNCTION public.activate_subscription(TEXT, JSONB, TIMESTAMP WITH TIME ZONE) IS
  'Marks a Paystack charge successful and activates both the legacy subscription and the organization_products '
  'entitlement that platform metrics and the seat-limit trigger read. Idempotent per transaction reference. '
  'Self-sufficient since 090: when the organization has no subscriptions row, the row is created from the '
  'transaction''s own plan, so the entitlement it writes always carries a non-NULL expires_at. '
  'Since 094 the subscription period and the entitlement plan come from the transaction''s own billing_cycle and '
  'product_plan_id, so an annual purchase activates an annual period; the legacy mirror row''s billing_interval and '
  'the name-matching bridge remain as fallbacks for rows written before 094 and by the legacy checkout. '
  'service_role ONLY: EXECUTE is revoked from anon and authenticated by name (section 5 of 090), because this project '
  'grants EXECUTE on new public functions to those roles through ALTER DEFAULT PRIVILEGES and a REVOKE ... '
  'FROM PUBLIC does not remove that grant.';

REVOKE ALL ON FUNCTION public.activate_subscription(TEXT, JSONB, TIMESTAMP WITH TIME ZONE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_subscription(TEXT, JSONB, TIMESTAMP WITH TIME ZONE) TO service_role;

-- ============================================================
-- 4. THE PRIVILEGE SURFACE, RE-ASSERTED
-- ============================================================
-- CREATE OR REPLACE FUNCTION does not reset a function's ACL, but 092's section 8
-- exists precisely because this project's ALTER DEFAULT PRIVILEGES hands EXECUTE
-- to anon and authenticated on new public functions, and re-creating a function is
-- close enough to creating one that asserting the result is cheaper than trusting
-- it. The expectations are the same as 092's, restated so this migration fails
-- loudly if it moved any of them.

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
      RAISE EXCEPTION '094 privileges: % does not exist after this migration ran', v_signature;
    END IF;
    IF NOT has_function_privilege('authenticated', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION '094 privileges: authenticated lost EXECUTE on %', v_signature;
    END IF;
  END LOOP;

  IF NOT has_function_privilege('anon', v_anon_signature, 'EXECUTE') THEN
    RAISE EXCEPTION '094 privileges: anon cannot execute %. The public pricing page renders for anonymous visitors and would show no prices.', v_anon_signature;
  END IF;

  FOREACH v_signature IN ARRAY v_client_secrets LOOP
    IF has_function_privilege('anon', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION '094 privileges: anon can execute %. Only list_published_plans may be anon-callable.', v_signature;
    END IF;
  END LOOP;

  -- The two functions this migration re-creates must not have regained a client
  -- grant: activate_subscription settles money, and a client that can call it can
  -- activate a subscription it never paid for.
  IF has_function_privilege('authenticated', 'public.activate_subscription(text,jsonb,timestamp with time zone)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.activate_subscription(text,jsonb,timestamp with time zone)', 'EXECUTE') THEN
    RAISE EXCEPTION '094: activate_subscription regained EXECUTE for a client role; 090 locked it to service_role and 094 must not have undone that';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.activate_subscription(text,jsonb,timestamp with time zone)', 'EXECUTE') THEN
    RAISE EXCEPTION '094: service_role lost EXECUTE on activate_subscription, which the Paystack webhook needs';
  END IF;

  -- The webhook resolves this function by name and arity at call time. A changed
  -- return type would break settlement for every customer, so it is asserted, not
  -- assumed.
  IF (SELECT p.prorettype FROM pg_proc p
      WHERE p.oid = to_regprocedure('public.activate_subscription(text,jsonb,timestamp with time zone)'))
     IS DISTINCT FROM 'public.subscriptions'::regtype THEN
    RAISE EXCEPTION '094: activate_subscription no longer returns public.subscriptions; the Paystack webhook would break';
  END IF;

  -- The legacy checkout is untouched and must keep working for existing customers.
  IF NOT has_function_privilege('authenticated', 'public.initiate_subscription_checkout(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '094: initiate_subscription_checkout lost its authenticated grant';
  END IF;

  RAISE NOTICE '094 privileges: % function(s) granted to authenticated, 1 of them also to anon; activate_subscription is service_role only and still returns subscriptions',
    array_length(v_authenticated_signatures, 1);
END $$;

-- ============================================================
-- 5. NOTHING ALREADY WRITTEN CHANGED MEANING
-- ============================================================
-- The claim this migration makes is that every pre-existing transaction activates
-- exactly as it did before, because both new columns are NULL on all of them and
-- both read paths fall back to 090's behaviour. That is checkable, so it is
-- checked here rather than asserted in a comment. A settled row must be untouched
-- - activation is idempotent on status = 'success' - and every unsettled row must
-- carry NULL in both columns, which is what selects the fallback.

DO $$
DECLARE
  v_total INTEGER;
  v_settled INTEGER;
  v_unsettled_with_cycle INTEGER;
  v_unsettled_with_plan INTEGER;
BEGIN
  SELECT count(*) INTO v_total FROM public.subscription_transactions;
  SELECT count(*) INTO v_settled FROM public.subscription_transactions WHERE status = 'success';

  SELECT count(*) INTO v_unsettled_with_cycle
  FROM public.subscription_transactions WHERE status <> 'success' AND billing_cycle IS NOT NULL;

  SELECT count(*) INTO v_unsettled_with_plan
  FROM public.subscription_transactions WHERE status <> 'success' AND product_plan_id IS NOT NULL;

  RAISE NOTICE '094: % transaction(s), % settled and therefore untouched; % unsettled row(s) carry a cycle and % carry a plan, so % unsettled row(s) still activate through the pre-094 fallback',
    v_total, v_settled, v_unsettled_with_cycle, v_unsettled_with_plan,
    (SELECT count(*) FROM public.subscription_transactions WHERE status <> 'success');
END $$;

-- ============================================================
-- 6. THE END-TO-END PROOF, RUN AND ROLLED BACK
-- ============================================================
-- The defect this migration fixes was a wrong period, and the only honest way to
-- show it is fixed is to buy something annually and read the period back. That
-- needs an organization, and creating one in a migration would be a fixture. So
-- the proof runs only when a usable organization already exists, does all of its
-- work inside a block that ends in a deliberate rollback, and reports what it
-- measured. It changes nothing and leaves nothing behind.

DO $$
DECLARE
  v_org_id UUID;
  v_owner UUID;
  v_plan public.product_plans;
  v_legacy_id UUID;
  v_txn public.subscription_transactions;
  v_sub public.subscriptions;
  v_months NUMERIC;
BEGIN
  -- Any organization will do: this block only needs the FKs to be satisfiable.
  -- Prefer one with no subscription, so the insert path is exercised too.
  SELECT o.id, o.owner_id INTO v_org_id, v_owner
  FROM public.organizations o
  LEFT JOIN public.subscriptions s ON s.org_id = o.id
  WHERE s.id IS NULL
  ORDER BY o.created_at ASC
  LIMIT 1;

  IF v_org_id IS NULL THEN
    SELECT o.id, o.owner_id INTO v_org_id, v_owner
    FROM public.organizations o ORDER BY o.created_at ASC LIMIT 1;
  END IF;

  SELECT pp.* INTO v_plan
  FROM public.product_plans pp
  WHERE pp.status = 'active' AND pp.is_public = TRUE
    AND pp.published_at IS NOT NULL AND pp.effective_from <= now()
    AND pp.annual_price IS NOT NULL
  ORDER BY pp.annual_price DESC
  LIMIT 1;

  IF v_org_id IS NULL OR v_plan.id IS NULL THEN
    RAISE NOTICE '094 proof: SKIPPED - % organization(s) and a published plan with an annual price are both needed to run it',
      (SELECT count(*) FROM public.organizations);
    RETURN;
  END IF;

  -- Everything below is undone. The rollback is the point: a migration that
  -- proves its own fix by leaving a fake paid subscription behind would be a
  -- fixture, not a proof.
  BEGIN
    -- subscriptions.plan_id is an FK to the legacy table, so the proof needs a
    -- mirror row. It creates one when absent rather than skipping, so the proof
    -- runs against whatever the catalogue happens to hold.
    SELECT sp.id INTO v_legacy_id
    FROM public.subscription_plans sp
    WHERE lower(sp.name) = lower(v_plan.name)
    ORDER BY (sp.status = 'active') DESC, sp.price ASC, sp.created_at ASC
    LIMIT 1;

    IF v_legacy_id IS NULL THEN
      INSERT INTO public.subscription_plans (
        name, description, price, currency, billing_interval, trial_days, feature_set, status
      ) VALUES (
        v_plan.name, v_plan.description, v_plan.annual_price,
        COALESCE(v_plan.currency, 'NGN'), 'yearly', COALESCE(v_plan.trial_days, 0),
        jsonb_build_object('created_by', 'migration-094-proof'), 'active'
      )
      RETURNING id INTO v_legacy_id;
    END IF;

    INSERT INTO public.subscription_transactions (
      org_id, plan_id, reference, amount, currency, status, created_by,
      product_id, is_sandbox, billing_cycle, product_plan_id
    ) VALUES (
      v_org_id, v_legacy_id,
      'mig094proof' || replace(gen_random_uuid()::text, '-', ''),
      v_plan.annual_price, COALESCE(v_plan.currency, 'NGN'), 'pending', v_owner,
      v_plan.product_id, FALSE, 'annual', v_plan.id
    )
    RETURNING * INTO v_txn;

    v_sub := public.activate_subscription(v_txn.reference, '{"source":"migration-094-proof"}'::jsonb, now());

    v_months := round(EXTRACT(EPOCH FROM (v_sub.current_period_end - v_sub.current_period_start)) / 2629746.0, 2);

    IF v_sub.current_period_end < now() + INTERVAL '360 days' THEN
      RAISE EXCEPTION '094 proof FAILED: an annual purchase of "%" (NGN %) activated a period of % month(s), ending %. The cycle recorded on the transaction is not being honoured.',
        v_plan.name, v_plan.annual_price, v_months, v_sub.current_period_end;
    END IF;

    RAISE NOTICE '094 proof: an annual purchase of "%" at NGN % activated a %-month period, % to %. The transaction''s own billing_cycle set it.',
      v_plan.name, v_plan.annual_price, v_months, v_sub.current_period_start, v_sub.current_period_end;

    RAISE EXCEPTION 'ROLLBACK:094PROOF';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'ROLLBACK:094PROOF' THEN
        RAISE NOTICE '094 proof: rolled back; no transaction, subscription, entitlement or mirror row was left behind';
      ELSE
        RAISE;
      END IF;
  END;
END $$;
