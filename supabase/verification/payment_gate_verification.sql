-- ============================================================
-- Verification: the payment settlement gate
--
-- Run as one statement against the live database:
--   node sbq.js --file supabase/verification/payment_gate_verification.sql
--
-- WHAT IT PROVES. The brief for this work requires that a payment is verified
-- server-side before it grants anything; that reference, amount, currency,
-- business, environment and expected plan all match; that fulfilment is
-- idempotent; and that a missing or invalid payment configuration never creates a
-- paid subscription. This measures the settlement half of that: given a pending
-- attempt, which settlements are accepted, which are refused, and what each
-- outcome actually writes.
--
-- TWO DEFECTS THIS SCRIPT FOUND, both fixed by
-- 20261001000001_refusal_must_persist.sql. It is kept as the regression test for
-- them.
--
--   1. Four refusal branches appended an untyped string literal to a TEXT[], so
--      PostgreSQL chose the array-concatenation operator and raised "malformed
--      array literal" instead of recording the reason.
--   2. The refusal wrote `status = 'failed'` and then raised, and a raised exception
--      aborts the enclosing transaction, so the caller's rollback erased the record
--      the code had just written. The attempt stayed 'pending' with no reason.
--      Steps 9 to 11 exist specifically to catch that: they read the rows back
--      rather than trusting the message.
--
-- HOW IT RUNS WITHOUT TOUCHING ANYTHING. `billing.payment_system` is DISABLED on
-- this deployment and a BEFORE INSERT trigger refuses to create a payment attempt
-- at all, which is the correct production behaviour and also means a real attempt
-- cannot be manufactured here. So the whole fixture - including disabling that one
-- trigger and giving a plan version a setup fee - runs inside a sub-block that
-- always ends in a deliberate rollback.
--
-- Results are buffered in an array and written out after the rollback. A savepoint
-- rollback undoes table changes, including a temporary table's, so results written
-- from inside the fixture block would vanish with it.

DROP TABLE IF EXISTS zz_payment_gate_results;
CREATE TEMP TABLE zz_payment_gate_results (
  step INTEGER,
  check_name TEXT,
  passed BOOLEAN,
  detail TEXT
);

DO $do$
DECLARE
  v_results JSONB[] := ARRAY[]::JSONB[];
  v_version public.product_plan_versions;
  v_org UUID;
  v_other_org UUID;
  v_actor UUID;
  v_legacy_plan UUID;
  v_charge_minor BIGINT;
  v_setup_minor BIGINT := 2500000;  -- NGN 25,000, set inside the rolled-back block

  v_cases JSONB[];
  v_case JSONB;
  v_i INTEGER;
  v_ref TEXT;
  v_refs TEXT[] := ARRAY[]::TEXT[];
  v_res JSONB;
  v_sub public.subscriptions;
  v_ok BOOLEAN;
  v_detail TEXT;
  v_reason TEXT;

  v_before_subs INTEGER;
  v_before_ent INTEGER;
  v_before_inv INTEGER;
  v_before_rct INTEGER;
  v_n INTEGER;
  v_n2 INTEGER;
  v_period_end TIMESTAMPTZ;
  v_period_end_after TIMESTAMPTZ;
  v_billing_email TEXT;
  v_org_ent_before INTEGER;
BEGIN
  SELECT count(*) INTO v_before_subs FROM public.subscriptions;
  SELECT count(*) INTO v_before_ent FROM public.organization_products;
  SELECT count(*) INTO v_before_inv FROM public.billing_invoices;
  SELECT count(*) INTO v_before_rct FROM public.billing_receipts;

  BEGIN
    ALTER TABLE public.subscription_transactions DISABLE TRIGGER guard_subscription_payment_creation;

    SELECT * INTO v_version FROM public.product_plan_versions
    WHERE status = 'active' AND amount_minor IS NOT NULL
    ORDER BY amount_minor ASC LIMIT 1;

    -- A setup fee is configured on no plan version today, so the invoice-line check
    -- would pass vacuously. And plan versions are IMMUTABLE: a trigger
    -- (`refuse_plan_version_mutation`) refuses to update one, which is correct -
    -- a published commercial snapshot must not change under a customer. So a new
    -- version is published here, inside the rollback, with the fee on it. That is
    -- also the honest way to test it: it is how a real setup fee would arrive.
    IF v_version.id IS NOT NULL THEN
      INSERT INTO public.product_plan_versions (
        plan_id, product_id, version, plan_key, display_name, description,
        billing_cycle, amount_minor, setup_fee_minor, currency,
        trial_enabled, trial_days, features, limits, entitlements, activation_policy,
        status, effective_from, metadata, created_by
      ) VALUES (
        v_version.plan_id, v_version.product_id, v_version.version + 1000,
        v_version.plan_key || '-zzgate', v_version.display_name || ' (verification)',
        v_version.description, v_version.billing_cycle, v_version.amount_minor, v_setup_minor,
        v_version.currency, v_version.trial_enabled, v_version.trial_days,
        v_version.features, v_version.limits, v_version.entitlements, v_version.activation_policy,
        -- 'retired' rather than 'active': the partial unique index
        -- `product_plan_versions_one_current` permits only one current version per
        -- plan and billing cycle, and an active one already exists. The settlement
        -- gate requires the version to EXIST, not to be current, so a retired
        -- version exercises the same path without breaking that rule.
        'retired', now(), jsonb_build_object('created_by', 'payment_gate_verification'), v_actor
      ) RETURNING * INTO v_version;
    END IF;

    SELECT o.id, o.owner_id INTO v_org, v_actor
    FROM public.organizations o
    LEFT JOIN public.subscriptions s ON s.org_id = o.id
    WHERE s.id IS NULL AND o.owner_id IS NOT NULL
    ORDER BY o.created_at ASC LIMIT 1;

    IF v_org IS NULL THEN
      SELECT o.id, o.owner_id INTO v_org, v_actor FROM public.organizations o
      WHERE o.owner_id IS NOT NULL ORDER BY o.created_at ASC LIMIT 1;
    END IF;

    -- A second real business, so the "settlement names another business" case is
    -- refused for the right reason rather than for a missing organization.
    SELECT o.id INTO v_other_org FROM public.organizations o WHERE o.id <> v_org ORDER BY o.created_at ASC LIMIT 1;

    -- A known billing email, set inside the rollback. Without it the invoice's
    -- billing_email and the organization's are both NULL and the check comparing
    -- them passes while proving nothing.
    v_billing_email := 'billing-verify-' || replace(gen_random_uuid()::TEXT, '-', '') || '@trackoja.test';
    UPDATE public.organizations SET billing_email = v_billing_email WHERE id = v_org;

    -- What the business already holds. Every business is given a trialing
    -- entitlement by the organization trigger, so "no entitlement exists" is the
    -- wrong question: the question is whether the refusals added one.
    SELECT count(*) INTO v_org_ent_before FROM public.organization_products WHERE org_id = v_org;

    SELECT id INTO v_legacy_plan FROM public.subscription_plans
    WHERE lower(name) = lower(v_version.display_name)
    ORDER BY (status = 'active') DESC, created_at ASC LIMIT 1;
    IF v_legacy_plan IS NULL THEN
      SELECT id INTO v_legacy_plan FROM public.subscription_plans ORDER BY created_at ASC LIMIT 1;
    END IF;

    IF v_version.id IS NULL OR v_org IS NULL OR v_actor IS NULL OR v_legacy_plan IS NULL OR v_other_org IS NULL THEN
      v_results := v_results || jsonb_build_object('step', 0,
        'name', 'the settlement gate could not be measured', 'passed', NULL,
        'detail', 'SKIPPED: needs an active plan version, an organization with an owner, a second organization and a legacy plan row');
    ELSE
      v_charge_minor := v_version.amount_minor + v_setup_minor;

      -- ----------------------------------------------------------
      -- One row per way a settlement can be wrong, plus the one way it is right.
      -- Driving them from a table keeps each case to one line and makes it obvious
      -- which fact is being varied.
      -- ----------------------------------------------------------
      v_cases := ARRAY[
        jsonb_build_object('name', 'an attempt with no recorded payment mode is REFUSED',
          'stamp', NULL, 'mode', 'test', 'env', 'staging', 'expect', 'never initialized against a gateway'),
        jsonb_build_object('name', 'a settlement for the WRONG AMOUNT is refused',
          'stamp', 'test', 'mode', 'test', 'env', 'staging', 'amount_mode', 'one_minor_short',
          'expect', 'minor units but gateway reports'),
        jsonb_build_object('name', 'a settlement in the WRONG CURRENCY is refused',
          'stamp', 'test', 'mode', 'test', 'env', 'staging', 'currency', 'USD', 'expect', 'but gateway reports USD'),
        jsonb_build_object('name', 'a LIVE settlement cannot settle a TEST attempt',
          'stamp', 'test', 'mode', 'live', 'env', 'staging', 'expect', 'mode is test but settlement is live'),
        jsonb_build_object('name', 'a settlement claiming the WRONG ENVIRONMENT is refused',
          'stamp', 'test', 'stamp_env', 'staging', 'mode', 'test', 'env', 'production',
          'expect', 'environment is staging but settlement is production'),
        jsonb_build_object('name', 'a settlement for ANOTHER BUSINESS is refused',
          'stamp', 'test', 'mode', 'test', 'env', 'staging', 'org', 'other', 'expect', 'gateway business does not match'),
        jsonb_build_object('name', 'a settlement for a DIFFERENT PLAN VERSION is refused',
          'stamp', 'test', 'mode', 'test', 'env', 'staging', 'version', 'other', 'expect', 'gateway plan version does not match'),
        jsonb_build_object('name', 'a settlement where NO gateway business is claimed is refused',
          'stamp', 'test', 'mode', 'test', 'env', 'staging', 'org', 'absent', 'expect', 'gateway business does not match')
      ];

      -- ----------------------------------------------------------
      -- The refusals.
      -- ----------------------------------------------------------
      FOR v_i IN 1..array_length(v_cases, 1) LOOP
        v_case := v_cases[v_i];
        v_ref := format('zzgate%s-%s', v_i, replace(gen_random_uuid()::TEXT, '-', ''));
        v_refs := v_refs || v_ref;

        INSERT INTO public.subscription_transactions (
          org_id, plan_id, reference, amount, currency, status, created_by,
          product_id, is_sandbox, billing_cycle, product_plan_id, plan_version_id,
          amount_minor, recurring_amount_minor, setup_fee_amount_minor
        ) VALUES (
          v_org, v_legacy_plan, v_ref, v_charge_minor / 100.0, v_version.currency, 'pending', v_actor,
          v_version.product_id, FALSE, v_version.billing_cycle, v_version.plan_id, v_version.id,
          v_charge_minor, v_version.amount_minor, v_setup_minor
        );

        IF v_case->>'stamp' IS NOT NULL THEN
          -- The stamped environment is separate from the environment the settlement
          -- claims, because they are separate facts and the check between them is
          -- the point of one of these cases. Stamping and settling with the same
          -- value would make that case untestable - which is exactly what the first
          -- version of this script did, and it made the case pass by settling.
          PERFORM public.record_payment_attempt(
            v_ref, v_case->>'stamp', COALESCE(v_case->>'stamp_env', 'staging'), NULL, NULL, NULL);
        END IF;

        v_reason := NULL;
        BEGIN
          v_res := public.settle_verified_payment(
            v_ref,
            jsonb_build_object(
              'org_id', CASE v_case->>'org'
                          WHEN 'other' THEN v_other_org::TEXT
                          WHEN 'absent' THEN NULL
                          ELSE v_org::TEXT END,
              'metadata', jsonb_build_object(
                'plan_version_id', CASE v_case->>'version' WHEN 'other' THEN gen_random_uuid()::TEXT ELSE v_version.id::TEXT END)
            ),
            now(),
            v_case->>'mode',
            v_case->>'env',
            CASE v_case->>'amount_mode' WHEN 'one_minor_short' THEN (v_charge_minor - 1) / 100.0 ELSE v_charge_minor / 100.0 END,
            COALESCE(v_case->>'currency', v_version.currency),
            NULL,
            'callback'
          );
          v_reason := v_res->>'reason';
        EXCEPTION WHEN OTHERS THEN
          -- An integrity failure is still an exception, and must not be mistaken
          -- for a business refusal.
          v_reason := 'INTEGRITY ERROR: ' || SQLERRM;
        END;

        v_ok := COALESCE((v_res->>'refused')::BOOLEAN, FALSE)
                AND v_reason LIKE '%' || (v_case->>'expect') || '%';

        v_results := v_results || jsonb_build_object('step', v_i + 1,
          'name', v_case->>'name', 'passed', v_ok, 'detail', left(COALESCE(v_reason, '(no refusal returned)'), 220));
      END LOOP;

      v_results := v_results || jsonb_build_object('step', 20,
        'name', 'the refusals returned a verdict instead of raising',
        'passed', (SELECT count(*) FROM public.subscription_transactions
                   WHERE reference = ANY(v_refs) AND status = 'failed' AND failure_reason IS NOT NULL) = array_length(v_cases, 1),
        'detail', format('%s of %s refused attempts recorded a reason',
          (SELECT count(*) FROM public.subscription_transactions
           WHERE reference = ANY(v_refs) AND status = 'failed' AND failure_reason IS NOT NULL),
          array_length(v_cases, 1)));

      SELECT count(*) INTO v_n FROM public.organization_products
      WHERE org_id = v_org AND plan_version_id = v_version.id;
      v_n2 := (SELECT count(*) FROM public.organization_products WHERE org_id = v_org);
      v_results := v_results || jsonb_build_object('step', 21,
        'name', 'NOT ONE refusal created an entitlement',
        'passed', v_n = 0 AND v_n2 = v_org_ent_before,
        'detail', format('%s entitlement(s) reference the plan version the refusals were for; the business holds %s, and held %s before any of them',
          v_n, v_n2, v_org_ent_before));

      SELECT count(*) INTO v_n FROM public.subscription_transactions
      WHERE reference = ANY(v_refs) AND verified_at IS NOT NULL;
      v_results := v_results || jsonb_build_object('step', 22,
        'name', 'no refused attempt was marked verified',
        'passed', v_n = 0, 'detail', format('%s refused attempt(s) carry a verification timestamp', v_n));

      SELECT count(*) INTO v_n FROM public.billing_invoices;
      v_results := v_results || jsonb_build_object('step', 23,
        'name', 'no refusal raised an invoice',
        'passed', v_n = v_before_inv, 'detail', format('%s invoice(s), %s before', v_n, v_before_inv));

      -- ----------------------------------------------------------
      -- The correct settlement.
      -- ----------------------------------------------------------
      v_ref := 'zzgate-ok-' || replace(gen_random_uuid()::TEXT, '-', '');
      INSERT INTO public.subscription_transactions (
        org_id, plan_id, reference, amount, currency, status, created_by,
        product_id, is_sandbox, billing_cycle, product_plan_id, plan_version_id,
        amount_minor, recurring_amount_minor, setup_fee_amount_minor
      ) VALUES (
        v_org, v_legacy_plan, v_ref, v_charge_minor / 100.0, v_version.currency, 'pending', v_actor,
        v_version.product_id, FALSE, v_version.billing_cycle, v_version.plan_id, v_version.id,
        v_charge_minor, v_version.amount_minor, v_setup_minor
      );
      PERFORM public.record_payment_attempt(v_ref, 'test', 'staging', NULL, NULL, NULL);

      v_sub := NULL;
      v_detail := 'settlement returned no subscription';
      BEGIN
        v_res := public.settle_verified_payment(
          v_ref,
          jsonb_build_object('org_id', v_org::TEXT,
            'metadata', jsonb_build_object('plan_version_id', v_version.id::TEXT), 'source', 'verification'),
          now(), 'test', 'staging', v_charge_minor / 100.0, v_version.currency, 'gateway-ref-1', 'callback');
        SELECT * INTO v_sub FROM public.subscriptions WHERE id = (v_res->>'subscription_id')::UUID;
        v_detail := format('subscription %s, status %s', v_sub.id, v_sub.status);
      EXCEPTION WHEN OTHERS THEN
        v_detail := SQLERRM;
      END;
      v_results := v_results || jsonb_build_object('step', 24,
        'name', 'a fully matching settlement ACTIVATES the subscription',
        'passed', v_sub.id IS NOT NULL AND v_sub.status = 'active', 'detail', left(v_detail, 200));

      SELECT count(*) INTO v_n FROM public.organization_products
      WHERE org_id = v_org AND plan_version_id = v_version.id;
      v_results := v_results || jsonb_build_object('step', 25,
        'name', 'the entitlement is granted against the exact plan version bought',
        'passed', v_n = 1, 'detail', format('%s entitlement row(s) for that version', v_n));

      SELECT metadata->>'is_test_data' INTO v_detail FROM public.organization_products
      WHERE org_id = v_org AND plan_version_id = v_version.id;
      v_results := v_results || jsonb_build_object('step', 26,
        'name', 'a TEST settlement labels the entitlement as test data',
        'passed', v_detail = 'true', 'detail', format('entitlement is_test_data = %s', COALESCE(v_detail, 'absent')));

      SELECT count(*) INTO v_n FROM public.billing_invoices i
      JOIN public.subscription_transactions t ON t.id = i.transaction_id WHERE t.reference = v_ref;
      v_results := v_results || jsonb_build_object('step', 27,
        'name', 'exactly ONE invoice is raised for the payment',
        'passed', v_n = 1, 'detail', format('%s invoice(s)', v_n));

      SELECT count(*) INTO v_n FROM public.billing_receipts r
      JOIN public.subscription_transactions t ON t.id = r.transaction_id WHERE t.reference = v_ref;
      v_results := v_results || jsonb_build_object('step', 28,
        'name', 'exactly ONE receipt is raised for the payment',
        'passed', v_n = 1, 'detail', format('%s receipt(s)', v_n));

      SELECT count(*) INTO v_n FROM public.billing_invoice_lines l
      JOIN public.billing_invoices i ON i.id = l.invoice_id
      JOIN public.subscription_transactions t ON t.id = i.transaction_id
      WHERE t.reference = v_ref AND l.line_type = 'subscription';
      v_results := v_results || jsonb_build_object('step', 29,
        'name', 'the invoice itemises the subscription',
        'passed', v_n = 1, 'detail', format('%s subscription line(s)', v_n));

      SELECT count(*) INTO v_n FROM public.billing_invoice_lines l
      JOIN public.billing_invoices i ON i.id = l.invoice_id
      JOIN public.subscription_transactions t ON t.id = i.transaction_id
      WHERE t.reference = v_ref AND l.line_type = 'setup_fee';
      v_results := v_results || jsonb_build_object('step', 30,
        'name', 'the invoice itemises the one-off setup fee, so the fee is charged and not merely advertised',
        'passed', v_n = 1, 'detail', format('%s setup_fee line(s) for a setup fee of %s minor units', v_n, v_setup_minor));

      SELECT i.total_minor INTO v_n FROM public.billing_invoices i
      JOIN public.subscription_transactions t ON t.id = i.transaction_id WHERE t.reference = v_ref;
      v_results := v_results || jsonb_build_object('step', 31,
        'name', 'the invoice total equals the amount actually charged',
        'passed', v_n = v_charge_minor,
        'detail', format('invoice total %s minor units; plan price %s plus setup fee %s',
          v_n, v_version.amount_minor, v_setup_minor));

      SELECT i.billing_email INTO v_detail FROM public.billing_invoices i
      JOIN public.subscription_transactions t ON t.id = i.transaction_id WHERE t.reference = v_ref;
      v_results := v_results || jsonb_build_object('step', 32,
        'name', 'the invoice carries the business billing email from the organization',
        'passed', v_detail IS NOT NULL AND v_detail = v_billing_email,
        'detail', format('invoice %s, organization %s', COALESCE(v_detail, 'null'), v_billing_email));

      -- ----------------------------------------------------------
      -- Idempotency.
      -- ----------------------------------------------------------
      SELECT current_period_end INTO v_period_end FROM public.subscriptions WHERE org_id = v_org;

      v_ok := FALSE; v_detail := 'replay raised';
      BEGIN
        v_res := public.settle_verified_payment(
          v_ref,
          jsonb_build_object('org_id', v_org::TEXT,
            'metadata', jsonb_build_object('plan_version_id', v_version.id::TEXT), 'source', 'replay'),
          now(), 'test', 'staging', v_charge_minor / 100.0, v_version.currency, 'gateway-ref-1', 'webhook');
        v_ok := COALESCE((v_res->>'settled')::BOOLEAN, FALSE) AND COALESCE((v_res->>'already_settled')::BOOLEAN, FALSE);
        v_detail := format('settled=%s already_settled=%s', v_res->>'settled', v_res->>'already_settled');
      EXCEPTION WHEN OTHERS THEN
        v_detail := SQLERRM;
      END;
      v_results := v_results || jsonb_build_object('step', 33,
        'name', 'a webhook replaying a settled payment is idempotent, not an error',
        'passed', v_ok, 'detail', left(v_detail, 200));

      SELECT count(*) INTO v_n FROM public.billing_invoices i
      JOIN public.subscription_transactions t ON t.id = i.transaction_id WHERE t.reference = v_ref;
      SELECT count(*) INTO v_n2 FROM public.billing_receipts r
      JOIN public.subscription_transactions t ON t.id = r.transaction_id WHERE t.reference = v_ref;
      v_results := v_results || jsonb_build_object('step', 34,
        'name', 'the replay raised NO second invoice and NO second receipt',
        'passed', v_n = 1 AND v_n2 = 1, 'detail', format('%s invoice(s), %s receipt(s) after two settlements', v_n, v_n2));

      SELECT current_period_end INTO v_period_end_after FROM public.subscriptions WHERE org_id = v_org;
      v_results := v_results || jsonb_build_object('step', 35,
        'name', 'the replay did NOT extend the paid period',
        'passed', v_period_end_after IS NOT DISTINCT FROM v_period_end,
        'detail', format('%s before, %s after', v_period_end, v_period_end_after));

      SELECT settled_by INTO v_detail FROM public.subscription_transactions WHERE reference = v_ref;
      v_results := v_results || jsonb_build_object('step', 36,
        'name', 'the FIRST settlement path is the one recorded',
        'passed', v_detail = 'callback', 'detail', format('settled_by = %s', COALESCE(v_detail, 'null')));

      -- ----------------------------------------------------------
      -- Integrity failures still raise, and must be distinguishable from refusals.
      -- ----------------------------------------------------------
      v_ok := FALSE; v_detail := 'no error raised';
      BEGIN
        v_res := public.settle_verified_payment('zzgate-nonexistent-' || gen_random_uuid()::TEXT,
          '{}'::JSONB, now(), 'test', 'staging', 1, 'NGN', NULL, 'callback');
        v_detail := 'returned ' || COALESCE(v_res::TEXT, 'null');
      EXCEPTION WHEN OTHERS THEN
        v_ok := SQLERRM LIKE '%Transaction not found%';
        v_detail := SQLERRM;
      END;
      v_results := v_results || jsonb_build_object('step', 37,
        'name', 'a settlement for an UNKNOWN REFERENCE is an integrity error, not a quiet refusal',
        'passed', v_ok, 'detail', left(v_detail, 200));
    END IF;

    RAISE EXCEPTION 'ROLLBACK:PAYMENTGATE';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM <> 'ROLLBACK:PAYMENTGATE' THEN
        RAISE;
      END IF;
  END;

  IF array_length(v_results, 1) IS NOT NULL THEN
    FOR v_i IN 1..array_length(v_results, 1) LOOP
      INSERT INTO zz_payment_gate_results (step, check_name, passed, detail)
      VALUES ((v_results[v_i]->>'step')::INTEGER, v_results[v_i]->>'name',
              (v_results[v_i]->>'passed')::BOOLEAN, v_results[v_i]->>'detail');
    END LOOP;
  END IF;

  -- ----------------------------------------------------------
  -- The rollback held, and the production guard is still armed.
  -- ----------------------------------------------------------
  SELECT count(*) INTO v_n FROM public.subscriptions;
  INSERT INTO zz_payment_gate_results VALUES (50, 'no fixture subscription survived the rollback',
    v_n = v_before_subs, format('%s -> %s', v_before_subs, v_n));

  SELECT count(*) INTO v_n FROM public.organization_products;
  INSERT INTO zz_payment_gate_results VALUES (51, 'no fixture entitlement survived the rollback',
    v_n = v_before_ent, format('%s -> %s', v_before_ent, v_n));

  SELECT count(*) INTO v_n FROM public.billing_invoices;
  INSERT INTO zz_payment_gate_results VALUES (52, 'no fixture invoice survived the rollback',
    v_n = v_before_inv, format('%s -> %s', v_before_inv, v_n));

  SELECT count(*) INTO v_n FROM public.billing_receipts;
  INSERT INTO zz_payment_gate_results VALUES (53, 'no fixture receipt survived the rollback',
    v_n = v_before_rct, format('%s -> %s', v_before_rct, v_n));

  SELECT count(*) INTO v_n FROM public.subscription_transactions WHERE reference LIKE 'zzgate%';
  INSERT INTO zz_payment_gate_results VALUES (54, 'no fixture payment attempt survived the rollback',
    v_n = 0, format('%s attempt(s) named zzgate%%', v_n));

  SELECT t.tgenabled::TEXT INTO v_detail FROM pg_trigger t
  WHERE t.tgrelid = 'public.subscription_transactions'::regclass
    AND t.tgname = 'guard_subscription_payment_creation';
  INSERT INTO zz_payment_gate_results VALUES (55, 'the production payment guard is still armed',
    v_detail = 'O', format('trigger enabled state = %s (O means enabled)', COALESCE(v_detail, 'missing')));
END
$do$;

SELECT step, check_name,
  CASE passed WHEN TRUE THEN 'PASS' WHEN FALSE THEN 'FAIL' ELSE 'SKIP' END AS result,
  detail
FROM zz_payment_gate_results
ORDER BY step;
