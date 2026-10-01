-- ============================================================
-- 20261001000001: A REFUSED PAYMENT MUST PERSIST ITS OWN REFUSAL
-- ============================================================
-- `supabase/verification/payment_gate_verification.sql` was written to measure the
-- settlement gate and it found two defects in it. Both are in the refusal path,
-- which is the path that matters most: it is the one that runs when a payment does
-- not match what was agreed.
--
-- DEFECT 1 - THE APPEND CRASHES INSTEAD OF RECORDING.
--
--   v_mismatches := v_mismatches || 'gateway business does not match the pending attempt';
--
-- The right operand is an untyped literal, so PostgreSQL resolves `||` to the
-- array-concatenation operator and tries to parse the string as a text[]. It fails
-- with "malformed array literal: ...". Four of the seven checks used a bare literal
-- and four of them crashed. The branches using format(...) were fine, because
-- format returns a real text value and resolves to the element-append operator -
-- which is exactly why this survived review: half the checks worked.
--
-- The consequence was not cosmetic. Instead of a refusal with a readable reason,
-- the caller received "malformed array literal", and the failed-status write below
-- never ran.
--
-- DEFECT 2 - THE REFUSAL ROLLS ITSELF BACK.
--
-- The refusal wrote `status = 'failed'` and `failure_reason`, and then raised. A
-- raised exception aborts the enclosing transaction, so everything written in it is
-- rolled back - including the failed-status write. The function returned a refusal
-- message to the caller while leaving the attempt sitting at 'pending' with no
-- reason attached.
--
-- This is not an artefact of the verification harness. PostgREST runs an RPC in a
-- transaction and aborts it on error, so the same rollback happens for the
-- paystack-webhook and paystack-verify call sites. The verification merely made it
-- visible by measuring the rows afterwards instead of trusting the message.
--
-- THE FIX, AND WHY IT CHANGES THE RETURN TYPE.
--
-- A refusal is a business outcome, not an integrity failure, so it must not raise.
-- Recording it and returning it are the same act, and only a return lets the write
-- commit. That means the function can no longer return `public.subscriptions`: it
-- has to be able to say "settled" and "refused, and here is why" with the same
-- signature. It returns JSONB.
--
-- Raising is kept for the cases that really are integrity failures - an unknown
-- reference, a wrong settlement path, an attempt in a state that cannot be settled
-- at all - because those indicate a bug or an attack rather than a customer's
-- payment not matching.

DROP FUNCTION IF EXISTS public.settle_verified_payment(
  TEXT, JSONB, TIMESTAMPTZ, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT
);

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
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_txn public.subscription_transactions;
  v_sub public.subscriptions;
  v_mismatches TEXT[] := ARRAY[]::TEXT[];
  v_gateway_org TEXT := COALESCE(p_gateway_data->>'org_id', p_gateway_data#>>'{metadata,org_id}');
  v_gateway_version TEXT := p_gateway_data#>>'{metadata,plan_version_id}';
  v_gateway_minor BIGINT;
BEGIN
  IF p_settled_by IS NULL OR p_settled_by NOT IN ('webhook', 'callback', 'mock') THEN
    RAISE EXCEPTION 'Unknown settlement path: %', COALESCE(p_settled_by, '(none)');
  END IF;

  SELECT * INTO v_txn FROM public.subscription_transactions WHERE reference = p_reference FOR UPDATE;
  IF v_txn.id IS NULL THEN
    -- Integrity: a settlement for a reference this database never issued.
    RAISE EXCEPTION 'Transaction not found for reference %', p_reference;
  END IF;

  -- ----------------------------------------------------------
  -- Already settled. Both a webhook and a callback can reach this, and the second
  -- must return the existing outcome without re-activating, re-invoicing or
  -- extending the period. The FOR UPDATE above is what serializes them.
  -- ----------------------------------------------------------
  IF v_txn.status = 'success' THEN
    SELECT * INTO v_sub FROM public.subscriptions WHERE org_id = v_txn.org_id;
    RETURN jsonb_build_object(
      'settled', TRUE,
      'already_settled', TRUE,
      'refused', FALSE,
      'reason', NULL,
      'subscription_id', v_sub.id,
      'status', v_txn.status,
      'payment_mode', v_txn.payment_mode,
      'is_test_data', v_txn.is_test_data
    );
  END IF;

  IF v_txn.status <> 'pending' THEN
    -- Integrity: a failed or abandoned attempt must not be reconsidered, and a
    -- settlement arriving for one is either a replay of a decision already made or
    -- an attempt to reopen it.
    RAISE EXCEPTION 'Transaction % is % and cannot be settled', p_reference, v_txn.status;
  END IF;

  -- ----------------------------------------------------------
  -- Every check, in the order the brief lists them.
  -- ----------------------------------------------------------
  -- Each append casts to text explicitly. That is the fix for defect 1: an untyped
  -- literal here makes PostgreSQL choose the array-concatenation operator and fail
  -- to parse the string as an array.
  IF v_txn.payment_mode IS NULL THEN
    v_mismatches := v_mismatches || 'the attempt was never initialized against a gateway'::TEXT;
  ELSIF v_txn.payment_mode IS DISTINCT FROM p_payment_mode THEN
    v_mismatches := v_mismatches || format('mode is %s but settlement is %s', v_txn.payment_mode, p_payment_mode);
  END IF;

  IF v_txn.environment IS DISTINCT FROM p_environment THEN
    v_mismatches := v_mismatches || format('environment is %s but settlement is %s', v_txn.environment, p_environment);
  END IF;

  v_gateway_minor := CASE WHEN p_gateway_amount IS NULL THEN NULL
                          ELSE round(p_gateway_amount * 100)::BIGINT END;

  IF v_txn.amount_minor IS NULL OR v_gateway_minor IS NULL
     OR v_txn.amount_minor <> v_gateway_minor THEN
    v_mismatches := v_mismatches || format('expected %s minor units but gateway reports %s',
      COALESCE(v_txn.amount_minor::TEXT, 'nothing'), COALESCE(v_gateway_minor::TEXT, 'nothing'));
  END IF;

  IF v_txn.currency IS NULL OR upper(btrim(p_gateway_currency)) IS DISTINCT FROM upper(btrim(v_txn.currency)) THEN
    v_mismatches := v_mismatches || format('expected %s but gateway reports %s',
      COALESCE(v_txn.currency, 'nothing'), COALESCE(p_gateway_currency, 'nothing'));
  END IF;

  IF v_gateway_org IS NULL OR v_gateway_org IS DISTINCT FROM v_txn.org_id::TEXT THEN
    v_mismatches := v_mismatches || 'gateway business does not match the pending attempt'::TEXT;
  END IF;

  IF v_txn.plan_version_id IS NULL OR v_gateway_version IS NULL
     OR v_gateway_version IS DISTINCT FROM v_txn.plan_version_id::TEXT THEN
    v_mismatches := v_mismatches || 'gateway plan version does not match the pending attempt'::TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.product_plan_versions WHERE id = v_txn.plan_version_id) THEN
    v_mismatches := v_mismatches || 'the purchased plan version does not exist'::TEXT;
  END IF;

  -- ----------------------------------------------------------
  -- Refused. Record it and RETURN it, so the record survives.
  -- ----------------------------------------------------------
  IF array_length(v_mismatches, 1) IS NOT NULL THEN
    UPDATE public.subscription_transactions
    SET status = 'failed',
        failure_reason = array_to_string(v_mismatches, '; '),
        verification_data = COALESCE(p_gateway_data, '{}'::JSONB),
        updated_at = now()
    WHERE id = v_txn.id;

    RETURN jsonb_build_object(
      'settled', FALSE,
      'already_settled', FALSE,
      'refused', TRUE,
      'reason', array_to_string(v_mismatches, '; '),
      'mismatches', to_jsonb(v_mismatches),
      'subscription_id', NULL,
      'status', 'failed',
      'payment_mode', v_txn.payment_mode,
      'is_test_data', v_txn.is_test_data
    );
  END IF;

  -- ----------------------------------------------------------
  -- Verified. Record the evidence, then activate.
  -- ----------------------------------------------------------
  UPDATE public.subscription_transactions
  SET verified_at = now(),
      settled_by = p_settled_by,
      gateway_reference = COALESCE(p_gateway_reference, gateway_reference),
      provider_reference = COALESCE(p_gateway_reference, provider_reference),
      verification_data = COALESCE(p_gateway_data, '{}'::JSONB),
      paystack_data = COALESCE(p_gateway_data, paystack_data),
      failure_reason = NULL
  WHERE id = v_txn.id;

  v_sub := public.activate_subscription(p_reference, p_gateway_data, p_paid_at);

  RETURN jsonb_build_object(
    'settled', TRUE,
    'already_settled', FALSE,
    'refused', FALSE,
    'reason', NULL,
    'subscription_id', v_sub.id,
    'status', 'success',
    'payment_mode', p_payment_mode,
    'is_test_data', (p_payment_mode <> 'live')
  );
END;
$$;

COMMENT ON FUNCTION public.settle_verified_payment(TEXT, JSONB, TIMESTAMPTZ, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT) IS
  'The only path that activates a paid subscription, used by the signed webhook, the browser callback and the mock '
  'path. Refuses unless the transaction was initialized against a gateway and the settlement agrees with the recorded '
  'mode, environment, amount in minor units, currency, business and plan version. '
  'A REFUSAL RETURNS, IT DOES NOT RAISE: `{settled: false, refused: true, reason, mismatches}`. That is deliberate. '
  'An earlier version wrote status = failed with the reason and then raised, and a raised exception aborts the '
  'enclosing transaction, so the caller''s rollback erased the very record the code had just written and the attempt '
  'sat at pending with no reason. PostgREST aborts on error, so this happened on the real call sites too. Raising is '
  'kept only for integrity failures - an unknown reference, an unknown settlement path, an attempt that is neither '
  'pending nor already successful - which indicate a bug or an attack rather than a payment that did not match. '
  'Idempotent: the row is locked FOR UPDATE, so a webhook and a callback arriving together produce one activation, '
  'one invoice and one period. service_role only.';

REVOKE ALL ON FUNCTION public.settle_verified_payment(TEXT, JSONB, TIMESTAMPTZ, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_verified_payment(TEXT, JSONB, TIMESTAMPTZ, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT) TO service_role;

-- ============================================================
-- THE PRIVILEGE SURFACE, RE-ASSERTED AFTER A DROP
-- ============================================================
-- DROP FUNCTION discards the ACL, and this project's ALTER DEFAULT PRIVILEGES
-- grants EXECUTE to anon and authenticated on newly created public functions. So
-- the new function is checked rather than assumed.

DO $$
BEGIN
  IF to_regprocedure('public.settle_verified_payment(text,jsonb,timestamp with time zone,text,text,numeric,text,text,text)') IS NULL THEN
    RAISE EXCEPTION '20261001000001: settle_verified_payment does not exist after this migration';
  END IF;

  IF NOT has_function_privilege('service_role', 'public.settle_verified_payment(text,jsonb,timestamp with time zone,text,text,numeric,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '20261001000001: service_role lost EXECUTE on settle_verified_payment, which every settlement path needs';
  END IF;

  IF has_function_privilege('anon', 'public.settle_verified_payment(text,jsonb,timestamp with time zone,text,text,numeric,text,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.settle_verified_payment(text,jsonb,timestamp with time zone,text,text,numeric,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '20261001000001: a client role can execute settle_verified_payment. This function grants paid access; only the server may call it.';
  END IF;

  IF NOT (SELECT p.prosecdef FROM pg_proc p
          WHERE p.oid = to_regprocedure('public.settle_verified_payment(text,jsonb,timestamp with time zone,text,text,numeric,text,text,text)')) THEN
    RAISE EXCEPTION '20261001000001: settle_verified_payment is no longer SECURITY DEFINER, so it can no longer call activate_subscription';
  END IF;

  RAISE NOTICE '20261001000001: settle_verified_payment returns JSONB, refuses without raising, and is service_role only';
END $$;
