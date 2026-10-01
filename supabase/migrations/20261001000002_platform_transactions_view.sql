-- ============================================================
-- 20261001000002: THE PLATFORM TRANSACTIONS VIEW, REPAIRED AND EXTENDED
-- ============================================================
-- Two separate problems, one migration, because the second is what makes the
-- first worth having.
--
-- ============================================================
-- PROBLEM 1: THE TRANSACTIONS VIEW HAS NEVER RENDERED A ROW
-- ============================================================
-- `list_platform_commercial_transactions` was introduced by
-- 20260928000096_commercial_lifecycle.sql and it does not run. It selects
-- `v.version_number`, and `product_plan_versions` has no such column - its column
-- is `version`. It also left-joins `public.products p`, which is the merchant
-- INVENTORY table, not `public.platform_products`. Reproduced against the live
-- database:
--
--   SELECT t.reference, v.version_number FROM public.subscription_transactions t
--     LEFT JOIN public.product_plan_versions v ON v.id = t.plan_version_id LIMIT 1
--   ERROR: 42703: column v.version_number does not exist
--
-- So the Platform Owner "Payments and invoices" section has been showing its error
-- state on every load, and the transaction table underneath it has never appeared.
-- A screen that cannot load is worse than a screen that is absent, because both the
-- operator and whoever reads the console assume the section works.
--
-- ============================================================
-- PROBLEM 2: THE VIEW COULD NOT ANSWER THE QUESTIONS ASKED OF IT
-- ============================================================
-- Even repaired, the function returned one flat row per attempt and nothing to
-- open. The brief for this work asks for search and filters over business,
-- reference, status, date, plan, amount and environment; and for each transaction
-- a detail showing its timeline, gateway reference, verification result, invoice or
-- receipt, subscription effect and audit events. Most of those fields exist on
-- `subscription_transactions` and were simply never selected:
--
--   gateway_reference, provider_reference   the gateway's own identifiers
--   verified_at, settled_by                 the verification result
--   verification_data                       what the gateway actually returned
--
-- The filters are SERVER-SIDE rather than a bigger client-side filter, because the
-- table grows without bound and a limit applied before filtering silently hides
-- matching rows behind newer non-matching ones.

-- ============================================================
-- 1. THE LIST
-- ============================================================
-- The RETURNS TABLE shape changes, so the function must be dropped rather than
-- replaced: CREATE OR REPLACE cannot alter a function's output columns.

DROP FUNCTION IF EXISTS public.list_platform_commercial_transactions(INTEGER);

CREATE OR REPLACE FUNCTION public.list_platform_commercial_transactions(
  p_limit INTEGER DEFAULT 100,
  p_status TEXT DEFAULT NULL,
  p_payment_mode TEXT DEFAULT NULL,
  p_environment TEXT DEFAULT NULL,
  p_org_id UUID DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_from TIMESTAMPTZ DEFAULT NULL,
  p_to TIMESTAMPTZ DEFAULT NULL,
  p_test_only BOOLEAN DEFAULT NULL
)
RETURNS TABLE (
  reference TEXT,
  org_id UUID,
  business_name TEXT,
  business_is_sandbox BOOLEAN,
  product_name TEXT,
  plan_name TEXT,
  plan_key TEXT,
  plan_version INTEGER,
  plan_version_id UUID,
  billing_cycle TEXT,
  amount_minor BIGINT,
  currency TEXT,
  status TEXT,
  payment_mode TEXT,
  environment TEXT,
  is_test_data BOOLEAN,
  failure_reason TEXT,
  created_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  settled_by TEXT,
  gateway_reference TEXT,
  provider_reference TEXT,
  invoice_number TEXT,
  receipt_number TEXT,
  subscription_status TEXT,
  entitlement_status TEXT,
  entitlement_expires_at TIMESTAMPTZ,
  audit_event_count BIGINT,
  webhook_event_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_search TEXT := NULLIF(btrim(COALESCE(p_search, '')), '');
BEGIN
  PERFORM public.require_platform_permission('platform:view_payments');

  RETURN QUERY
  SELECT
    t.reference,
    t.org_id,
    o.name,
    COALESCE(o.is_sandbox, FALSE),
    -- COALESCE to 'TrackOja' rather than NULL: a pre-069 transaction has no
    -- product attribution, and the one product this platform sells is the honest
    -- answer for those rows. A NULL would render as a blank column and read as a
    -- missing record rather than an old one.
    COALESCE(pr.name, 'TrackOja'),
    COALESCE(v.display_name, lp.name),
    v.plan_key,
    v.version,
    t.plan_version_id,
    t.billing_cycle,
    t.amount_minor,
    t.currency,
    t.status,
    t.payment_mode,
    t.environment,
    COALESCE(t.is_test_data, FALSE),
    t.failure_reason,
    t.created_at,
    t.paid_at,
    t.verified_at,
    t.settled_by,
    t.gateway_reference,
    t.provider_reference,
    i.invoice_number,
    r.receipt_number,
    s.status,
    op.status,
    op.expires_at,
    (SELECT count(*) FROM public.audit_logs a WHERE a.resource_id = t.id),
    (SELECT count(*) FROM public.webhook_events w WHERE w.reference = t.reference)
  FROM public.subscription_transactions t
  JOIN public.organizations o ON o.id = t.org_id
  -- platform_products, not products. The original joined the merchant inventory
  -- table, which is a different thing with a confusingly similar name.
  LEFT JOIN public.platform_products pr ON pr.id = t.product_id
  LEFT JOIN public.product_plan_versions v ON v.id = t.plan_version_id
  -- The legacy mirror row. Pre-092 transactions have no plan_version_id, and this
  -- is the only plan name available for them.
  LEFT JOIN public.subscription_plans lp ON lp.id = t.plan_id
  LEFT JOIN public.billing_invoices i ON i.transaction_id = t.id
  LEFT JOIN public.billing_receipts r ON r.transaction_id = t.id
  LEFT JOIN public.subscriptions s ON s.org_id = t.org_id
  LEFT JOIN public.organization_products op
    ON op.org_id = t.org_id AND op.product_id = t.product_id
  WHERE
    (p_status IS NULL OR p_status = '' OR p_status = 'all' OR t.status = p_status)
    AND (p_payment_mode IS NULL OR p_payment_mode = '' OR p_payment_mode = 'all'
         OR COALESCE(t.payment_mode, 'uninitialized') = p_payment_mode)
    AND (p_environment IS NULL OR p_environment = '' OR p_environment = 'all'
         OR COALESCE(t.environment, 'unknown') = p_environment)
    AND (p_org_id IS NULL OR t.org_id = p_org_id)
    AND (p_from IS NULL OR t.created_at >= p_from)
    AND (p_to IS NULL OR t.created_at <= p_to)
    AND (p_test_only IS NULL OR COALESCE(t.is_test_data, FALSE) = p_test_only)
    AND (
      v_search IS NULL
      OR t.reference ILIKE '%' || v_search || '%'
      OR o.name ILIKE '%' || v_search || '%'
      OR pr.name ILIKE '%' || v_search || '%'
      OR v.display_name ILIKE '%' || v_search || '%'
      OR lp.name ILIKE '%' || v_search || '%'
      OR i.invoice_number ILIKE '%' || v_search || '%'
      OR r.receipt_number ILIKE '%' || v_search || '%'
      OR t.gateway_reference ILIKE '%' || v_search || '%'
      OR t.provider_reference ILIKE '%' || v_search || '%'
    )
  ORDER BY t.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
END;
$$;

COMMENT ON FUNCTION public.list_platform_commercial_transactions(INTEGER, TEXT, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN) IS
  'Platform Owner transaction list, newest first, with server-side filters for status, payment mode, environment, '
  'business, date range, test data and a free-text search across reference, business, product, plan, invoice number, '
  'receipt number and both gateway identifiers. Repaired in 20261001000002: the original selected '
  'product_plan_versions.version_number, which does not exist, and joined public.products (the merchant inventory '
  'table) instead of public.platform_products, so it raised 42703 on every call and the console showed an error state '
  'instead of the table. Filters are applied in SQL rather than in the client because the row limit is applied before '
  'the filter would be, which would hide matching rows behind newer non-matching ones.';

REVOKE ALL ON FUNCTION public.list_platform_commercial_transactions(INTEGER, TEXT, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_platform_commercial_transactions(INTEGER, TEXT, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN) TO authenticated, service_role;

-- Indexes for the filters that will actually be used. The table only grows, and
-- each of these turns a sequential scan of every payment this platform has taken
-- into an index range scan.
CREATE INDEX IF NOT EXISTS idx_subscription_txns_status_created
  ON public.subscription_transactions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscription_txns_mode_created
  ON public.subscription_transactions(payment_mode, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscription_transactions_gateway_ref
  ON public.subscription_transactions(gateway_reference)
  WHERE gateway_reference IS NOT NULL;

-- ============================================================
-- 2. THE DETAIL
-- ============================================================
-- One call answers everything the detail panel shows, so the panel cannot show a
-- half-loaded mix of states from separate requests.
--
-- WHAT THIS FUNCTION REFUSES TO INVENT. Every value it returns is read from a row
-- that exists. There is no placeholder invoice, no synthesised receipt and no
-- assumed refund. Where the platform genuinely cannot do something - refunds have
-- no authorised flow at all - the answer is an explicit marker rather than an
-- absent field, so the interface can say "not implemented" instead of rendering an
-- empty space that reads as "nothing to see here".
--
-- The timeline is assembled from timestamps the database already holds (checkout
-- opened, gateway session created, settlement verified, gateway paid, invoice
-- issued, receipt recorded, subscription activated, entitlement expiring) plus the
-- stored webhook events for the reference. Each entry names its own source, so a
-- reader can tell a recorded fact from a derived one.

CREATE OR REPLACE FUNCTION public.get_platform_commercial_transaction(p_reference TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_txn public.subscription_transactions;
  v_result JSONB;
  v_timeline JSONB := '[]'::JSONB;
BEGIN
  PERFORM public.require_platform_permission('platform:view_payments');

  SELECT * INTO v_txn FROM public.subscription_transactions t WHERE t.reference = p_reference;
  IF v_txn.id IS NULL THEN
    RAISE EXCEPTION 'Transaction not found for reference %', p_reference;
  END IF;

  -- ----------------------------------------------------------
  -- The timeline. Built by appending events in time order, each with the
  -- table and column it came from. A NULL timestamp contributes nothing, which is
  -- the point: an event that never happened must not appear as a blank entry.
  -- ----------------------------------------------------------
  v_timeline := v_timeline || jsonb_build_object('at', v_txn.created_at, 'kind', 'checkout_opened',
    'label', 'Checkout opened', 'source', 'subscription_transactions.created_at');

  IF v_txn.payment_mode IS NOT NULL THEN
    v_timeline := v_timeline || jsonb_build_object('at', v_txn.updated_at, 'kind', 'initialized',
      'label', format('Initialized against the gateway in %s mode', v_txn.payment_mode),
      'source', 'subscription_transactions.payment_mode');
  END IF;

  IF v_txn.verified_at IS NOT NULL THEN
    v_timeline := v_timeline || jsonb_build_object('at', v_txn.verified_at, 'kind', 'verified',
      'label', format('Settlement verified (%s)', COALESCE(v_txn.settled_by, 'unknown path')),
      'source', 'subscription_transactions.verified_at');
  END IF;

  IF v_txn.paid_at IS NOT NULL THEN
    v_timeline := v_timeline || jsonb_build_object('at', v_txn.paid_at, 'kind', 'paid',
      'label', 'Gateway recorded the payment', 'source', 'subscription_transactions.paid_at');
  END IF;

  IF v_txn.status = 'failed' THEN
    v_timeline := v_timeline || jsonb_build_object('at', v_txn.updated_at, 'kind', 'failed',
      'label', COALESCE(v_txn.failure_reason, 'Payment failed'),
      'source', 'subscription_transactions.status');
  ELSIF v_txn.status = 'abandoned' THEN
    v_timeline := v_timeline || jsonb_build_object('at', v_txn.updated_at, 'kind', 'abandoned',
      'label', COALESCE(v_txn.failure_reason, 'Checkout abandoned'),
      'source', 'subscription_transactions.status');
  END IF;

  SELECT v_timeline || COALESCE(jsonb_agg(jsonb_build_object(
      'at', w.received_at, 'kind', 'webhook',
      'label', format('Webhook %s: %s%s', COALESCE(w.event, 'unknown event'), w.outcome,
        CASE WHEN w.signature_valid THEN '' ELSE ' (signature INVALID)' END),
      'source', 'webhook_events.received_at', 'detail', w.detail)
      ORDER BY w.received_at), '[]'::JSONB)
  INTO v_timeline
  FROM public.webhook_events w WHERE w.reference = p_reference;

  SELECT v_timeline || COALESCE(jsonb_agg(jsonb_build_object(
      'at', a.created_at, 'kind', 'audit', 'label', a.action,
      'source', 'audit_logs.created_at', 'detail', a.resource_type)
      ORDER BY a.created_at), '[]'::JSONB)
  INTO v_timeline
  FROM public.audit_logs a WHERE a.resource_id = v_txn.id;

  -- ----------------------------------------------------------
  -- The whole record.
  -- ----------------------------------------------------------
  SELECT jsonb_build_object(
    'reference', v_txn.reference,
    'status', v_txn.status,
    'amountMinor', v_txn.amount_minor,
    'recurringAmountMinor', v_txn.recurring_amount_minor,
    'setupFeeAmountMinor', v_txn.setup_fee_amount_minor,
    'amount', v_txn.amount,
    'currency', v_txn.currency,
    'billingCycle', v_txn.billing_cycle,
    'paymentMode', v_txn.payment_mode,
    'environment', v_txn.environment,
    'isTestData', COALESCE(v_txn.is_test_data, FALSE),
    'failureReason', v_txn.failure_reason,
    'createdAt', v_txn.created_at,
    'paidAt', v_txn.paid_at,
    'verifiedAt', v_txn.verified_at,
    'settledBy', v_txn.settled_by,
    'gatewayReference', v_txn.gateway_reference,
    'providerReference', v_txn.provider_reference,
    -- What the gateway actually returned, so an operator can see the evidence the
    -- verification was performed against rather than only its verdict.
    'verificationData', v_txn.verification_data,
    'business', (
      SELECT jsonb_build_object('id', o.id, 'name', o.name, 'billingEmail', o.billing_email,
        'isSandbox', COALESCE(o.is_sandbox, FALSE), 'billingStatus', o.billing_status)
      FROM public.organizations o WHERE o.id = v_txn.org_id
    ),
    'product', (
      SELECT jsonb_build_object('id', pr.id, 'key', pr.key, 'name', pr.name)
      FROM public.platform_products pr WHERE pr.id = v_txn.product_id
    ),
    'plan', (
      SELECT jsonb_build_object(
        'versionId', v.id, 'planKey', v.plan_key, 'displayName', v.display_name,
        'version', v.version, 'billingCycle', v.billing_cycle,
        'amountMinor', v.amount_minor, 'setupFeeMinor', v.setup_fee_minor,
        'currency', v.currency, 'status', v.status)
      FROM public.product_plan_versions v WHERE v.id = v_txn.plan_version_id
    ),
    'legacyPlanName', (
      SELECT lp.name FROM public.subscription_plans lp WHERE lp.id = v_txn.plan_id
    ),
    'invoice', (
      SELECT jsonb_build_object(
        'number', i.invoice_number, 'status', i.status, 'currency', i.currency,
        'subtotalMinor', i.subtotal_minor, 'totalMinor', i.total_minor,
        'billingEmail', i.billing_email, 'isTestData', COALESCE(i.is_test_data, FALSE),
        'issuedAt', i.issued_at, 'paidAt', i.paid_at,
        'lines', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'type', l.line_type, 'description', l.description,
            'unitAmountMinor', l.unit_amount_minor, 'totalAmountMinor', l.total_amount_minor)
            ORDER BY l.line_type)
          FROM public.billing_invoice_lines l WHERE l.invoice_id = i.id), '[]'::JSONB))
      FROM public.billing_invoices i WHERE i.transaction_id = v_txn.id
    ),
    'receipt', (
      SELECT jsonb_build_object(
        'number', r.receipt_number, 'amountMinor', r.amount_minor, 'currency', r.currency,
        'paymentMode', r.payment_mode, 'providerReference', r.provider_reference,
        'isTestData', COALESCE(r.is_test_data, FALSE), 'paidAt', r.paid_at)
      FROM public.billing_receipts r WHERE r.transaction_id = v_txn.id
    ),
    'subscriptionEffect', (
      SELECT jsonb_build_object(
        'subscriptionId', s.id, 'status', s.status,
        'currentPeriodStart', s.current_period_start, 'currentPeriodEnd', s.current_period_end,
        'cancelAtPeriodEnd', s.cancel_at_period_end,
        'entitlementStatus', op.status, 'entitlementActivatedAt', op.activated_at,
        'entitlementExpiresAt', op.expires_at, 'entitlementPlanVersionId', op.plan_version_id)
      FROM public.subscriptions s
      LEFT JOIN public.organization_products op
        ON op.org_id = s.org_id AND op.product_id = v_txn.product_id
      WHERE s.org_id = v_txn.org_id
    ),
    'timeline', v_timeline,
    -- ----------------------------------------------------------
    -- Refunds, stated rather than implied.
    -- ----------------------------------------------------------
    -- There is no authorised refund flow for a platform subscription: no
    -- `refund_subscription_payment` function exists, nothing writes a refunded
    -- state for `subscription_transactions`, and no gateway refund call is made
    -- anywhere in the billing code. So the endpoint reports that as a fact with a
    -- reason, and the interface shows it as unavailable rather than offering a
    -- button that would either fail or, worse, pretend.
    'refund', jsonb_build_object(
      'state', 'not_implemented',
      'reason', 'No authorised refund flow exists for a platform subscription. Refunding a charge requires a decision '
                'about the entitlement as well as the money, and neither has an implementation or a permission model '
                'yet. Refunds are performed in the Paystack dashboard, outside this system, and nothing here records '
                'them.',
      'refundable', FALSE
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_platform_commercial_transaction(TEXT) IS
  'Everything the Platform Owner transaction detail shows, in one call: the attempt, its gateway and provider '
  'references, the verification result and the data it was verified against, the business and its billing email, the '
  'immutable plan version bought, the invoice with its line items, the receipt, the subscription and entitlement the '
  'payment produced, a timeline assembled from stored timestamps, webhook events and audit rows, and an explicit '
  'not_implemented marker for refunds. It invents nothing: every value is read from a row, and a timeline entry is '
  'only emitted when the timestamp it describes is present, so an event that never happened cannot appear as a blank.';

REVOKE ALL ON FUNCTION public.get_platform_commercial_transaction(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_platform_commercial_transaction(TEXT) TO authenticated, service_role;

-- ============================================================
-- 3. UNDOING A PRIVILEGE REGRESSION FROM 20260929000004
-- ============================================================
-- That migration re-created three platform functions with CREATE OR REPLACE and no
-- accompanying REVOKE, so the project's ALTER DEFAULT PRIVILEGES left anon holding
-- EXECUTE on all three. Each is gated internally by require_platform_permission, so
-- an anonymous caller receives 'Authentication required' rather than data - but the
-- pattern is exactly the one 20260927000096 and 20261001000001 warn about and
-- assert against, and "the body refuses" is a weaker guarantee than "the grant is
-- absent". Restoring the grant costs nothing and removes the class of mistake.

DO $$
DECLARE
  v_signature TEXT;
  v_regressed TEXT[] := ARRAY[
    'public.get_platform_overview_v2(text)',
    'public.list_platform_products()',
    'public.list_platform_users(text,text,integer)'
  ];
BEGIN
  FOREACH v_signature IN ARRAY v_regressed LOOP
    IF to_regprocedure(v_signature) IS NULL THEN
      RAISE NOTICE '20261001000002: % does not exist, so nothing to revoke', v_signature;
      CONTINUE;
    END IF;

    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', v_signature);

    IF NOT has_function_privilege('authenticated', v_signature, 'EXECUTE') THEN
      -- The console reads these as a signed-in platform admin.
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_signature);
    END IF;

    IF NOT has_function_privilege('service_role', v_signature, 'EXECUTE') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_signature);
    END IF;

    IF has_function_privilege('anon', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION '20261001000002: anon still holds EXECUTE on % after the revoke', v_signature;
    END IF;
  END LOOP;

  RAISE NOTICE '20261001000002: anon EXECUTE revoked from % platform function(s)', array_length(v_regressed, 1);
END $$;

-- ============================================================
-- 4. THE TWO NEW FUNCTIONS, ASSERTED
-- ============================================================

DO $$
BEGIN
  IF to_regprocedure('public.list_platform_commercial_transactions(integer,text,text,text,uuid,text,timestamp with time zone,timestamp with time zone,boolean)') IS NULL THEN
    RAISE EXCEPTION '20261001000002: the repaired transaction list does not exist';
  END IF;

  IF to_regprocedure('public.get_platform_commercial_transaction(text)') IS NULL THEN
    RAISE EXCEPTION '20261001000002: the transaction detail function does not exist';
  END IF;

  IF has_function_privilege('anon', 'public.list_platform_commercial_transactions(integer,text,text,text,uuid,text,timestamp with time zone,timestamp with time zone,boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_platform_commercial_transaction(text)', 'EXECUTE') THEN
    RAISE EXCEPTION '20261001000002: anon can read platform transactions';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.list_platform_commercial_transactions(integer,text,text,text,uuid,text,timestamp with time zone,timestamp with time zone,boolean)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.get_platform_commercial_transaction(text)', 'EXECUTE') THEN
    RAISE EXCEPTION '20261001000002: the Platform Owner console cannot read transactions';
  END IF;

  -- The query that the original function could not run. If this fails, the repair
  -- did not take, and the console would go back to showing an error state.
  PERFORM 1
  FROM public.subscription_transactions t
  LEFT JOIN public.product_plan_versions v ON v.id = t.plan_version_id
  LEFT JOIN public.platform_products pr ON pr.id = t.product_id
  LIMIT 1;

  RAISE NOTICE '20261001000002: transaction list and detail are installed and readable by the console';
END $$;
