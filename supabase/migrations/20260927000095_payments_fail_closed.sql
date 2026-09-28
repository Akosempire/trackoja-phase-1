-- ============================================================
-- 095: PAYMENTS FAIL CLOSED, AND ONLY A VERIFIED SETTLEMENT ACTIVATES
-- ============================================================
-- The defect this migration exists to close.
--
-- `PAYSTACK_SECRET_KEY` was unset on this project, and `paystack-initialize` had
-- a mock branch for exactly that case: it created no gateway session, returned
-- the callback URL as if it were a checkout URL, and called activate_subscription
-- immediately. So a production deployment with no payment configuration at all
-- would hand out paid access to anyone who pressed the button. A missing secret
-- is a configuration error, and a configuration error must never be a free
-- subscription.
--
-- 095 makes the database able to tell the difference between money that was
-- verified and money that was assumed, and refuses to activate on anything but
-- the former:
--
--   * a transaction records the payment mode it was started under (live, test or
--     mock), the environment, and the amount and currency it EXPECTED to be
--     charged, stamped by the server at initialization and never by the client
--   * `settle_verified_payment` is the only path that activates, and it refuses
--     unless reference, business, amount, currency, mode, environment and plan all
--     match what the transaction expected
--   * `activate_subscription` loses its service_role grant, so the Edge Functions
--     holding the service key can no longer reach activation without passing the
--     gate above. It stays callable from inside the database, which is how the
--     gate itself calls it.
--   * mock and test settlements are recorded as test data, on the transaction and
--     on the entitlement they produce, so test access is never counted as revenue
--     and never mistaken for a customer.
--   * `webhook_events` finally exists. The Platform Owner console has claimed
--     since it was written that "a webhook_events ledger written by
--     paystack-webhook and opay-webhook" backs its webhook health metric, and no
--     such table existed. A metric that reads a table that is not there is worse
--     than no metric.
--
-- WHY THE MODE IS NOT A PARAMETER OF ANY CLIENT-CALLABLE FUNCTION. The brief for
-- this work is explicit that a production request must not be able to select mock
-- mode through client parameters, account settings, or an unprotected endpoint.
-- So the mode is resolved ONLY from Edge Function secrets (`_shared/payments.ts`)
-- and reaches the database through `record_payment_attempt`, which is granted to
-- service_role alone. `start_plan_checkout` takes a plan and a cycle from the
-- customer and nothing else; it cannot name a mode even if it wanted to.

-- ============================================================
-- 1. WHAT A PAYMENT ATTEMPT MUST RECORD
-- ============================================================
-- `subscription_transactions` was already the payment-attempt table; 094 added
-- the cycle and the exact plan. This adds the four facts that let a settlement be
-- checked rather than trusted, plus the bookkeeping that says who settled it and
-- whether it was real money.

ALTER TABLE public.subscription_transactions
  ADD COLUMN IF NOT EXISTS payment_mode TEXT;

ALTER TABLE public.subscription_transactions
  ADD COLUMN IF NOT EXISTS environment TEXT;

-- What the server told the gateway to charge, in major units, captured at
-- initialization. Verification compares the gateway's answer against THIS, not
-- against the plan's current price: a plan edited between checkout and settlement
-- must not silently change what the customer agreed to pay.
ALTER TABLE public.subscription_transactions
  ADD COLUMN IF NOT EXISTS expected_amount NUMERIC(14,2);

ALTER TABLE public.subscription_transactions
  ADD COLUMN IF NOT EXISTS expected_currency TEXT;

-- The gateway's own identifier for the session, when it gives one.
ALTER TABLE public.subscription_transactions
  ADD COLUMN IF NOT EXISTS gateway_reference TEXT;

-- Set only by settle_verified_payment, after every check has passed. Its presence
-- is the evidence that a human reviewable verification happened.
ALTER TABLE public.subscription_transactions
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

-- Which path settled it: 'webhook', 'callback' or 'mock'. Two of those three can
-- arrive for one payment, and this column is how the audit trail shows which one
-- got there first.
ALTER TABLE public.subscription_transactions
  ADD COLUMN IF NOT EXISTS settled_by TEXT;

-- Why a payment did not succeed, in words an operator can read without opening
-- the gateway dashboard.
ALTER TABLE public.subscription_transactions
  ADD COLUMN IF NOT EXISTS failure_reason TEXT;

-- Mock and test money is not money. Default FALSE so every existing row keeps its
-- meaning: those rows were written before test data was distinguishable and the
-- only payments this project has ever taken were real ones.
ALTER TABLE public.subscription_transactions
  ADD COLUMN IF NOT EXISTS is_test_data BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.subscription_transactions'::regclass
      AND conname = 'subscription_transactions_payment_mode_check'
  ) THEN
    ALTER TABLE public.subscription_transactions
      ADD CONSTRAINT subscription_transactions_payment_mode_check
      CHECK (payment_mode IS NULL OR payment_mode IN ('live', 'test', 'mock'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.subscription_transactions'::regclass
      AND conname = 'subscription_transactions_environment_check'
  ) THEN
    ALTER TABLE public.subscription_transactions
      ADD CONSTRAINT subscription_transactions_environment_check
      CHECK (environment IS NULL OR environment IN ('production', 'staging', 'development'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.subscription_transactions'::regclass
      AND conname = 'subscription_transactions_settled_by_check'
  ) THEN
    ALTER TABLE public.subscription_transactions
      ADD CONSTRAINT subscription_transactions_settled_by_check
      CHECK (settled_by IS NULL OR settled_by IN ('webhook', 'callback', 'mock'));
  END IF;
END $$;

-- Admin reporting filters on both of these, and the newest-first transaction list
-- is the single most-read query in the Platform Owner billing area.
CREATE INDEX IF NOT EXISTS idx_subscription_txns_test_data
  ON public.subscription_transactions(is_test_data, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscription_txns_gateway_ref
  ON public.subscription_transactions(gateway_reference)
  WHERE gateway_reference IS NOT NULL;

COMMENT ON COLUMN public.subscription_transactions.payment_mode IS
  'The gateway mode this attempt was started under: live, test or mock. Stamped by record_payment_attempt, which '
  'only service_role may call, so a client cannot choose it. NULL means the attempt predates 095 or was never '
  'initialized, and settle_verified_payment refuses to activate such a row unless it is also a legacy row it can '
  'verify by amount alone.';
COMMENT ON COLUMN public.subscription_transactions.is_test_data IS
  'TRUE when this attempt was settled in test or mock mode. Test access is real access for the customer using it and '
  'must never be counted as revenue, so every revenue figure and every counting query has to exclude it deliberately.';

-- ============================================================
-- 2. THE WEBHOOK LEDGER THE CONSOLE ALREADY PROMISED
-- ============================================================
-- Written by every provider webhook, including the events it ignores and the ones
-- whose signature failed. Those two are the interesting ones: an operator wants to
-- know that a webhook arrived and was rejected, because that is what a wrong
-- secret looks like from the outside, and it is indistinguishable from silence if
-- nothing is recorded.
--
-- No foreign key to subscription_transactions: a webhook can arrive for a
-- reference this database has never heard of, and refusing to record that would
-- throw away the most useful evidence there is.

CREATE TABLE IF NOT EXISTS public.webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  event TEXT,
  reference TEXT,
  signature_valid BOOLEAN NOT NULL,
  http_status INTEGER,
  outcome TEXT NOT NULL,
  detail TEXT,
  payload JSONB,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_received ON public.webhook_events(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_events_reference ON public.webhook_events(reference) WHERE reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_webhook_events_outcome ON public.webhook_events(signature_valid, received_at DESC);

ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

-- Operators read it; no client writes it. The Edge Function writes through the
-- service key, which bypasses RLS.
DROP POLICY IF EXISTS "Platform admins can read webhook events" ON public.webhook_events;
CREATE POLICY "Platform admins can read webhook events" ON public.webhook_events
  FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()));

COMMENT ON TABLE public.webhook_events IS
  'Every provider webhook this system received, including unknown events, ignored events and signature failures. '
  'A signature failure is recorded rather than discarded, because a wrong secret and a quiet gateway look identical '
  'if nothing is written. No FK to subscription_transactions: a webhook for an unknown reference is evidence.';

-- ============================================================
-- 3. WHAT A CHECKOUT COSTS
-- ============================================================
-- One function decides the amount, and everything that needs the number reads it:
-- the plan preview in the Platform Owner console, the customer's plan comparison,
-- the checkout itself, and the amount verification at settlement. A second
-- implementation of this rule anywhere is a future mismatch between what a
-- customer was shown and what they were charged.
--
-- SETUP FEE. 092 added product_plans.setup_fee and nothing applied it. It is a
-- one-off onboarding charge, so it belongs to the FIRST payment a business makes
-- for a product and to no payment after that. "First" is decided by whether any
-- earlier transaction for the same business and product was settled successfully -
-- not by whether a subscription row exists, because every new business gets a
-- trialing subscription row from a trigger and has therefore never paid.
--
-- TRIAL DAYS. product_plans.trial_days is deliberately NOT read here, and section
-- 6 explains why. A trial is granted per business by billing.trial_days when the
-- business is created, and reading a second trial length from the plan would mean
-- a business could restart its trial by switching plans.

CREATE OR REPLACE FUNCTION public.plan_checkout_amount(
  p_product_plan_id UUID,
  p_cycle TEXT,
  p_org_id UUID
)
RETURNS TABLE (
  plan_name TEXT,
  billing_cycle TEXT,
  list_amount NUMERIC,
  setup_fee NUMERIC,
  total_amount NUMERIC,
  currency TEXT,
  is_first_payment BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cycle TEXT := lower(btrim(COALESCE(NULLIF(p_cycle, ''), 'monthly')));
  v_plan public.product_plans;
  v_list NUMERIC;
  v_fee NUMERIC := 0;
  v_first BOOLEAN;
BEGIN
  IF v_cycle NOT IN ('monthly', 'annual') THEN
    RAISE EXCEPTION 'Unsupported billing cycle: %', p_cycle;
  END IF;

  SELECT * INTO v_plan FROM public.product_plans pp WHERE pp.id = p_product_plan_id;
  IF v_plan.id IS NULL THEN
    RAISE EXCEPTION 'Unknown plan';
  END IF;

  v_list := CASE v_cycle
    WHEN 'annual' THEN COALESCE(v_plan.annual_price, v_plan.monthly_price)
    ELSE COALESCE(v_plan.monthly_price, v_plan.annual_price)
  END;

  -- A plan with no price for the cycle asked for, and no price for the other one
  -- either, is a plan priced on application. Returning NULL lets the caller say so
  -- rather than quoting zero.
  IF v_list IS NULL THEN
    RETURN QUERY SELECT v_plan.name, v_cycle, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC,
      COALESCE(v_plan.currency, 'NGN'), FALSE;
    RETURN;
  END IF;

  -- No organization means no history, so quote the first-payment total. This is
  -- the honest reading for a caller that is previewing prices on a landing page.
  IF p_org_id IS NULL THEN
    v_first := TRUE;
  ELSE
    -- A business may only be asked about by its owner or by a platform admin.
    -- Whether a business has ever paid is not public information, and without this
    -- guard any signed-in caller could probe it by passing somebody else's id.
    IF NOT EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = p_org_id AND o.owner_id = auth.uid()
    ) AND NOT public.is_platform_admin(auth.uid()) THEN
      RAISE EXCEPTION 'Only the organization owner can price a checkout for it';
    END IF;

    v_first := NOT EXISTS (
      SELECT 1 FROM public.subscription_transactions t
      WHERE t.org_id = p_org_id
        AND t.product_id = v_plan.product_id
        AND t.status = 'success'
        AND t.is_test_data = FALSE
    );
  END IF;

  IF v_first THEN
    v_fee := COALESCE(v_plan.setup_fee, 0);
  END IF;

  RETURN QUERY SELECT
    v_plan.name,
    v_cycle,
    v_list,
    v_fee,
    v_list + v_fee,
    COALESCE(v_plan.currency, 'NGN'),
    v_first;
END;
$$;

COMMENT ON FUNCTION public.plan_checkout_amount(UUID, TEXT, UUID) IS
  'The single authority on what a checkout costs: the plan price for the cycle plus the one-off setup fee when this '
  'business has never paid for this product before. Read by the Platform Owner plan preview, the customer plan '
  'comparison, start_plan_checkout and settlement verification, so that what a customer was shown and what they were '
  'charged cannot drift apart. p_org_id NULL means "no history known" and quotes the first-payment total.';

REVOKE ALL ON FUNCTION public.plan_checkout_amount(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.plan_checkout_amount(UUID, TEXT, UUID) TO authenticated, service_role;

-- ============================================================
-- 3.1 THE CHECKOUT CHARGES WHAT plan_checkout_amount SAYS
-- ============================================================
-- 094's start_plan_checkout priced the checkout from the plan's own column, which
-- ignored the setup fee. It now reads the one function that knows the rule, so the
-- amount recorded as `amount` is the amount the customer will actually be charged,
-- and record_payment_attempt later stamps the same number as `expected_amount`.
--
-- Everything else is 094's behaviour unchanged: the published-plan rule, the
-- owner-only rule, the sole-business rule, the legacy mirror row, and the cycle
-- and plan recorded on the transaction.

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
  v_priced RECORD;
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
    IF EXISTS (SELECT 1 FROM public.organization_members om WHERE om.user_id = v_actor) THEN
      RAISE EXCEPTION 'Only the organization owner can manage billing';
    END IF;
    RAISE EXCEPTION 'An organisation is required';
  ELSIF v_owned > 1 THEN
    RAISE EXCEPTION 'An organisation is required';
  END IF;

  SELECT o.* INTO v_org
  FROM public.organizations o
  WHERE o.owner_id = v_actor
  ORDER BY o.created_at ASC, o.id ASC
  LIMIT 1;

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

  SELECT * INTO v_priced
  FROM public.plan_checkout_amount(v_plan.id, v_cycle, v_org.id);

  v_amount := v_priced.total_amount;

  IF v_amount IS NULL THEN
    RAISE EXCEPTION 'This plan has no % price; contact sales to arrange terms', v_cycle;
  END IF;

  -- ----------------------------------------------------------
  -- The legacy mirror, resolved by name and created when absent.
  -- ----------------------------------------------------------
  -- subscriptions.plan_id is an FK to this table, so a payment must produce one.
  -- The mirror is no longer the record of what was bought - the transaction is.
  SELECT * INTO v_legacy
  FROM public.subscription_plans sp
  WHERE lower(sp.name) = lower(v_plan.name)
  ORDER BY (sp.status = 'active') DESC, sp.price ASC, sp.created_at ASC
  LIMIT 1;

  IF v_legacy.id IS NULL THEN
    INSERT INTO public.subscription_plans (
      name, description, price, currency, billing_interval, trial_days, feature_set, status
    ) VALUES (
      v_plan.name,
      v_plan.description,
      COALESCE(v_priced.list_amount, v_amount),
      COALESCE(v_plan.currency, 'NGN'),
      CASE WHEN v_cycle = 'annual' THEN 'yearly' ELSE 'monthly' END,
      COALESCE(v_plan.trial_days, 0),
      jsonb_build_object('user_limit', v_plan.user_limit, 'store_limit', v_plan.store_limit),
      'active'
    )
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

  v_reference := 'sub_' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.subscription_transactions (
    org_id, plan_id, reference, amount, currency, status, created_by,
    product_id, is_sandbox, billing_cycle, product_plan_id
  ) VALUES (
    v_org.id, v_legacy.id, v_reference, v_amount,
    COALESCE(v_priced.currency, v_plan.currency, v_legacy.currency, 'NGN'),
    'pending', v_actor, v_plan.product_id, COALESCE(v_org.is_sandbox, FALSE),
    v_cycle, v_plan.id
  )
  RETURNING * INTO v_txn;

  RETURN v_txn;
END;
$$;

COMMENT ON FUNCTION public.start_plan_checkout(UUID, TEXT) IS
  'Starts a checkout against a PUBLISHED product plan, by plan id and billing cycle. Prices it through '
  'plan_checkout_amount, so the amount includes the one-off setup fee on a business''s first payment for the product. '
  'Records the cycle and the exact plan on the transaction, which is what settlement verification checks. Creates or '
  'reuses the legacy subscription_plans mirror row, and writes the pending row that paystack-initialize then stamps '
  'with a payment mode. Owner-only: the caller must own exactly one business. Requires a session. Note that a pending '
  'row grants nothing: only settle_verified_payment activates.';

REVOKE ALL ON FUNCTION public.start_plan_checkout(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_plan_checkout(UUID, TEXT) TO authenticated;

-- ============================================================
-- 4. STAMPING THE ATTEMPT, FROM THE SERVER ONLY
-- ============================================================
-- Called by paystack-initialize once it has resolved the mode from its own
-- secrets and before it talks to the gateway. This is the only way a mode reaches
-- the database, and it is granted to service_role alone.

CREATE OR REPLACE FUNCTION public.record_payment_attempt(
  p_reference TEXT,
  p_payment_mode TEXT,
  p_environment TEXT,
  p_expected_amount NUMERIC,
  p_expected_currency TEXT,
  p_gateway_reference TEXT DEFAULT NULL
)
RETURNS public.subscription_transactions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_txn public.subscription_transactions;
BEGIN
  IF p_payment_mode IS NULL OR p_payment_mode NOT IN ('live', 'test', 'mock') THEN
    RAISE EXCEPTION 'Unsupported payment mode: %', COALESCE(p_payment_mode, '(none)');
  END IF;

  IF p_environment IS NULL OR p_environment NOT IN ('production', 'staging', 'development') THEN
    RAISE EXCEPTION 'Unsupported environment: %', COALESCE(p_environment, '(none)');
  END IF;

  SELECT * INTO v_txn FROM public.subscription_transactions WHERE reference = p_reference FOR UPDATE;
  IF v_txn.id IS NULL THEN
    RAISE EXCEPTION 'Transaction not found for reference %', p_reference;
  END IF;

  IF v_txn.status <> 'pending' THEN
    RAISE EXCEPTION 'Transaction % is already % and cannot be initialized again', p_reference, v_txn.status;
  END IF;

  -- A mode may be recorded twice for the same attempt only if it is the same mode.
  -- Re-initializing must not be a way to downgrade a live attempt to a mock one.
  IF v_txn.payment_mode IS NOT NULL AND v_txn.payment_mode <> p_payment_mode THEN
    RAISE EXCEPTION 'Transaction % was started in % mode and cannot be re-initialized as %',
      p_reference, v_txn.payment_mode, p_payment_mode;
  END IF;

  UPDATE public.subscription_transactions
  SET payment_mode = p_payment_mode,
      environment = p_environment,
      expected_amount = p_expected_amount,
      expected_currency = p_expected_currency,
      gateway_reference = COALESCE(p_gateway_reference, gateway_reference),
      is_test_data = (p_payment_mode <> 'live')
  WHERE id = v_txn.id
  RETURNING * INTO v_txn;

  RETURN v_txn;
END;
$$;

COMMENT ON FUNCTION public.record_payment_attempt(TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT) IS
  'Stamps a pending transaction with the gateway mode, environment and the amount and currency the server is about to '
  'ask for. service_role only, because the mode is a server decision: the brief for this work requires that a '
  'production request cannot select mock mode through client parameters, account settings or an unprotected endpoint. '
  'Re-initializing with a different mode is refused, so a live attempt cannot be downgraded to a mock one.';

REVOKE ALL ON FUNCTION public.record_payment_attempt(TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_payment_attempt(TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT) TO service_role;

-- ============================================================
-- 5. THE GATE: VERIFY, THEN ACTIVATE
-- ============================================================
-- Every settlement path goes through here - the signed webhook, the browser
-- callback and the mock path - so there is exactly one implementation of "is this
-- payment real and is it the payment we asked for".
--
-- It refuses on: an unknown reference, a transaction that is not pending, a mode
-- or environment that disagrees with what was stamped at initialization, an
-- amount or currency that disagrees with what the customer was quoted, a
-- transaction belonging to a different business than the settlement claims, and a
-- transaction with no recorded expectation at all.
--
-- WHY IT REFUSES A TRANSACTION WITH NO EXPECTATION. A row with no stamped amount
-- is a row this system never asked a gateway to charge. The only rows in that
-- state are pre-095 rows and rows whose initialization failed, and activating
-- either on an unverified claim is the defect this migration exists to close.
--
-- IDEMPOTENCY. The row is locked FOR UPDATE before the status is read, so a
-- webhook and a callback arriving together serialize: the second one finds
-- status = 'success' and returns the subscription that already exists without
-- touching it. Two settlements cannot produce two activations, two invoices or a
-- doubled period.

CREATE OR REPLACE FUNCTION public.settle_verified_payment(
  p_reference TEXT,
  p_gateway_data JSONB,
  p_paid_at TIMESTAMPTZ,
  p_payment_mode TEXT,
  p_environment TEXT,
  p_gateway_amount NUMERIC,
  p_gateway_currency TEXT,
  p_gateway_reference TEXT DEFAULT NULL,
  p_settled_by TEXT DEFAULT 'webhook'
)
RETURNS public.subscriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_txn public.subscription_transactions;
  v_sub public.subscriptions;
  v_mismatches TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF p_settled_by IS NULL OR p_settled_by NOT IN ('webhook', 'callback', 'mock') THEN
    RAISE EXCEPTION 'Unknown settlement path: %', COALESCE(p_settled_by, '(none)');
  END IF;

  SELECT * INTO v_txn FROM public.subscription_transactions WHERE reference = p_reference FOR UPDATE;
  IF v_txn.id IS NULL THEN
    RAISE EXCEPTION 'Transaction not found for reference %', p_reference;
  END IF;

  -- Already settled: hand back what exists. This is the branch a racing webhook
  -- and callback both land on, and it must not re-activate, re-invoice or extend
  -- the period a second time.
  IF v_txn.status = 'success' THEN
    SELECT * INTO v_sub FROM public.subscriptions WHERE org_id = v_txn.org_id;
    RETURN v_sub;
  END IF;

  IF v_txn.status <> 'pending' THEN
    RAISE EXCEPTION 'Transaction % is % and cannot be settled', p_reference, v_txn.status;
  END IF;

  -- ----------------------------------------------------------
  -- Everything that must match before a single row is written.
  -- ----------------------------------------------------------
  IF v_txn.payment_mode IS NULL THEN
    v_mismatches := v_mismatches || 'this attempt was never initialized against a gateway, so no amount was ever agreed';
  ELSIF v_txn.payment_mode IS DISTINCT FROM p_payment_mode THEN
    v_mismatches := v_mismatches || format('mode is %s but the settlement is %s', v_txn.payment_mode, p_payment_mode);
  END IF;

  IF v_txn.environment IS NOT NULL AND v_txn.environment IS DISTINCT FROM p_environment THEN
    v_mismatches := v_mismatches || format('environment is %s but the settlement is %s', v_txn.environment, p_environment);
  END IF;

  IF v_txn.expected_amount IS NULL THEN
    v_mismatches := v_mismatches || 'no expected amount was recorded';
  ELSIF p_gateway_amount IS NULL OR v_txn.expected_amount <> round(p_gateway_amount, 2) THEN
    v_mismatches := v_mismatches || format('expected %s but the gateway reports %s',
      v_txn.expected_amount, COALESCE(p_gateway_amount::TEXT, 'nothing'));
  END IF;

  IF v_txn.expected_currency IS NULL THEN
    v_mismatches := v_mismatches || 'no expected currency was recorded';
  ELSIF upper(btrim(p_gateway_currency)) IS DISTINCT FROM upper(btrim(v_txn.expected_currency)) THEN
    v_mismatches := v_mismatches || format('expected %s but the gateway reports %s',
      v_txn.expected_currency, COALESCE(p_gateway_currency, 'nothing'));
  END IF;

  -- The business the gateway says it charged must be the business the attempt was
  -- opened for. A callback carries the reference only, so a callback that names a
  -- different organization is either a bug or an attempt to settle somebody
  -- else's payment into your own account.
  IF p_gateway_data ? 'org_id'
     AND (p_gateway_data->>'org_id') IS DISTINCT FROM v_txn.org_id::TEXT THEN
    v_mismatches := v_mismatches || format('the settlement names business %s but the attempt belongs to %s',
      p_gateway_data->>'org_id', v_txn.org_id);
  END IF;

  -- The plan the customer bought must still be the plan on the attempt.
  IF v_txn.product_plan_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.product_plans pp WHERE pp.id = v_txn.product_plan_id) THEN
    v_mismatches := v_mismatches || 'the plan this attempt was opened for no longer exists';
  END IF;

  IF array_length(v_mismatches, 1) IS NOT NULL THEN
    UPDATE public.subscription_transactions
    SET status = 'failed',
        failure_reason = array_to_string(v_mismatches, '; '),
        paystack_data = COALESCE(p_gateway_data, paystack_data),
        updated_at = now()
    WHERE id = v_txn.id;

    RAISE EXCEPTION 'Payment % refused: %', p_reference, array_to_string(v_mismatches, '; ');
  END IF;

  -- ----------------------------------------------------------
  -- Verified. Record the evidence, then activate through the one
  -- function that knows how to write a subscription.
  -- ----------------------------------------------------------
  UPDATE public.subscription_transactions
  SET verified_at = now(),
      settled_by = p_settled_by,
      gateway_reference = COALESCE(p_gateway_reference, gateway_reference),
      paystack_data = COALESCE(p_gateway_data, paystack_data),
      failure_reason = NULL
  WHERE id = v_txn.id;

  -- activate_subscription does its own idempotency check and removes its own
  -- service_role grant in this migration, so the only way to reach it from here
  -- on is from inside the database, which is to say through this gate.
  v_sub := public.activate_subscription(p_reference, p_gateway_data, p_paid_at);

  RETURN v_sub;
END;
$$;

COMMENT ON FUNCTION public.settle_verified_payment(TEXT, JSONB, TIMESTAMPTZ, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT) IS
  'The only path that activates a paid subscription, used by the signed webhook, the browser callback and the mock '
  'path. Refuses unless the transaction was initialized against a gateway and the settlement agrees with the recorded '
  'mode, environment, amount, currency, business and plan; a refusal marks the attempt failed with the reason and '
  'writes no access. Idempotent: the row is locked FOR UPDATE, so a webhook and a callback arriving together produce '
  'one activation. service_role only.';

REVOKE ALL ON FUNCTION public.settle_verified_payment(TEXT, JSONB, TIMESTAMPTZ, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_verified_payment(TEXT, JSONB, TIMESTAMPTZ, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT) TO service_role;

-- ============================================================
-- 6. CLOSING THE DIRECT ROUTE INTO ACTIVATION
-- ============================================================
-- Until now the Edge Functions settled by calling activate_subscription directly,
-- which meant any future function holding the service key could grant paid access
-- without checking anything. Removing the grant makes settle_verified_payment the
-- only door. The function still works when called from inside the database, which
-- is how the gate reaches it, because a SECURITY DEFINER function is invoked as
-- its owner rather than as the caller.

REVOKE ALL ON FUNCTION public.activate_subscription(TEXT, JSONB, TIMESTAMP WITH TIME ZONE) FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================
-- 7. MARKING AN ATTEMPT ABANDONED
-- ============================================================
-- When initialization cannot proceed - payments are unconfigured, or the gateway
-- refused the session - the pending row must not be left looking like a payment
-- that might still arrive. 'abandoned' is the status that means "we tried to start
-- this and it did not start", and it is the honest one here.

CREATE OR REPLACE FUNCTION public.abandon_payment_attempt(
  p_reference TEXT,
  p_reason TEXT
)
RETURNS public.subscription_transactions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_txn public.subscription_transactions;
BEGIN
  UPDATE public.subscription_transactions
  SET status = 'abandoned',
      failure_reason = COALESCE(NULLIF(btrim(p_reason), ''), 'Checkout could not be started'),
      updated_at = now()
  WHERE reference = p_reference
    AND status = 'pending'
  RETURNING * INTO v_txn;

  IF v_txn.id IS NULL THEN
    SELECT * INTO v_txn FROM public.subscription_transactions WHERE reference = p_reference;
  END IF;

  RETURN v_txn;
END;
$$;

COMMENT ON FUNCTION public.abandon_payment_attempt(TEXT, TEXT) IS
  'Marks a pending attempt abandoned with a reason. Used when checkout cannot start at all - most importantly when '
  'payments are unconfigured, so the row does not sit pending forever implying money may still arrive. Only a pending '
  'row is touched: a settled one is never rewritten by a later failure.';

REVOKE ALL ON FUNCTION public.abandon_payment_attempt(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.abandon_payment_attempt(TEXT, TEXT) TO service_role;

-- ============================================================
-- 8. WHAT THE CUSTOMER AND THE OPERATOR MAY READ BACK
-- ============================================================
-- The customer's payment history needs the mode and the failure reason, and it
-- needs them scoped to a business they own. Not SECURITY DEFINER: the existing
-- `subscription_transactions_select` policy admits a row only when its business's
-- owner is the caller, and this function states the same rule and then reads
-- through that policy rather than around it. The duplication is deliberate - if
-- the WHERE below were ever wrong, RLS still refuses the row.

CREATE OR REPLACE FUNCTION public.get_my_payment_attempts(
  p_limit INTEGER DEFAULT 25
)
RETURNS TABLE (
  reference TEXT,
  status TEXT,
  amount NUMERIC,
  currency TEXT,
  billing_cycle TEXT,
  plan_name TEXT,
  payment_mode TEXT,
  is_test_data BOOLEAN,
  failure_reason TEXT,
  created_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    t.reference,
    t.status,
    COALESCE(t.expected_amount, t.amount),
    COALESCE(t.expected_currency, t.currency),
    t.billing_cycle,
    pp.name,
    t.payment_mode,
    t.is_test_data,
    t.failure_reason,
    t.created_at,
    t.paid_at,
    t.verified_at
  FROM public.subscription_transactions t
  LEFT JOIN public.product_plans pp ON pp.id = t.product_plan_id
  WHERE t.org_id IN (SELECT o.id FROM public.organizations o WHERE o.owner_id = auth.uid())
  ORDER BY t.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 25), 200));
$$;

COMMENT ON FUNCTION public.get_my_payment_attempts(INTEGER) IS
  'The signed-in caller''s own payment attempts, newest first, including the ones that failed and the ones that were '
  'never initialized. Owner-scoped to match the subscription_transactions_select policy: billing is the owner''s, and '
  'a member who is not the owner is refused elsewhere in the same way. SECURITY INVOKER on purpose, so it reads '
  'through RLS rather than around it and a mistake in its WHERE clause cannot leak another business''s payments.';

REVOKE ALL ON FUNCTION public.get_my_payment_attempts(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_payment_attempts(INTEGER) TO authenticated, service_role;

-- ============================================================
-- 9. TEST ACCESS IS LABELLED AS TEST ACCESS
-- ============================================================
-- The entitlement a test or mock settlement produces is a real entitlement - the
-- customer testing it should be able to use the product - but it must be
-- impossible to mistake it for a paying customer, so the label travels with the
-- row. 094's body is reproduced here with one addition in the metadata, because a
-- later migration must state the whole function rather than a diff against a file
-- somebody might edit.

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
  -- from the legacy checkout, which has no cycle argument to record.
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

  v_product_id := v_txn.product_id;

  IF v_product_id IS NULL THEN
    SELECT p.id INTO v_product_id
    FROM public.platform_products p
    WHERE p.key = 'trackoja';
  END IF;

  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'Cannot record the entitlement for reference %: the transaction has no product and the trackoja product is not configured', p_reference;
  END IF;

  -- The plan the customer actually bought, when the transaction says so.
  IF v_txn.product_plan_id IS NOT NULL THEN
    SELECT * INTO v_product_plan
    FROM public.product_plans pp
    WHERE pp.id = v_txn.product_plan_id;

    IF v_product_plan.id IS NULL THEN
      RAISE NOTICE 'activate_subscription: transaction % references product plan %, which no longer exists; falling back to name matching',
        p_reference, v_txn.product_plan_id;
    END IF;
  END IF;

  IF v_product_plan.id IS NULL THEN
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
      'billing_cycle', v_cycle,
      -- What the money actually was. A test or mock settlement grants real access
      -- to whoever is testing, and this is the label that stops that access being
      -- counted as a customer in every metric that reads this row.
      'payment_mode', v_txn.payment_mode,
      'is_test_data', v_txn.is_test_data,
      'settled_by', v_txn.settled_by,
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
  'INTERNAL SETTLING PRIMITIVE. Writes the subscription, the entitlement and the transaction''s success state from a '
  'transaction that has already been checked, and labels the entitlement with the payment mode and whether it is test '
  'data. Since 095 no role can execute it from outside the database: settle_verified_payment is the only way in, and '
  'it performs the verification this function assumes has already happened.';

REVOKE ALL ON FUNCTION public.activate_subscription(TEXT, JSONB, TIMESTAMP WITH TIME ZONE) FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================
-- 10. THE PRIVILEGE SURFACE, ASSERTED
-- ============================================================
-- The lesson this project learned in 090 and restated in 092: ALTER DEFAULT
-- PRIVILEGES grants EXECUTE on new public functions to anon and authenticated, so
-- `REVOKE ... FROM PUBLIC` removes nothing that matters and every role must be
-- named. This asserts the result instead of trusting the REVOKEs above.

DO $$
DECLARE
  v_service_only TEXT[] := ARRAY[
    'public.record_payment_attempt(text,text,text,numeric,text,text)',
    'public.settle_verified_payment(text,jsonb,timestamp with time zone,text,text,numeric,text,text,text)',
    'public.abandon_payment_attempt(text,text)'
  ];
  v_client_readable TEXT[] := ARRAY[
    'public.plan_checkout_amount(uuid,text,uuid)',
    'public.get_my_payment_attempts(integer)',
    'public.start_plan_checkout(uuid,text)'
  ];
  v_signature TEXT;
BEGIN
  FOREACH v_signature IN ARRAY v_service_only LOOP
    IF to_regprocedure(v_signature) IS NULL THEN
      RAISE EXCEPTION '095 privileges: % does not exist', v_signature;
    END IF;
    IF NOT has_function_privilege('service_role', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION '095 privileges: service_role cannot execute %', v_signature;
    END IF;
    IF has_function_privilege('anon', v_signature, 'EXECUTE')
       OR has_function_privilege('authenticated', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION '095 privileges: a client role can execute %. These stamp payment modes and settle money.', v_signature;
    END IF;
  END LOOP;

  FOREACH v_signature IN ARRAY v_client_readable LOOP
    IF NOT has_function_privilege('authenticated', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION '095 privileges: authenticated cannot execute %', v_signature;
    END IF;
    IF has_function_privilege('anon', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION '095 privileges: anon can execute %. Every one of these needs a session: two read tenant data, and start_plan_checkout opens a payment attempt.', v_signature;
    END IF;
  END LOOP;

  -- The whole point of this migration, asserted rather than described.
  IF has_function_privilege('service_role', 'public.activate_subscription(text,jsonb,timestamp with time zone)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.activate_subscription(text,jsonb,timestamp with time zone)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.activate_subscription(text,jsonb,timestamp with time zone)', 'EXECUTE') THEN
    RAISE EXCEPTION '095: activate_subscription is still executable by a role from outside the database. This migration exists to remove that, because a function holding the service key could otherwise grant paid access without verifying anything.';
  END IF;

  -- And the function still has to be callable from inside settle_verified_payment,
  -- which runs as its owner. If this ever became SECURITY INVOKER, the gate would
  -- start failing at runtime rather than at migration time.
  IF NOT (SELECT p.prosecdef FROM pg_proc p
          WHERE p.oid = to_regprocedure('public.activate_subscription(text,jsonb,timestamp with time zone)')) THEN
    RAISE EXCEPTION '095: activate_subscription is no longer SECURITY DEFINER, so the gate can no longer call it';
  END IF;

  IF NOT (SELECT p.prosecdef FROM pg_proc p
          WHERE p.oid = to_regprocedure('public.settle_verified_payment(text,jsonb,timestamp with time zone,text,text,numeric,text,text,text)')) THEN
    RAISE EXCEPTION '095: settle_verified_payment must be SECURITY DEFINER to write the rows it settles';
  END IF;

  RAISE NOTICE '095 privileges: 3 function(s) are service_role only, % are reachable by a signed-in client, and activate_subscription is no longer callable from outside the database',
    array_length(v_client_readable, 1);
END $$;

-- ============================================================
-- 11. WHAT THIS MIGRATION ASSUMES, STATED
-- ============================================================
-- The remaining route to paid access without a payment is a service_role key. That
-- key can also insert an entitlement row directly, or read every tenant's data, so
-- 095 does not pretend to defend against it: it removes the convenience of a
-- single RPC that grants access, and leaves the unavoidable fact that a full-trust
-- credential is a full-trust credential. The defence that matters is that the
-- credential lives only in Edge Function secrets and never in a client bundle, a
-- log line or a screenshot.

DO $$
DECLARE
  v_pending INTEGER;
  v_stamped INTEGER;
BEGIN
  SELECT count(*) INTO v_pending
  FROM public.subscription_transactions WHERE status = 'pending';

  SELECT count(*) INTO v_stamped
  FROM public.subscription_transactions WHERE payment_mode IS NOT NULL;

  RAISE NOTICE '095: % pending attempt(s) exist and % row(s) already carry a payment mode. Every pending row without a mode predates this migration and can no longer be settled: the gate refuses a transaction whose amount was never agreed.',
    v_pending, v_stamped;
END $$;
