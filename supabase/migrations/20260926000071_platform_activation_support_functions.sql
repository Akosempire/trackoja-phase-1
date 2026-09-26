-- Migration: 071_platform_activation_support_functions.sql
-- Description: Function surface for activation keys, support notes, subscription adjustments, platform settings, and notification templates. Every platform action is gated in the database, list functions never return a usable key or a secret, and every change is journalled.
-- Author: TrackOja Team
-- Date: 2026-09-26

-- =============================================================
-- ACTIVATION KEYS
-- =============================================================

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

  RETURN v_key;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_activation_key(TEXT, TEXT, UUID, INTEGER, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_activation_key(TEXT, TEXT, UUID, INTEGER, TEXT, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.redeem_activation_key(p_key_code TEXT)
RETURNS public.organization_products
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_code TEXT := upper(btrim(COALESCE(p_key_code, '')));
  v_org_count BIGINT;
  v_org public.organizations;
  v_key public.activation_keys;
  v_plan public.product_plans;
  v_entitlement public.organization_products;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF v_code = '' THEN
    RAISE EXCEPTION 'An activation key is required';
  END IF;

  -- The redeeming business owner acts for exactly one business at a time.
  SELECT count(*) INTO v_org_count
  FROM public.get_user_org_ids(v_user);

  IF v_org_count = 0 THEN
    RAISE EXCEPTION 'No business is linked to your account';
  END IF;

  IF v_org_count > 1 THEN
    RAISE EXCEPTION 'Your account belongs to more than one business. Select a store before redeeming an activation key';
  END IF;

  SELECT * INTO v_org
  FROM public.organizations
  WHERE id IN (SELECT public.get_user_org_ids(v_user));

  IF v_org.id IS NULL THEN
    RAISE EXCEPTION 'No business is linked to your account';
  END IF;

  IF v_org.owner_id <> v_user THEN
    RAISE EXCEPTION 'Only the business owner can redeem an activation key';
  END IF;

  -- Row lock stops two concurrent redemptions of the same key.
  SELECT * INTO v_key
  FROM public.activation_keys
  WHERE key_code = v_code
  FOR UPDATE;

  IF v_key.id IS NULL THEN
    RAISE EXCEPTION 'That activation key is not valid';
  END IF;

  -- Deliberately identical wording for every unusable key: nothing about the
  -- product, plan, or the business it was issued to is disclosed.
  IF v_key.status = 'redeemed' THEN
    RAISE EXCEPTION 'That activation key has already been used';
  END IF;

  IF v_key.status <> 'issued' THEN
    RAISE EXCEPTION 'That activation key is no longer usable';
  END IF;

  IF v_key.valid_from IS NOT NULL AND now() < v_key.valid_from THEN
    RAISE EXCEPTION 'That activation key is not active yet';
  END IF;

  IF v_key.valid_until IS NOT NULL AND now() > v_key.valid_until THEN
    RAISE EXCEPTION 'That activation key has expired';
  END IF;

  IF v_key.org_id IS NOT NULL AND v_key.org_id <> v_org.id THEN
    RAISE EXCEPTION 'That activation key was issued for a different business';
  END IF;

  IF v_key.is_sandbox <> v_org.is_sandbox THEN
    RAISE EXCEPTION 'A sandbox key can only activate a sandbox business, and a live key only a live business';
  END IF;

  IF v_key.plan_id IS NOT NULL THEN
    SELECT * INTO v_plan
    FROM public.product_plans
    WHERE id = v_key.plan_id;
  END IF;

  -- The deal is snapshot onto the entitlement: the seat limit captured on the
  -- key and the plan prices agreed at issuance, not today's catalogue prices.
  INSERT INTO public.organization_products AS op (
    org_id, product_id, plan_id, status, source,
    agreed_monthly_price, agreed_annual_price, agreed_user_limit, currency,
    activated_at, expires_at, cancelled_at, is_sandbox, metadata
  ) VALUES (
    v_org.id, v_key.product_id, v_key.plan_id, 'active', 'activation_key',
    v_plan.monthly_price, v_plan.annual_price, v_key.user_limit,
    COALESCE(v_key.currency, v_plan.currency, 'NGN'),
    now(), v_key.valid_until, NULL, v_key.is_sandbox,
    jsonb_build_object('activation_key_id', v_key.id)
  )
  ON CONFLICT (org_id, product_id) DO UPDATE
  SET plan_id = EXCLUDED.plan_id,
      status = 'active',
      source = 'activation_key',
      agreed_monthly_price = EXCLUDED.agreed_monthly_price,
      agreed_annual_price = EXCLUDED.agreed_annual_price,
      agreed_user_limit = EXCLUDED.agreed_user_limit,
      currency = EXCLUDED.currency,
      activated_at = now(),
      expires_at = EXCLUDED.expires_at,
      cancelled_at = NULL,
      is_sandbox = EXCLUDED.is_sandbox,
      metadata = op.metadata || EXCLUDED.metadata
  RETURNING * INTO v_entitlement;

  -- Bind an unbound key to the business that redeemed it and close the key out.
  UPDATE public.activation_keys
  SET status = 'redeemed',
      redeemed_at = now(),
      redeemed_by = v_user,
      org_id = COALESCE(org_id, v_org.id)
  WHERE id = v_key.id
  RETURNING * INTO v_key;

  INSERT INTO public.activation_key_events (key_id, event_type, actor_id, note, metadata)
  VALUES (
    v_key.id, 'redeemed', v_user, 'Activation key redeemed',
    jsonb_build_object('org_id', v_org.id, 'organization_product_id', v_entitlement.id)
  );

  RETURN v_entitlement;
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_activation_key(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_activation_key(TEXT) TO authenticated;

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

  RETURN v_key;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_activation_key(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_activation_key(UUID, TEXT) TO authenticated;

-- =============================================================
-- ACTIVATION KEY LISTING
-- =============================================================

CREATE OR REPLACE FUNCTION public.list_activation_keys(
  p_product_key TEXT DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
  id UUID,
  key_code_masked TEXT,
  product_key TEXT,
  product_name TEXT,
  plan_name TEXT,
  org_id UUID,
  org_name TEXT,
  status TEXT,
  valid_from TIMESTAMPTZ,
  valid_until TIMESTAMPTZ,
  user_limit INTEGER,
  redeemed_at TIMESTAMPTZ,
  is_sandbox BOOLEAN,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := public.require_platform_permission('platform:manage_activation');
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 500);
BEGIN
  RETURN QUERY
  SELECT ak.id,
         -- Only the last group is shown: a listing can never yield a usable key.
         '••••-••••-' || right(ak.key_code, 4) AS key_code_masked,
         pp.key AS product_key,
         pp.name AS product_name,
         pl.name AS plan_name,
         ak.org_id,
         o.name AS org_name,
         ak.status,
         ak.valid_from,
         ak.valid_until,
         ak.user_limit,
         ak.redeemed_at,
         ak.is_sandbox,
         ak.created_at
  FROM public.activation_keys ak
  JOIN public.platform_products pp ON pp.id = ak.product_id
  LEFT JOIN public.product_plans pl ON pl.id = ak.plan_id
  LEFT JOIN public.organizations o ON o.id = ak.org_id
  WHERE (p_product_key IS NULL OR btrim(p_product_key) = '' OR pp.key = btrim(p_product_key))
    AND (p_status IS NULL OR btrim(p_status) = '' OR ak.status = btrim(p_status))
  ORDER BY ak.created_at DESC
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.list_activation_keys(TEXT, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_activation_keys(TEXT, TEXT, INTEGER) TO authenticated;

-- =============================================================
-- SUPPORT NOTES AND AUDIT
-- =============================================================

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

  RETURN v_note;
END;
$$;

REVOKE ALL ON FUNCTION public.add_support_note(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_support_note(UUID, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_support_notes(
  p_org_id UUID,
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
  id UUID,
  note_type TEXT,
  body TEXT,
  admin_email TEXT,
  product_key TEXT,
  is_sandbox BOOLEAN,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 500);
  v_allowed BOOLEAN;
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'A business is required';
  END IF;

  -- Support staff see every note; a business owner sees only their own.
  v_allowed := public.platform_user_has_permission(auth.uid(), 'platform:support')
    OR p_org_id IN (SELECT public.get_user_org_ids(auth.uid()))
    OR EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = p_org_id AND o.owner_id = auth.uid()
    );

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Permission denied: platform:support required';
  END IF;

  RETURN QUERY
  SELECT sn.id,
         sn.note_type,
         sn.body,
         u.email AS admin_email,
         pp.key AS product_key,
         sn.is_sandbox,
         sn.created_at
  FROM public.platform_support_notes sn
  LEFT JOIN public.users u ON u.id = sn.admin_user_id
  LEFT JOIN public.platform_products pp ON pp.id = sn.product_id
  WHERE sn.org_id = p_org_id
  ORDER BY sn.created_at DESC
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.list_support_notes(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_support_notes(UUID, INTEGER) TO authenticated;

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

  RETURN v_adjustment;
END;
$$;

REVOKE ALL ON FUNCTION public.record_subscription_adjustment(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_subscription_adjustment(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, INTEGER, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_subscription_adjustments(
  p_org_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
  id UUID,
  org_id UUID,
  org_name TEXT,
  adjustment_type TEXT,
  reason TEXT,
  previous_values JSONB,
  new_values JSONB,
  performed_by_email TEXT,
  is_sandbox BOOLEAN,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := public.require_platform_permission('platform:manage_payments');
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 1000);
BEGIN
  RETURN QUERY
  SELECT sa.id,
         sa.org_id,
         o.name AS org_name,
         sa.adjustment_type,
         sa.reason,
         sa.previous_values,
         sa.new_values,
         u.email AS performed_by_email,
         sa.is_sandbox,
         sa.created_at
  FROM public.subscription_adjustments sa
  LEFT JOIN public.organizations o ON o.id = sa.org_id
  LEFT JOIN public.users u ON u.id = sa.performed_by
  WHERE (p_org_id IS NULL OR sa.org_id = p_org_id)
  ORDER BY sa.created_at DESC
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.list_subscription_adjustments(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_subscription_adjustments(UUID, INTEGER) TO authenticated;

-- =============================================================
-- PLATFORM SETTINGS
-- =============================================================

CREATE OR REPLACE FUNCTION public.list_platform_settings()
RETURNS TABLE (
  key TEXT,
  value JSONB,
  description TEXT,
  category TEXT,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := public.require_platform_permission('platform:view');
BEGIN
  RETURN QUERY
  SELECT ps.key,
         ps.value,
         ps.description,
         ps.category,
         ps.updated_at
  FROM public.platform_settings ps
  ORDER BY ps.category, ps.key;
END;
$$;

REVOKE ALL ON FUNCTION public.list_platform_settings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_platform_settings() TO authenticated;

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

  UPDATE public.platform_settings
  SET value = p_value,
      updated_by = v_actor
  WHERE key = v_key
  RETURNING * INTO v_setting;

  RETURN v_setting;
END;
$$;

REVOKE ALL ON FUNCTION public.set_platform_setting(TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_platform_setting(TEXT, JSONB) TO authenticated;

-- =============================================================
-- NOTIFICATION TEMPLATES
-- =============================================================

CREATE OR REPLACE FUNCTION public.list_notification_templates()
RETURNS TABLE (
  id UUID,
  key TEXT,
  name TEXT,
  channel TEXT,
  subject TEXT,
  body TEXT,
  status TEXT,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := public.require_platform_permission('platform:view');
BEGIN
  RETURN QUERY
  SELECT nt.id,
         nt.key,
         nt.name,
         nt.channel,
         nt.subject,
         nt.body,
         nt.status,
         nt.updated_at
  FROM public.notification_templates nt
  ORDER BY nt.channel, nt.key;
END;
$$;

REVOKE ALL ON FUNCTION public.list_notification_templates() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_notification_templates() TO authenticated;

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

  RETURN v_template;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_notification_template(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_notification_template(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
