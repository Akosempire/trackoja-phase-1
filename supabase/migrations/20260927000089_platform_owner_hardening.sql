-- Migration: 089_platform_owner_hardening.sql
-- Description: Hardens the platform layer so the Platform Owner dashboard is
--   correct and enforceable. Ten defects are closed here, each one confirmed by
--   reading the migrations that introduced it:
--
--   1. is_platform_admin(uuid) read only the legacy users.is_platform_admin
--      column, so an admin appointed through platform_admins could call the
--      permission-gated RPCs but was blocked by the RLS SELECT policy on every
--      platform table. It now honours either source.
--   2. activate_subscription wrote subscriptions, organizations and
--      subscription_transactions but never organization_products - the
--      entitlement table every platform metric and the seat-limit trigger read -
--      so a customer who paid stayed 'pending' forever. It now activates the
--      matching entitlement from the transaction's own product.
--   3. create_audit_log and log_activity were created with no GRANT or REVOKE,
--      which in PostgreSQL means EXECUTE TO PUBLIC: any anonymous caller could
--      forge audit_logs and activity_logs rows, including a fake actor_id.
--   4. block_writes_while_impersonating() existed but was attached to no table,
--      so "read-only impersonation" was a UI convention rather than a guarantee.
--   5. platform_admins.level had no 'finance_operator', and
--      platform_permissions.category had no 'integrations', 'health' or 'audit'.
--   6. Read and write were not separable in the permission catalogue, and the
--      payments/health/audit/integrations areas had no key at all.
--   7. Platform actions left no audit trail.
--   8. There was no endpoint that could browse platform-scoped audit rows:
--      audit_logs.org_id IS NULL rows are invisible to every RLS policy.
--   9. get_platform_revenue_summary and get_platform_revenue_by_plan predate
--      subscription_transactions.is_sandbox and double-counted sandbox rows.
--  10. product_plans had no billing-cycle concept, so nothing could say which
--      cycle a customer is on.
--
--   Every statement is idempotent: the migration can be re-run against the same
--   database without error.
-- Author: TrackOja Team
-- Date: 2026-09-27

-- ============================================================
-- 1. is_platform_admin HONOURS platform_admins
-- ============================================================
-- Two sources of platform identity exist: the legacy users.is_platform_admin
-- flag (034) and the explicit platform_admins roster (067). The RLS SELECT policy
-- on every platform table and the legacy Phase-7 dashboard RPCs call this helper,
-- so when it read only the legacy column an admin appointed through
-- platform_admins could pass platform_user_has_permission() and then be refused
-- by RLS on the very rows they were asked to read.
--
-- The signature, STABLE volatility, SECURITY DEFINER and search_path are
-- unchanged, so no dependent policy or function has to be recreated. The
-- explicit roster is authoritative: only an 'active' platform_admins row counts,
-- so suspending or revoking an admin withdraws read access immediately.

CREATE OR REPLACE FUNCTION public.is_platform_admin(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_legacy BOOLEAN;
  v_roster BOOLEAN;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT u.is_platform_admin INTO v_legacy
  FROM public.users u
  WHERE u.id = p_user_id;

  IF COALESCE(v_legacy, FALSE) THEN
    RETURN TRUE;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.platform_admins pa
    WHERE pa.user_id = p_user_id
      AND pa.status = 'active'
  ) INTO v_roster;

  RETURN COALESCE(v_roster, FALSE);
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_platform_admin(UUID) TO authenticated;

COMMENT ON FUNCTION public.is_platform_admin(UUID) IS
  'TRUE when the user holds the legacy users.is_platform_admin flag OR an active platform_admins row. '
  'Gates the RLS SELECT policy on every platform table, so it must honour both sources of platform identity.';

-- ============================================================
-- 2. activate_subscription CREATES THE ENTITLEMENT
-- ============================================================
-- organization_products is the entitlement boundary: get_platform_overview_v2,
-- the seat-limit trigger and every per-business access check read it, while
-- subscriptions/organizations are the legacy billing view. A verified payment
-- used to update only the legacy tables, so a paying customer's entitlement
-- stayed 'pending' and the platform reported them as never having paid.
--
-- The entitlement now comes from the transaction's own attribution:
--   * product_id: the transaction's product, falling back to the 'trackoja'
--     product for legacy rows created before 069 added the column. A payment
--     that cannot be attributed to any product raises instead of silently
--     leaving the business unentitled - a paid customer must never be stuck.
--   * plan_id and the agreed snapshot: resolved from the matching product_plans
--     row (product + the legacy plan's key or name, case-insensitively). When no
--     product plan matches there is no agreed price to record, so those snapshot
--     columns stay NULL rather than being invented.
--   * expires_at: the new subscriptions.current_period_end.
-- Idempotency is preserved: an already-successful transaction returns the
-- existing subscription untouched and writes no second entitlement
-- (UNIQUE(org_id, product_id) is handled with ON CONFLICT DO UPDATE).
--
-- Signature, return type and the service_role-only REVOKE are unchanged.

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
    v_subscription.current_period_end,
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
  'entitlement that platform metrics and the seat-limit trigger read. Idempotent per transaction reference.';

-- ============================================================
-- 3. AUDIT AND ACTIVITY HELPERS ARE NO LONGER PUBLIC
-- ============================================================
-- 005 created both helpers without any GRANT or REVOKE. PostgreSQL grants EXECUTE
-- on a new function to PUBLIC by default, so an anonymous caller could invoke
-- create_audit_log directly and forge an audit row - including its actor_id and
-- org_id - and could inject arbitrary activity_logs rows. Both helpers are
-- SECURITY DEFINER, so the forged row bypassed the (INSERT-denying) RLS policies
-- on the two tables entirely.
--
-- Neither helper is meant to be called by a client: every caller is a SECURITY
-- DEFINER function that already runs as the owner and therefore needs no grant.
-- service_role keeps EXECUTE for server-side automation.

REVOKE ALL ON FUNCTION public.create_audit_log(UUID, UUID, UUID, TEXT, TEXT, UUID, TEXT, JSONB, JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_activity(UUID, UUID, UUID, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_audit_log(UUID, UUID, UUID, TEXT, TEXT, UUID, TEXT, JSONB, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.log_activity(UUID, UUID, UUID, TEXT, TEXT, JSONB) TO service_role;

COMMENT ON FUNCTION public.create_audit_log(UUID, UUID, UUID, TEXT, TEXT, UUID, TEXT, JSONB, JSONB) IS
  'Internal audit writer. Not executable by anon or authenticated: audit rows must never be forgeable by a caller.';
COMMENT ON FUNCTION public.log_activity(UUID, UUID, UUID, TEXT, TEXT, JSONB) IS
  'Internal activity writer. Not executable by anon or authenticated: activity rows must never be forgeable by a caller.';

-- ============================================================
-- 4. READ-ONLY IMPERSONATION IS ENFORCED BY TRIGGERS
-- ============================================================
-- 065 declared block_writes_while_impersonating() and its comment promised that
-- business writes are refused during an active support session, but the trigger
-- was never attached to a table: the guarantee did not exist. Every tenant
-- business table a read-only session must not modify now carries a BEFORE
-- INSERT OR UPDATE OR DELETE trigger. The function's own predicate is unchanged -
-- it raises only when the caller is impersonating, authenticated, and not a
-- platform admin.
--
-- The trigger is named identically on every table and fires first (before
-- handle_updated_at and the audit triggers), so a refused write costs nothing.
-- Idempotent: each trigger is dropped before it is created.
--
-- Note for operators: a service_role webhook has no auth.uid(), so it is never
-- blocked; and a platform admin who is impersonating is exempt by the function's
-- own predicate. Tenant staff who are not platform admins can never hold an
-- impersonation session, so the guard bites for exactly one transient case: an
-- admin whose platform_admins row was suspended while their session was live.

DO $$
DECLARE
  v_tables TEXT[] := ARRAY[
    'sales', 'sale_items', 'sale_payments', 'products', 'product_variants',
    'product_categories', 'customers', 'inventory_movements', 'stock_lots',
    'stores', 'store_members', 'organization_members', 'organizations',
    'expenses', 'suppliers', 'purchases', 'tailoring_jobs', 'material_quotes',
    'refunds', 'devices'
  ];
  v_table TEXT;
  v_attached INTEGER := 0;
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    IF to_regclass('public.' || quote_ident(v_table)) IS NULL THEN
      RAISE EXCEPTION 'Cannot attach the impersonation write guard to public.%: the table does not exist', v_table;
    END IF;

    EXECUTE format('DROP TRIGGER IF EXISTS block_writes_while_impersonating ON public.%I', v_table);

    EXECUTE format(
      'CREATE TRIGGER block_writes_while_impersonating '
      'BEFORE INSERT OR UPDATE OR DELETE ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.block_writes_while_impersonating()',
      v_table
    );

    v_attached := v_attached + 1;
  END LOOP;

  RAISE NOTICE 'Read-only impersonation guard attached to % tenant business tables', v_attached;
END $$;

-- ============================================================
-- 5. FINANCE OPERATOR LEVEL AND NEW PERMISSION CATEGORIES
-- ============================================================
-- A finance operator is a narrower role than a platform admin: it exists so
-- billing and revenue work can be delegated without handing over products,
-- businesses or users. The level had no such value, so the role could not be
-- represented at all. The three new categories exist for the same reason: the
-- dashboard's integrations, health and audit areas had no category to live in.
--
-- Both constraints are dropped and recreated so the allowed sets are explicit
-- and reviewable rather than appended by guesswork. Both tables are tiny
-- (single-digit rows), so the validating rewrite is instantaneous.

ALTER TABLE public.platform_admins DROP CONSTRAINT IF EXISTS platform_admins_level_check;
ALTER TABLE public.platform_admins
  ADD CONSTRAINT platform_admins_level_check
  CHECK (level IN ('super_admin', 'admin', 'support', 'developer', 'finance_operator'));

ALTER TABLE public.platform_permissions DROP CONSTRAINT IF EXISTS platform_permissions_category_check;
ALTER TABLE public.platform_permissions
  ADD CONSTRAINT platform_permissions_category_check
  CHECK (category IN ('overview', 'products', 'businesses', 'users', 'plans',
                      'payments', 'activation', 'support', 'settings', 'developer',
                      'integrations', 'health', 'audit'));

COMMENT ON COLUMN public.platform_admins.level IS
  'super_admin = manage admins and developer mode; admin = products/plans/businesses; support = read + notes; '
  'developer = diagnostics only; finance_operator = payments, revenue and subscription adjustments.';
COMMENT ON COLUMN public.platform_permissions.category IS
  'Catalogue grouping used by the dashboard. integrations, health and audit cover the platform operations areas.';

-- ============================================================
-- 6. PERMISSION KEYS: READ/WRITE SEPARATION AND NEW AREAS
-- ============================================================
-- platform:manage_payments held both watching revenue and moving money, so the
-- two could not be granted apart. Nothing is granted automatically here: a
-- super admin holds every permission by short-circuit in
-- platform_user_has_permission(), and every other admin must be granted a key
-- explicitly through set_platform_admin_permission().

INSERT INTO public.platform_permissions (key, label, description, category) VALUES
  ('platform:view_payments',        'View payments and revenue', 'See transactions, revenue totals, and payment history without changing them', 'payments'),
  ('platform:manage_subscriptions', 'Manage subscriptions',      'Adjust expiry, plans, seats, and pricing on a business subscription',           'payments'),
  ('platform:manage_integrations',  'Manage integrations',       'Configure payment and messaging integrations and their non-secret settings',   'integrations'),
  ('platform:view_health',          'View system health',        'See failure counters, payment health, and platform operational status',        'health'),
  ('platform:view_audit',           'View audit logs',           'Browse the platform audit trail, including platform-scoped events',            'audit'),
  ('platform:manage_tickets',       'Manage support tickets',    'Record support actions and admin notes and manage the support queue',          'support')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 7. PLATFORM ACTIONS WRITE AN AUDIT ROW
-- ============================================================
-- Issuing an activation key, revoking one, adjusting a subscription, changing a
-- platform setting, editing a notification template and adding a support note
-- all changed platform state without leaving a trace in audit_logs - so a
-- reviewer could see the resulting row but never who changed it or what it was
-- before. Each function below now writes one audit row after its mutation has
-- succeeded, through public.create_audit_log() so the row is shaped like every
-- other audit event in the platform.
--
--   * org_id is NULL for platform-scoped events (keys, settings, templates) and
--     the business's own id where the action concerns one business (support
--     notes, subscription adjustments, a key bound to a business).
--   * Nothing that could be a credential or a usable secret is recorded: an
--     activation key is stored masked to its last four characters, and a template
--     body and support-note body are deliberately not copied into the audit row.
--   * No signature changes: every function keeps its exact argument list and
--     return type, so no caller or GRANT has to change.

-- ------------------------------------------------------------
-- 7.1 issue_activation_key -> ACTIVATION_KEY_ISSUED
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_activation_key(
  p_product_key TEXT,
  p_plan_key TEXT DEFAULT NULL,
  p_org_id UUID DEFAULT NULL,
  p_valid_days INTEGER DEFAULT 365,
  p_payment_reference TEXT DEFAULT NULL,
  p_is_sandbox BOOLEAN DEFAULT FALSE
)
RETURNS public.activation_keys
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := public.require_platform_permission('platform:manage_activation');
  v_product public.platform_products;
  v_plan public.product_plans;
  v_org public.organizations;
  v_random TEXT;
  v_key_code TEXT;
  v_key public.activation_keys;
BEGIN
  IF p_product_key IS NULL OR btrim(p_product_key) = '' THEN
    RAISE EXCEPTION 'A product key is required to issue an activation key';
  END IF;

  IF p_valid_days IS NULL OR p_valid_days < 1 OR p_valid_days > 3650 THEN
    RAISE EXCEPTION 'Validity must be between 1 and 3650 days';
  END IF;

  -- Sandbox records are developer-mode only, exactly like every other sandbox surface.
  IF p_is_sandbox AND NOT public.developer_mode_enabled(auth.uid()) THEN
    RAISE EXCEPTION 'Developer mode is required to issue sandbox activation keys';
  END IF;

  SELECT * INTO v_product
  FROM public.platform_products
  WHERE key = btrim(p_product_key);

  IF v_product.id IS NULL THEN
    RAISE EXCEPTION 'Unknown product: %', p_product_key;
  END IF;

  IF p_plan_key IS NOT NULL AND btrim(p_plan_key) <> '' THEN
    SELECT * INTO v_plan
    FROM public.product_plans
    WHERE product_id = v_product.id AND key = btrim(p_plan_key);

    IF v_plan.id IS NULL THEN
      IF EXISTS (SELECT 1 FROM public.product_plans WHERE key = btrim(p_plan_key)) THEN
        RAISE EXCEPTION 'Plan % belongs to a different product and cannot be issued for %', p_plan_key, v_product.key;
      END IF;
      RAISE EXCEPTION 'Unknown plan % for product %', p_plan_key, v_product.key;
    END IF;
  END IF;

  IF p_org_id IS NOT NULL THEN
    SELECT * INTO v_org
    FROM public.organizations
    WHERE id = p_org_id;

    IF v_org.id IS NULL THEN
      RAISE EXCEPTION 'Unknown business: %', p_org_id;
    END IF;

    IF p_is_sandbox <> v_org.is_sandbox THEN
      RAISE EXCEPTION 'A sandbox key can only be bound to a sandbox business, and a live key only to a live business';
    END IF;
  END IF;

  -- Opaque, groupable code. Nothing about the product, plan, business, price, or
  -- payment is encoded in it, so a printed key discloses nothing on its own.
  v_random := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
  v_key_code := 'TOJA-' || substr(v_random, 1, 4) || '-' || substr(v_random, 5, 4) || '-' || substr(v_random, 9, 4);

  INSERT INTO public.activation_keys (
    key_code, product_id, plan_id, org_id, status, valid_from, valid_until,
    user_limit, currency, payment_reference, issued_by, is_sandbox, metadata
  ) VALUES (
    v_key_code, v_product.id, v_plan.id, p_org_id, 'issued', now(),
    now() + (p_valid_days * INTERVAL '1 day'),
    v_plan.user_limit,
    COALESCE(v_plan.currency, 'NGN'),
    p_payment_reference,
    v_actor,
    p_is_sandbox,
    jsonb_build_object('issued_product_key', v_product.key, 'issued_plan_key', v_plan.key)
  )
  RETURNING * INTO v_key;

  INSERT INTO public.activation_key_events (key_id, event_type, actor_id, note, metadata)
  VALUES (
    v_key.id, 'issued', v_actor, 'Activation key issued',
    jsonb_build_object('product_key', v_product.key, 'plan_key', v_plan.key, 'valid_days', p_valid_days)
  );

  -- The full key code is never copied into the audit trail: only its last four
  -- characters, which is enough to identify the key without disclosing it.
  PERFORM public.create_audit_log(
    v_actor,
    p_org_id,
    NULL,
    'ACTIVATION_KEY_ISSUED',
    'activation_key',
    v_key.id,
    '••••-••••-' || right(v_key.key_code, 4),
    NULL,
    jsonb_build_object(
      'product_key', v_product.key,
      'plan_key', v_plan.key,
      'valid_days', p_valid_days,
      'valid_until', v_key.valid_until,
      'user_limit', v_key.user_limit,
      'is_sandbox', v_key.is_sandbox,
      'bound_org_id', p_org_id
    )
  );

  RETURN v_key;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_activation_key(TEXT, TEXT, UUID, INTEGER, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_activation_key(TEXT, TEXT, UUID, INTEGER, TEXT, BOOLEAN) TO authenticated;

-- ------------------------------------------------------------
-- 7.2 revoke_activation_key -> ACTIVATION_KEY_REVOKED
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revoke_activation_key(p_key_id UUID, p_reason TEXT)
RETURNS public.activation_keys
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := public.require_platform_permission('platform:manage_activation');
  v_reason TEXT := btrim(COALESCE(p_reason, ''));
  v_previous_status TEXT;
  v_key public.activation_keys;
BEGIN
  IF p_key_id IS NULL THEN
    RAISE EXCEPTION 'An activation key id is required';
  END IF;

  SELECT * INTO v_key
  FROM public.activation_keys
  WHERE id = p_key_id
  FOR UPDATE;

  IF v_key.id IS NULL THEN
    RAISE EXCEPTION 'Unknown activation key: %', p_key_id;
  END IF;

  IF v_key.status = 'revoked' THEN
    RAISE EXCEPTION 'That activation key is already revoked';
  END IF;

  v_previous_status := v_key.status;

  -- A redeemed key can still be revoked, but only with a recorded reason: it has
  -- already granted access, so the decision must be explainable later.
  IF v_previous_status = 'redeemed' AND v_reason = '' THEN
    RAISE EXCEPTION 'A reason is required to revoke an activation key that has already been redeemed';
  END IF;

  UPDATE public.activation_keys
  SET status = 'revoked',
      revoked_at = now(),
      revoked_by = v_actor,
      revoke_reason = NULLIF(v_reason, '')
  WHERE id = v_key.id
  RETURNING * INTO v_key;

  INSERT INTO public.activation_key_events (key_id, event_type, actor_id, note, metadata)
  VALUES (
    v_key.id, 'revoked', v_actor,
    COALESCE(NULLIF(v_reason, ''), 'Activation key revoked'),
    jsonb_build_object('previous_status', v_previous_status)
  );

  PERFORM public.create_audit_log(
    v_actor,
    v_key.org_id,
    NULL,
    'ACTIVATION_KEY_REVOKED',
    'activation_key',
    v_key.id,
    '••••-••••-' || right(v_key.key_code, 4),
    jsonb_build_object('previous_status', v_previous_status, 'new_status', v_key.status),
    jsonb_build_object(
      'reason', NULLIF(v_reason, ''),
      'revoked_at', v_key.revoked_at,
      'is_sandbox', v_key.is_sandbox
    )
  );

  RETURN v_key;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_activation_key(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_activation_key(UUID, TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 7.3 add_support_note -> SUPPORT_NOTE_ADDED
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_support_note(
  p_org_id UUID,
  p_body TEXT,
  p_note_type TEXT DEFAULT 'note',
  p_product_key TEXT DEFAULT NULL
)
RETURNS public.platform_support_notes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := public.require_platform_permission('platform:support');
  v_body TEXT := btrim(COALESCE(p_body, ''));
  v_note_type TEXT := COALESCE(NULLIF(btrim(COALESCE(p_note_type, '')), ''), 'note');
  v_org public.organizations;
  v_product_id UUID;
  v_note public.platform_support_notes;
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'A business is required';
  END IF;

  IF v_body = '' THEN
    RAISE EXCEPTION 'A support note body is required';
  END IF;

  IF v_note_type NOT IN ('note', 'support_action', 'suspension', 'reinstatement',
                         'manual_activation', 'pricing_change', 'contact', 'developer_test') THEN
    RAISE EXCEPTION 'Unsupported note type: %', p_note_type;
  END IF;

  SELECT * INTO v_org
  FROM public.organizations
  WHERE id = p_org_id;

  IF v_org.id IS NULL THEN
    RAISE EXCEPTION 'Unknown business: %', p_org_id;
  END IF;

  IF p_product_key IS NOT NULL AND btrim(p_product_key) <> '' THEN
    SELECT id INTO v_product_id
    FROM public.platform_products
    WHERE key = btrim(p_product_key);

    IF v_product_id IS NULL THEN
      RAISE EXCEPTION 'Unknown product: %', p_product_key;
    END IF;
  END IF;

  INSERT INTO public.platform_support_notes (
    org_id, product_id, admin_user_id, note_type, body, is_sandbox, metadata
  ) VALUES (
    v_org.id, v_product_id, v_actor, v_note_type, v_body, v_org.is_sandbox,
    jsonb_build_object('product_key', p_product_key)
  )
  RETURNING * INTO v_note;

  -- The note body itself is not copied into the audit row: the note is already
  -- visible on the business timeline, and the audit trail records that it exists
  -- and who wrote it.
  PERFORM public.create_audit_log(
    v_actor,
    v_org.id,
    NULL,
    'SUPPORT_NOTE_ADDED',
    'platform_support_note',
    v_note.id,
    v_note_type,
    NULL,
    jsonb_build_object(
      'note_type', v_note_type,
      'product_key', p_product_key,
      'body_length', length(v_body),
      'is_sandbox', v_note.is_sandbox
    )
  );

  RETURN v_note;
END;
$$;

REVOKE ALL ON FUNCTION public.add_support_note(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_support_note(UUID, TEXT, TEXT, TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 7.4 record_subscription_adjustment -> SUBSCRIPTION_ADJUSTED
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_subscription_adjustment(
  p_org_id UUID,
  p_adjustment_type TEXT,
  p_product_key TEXT DEFAULT NULL,
  p_new_plan_key TEXT DEFAULT NULL,
  p_new_expires_at TIMESTAMPTZ DEFAULT NULL,
  p_new_user_limit INTEGER DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS public.subscription_adjustments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := public.require_platform_permission('platform:manage_payments');
  v_type TEXT := lower(btrim(COALESCE(p_adjustment_type, '')));
  v_reason TEXT := btrim(COALESCE(p_reason, ''));
  v_plan_key TEXT := NULLIF(btrim(COALESCE(p_new_plan_key, '')), '');
  v_product_key TEXT := NULLIF(btrim(COALESCE(p_product_key, '')), '');
  v_org public.organizations;
  v_product public.platform_products;
  v_plan public.product_plans;
  v_ent public.organization_products;
  v_adjustment public.subscription_adjustments;
  v_previous JSONB;
  v_new JSONB;
  v_plan_key_result TEXT;
  v_count BIGINT;
  v_created BOOLEAN := FALSE;
  v_note_type TEXT;
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'A business is required';
  END IF;

  IF length(v_reason) < 5 THEN
    RAISE EXCEPTION 'A reason of at least 5 characters is required for every subscription adjustment';
  END IF;

  IF v_type NOT IN ('extend_expiry', 'shorten_expiry', 'change_plan', 'upgrade', 'downgrade',
                    'suspend', 'reinstate', 'cancel', 'reactivate', 'manual_activation',
                    'manual_price', 'seat_change') THEN
    RAISE EXCEPTION 'Unsupported adjustment type: %', p_adjustment_type;
  END IF;

  SELECT * INTO v_org
  FROM public.organizations
  WHERE id = p_org_id;

  IF v_org.id IS NULL THEN
    RAISE EXCEPTION 'Unknown business: %', p_org_id;
  END IF;

  -- Find the entitlement row this adjustment applies to.
  IF v_product_key IS NOT NULL THEN
    SELECT * INTO v_product
    FROM public.platform_products
    WHERE key = v_product_key;

    IF v_product.id IS NULL THEN
      RAISE EXCEPTION 'Unknown product: %', p_product_key;
    END IF;

    SELECT * INTO v_ent
    FROM public.organization_products
    WHERE org_id = p_org_id AND product_id = v_product.id
    FOR UPDATE;
  ELSE
    SELECT count(*) INTO v_count
    FROM public.organization_products
    WHERE org_id = p_org_id;

    IF v_count = 0 THEN
      RAISE EXCEPTION 'This business has no product subscription yet; supply a product key to record a manual activation';
    END IF;

    IF v_count > 1 THEN
      RAISE EXCEPTION 'This business subscribes to more than one product; a product key is required';
    END IF;

    SELECT * INTO v_ent
    FROM public.organization_products
    WHERE org_id = p_org_id
    FOR UPDATE;

    SELECT * INTO v_product
    FROM public.platform_products
    WHERE id = v_ent.product_id;
  END IF;

  IF v_ent.id IS NULL THEN
    IF v_type IN ('manual_activation', 'reactivate') THEN
      v_created := TRUE;
    ELSE
      RAISE EXCEPTION 'This business has no subscription to % to adjust', v_product.key;
    END IF;
  END IF;

  -- The requested plan must belong to the entitlement's own product.
  IF v_plan_key IS NOT NULL THEN
    SELECT * INTO v_plan
    FROM public.product_plans
    WHERE product_id = v_product.id AND key = v_plan_key;

    IF v_plan.id IS NULL THEN
      IF EXISTS (SELECT 1 FROM public.product_plans WHERE key = v_plan_key) THEN
        RAISE EXCEPTION 'Plan % belongs to a different product and cannot be applied to %', v_plan_key, v_product.key;
      END IF;
      RAISE EXCEPTION 'Unknown plan % for product %', v_plan_key, v_product.key;
    END IF;
  END IF;

  IF v_type IN ('change_plan', 'upgrade', 'downgrade') AND v_plan.id IS NULL THEN
    RAISE EXCEPTION 'A new plan key is required for a % adjustment', v_type;
  END IF;

  IF v_type IN ('extend_expiry', 'shorten_expiry') AND p_new_expires_at IS NULL THEN
    RAISE EXCEPTION 'A new expiry date is required for a % adjustment', v_type;
  END IF;

  IF v_type = 'manual_activation' AND p_new_expires_at IS NULL THEN
    RAISE EXCEPTION 'An expiry date is required for a manual activation';
  END IF;

  IF v_type = 'seat_change' AND (p_new_user_limit IS NULL OR p_new_user_limit = 0 OR p_new_user_limit < -1) THEN
    RAISE EXCEPTION 'A seat limit of -1 (unlimited) or a positive number is required for a seat change';
  END IF;

  IF v_type = 'manual_price' AND v_plan.id IS NULL AND p_new_user_limit IS NULL THEN
    RAISE EXCEPTION 'A plan key or a seat limit is required to record a manual price change';
  END IF;

  IF v_type = 'reactivate' AND NOT v_created AND p_new_expires_at IS NULL
     AND v_ent.expires_at IS NOT NULL AND v_ent.expires_at <= now() THEN
    RAISE EXCEPTION 'A new expiry date is required to reactivate an expired subscription';
  END IF;

  -- Snapshot the subscription exactly as it was, for the audit trail.
  IF v_created THEN
    v_previous := jsonb_build_object('existed', FALSE);
  ELSE
    SELECT p.key INTO v_plan_key_result
    FROM public.product_plans p
    WHERE p.id = v_ent.plan_id;

    v_previous := jsonb_build_object(
      'status', v_ent.status,
      'plan_id', v_ent.plan_id,
      'plan_key', v_plan_key_result,
      'expires_at', v_ent.expires_at,
      'agreed_user_limit', v_ent.agreed_user_limit,
      'agreed_monthly_price', v_ent.agreed_monthly_price,
      'agreed_annual_price', v_ent.agreed_annual_price,
      'source', v_ent.source
    );
  END IF;

  IF v_created THEN
    -- Manual activation of a product the business has never held.
    INSERT INTO public.organization_products (
      org_id, product_id, plan_id, status, source,
      agreed_monthly_price, agreed_annual_price, agreed_user_limit, currency,
      activated_at, expires_at, is_sandbox, metadata
    ) VALUES (
      p_org_id, v_product.id, v_plan.id, 'active', 'manual',
      v_plan.monthly_price, v_plan.annual_price,
      COALESCE(p_new_user_limit, v_plan.user_limit),
      COALESCE(v_plan.currency, 'NGN'),
      now(), p_new_expires_at, v_org.is_sandbox,
      jsonb_build_object('recorded_by_adjustment_type', v_type, 'reason', v_reason)
    )
    RETURNING * INTO v_ent;

  ELSIF v_type = 'extend_expiry' THEN
    IF v_ent.expires_at IS NOT NULL AND p_new_expires_at <= v_ent.expires_at THEN
      RAISE EXCEPTION 'The new expiry (%) must be later than the current expiry (%)', p_new_expires_at, v_ent.expires_at;
    END IF;

    UPDATE public.organization_products
    SET expires_at = p_new_expires_at,
        status = CASE WHEN status = 'expired' THEN 'active' ELSE status END
    WHERE id = v_ent.id
    RETURNING * INTO v_ent;

  ELSIF v_type = 'shorten_expiry' THEN
    UPDATE public.organization_products
    SET expires_at = p_new_expires_at,
        status = CASE WHEN p_new_expires_at <= now() AND status = 'active' THEN 'expired' ELSE status END
    WHERE id = v_ent.id
    RETURNING * INTO v_ent;

  ELSIF v_type IN ('change_plan', 'upgrade', 'downgrade') THEN
    -- The agreed deal follows the new plan so seat and price enforcement match it.
    UPDATE public.organization_products
    SET plan_id = v_plan.id,
        agreed_monthly_price = COALESCE(v_plan.monthly_price, agreed_monthly_price),
        agreed_annual_price = COALESCE(v_plan.annual_price, agreed_annual_price),
        agreed_user_limit = COALESCE(p_new_user_limit, v_plan.user_limit, agreed_user_limit),
        currency = v_plan.currency,
        status = CASE WHEN status IN ('pending', 'expired') THEN 'active' ELSE status END,
        activated_at = COALESCE(activated_at, now()),
        expires_at = COALESCE(p_new_expires_at, expires_at)
    WHERE id = v_ent.id
    RETURNING * INTO v_ent;

  ELSIF v_type = 'manual_price' THEN
    UPDATE public.organization_products
    SET plan_id = COALESCE(v_plan.id, plan_id),
        agreed_monthly_price = CASE WHEN v_plan.id IS NOT NULL THEN v_plan.monthly_price ELSE agreed_monthly_price END,
        agreed_annual_price = CASE WHEN v_plan.id IS NOT NULL THEN v_plan.annual_price ELSE agreed_annual_price END,
        agreed_user_limit = COALESCE(p_new_user_limit, v_plan.user_limit, agreed_user_limit),
        currency = COALESCE(v_plan.currency, currency),
        expires_at = COALESCE(p_new_expires_at, expires_at)
    WHERE id = v_ent.id
    RETURNING * INTO v_ent;

  ELSIF v_type = 'seat_change' THEN
    UPDATE public.organization_products
    SET agreed_user_limit = p_new_user_limit
    WHERE id = v_ent.id
    RETURNING * INTO v_ent;

  ELSIF v_type = 'suspend' THEN
    UPDATE public.organization_products
    SET status = 'suspended'
    WHERE id = v_ent.id
    RETURNING * INTO v_ent;

  ELSIF v_type = 'reinstate' THEN
    UPDATE public.organization_products
    SET status = 'active',
        cancelled_at = NULL
    WHERE id = v_ent.id
    RETURNING * INTO v_ent;

  ELSIF v_type = 'cancel' THEN
    UPDATE public.organization_products
    SET status = 'cancelled',
        cancelled_at = now()
    WHERE id = v_ent.id
    RETURNING * INTO v_ent;

  ELSIF v_type = 'reactivate' THEN
    UPDATE public.organization_products
    SET status = 'active',
        cancelled_at = NULL,
        activated_at = COALESCE(activated_at, now()),
        expires_at = COALESCE(p_new_expires_at, expires_at),
        plan_id = COALESCE(v_plan.id, plan_id),
        agreed_monthly_price = COALESCE(v_plan.monthly_price, agreed_monthly_price),
        agreed_annual_price = COALESCE(v_plan.annual_price, agreed_annual_price),
        agreed_user_limit = COALESCE(p_new_user_limit, v_plan.user_limit, agreed_user_limit),
        currency = COALESCE(v_plan.currency, currency)
    WHERE id = v_ent.id
    RETURNING * INTO v_ent;

  ELSIF v_type = 'manual_activation' THEN
    UPDATE public.organization_products
    SET status = 'active',
        source = 'manual',
        cancelled_at = NULL,
        activated_at = now(),
        expires_at = p_new_expires_at,
        plan_id = COALESCE(v_plan.id, plan_id),
        agreed_monthly_price = COALESCE(v_plan.monthly_price, agreed_monthly_price),
        agreed_annual_price = COALESCE(v_plan.annual_price, agreed_annual_price),
        agreed_user_limit = COALESCE(p_new_user_limit, v_plan.user_limit, agreed_user_limit),
        currency = COALESCE(v_plan.currency, currency),
        is_sandbox = v_org.is_sandbox
    WHERE id = v_ent.id
    RETURNING * INTO v_ent;
  END IF;

  SELECT p.key INTO v_plan_key_result
  FROM public.product_plans p
  WHERE p.id = v_ent.plan_id;

  v_new := jsonb_build_object(
    'status', v_ent.status,
    'plan_id', v_ent.plan_id,
    'plan_key', v_plan_key_result,
    'expires_at', v_ent.expires_at,
    'agreed_user_limit', v_ent.agreed_user_limit,
    'agreed_monthly_price', v_ent.agreed_monthly_price,
    'agreed_annual_price', v_ent.agreed_annual_price,
    'source', v_ent.source
  );

  INSERT INTO public.subscription_adjustments (
    org_id, organization_product_id, product_id, adjustment_type,
    previous_values, new_values, reason, performed_by, is_sandbox
  ) VALUES (
    p_org_id, v_ent.id, v_ent.product_id, v_type,
    v_previous, v_new, v_reason, v_actor, v_org.is_sandbox
  )
  RETURNING * INTO v_adjustment;

  -- The same change is written to the support timeline so an operator reading the
  -- business later sees why its pricing or access moved.
  v_note_type := CASE
    WHEN v_type = 'manual_activation' THEN 'manual_activation'
    WHEN v_type = 'suspend' THEN 'suspension'
    WHEN v_type IN ('reinstate', 'reactivate') THEN 'reinstatement'
    WHEN v_type = 'cancel' THEN 'support_action'
    ELSE 'pricing_change'
  END;

  INSERT INTO public.platform_support_notes (
    org_id, product_id, admin_user_id, note_type, body, is_sandbox, metadata
  ) VALUES (
    p_org_id, v_ent.product_id, v_actor, v_note_type,
    'Subscription adjustment (' || v_type || '): ' || v_reason,
    v_org.is_sandbox,
    jsonb_build_object('subscription_adjustment_id', v_adjustment.id, 'adjustment_type', v_type)
  );

  -- The before/after pair is the point of this event: the dashboard can now show
  -- what an adjustment moved, not merely that one happened. The two nested
  -- objects hold status, plan, expiry, seat and price values only.
  PERFORM public.create_audit_log(
    v_actor,
    p_org_id,
    NULL,
    'SUBSCRIPTION_ADJUSTED',
    'organization_product',
    v_ent.id,
    v_product.key,
    jsonb_build_object('previous', v_previous, 'new', v_new),
    jsonb_build_object(
      'adjustment_id', v_adjustment.id,
      'adjustment_type', v_type,
      'reason', v_reason,
      'is_sandbox', v_org.is_sandbox
    )
  );

  RETURN v_adjustment;
END;
$$;

REVOKE ALL ON FUNCTION public.record_subscription_adjustment(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_subscription_adjustment(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, INTEGER, TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 7.5 set_platform_setting -> PLATFORM_SETTING_UPDATED
-- ------------------------------------------------------------
-- A platform setting is configuration the whole platform reads, and its previous
-- value was destroyed by every write with no record of what it had been. The
-- audit row now carries the previous and the new value side by side.
CREATE OR REPLACE FUNCTION public.set_platform_setting(p_key TEXT, p_value JSONB)
RETURNS public.platform_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := public.require_platform_permission('platform:manage_settings');
  v_key TEXT := btrim(COALESCE(p_key, ''));
  v_setting public.platform_settings;
  v_previous JSONB;
  v_credential_pattern CONSTANT TEXT := 'secret|password|token|api_key|private_key|service_role';
  v_unknown_keys TEXT;
BEGIN
  IF v_key = '' THEN
    RAISE EXCEPTION 'A setting key is required';
  END IF;

  IF p_value IS NULL THEN
    RAISE EXCEPTION 'A setting value is required for %', v_key;
  END IF;

  -- Credentials never live in platform_settings: only a server-side secret does.
  IF v_key ~* v_credential_pattern THEN
    RAISE EXCEPTION 'Setting "%" looks like a credential. Passwords, tokens, and API keys must stay in server-side secret storage, not in platform_settings', v_key;
  END IF;

  IF p_value::text ~* v_credential_pattern THEN
    RAISE EXCEPTION 'The value for "%" looks like a credential. Credentials must stay in server-side secret storage, not in platform_settings', v_key;
  END IF;

  SELECT * INTO v_setting
  FROM public.platform_settings
  WHERE key = v_key
  FOR UPDATE;

  -- Only settings that a migration has already declared may be written, so this
  -- function cannot be used to inject new configuration.
  IF v_setting.key IS NULL THEN
    RAISE EXCEPTION 'Unknown setting: %. Settings are declared by migration before they can be updated', v_key;
  END IF;

  IF jsonb_typeof(p_value) <> jsonb_typeof(v_setting.value) THEN
    RAISE EXCEPTION 'Setting "%" holds a % value and cannot be replaced with a % value', v_key, jsonb_typeof(v_setting.value), jsonb_typeof(p_value);
  END IF;

  -- An object keeps its shape: existing keys may be updated, new ones may not appear.
  IF jsonb_typeof(v_setting.value) = 'object' THEN
    SELECT string_agg(k, ', ' ORDER BY k) INTO v_unknown_keys
    FROM jsonb_object_keys(p_value) AS k
    WHERE NOT (v_setting.value ? k);

    IF v_unknown_keys IS NOT NULL THEN
      RAISE EXCEPTION 'Setting "%" does not define: %. Add the option by migration first', v_key, v_unknown_keys;
    END IF;
  END IF;

  -- Captured before the write: this is the history the table itself cannot keep.
  v_previous := v_setting.value;

  UPDATE public.platform_settings
  SET value = p_value,
      updated_by = v_actor
  WHERE key = v_key
  RETURNING * INTO v_setting;

  PERFORM public.create_audit_log(
    v_actor,
    NULL,
    NULL,
    'PLATFORM_SETTING_UPDATED',
    'platform_setting',
    NULL,
    v_key,
    jsonb_build_object('previous', v_previous, 'new', p_value),
    jsonb_build_object('category', v_setting.category)
  );

  RETURN v_setting;
END;
$$;

REVOKE ALL ON FUNCTION public.set_platform_setting(TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_platform_setting(TEXT, JSONB) TO authenticated;

-- ------------------------------------------------------------
-- 7.6 upsert_notification_template -> NOTIFICATION_TEMPLATE_SAVED
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_notification_template(
  p_key TEXT,
  p_name TEXT,
  p_channel TEXT,
  p_subject TEXT,
  p_body TEXT,
  p_status TEXT DEFAULT 'active'
)
RETURNS public.notification_templates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := public.require_platform_permission('platform:manage_settings');
  v_key TEXT := btrim(COALESCE(p_key, ''));
  v_name TEXT := btrim(COALESCE(p_name, ''));
  v_channel TEXT := lower(btrim(COALESCE(p_channel, '')));
  v_subject TEXT := NULLIF(btrim(COALESCE(p_subject, '')), '');
  v_body TEXT := btrim(COALESCE(p_body, ''));
  v_status TEXT := lower(btrim(COALESCE(p_status, 'active')));
  v_existing public.notification_templates;
  v_template public.notification_templates;
BEGIN
  IF v_key = '' THEN
    RAISE EXCEPTION 'A template key is required';
  END IF;

  IF v_name = '' THEN
    RAISE EXCEPTION 'A template name is required';
  END IF;

  IF v_channel NOT IN ('email', 'sms', 'in_app') THEN
    RAISE EXCEPTION 'Unsupported channel: %. Use email, sms, or in_app', p_channel;
  END IF;

  IF v_status NOT IN ('active', 'inactive') THEN
    RAISE EXCEPTION 'Unsupported status: %. Use active or inactive', p_status;
  END IF;

  IF v_body = '' THEN
    RAISE EXCEPTION 'A template body is required for %', v_key;
  END IF;

  SELECT * INTO v_existing
  FROM public.notification_templates
  WHERE key = v_key;

  INSERT INTO public.notification_templates (
    key, name, channel, subject, body, status, updated_by
  ) VALUES (
    v_key, v_name, v_channel, v_subject, v_body, v_status, v_actor
  )
  ON CONFLICT (key) DO UPDATE
  SET name = EXCLUDED.name,
      channel = EXCLUDED.channel,
      subject = EXCLUDED.subject,
      body = EXCLUDED.body,
      status = EXCLUDED.status,
      updated_by = EXCLUDED.updated_by
  RETURNING * INTO v_template;

  -- Template bodies and subjects are deliberately absent from the audit row: the
  -- row records that the template changed, who changed it, and how it moved.
  PERFORM public.create_audit_log(
    v_actor,
    NULL,
    NULL,
    'NOTIFICATION_TEMPLATE_SAVED',
    'notification_template',
    v_template.id,
    v_template.key,
    jsonb_build_object(
      'previous', CASE
        WHEN v_existing.id IS NULL THEN NULL
        ELSE jsonb_build_object(
          'name', v_existing.name,
          'channel', v_existing.channel,
          'subject', v_existing.subject,
          'status', v_existing.status
        )
      END,
      'new', jsonb_build_object(
        'name', v_template.name,
        'channel', v_template.channel,
        'subject', v_template.subject,
        'status', v_template.status
      )
    ),
    jsonb_build_object('created', v_existing.id IS NULL)
  );

  RETURN v_template;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_notification_template(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_notification_template(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ============================================================
-- 8. SECRET REDACTION AND THE PLATFORM AUDIT BROWSER
-- ============================================================
-- audit_logs rows with org_id IS NULL - every platform-scoped event - are
-- invisible to the tenant RLS policy by design (072), so no admin could read the
-- platform audit trail at all without a SECURITY DEFINER function.
--
-- Redaction first: audit payloads are written by many code paths, and one of them
-- will eventually put a provider payload, a webhook signature, or a token into
-- changes/details. Nothing that looks like a credential may leave the database.

CREATE OR REPLACE FUNCTION public.redact_secret_keys(payload JSONB)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE jsonb_typeof(payload)
    WHEN 'object' THEN COALESCE((
      SELECT jsonb_object_agg(
               e.k,
               CASE
                 WHEN e.k ~* 'secret|password|token|api_key|private_key|authorization|service_role'
                   THEN '"***redacted***"'::jsonb
                 -- Recurse so a nested before/after object cannot smuggle a secret
                 -- out through a harmless-looking top-level key.
                 ELSE public.redact_secret_keys(e.v)
               END
             )
      FROM jsonb_each(payload) AS e(k, v)
    ), '{}'::jsonb)
    WHEN 'array' THEN COALESCE((
      SELECT jsonb_agg(public.redact_secret_keys(e.v))
      FROM jsonb_array_elements(payload) AS e(v)
    ), '[]'::jsonb)
    ELSE payload
  END;
$$;

REVOKE ALL ON FUNCTION public.redact_secret_keys(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redact_secret_keys(JSONB) TO authenticated, service_role;

COMMENT ON FUNCTION public.redact_secret_keys(JSONB) IS
  'Masks any value whose key looks like a credential (secret, password, token, api_key, private_key, '
  'authorization, service_role) anywhere in a JSONB payload, replacing it with ***redacted***. '
  'Purely restrictive: it never reveals anything the caller did not already hold.';

CREATE OR REPLACE FUNCTION public.list_platform_audit_logs(
  p_actor_id UUID DEFAULT NULL,
  p_org_id UUID DEFAULT NULL,
  p_action TEXT DEFAULT NULL,
  p_resource_type TEXT DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_from TIMESTAMPTZ DEFAULT NULL,
  p_to TIMESTAMPTZ DEFAULT NULL,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  actor_email TEXT,
  org_id UUID,
  org_name TEXT,
  action TEXT,
  resource_type TEXT,
  resource_id UUID,
  resource_name TEXT,
  status TEXT,
  changes JSONB,
  details JSONB,
  created_at TIMESTAMPTZ,
  total_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_offset INTEGER := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  -- The audit trail is a read of platform-scoped history, so it needs its own
  -- permission; support staff keep access because investigating a business from
  -- its audit trail is a support action.
  BEGIN
    PERFORM public.require_platform_permission('platform:view_audit');
  EXCEPTION WHEN OTHERS THEN
    IF NOT public.platform_user_has_permission(auth.uid(), 'platform:support') THEN
      RAISE;
    END IF;
  END;

  RETURN QUERY
  SELECT
    a.id,
    u.email AS actor_email,
    a.org_id,
    o.name AS org_name,
    a.action,
    a.resource_type,
    a.resource_id,
    a.resource_name,
    a.status,
    public.redact_secret_keys(a.changes) AS changes,
    public.redact_secret_keys(a.details) AS details,
    a.created_at,
    count(*) OVER () AS total_count
  FROM public.audit_logs a
  LEFT JOIN public.users u ON u.id = a.actor_id
  LEFT JOIN public.organizations o ON o.id = a.org_id
  WHERE (p_actor_id IS NULL OR a.actor_id = p_actor_id)
    AND (p_org_id IS NULL OR a.org_id = p_org_id)
    AND (p_action IS NULL OR btrim(p_action) = '' OR a.action ILIKE '%' || btrim(p_action) || '%')
    AND (p_resource_type IS NULL OR btrim(p_resource_type) = '' OR a.resource_type = btrim(p_resource_type))
    AND (p_status IS NULL OR btrim(p_status) = '' OR a.status = btrim(p_status))
    AND (p_from IS NULL OR a.created_at >= p_from)
    AND (p_to IS NULL OR a.created_at <= p_to)
  ORDER BY a.created_at DESC
  LIMIT v_limit
  OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.list_platform_audit_logs(UUID, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_platform_audit_logs(UUID, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER) TO authenticated;

COMMENT ON FUNCTION public.list_platform_audit_logs(UUID, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER) IS
  'Paginated platform audit browser. Requires platform:view_audit, with platform:support accepted as a fallback. '
  'Returns platform-scoped rows (org_id IS NULL) that no RLS policy can show, clamps the page size to 1-200, '
  'carries count(*) OVER () as total_count, and redacts credential-looking keys from changes and details.';

-- ============================================================
-- 9. REVENUE REPORTING EXCLUDES SANDBOX ROWS
-- ============================================================
-- Both functions were written in 035, before 069 added
-- subscription_transactions.is_sandbox. Sandbox payments - which developer mode
-- creates freely - were therefore counted as real revenue, inflating the one
-- number the platform owner trusts most.
--
-- The permission gate moves from the legacy is_platform_admin(auth.uid()) flag to
-- require_platform_permission('platform:view'), so an admin appointed through
-- platform_admins can actually open the revenue screen. Neither return type
-- changes: the gate is a PERFORM inside an existing plpgsql body, and both
-- functions keep their exact RETURNS TABLE column list and argument list.

CREATE OR REPLACE FUNCTION public.get_platform_revenue_summary(
  p_date_from TIMESTAMPTZ,
  p_date_to TIMESTAMPTZ
)
RETURNS TABLE (
  total_revenue NUMERIC,
  transaction_count BIGINT,
  successful_count BIGINT,
  failed_count BIGINT
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
    COALESCE(SUM(t.amount) FILTER (WHERE t.status = 'success'), 0) AS total_revenue,
    COUNT(*) AS transaction_count,
    COUNT(*) FILTER (WHERE t.status = 'success') AS successful_count,
    COUNT(*) FILTER (WHERE t.status = 'failed') AS failed_count
  FROM public.subscription_transactions t
  WHERE t.is_sandbox = FALSE
    AND t.created_at >= p_date_from
    AND t.created_at < p_date_to;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_platform_revenue_summary(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

COMMENT ON FUNCTION public.get_platform_revenue_summary(TIMESTAMPTZ, TIMESTAMPTZ) IS
  'Revenue totals for a date range. Sandbox transactions are excluded so developer tests never appear as revenue.';

CREATE OR REPLACE FUNCTION public.get_platform_revenue_by_plan(
  p_date_from TIMESTAMPTZ,
  p_date_to TIMESTAMPTZ
)
RETURNS TABLE (
  plan_id UUID,
  plan_name TEXT,
  revenue NUMERIC,
  transaction_count BIGINT
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
    sp.id AS plan_id,
    sp.name AS plan_name,
    COALESCE(SUM(t.amount), 0) AS revenue,
    COUNT(*) AS transaction_count
  FROM public.subscription_transactions t
  JOIN public.subscription_plans sp ON sp.id = t.plan_id
  WHERE t.status = 'success'
    AND t.is_sandbox = FALSE
    AND t.created_at >= p_date_from
    AND t.created_at < p_date_to
  GROUP BY sp.id, sp.name
  ORDER BY SUM(t.amount) DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_platform_revenue_by_plan(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

COMMENT ON FUNCTION public.get_platform_revenue_by_plan(TIMESTAMPTZ, TIMESTAMPTZ) IS
  'Successful revenue grouped by the legacy subscription plan. Sandbox transactions are excluded.';

-- ============================================================
-- 10. product_plans GAINS A BILLING CYCLE
-- ============================================================
-- A plan carried a monthly price and an annual price side by side with no way to
-- say which one a customer is actually on, so nothing downstream - the dashboard,
-- a renewal reminder, or a revenue forecast - could tell a monthly subscriber
-- from an annual one. The column defaults to 'monthly' so every existing row is
-- classified without a guess being made about it.

ALTER TABLE public.product_plans
  ADD COLUMN IF NOT EXISTS billing_cycle TEXT NOT NULL DEFAULT 'monthly';

ALTER TABLE public.product_plans DROP CONSTRAINT IF EXISTS product_plans_billing_cycle_check;
ALTER TABLE public.product_plans
  ADD CONSTRAINT product_plans_billing_cycle_check
  CHECK (billing_cycle IN ('monthly', 'annual', 'custom'));

COMMENT ON COLUMN public.product_plans.billing_cycle IS
  'Which cycle this plan is sold on: monthly, annual, or custom (negotiated). Existing rows default to monthly.';

-- ------------------------------------------------------------
-- 10.1 list_product_plans returns the new column
-- ------------------------------------------------------------
-- Appending a column changes the function's RETURNS TABLE, which CREATE OR
-- REPLACE cannot do, so the function is dropped first. billing_cycle is appended
-- as the LAST column and every existing column keeps its name and position, so a
-- caller that reads columns by name is unaffected.

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
  billing_cycle TEXT
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
    pp.billing_cycle
  FROM public.product_plans pp
  JOIN public.platform_products pr ON pr.id = pp.product_id
  WHERE p_product_key IS NULL OR pr.key = p_product_key
  ORDER BY pr.sort_order, pp.sort_order, pp.name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_product_plans(TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 10.2 upsert_product_plan accepts and journals the billing cycle
-- ------------------------------------------------------------
-- A new argument changes the signature, so the old function is dropped first.
-- p_billing_cycle is appended after the existing arguments so any positional
-- caller keeps working, and every existing argument keeps its name and default.
-- The cycle is journalled in product_plan_revisions alongside the prices, so the
-- pricing history records the cycle change as well as the numbers.

DROP FUNCTION IF EXISTS public.upsert_product_plan(
  TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, INTEGER, JSONB, TEXT, TEXT, BOOLEAN, BOOLEAN, INTEGER, TEXT
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
  p_billing_cycle TEXT DEFAULT 'monthly'
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
      'billing_cycle', v_existing.billing_cycle
    );
  END IF;

  IF p_is_default THEN
    UPDATE public.product_plans SET is_default = FALSE
    WHERE product_id = v_product_id AND is_default = TRUE AND key <> p_plan_key;
  END IF;

  INSERT INTO public.product_plans AS t
    (product_id, key, name, description, monthly_price, annual_price, user_limit,
     features, onboarding_note, status, is_default, is_public, sort_order, created_by,
     billing_cycle)
  VALUES
    (v_product_id, p_plan_key, p_name, p_description, p_monthly_price, p_annual_price,
     p_user_limit, COALESCE(p_features, '[]'::jsonb), p_onboarding_note, p_status,
     p_is_default, p_is_public, COALESCE(p_sort_order, 0), v_actor,
     v_billing_cycle)
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
    updated_at = now()
  RETURNING * INTO v_row;

  -- Journal the change. Existing subscribers are unaffected: their agreed prices
  -- live on organization_products and are never rewritten by a plan edit.
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
      'billing_cycle', v_row.billing_cycle
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

GRANT EXECUTE ON FUNCTION public.upsert_product_plan(
  TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, INTEGER, JSONB, TEXT, TEXT, BOOLEAN, BOOLEAN, INTEGER, TEXT, TEXT
) TO authenticated;
