-- ============================================================
-- 20261029000001: TRACKOJA <-> USETALLY CONNECTION (contract v1)
-- ============================================================
-- Implements the TrackOja side of docs/USETALLY_CONNECT.md.
--
--   usetally_links          one signed link per store (the Usetally business it
--                           reports to, the key's SHA-256 for inbound auth and the
--                           key encrypted with the Edge secret USETALLY_LINK_SECRET
--                           for outbound calls). Never readable by app users.
--   usetally_outbox         one row per completed sale ('sale') and per void of a
--                           sale that was queued ('void'). The usetally-sync Edge
--                           Function delivers it (contract section 5).
--   usetally_stock_applied  idempotency ledger for POST usetally-stock: one row per
--                           Usetally document whose stock was deducted.
--
-- Rows are queued by a DEFERRED constraint trigger on public.sales, so the
-- payload is built at COMMIT, after create_sale / settle_pos_payment_attempt have
-- written the line items, payments and final totals. The trigger swallows its
-- own errors (RAISE WARNING): a Usetally problem must never roll back a sale.
--
-- App users read the link only through get_usetally_link_status(store_id), which
-- requires store:update and never returns key_hash / key_enc. Every write goes
-- through SECURITY DEFINER functions granted to service_role only, which the
-- usetally-* Edge Functions call after their own checks.
--
-- Money in payloads is integer minor units: round(amount * 100).
-- ============================================================

-- ============================================================
-- 1. TABLES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.usetally_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL UNIQUE REFERENCES public.stores(id) ON DELETE CASCADE,
  business_id TEXT NOT NULL,
  business_name TEXT NOT NULL,
  business_currency TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  key_enc TEXT NOT NULL,
  key_hint TEXT NOT NULL CHECK (length(key_hint) <= 8),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  connected_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  last_sync_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS usetally_links_business_active
  ON public.usetally_links(business_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.usetally_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('sale', 'void')),
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT,
  remote_document_id TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sale_id, kind)
);
CREATE INDEX IF NOT EXISTS usetally_outbox_due
  ON public.usetally_outbox(next_attempt_at, created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS usetally_outbox_store_status
  ON public.usetally_outbox(store_id, status);

CREATE TABLE IF NOT EXISTS public.usetally_stock_applied (
  document_id UUID PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  number TEXT,
  lines JSONB NOT NULL DEFAULT '[]'::jsonb,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS usetally_stock_applied_store
  ON public.usetally_stock_applied(store_id, applied_at DESC);

DROP TRIGGER IF EXISTS handle_updated_at_usetally_links ON public.usetally_links;
CREATE TRIGGER handle_updated_at_usetally_links BEFORE UPDATE ON public.usetally_links
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- RLS on, no policies: app users cannot read or write these tables directly.
-- Link status and outbox counts are exposed by get_usetally_link_status() below.
ALTER TABLE public.usetally_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usetally_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usetally_stock_applied ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.usetally_links, public.usetally_outbox, public.usetally_stock_applied FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.usetally_links, public.usetally_outbox, public.usetally_stock_applied TO service_role;

COMMENT ON TABLE public.usetally_links IS
  'One Usetally link per store (docs/USETALLY_CONNECT.md). key_hash authenticates inbound calls; key_enc '
  '(AES-GCM, Edge secret USETALLY_LINK_SECRET) is used for outbound calls. Never exposed to app users.';
COMMENT ON TABLE public.usetally_outbox IS
  'Completed sales and voids waiting to be delivered to Usetally by the usetally-sync Edge Function.';

-- ============================================================
-- 2. SALE PAYLOAD (contract section 3, POST /api/pos/sales)
-- ============================================================
CREATE OR REPLACE FUNCTION public.usetally_minor(p_amount NUMERIC)
RETURNS BIGINT LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT round(COALESCE(p_amount, 0) * 100)::BIGINT;
$$;

CREATE OR REPLACE FUNCTION public.usetally_sale_payload(p_sale_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale public.sales;
  v_store public.stores;
  v_customer JSONB;
  v_cashier TEXT;
  v_items JSONB;
  v_payments JSONB;
BEGIN
  SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id;
  IF v_sale.id IS NULL THEN
    RAISE EXCEPTION 'Sale not found';
  END IF;
  SELECT * INTO v_store FROM public.stores WHERE id = v_sale.store_id;

  IF v_sale.customer_id IS NOT NULL THEN
    SELECT jsonb_build_object('name', c.name, 'phone', COALESCE(c.phone, ''), 'email', COALESCE(c.email, ''))
    INTO v_customer FROM public.customers c WHERE c.id = v_sale.customer_id;
  END IF;
  IF v_customer IS NULL AND (NULLIF(trim(v_sale.customer_name), '') IS NOT NULL
                             OR NULLIF(trim(v_sale.customer_phone), '') IS NOT NULL) THEN
    v_customer := jsonb_build_object(
      'name', COALESCE(NULLIF(trim(v_sale.customer_name), ''), 'Walk-in customer'),
      'phone', COALESCE(v_sale.customer_phone, ''), 'email', '');
  END IF;

  SELECT NULLIF(trim(concat_ws(' ', first_name, last_name)), '')
  INTO v_cashier FROM public.users WHERE id = v_sale.created_by;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'product_id', si.product_id,
           'name', si.product_name,
           'sku', COALESCE(si.sku, ''),
           'quantity', trim_scale(si.quantity),
           'unit_price_minor', public.usetally_minor(si.unit_price),
           'discount_minor', public.usetally_minor(si.discount_amount),
           'tax_minor', public.usetally_minor(si.tax_amount),
           'line_total_minor', public.usetally_minor(si.line_total)
         ) ORDER BY si.created_at, si.id), '[]'::jsonb)
  INTO v_items FROM public.sale_items si WHERE si.sale_id = p_sale_id;

  -- Rejected payments never happened; pending (unverified) transfers are sent as
  -- recorded, which is how TrackOja's own sales totals treat them.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'method', CASE WHEN sp.method IN ('cash', 'card', 'transfer', 'credit') THEN sp.method ELSE 'other' END,
           'amount_minor', public.usetally_minor(sp.amount),
           'reference', COALESCE(sp.reference, '')
         ) ORDER BY sp.created_at, sp.id), '[]'::jsonb)
  INTO v_payments FROM public.sale_payments sp
  WHERE sp.sale_id = p_sale_id AND sp.verification_status <> 'rejected';

  RETURN jsonb_build_object(
    'id', v_sale.id,
    'number', v_sale.sale_number,
    'created_at', to_char(COALESCE(v_sale.created_at, now()) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'currency', COALESCE(NULLIF(v_store.currency, ''), 'NGN'),
    'store', jsonb_build_object('id', v_store.id, 'name', v_store.name),
    'cashier', COALESCE(v_cashier, 'Staff member'),
    'customer', v_customer,  -- SQL NULL becomes JSON null
    'items', v_items,
    'subtotal_minor', public.usetally_minor(v_sale.subtotal),
    'discount_minor', public.usetally_minor(v_sale.discount_total),
    'tax_minor', public.usetally_minor(v_sale.tax_total),
    'total_minor', public.usetally_minor(v_sale.total),
    'payments', v_payments,
    'change_minor', public.usetally_minor(v_sale.change_due)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.usetally_sale_payload(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.usetally_sale_payload(UUID) TO service_role;

-- ============================================================
-- 3. ENQUEUE ON COMPLETE / VOID (deferred to COMMIT)
-- ============================================================
CREATE OR REPLACE FUNCTION public.usetally_enqueue_sale_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale public.sales;
BEGIN
  BEGIN
    -- Re-read the row: at commit time it carries its final status and totals.
    SELECT * INTO v_sale FROM public.sales WHERE id = NEW.id;
    IF v_sale.id IS NULL THEN
      RETURN NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.usetally_links
                   WHERE store_id = v_sale.store_id AND status = 'active') THEN
      RETURN NULL;
    END IF;

    IF v_sale.status = 'completed' THEN
      INSERT INTO public.usetally_outbox (store_id, sale_id, kind, payload)
      VALUES (v_sale.store_id, v_sale.id, 'sale', public.usetally_sale_payload(v_sale.id))
      ON CONFLICT (sale_id, kind) DO NOTHING;
    ELSIF v_sale.status = 'voided'
          AND EXISTS (SELECT 1 FROM public.usetally_outbox WHERE sale_id = v_sale.id AND kind = 'sale') THEN
      -- Only a sale that was queued for Usetally needs a void there.
      INSERT INTO public.usetally_outbox (store_id, sale_id, kind, payload)
      VALUES (v_sale.store_id, v_sale.id, 'void',
              jsonb_build_object('reason', COALESCE(NULLIF(trim(v_sale.void_reason), ''), 'Voided in TrackOja')))
      ON CONFLICT (sale_id, kind) DO NOTHING;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'usetally outbox: sale % was not queued: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.usetally_enqueue_sale_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS usetally_enqueue_sale_insert ON public.sales;
CREATE CONSTRAINT TRIGGER usetally_enqueue_sale_insert
  AFTER INSERT ON public.sales
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.status IN ('completed', 'voided'))
  EXECUTE FUNCTION public.usetally_enqueue_sale_change();

DROP TRIGGER IF EXISTS usetally_enqueue_sale_status ON public.sales;
CREATE CONSTRAINT TRIGGER usetally_enqueue_sale_status
  AFTER UPDATE OF status ON public.sales
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('completed', 'voided'))
  EXECUTE FUNCTION public.usetally_enqueue_sale_change();

-- ============================================================
-- 4. LINK MANAGEMENT (service_role; called by usetally-connect / -disconnect)
-- ============================================================
CREATE OR REPLACE FUNCTION public.usetally_save_link(
  p_store_id UUID,
  p_business_id TEXT,
  p_business_name TEXT,
  p_business_currency TEXT,
  p_key_hash TEXT,
  p_key_enc TEXT,
  p_key_hint TEXT,
  p_actor UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org UUID;
BEGIN
  SELECT org_id INTO v_org FROM public.stores WHERE id = p_store_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Store not found';
  END IF;

  -- One active link per Usetally business: Usetally revoked the other store's
  -- key when it issued this one, so stop that store from using it.
  UPDATE public.usetally_links
  SET status = 'revoked', revoked_at = now(), last_error = 'Replaced by a link from another branch'
  WHERE business_id = p_business_id AND store_id <> p_store_id AND status = 'active';

  INSERT INTO public.usetally_links (store_id, business_id, business_name, business_currency,
    key_hash, key_enc, key_hint, status, connected_by, connected_at, revoked_at, last_sync_at, last_error)
  VALUES (p_store_id, p_business_id, p_business_name, upper(p_business_currency),
    p_key_hash, p_key_enc, p_key_hint, 'active', p_actor, now(), NULL, NULL, NULL)
  ON CONFLICT (store_id) DO UPDATE SET
    business_id = EXCLUDED.business_id, business_name = EXCLUDED.business_name,
    business_currency = EXCLUDED.business_currency, key_hash = EXCLUDED.key_hash,
    key_enc = EXCLUDED.key_enc, key_hint = EXCLUDED.key_hint, status = 'active',
    connected_by = EXCLUDED.connected_by, connected_at = now(), revoked_at = NULL,
    last_sync_at = NULL, last_error = NULL;

  INSERT INTO public.audit_logs (actor_id, org_id, store_id, action, resource_type, resource_name, details)
  VALUES (p_actor, v_org, p_store_id, 'USETALLY_CONNECTED', 'usetally_link', p_business_name,
          jsonb_build_object('business_id', p_business_id, 'currency', upper(p_business_currency)));
END;
$$;

CREATE OR REPLACE FUNCTION public.usetally_revoke_link(
  p_store_id UUID,
  p_actor UUID,
  p_reason TEXT,
  p_fail_pending BOOLEAN DEFAULT FALSE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link public.usetally_links;
  v_org UUID;
BEGIN
  UPDATE public.usetally_links
  SET status = 'revoked', revoked_at = now(), last_error = left(p_reason, 300)
  WHERE store_id = p_store_id AND status = 'active'
  RETURNING * INTO v_link;
  IF v_link.id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- A deliberate disconnect stops delivery of what is still queued; "Retry
  -- failed" after reconnecting sends it on purpose. A 401 leaves rows pending so
  -- reconnecting resumes delivery.
  IF p_fail_pending THEN
    UPDATE public.usetally_outbox
    SET status = 'failed', last_error = 'Not sent: Usetally was disconnected'
    WHERE store_id = p_store_id AND status = 'pending';
  END IF;

  SELECT org_id INTO v_org FROM public.stores WHERE id = p_store_id;
  INSERT INTO public.audit_logs (actor_id, org_id, store_id, action, resource_type, resource_id, resource_name, details)
  VALUES (p_actor, v_org, p_store_id, 'USETALLY_DISCONNECTED', 'usetally_link', v_link.id, v_link.business_name,
          jsonb_build_object('reason', left(p_reason, 300)));
  RETURN TRUE;
END;
$$;

-- ============================================================
-- 5. DELIVERY (service_role; called by usetally-sync)
-- ============================================================
-- Claims due rows oldest first and leases them for two minutes, so the cron run
-- and a checkout nudge never send the same row at the same time. A void waits
-- until its sale row is no longer pending (the sale must reach Usetally first).
CREATE OR REPLACE FUNCTION public.usetally_claim_outbox(p_store_id UUID DEFAULT NULL, p_limit INTEGER DEFAULT 50)
RETURNS TABLE (id UUID, store_id UUID, sale_id UUID, kind TEXT, payload JSONB, attempts INTEGER, key_enc TEXT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT o.id
    FROM public.usetally_outbox o
    JOIN public.usetally_links l ON l.store_id = o.store_id AND l.status = 'active'
    WHERE o.status = 'pending'
      AND o.next_attempt_at <= now()
      AND (p_store_id IS NULL OR o.store_id = p_store_id)
      AND (o.kind = 'sale' OR NOT EXISTS (
            SELECT 1 FROM public.usetally_outbox s
            WHERE s.sale_id = o.sale_id AND s.kind = 'sale' AND s.status = 'pending'))
    ORDER BY o.created_at, o.kind
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
    FOR UPDATE OF o SKIP LOCKED
  ), leased AS (
    UPDATE public.usetally_outbox o
    SET next_attempt_at = now() + interval '2 minutes'
    FROM due WHERE o.id = due.id
    RETURNING o.*
  )
  SELECT leased.id, leased.store_id, leased.sale_id, leased.kind, leased.payload, leased.attempts,
         l.key_enc, leased.created_at
  FROM leased JOIN public.usetally_links l ON l.store_id = leased.store_id
  ORDER BY leased.created_at, leased.kind;
END;
$$;

-- p_outcome: 'sent' | 'failed' (no retry) | 'retry' (at p_retry_at) | 'revoked' (401)
CREATE OR REPLACE FUNCTION public.usetally_record_outbox_result(
  p_id UUID,
  p_outcome TEXT,
  p_error TEXT DEFAULT NULL,
  p_retry_at TIMESTAMPTZ DEFAULT NULL,
  p_remote_document_id TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.usetally_outbox;
BEGIN
  SELECT * INTO v_row FROM public.usetally_outbox WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN
    RETURN;
  END IF;

  IF p_outcome = 'sent' THEN
    UPDATE public.usetally_outbox
    SET status = 'sent', sent_at = now(), attempts = attempts + 1, last_error = NULL,
        remote_document_id = COALESCE(left(p_remote_document_id, 200), remote_document_id)
    WHERE id = p_id;
    UPDATE public.usetally_links SET last_sync_at = now(), last_error = NULL
    WHERE store_id = v_row.store_id AND status = 'active';
  ELSIF p_outcome = 'failed' THEN
    UPDATE public.usetally_outbox
    SET status = 'failed', attempts = attempts + 1, last_error = left(p_error, 500)
    WHERE id = p_id;
    UPDATE public.usetally_links SET last_error = left(p_error, 300)
    WHERE store_id = v_row.store_id AND status = 'active';
  ELSIF p_outcome = 'retry' THEN
    UPDATE public.usetally_outbox
    SET attempts = attempts + 1, last_error = left(p_error, 500),
        next_attempt_at = COALESCE(p_retry_at, now() + interval '1 minute')
    WHERE id = p_id;
    UPDATE public.usetally_links SET last_error = left(p_error, 300)
    WHERE store_id = v_row.store_id AND status = 'active';
  ELSIF p_outcome = 'revoked' THEN
    UPDATE public.usetally_outbox
    SET next_attempt_at = now(), last_error = 'Usetally rejected the link key'
    WHERE id = p_id;
    PERFORM public.usetally_revoke_link(v_row.store_id, NULL, 'Usetally rejected the link key (401). Connect again.', FALSE);
  ELSE
    RAISE EXCEPTION 'Unknown outbox outcome: %', p_outcome;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.usetally_retry_failed(p_store_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE public.usetally_outbox
  SET status = 'pending', attempts = 0, next_attempt_at = now(), last_error = NULL
  WHERE store_id = p_store_id AND status = 'failed';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ============================================================
-- 6. STOCK FROM USETALLY INVOICES (contract section 4, POST usetally-stock)
-- ============================================================
-- Idempotent on document_id. Each line becomes a 'sale' inventory movement with
-- reason 'Usetally invoice <number>' through _apply_inventory_movement_internal,
-- the same core create_sale uses. The contract says stock may go negative (the
-- sale already happened), so when the store does not allow negative stock and a
-- line would take the product below zero, the identical ledger write is made here
-- without that check (same columns, same constraint, same lock order).
-- Products tracked by lots are deducted at product level only, which is what
-- create_sale does before its separate lot allocation step; no sale exists here
-- to allocate lots against.
CREATE OR REPLACE FUNCTION public.usetally_apply_stock(
  p_store_id UUID,
  p_document_id UUID,
  p_number TEXT,
  p_lines JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted UUID;
  v_actor UUID;
  v_org UUID;
  v_reason TEXT := left('Usetally invoice ' || COALESCE(NULLIF(trim(p_number), ''), p_document_id::TEXT), 200);
  v_line RECORD;
  v_product public.products;
  v_allow_negative BOOLEAN;
  v_new_qty NUMERIC;
  v_applied JSONB := '[]'::jsonb;
  v_skipped JSONB := '[]'::jsonb;
BEGIN
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'lines must be an array';
  END IF;

  INSERT INTO public.usetally_stock_applied (document_id, store_id, number, lines)
  VALUES (p_document_id, p_store_id, p_number, p_lines)
  ON CONFLICT (document_id) DO NOTHING
  RETURNING document_id INTO v_inserted;
  IF v_inserted IS NULL THEN
    RETURN jsonb_build_object('applied', FALSE, 'reason', 'already applied');
  END IF;

  SELECT l.connected_by, s.org_id INTO v_actor, v_org
  FROM public.stores s LEFT JOIN public.usetally_links l ON l.store_id = s.id
  WHERE s.id = p_store_id;
  IF v_actor IS NULL THEN
    SELECT created_by INTO v_actor FROM public.stores WHERE id = p_store_id;
  END IF;

  SELECT COALESCE(allow_negative_stock, FALSE) INTO v_allow_negative
  FROM public.store_settings WHERE store_id = p_store_id;
  v_allow_negative := COALESCE(v_allow_negative, FALSE);

  -- One movement per product, locked in id order so concurrent calls cannot deadlock.
  FOR v_line IN
    SELECT (l->>'product_id')::UUID AS product_id, SUM((l->>'quantity')::NUMERIC) AS quantity
    FROM jsonb_array_elements(p_lines) l
    GROUP BY 1 ORDER BY 1
  LOOP
    IF v_line.quantity IS NULL OR v_line.quantity <= 0 THEN
      v_skipped := v_skipped || jsonb_build_object('product_id', v_line.product_id, 'reason', 'invalid quantity');
      CONTINUE;
    END IF;

    SELECT * INTO v_product FROM public.products
    WHERE id = v_line.product_id AND store_id = p_store_id FOR UPDATE;
    IF v_product.id IS NULL THEN
      v_skipped := v_skipped || jsonb_build_object('product_id', v_line.product_id, 'reason', 'not found');
      CONTINUE;
    END IF;
    IF NOT v_product.track_inventory THEN
      v_skipped := v_skipped || jsonb_build_object('product_id', v_line.product_id, 'reason', 'stock not tracked');
      CONTINUE;
    END IF;

    v_new_qty := v_product.stock_qty - v_line.quantity;
    IF v_new_qty >= 0 OR v_allow_negative THEN
      PERFORM public._apply_inventory_movement_internal(
        p_store_id, v_product.id, 'sale', -v_line.quantity, v_reason, 'usetally_invoice', p_document_id, v_actor);
    ELSE
      UPDATE public.products SET stock_qty = v_new_qty WHERE id = v_product.id;
      INSERT INTO public.inventory_movements (
        store_id, product_id, movement_type, quantity, quantity_before, quantity_after,
        reason, source_type, source_id, created_by
      ) VALUES (
        p_store_id, v_product.id, 'sale', -v_line.quantity, v_product.stock_qty, v_new_qty,
        v_reason, 'usetally_invoice', p_document_id, v_actor
      );
    END IF;
    v_applied := v_applied || jsonb_build_object('product_id', v_product.id, 'quantity', trim_scale(v_line.quantity));
  END LOOP;

  INSERT INTO public.audit_logs (actor_id, org_id, store_id, action, resource_type, resource_id, resource_name, details)
  VALUES (NULL, v_org, p_store_id, 'USETALLY_STOCK_APPLIED', 'usetally_invoice', p_document_id, p_number,
          jsonb_build_object('applied', v_applied, 'skipped', v_skipped));

  RETURN jsonb_build_object('applied', TRUE, 'skipped', v_skipped);
END;
$$;

REVOKE ALL ON FUNCTION public.usetally_save_link(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.usetally_revoke_link(UUID, UUID, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.usetally_claim_outbox(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.usetally_record_outbox_result(UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.usetally_retry_failed(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.usetally_apply_stock(UUID, UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.usetally_save_link(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.usetally_revoke_link(UUID, UUID, TEXT, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.usetally_claim_outbox(UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.usetally_record_outbox_result(UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.usetally_retry_failed(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.usetally_apply_stock(UUID, UUID, TEXT, JSONB) TO service_role;

-- ============================================================
-- 7. SAFE STATUS READ FOR THE SETTINGS SCREEN
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_usetally_link_status(p_store_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link public.usetally_links;
  v_pending INTEGER;
  v_failed INTEGER;
  v_sent INTEGER;
  v_store_currency TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.user_has_permission(auth.uid(), p_store_id, 'store:update') THEN
    RAISE EXCEPTION 'Permission denied: store:update required';
  END IF;

  SELECT * INTO v_link FROM public.usetally_links WHERE store_id = p_store_id;
  SELECT currency INTO v_store_currency FROM public.stores WHERE id = p_store_id;
  SELECT COUNT(*) FILTER (WHERE status = 'pending'), COUNT(*) FILTER (WHERE status = 'failed'),
         COUNT(*) FILTER (WHERE status = 'sent')
  INTO v_pending, v_failed, v_sent
  FROM public.usetally_outbox WHERE store_id = p_store_id;

  RETURN jsonb_build_object(
    'status', CASE WHEN v_link.id IS NULL THEN 'none' ELSE v_link.status END,
    'business_name', v_link.business_name,
    'business_currency', v_link.business_currency,
    'store_currency', COALESCE(v_store_currency, 'NGN'),
    'key_hint', v_link.key_hint,
    'connected_at', v_link.connected_at,
    'revoked_at', v_link.revoked_at,
    'last_sync_at', v_link.last_sync_at,
    'last_error', v_link.last_error,
    'pending', COALESCE(v_pending, 0),
    'failed', COALESCE(v_failed, 0),
    'sent', COALESCE(v_sent, 0)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_usetally_link_status(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_usetally_link_status(UUID) TO authenticated, service_role;

-- ============================================================
-- 8. EVERY-MINUTE DELIVERY (pg_cron + pg_net, when available)
-- ============================================================
-- usetally_cron_tick() calls usetally-sync only when something is due, so an
-- idle store costs one indexed query a minute and no HTTP request. It reads two
-- Vault secrets, created once per project:
--   select vault.create_secret('https://<project-ref>.supabase.co', 'usetally_project_url');
--   select vault.create_secret('<USETALLY_SYNC_TOKEN or service role key>', 'usetally_sync_token');
-- Missing secrets, Vault or pg_net make it a silent no-op.
--
-- ALTERNATIVE where pg_cron/pg_net are unavailable: any scheduler can
--   POST https://<project-ref>.supabase.co/functions/v1/usetally-sync
--   Authorization: Bearer <USETALLY_SYNC_TOKEN>      body: {}
-- once a minute. Checkout also nudges the function, so a missing schedule only
-- delays retries; it never loses a sale (rows stay pending in the outbox).
CREATE OR REPLACE FUNCTION public.usetally_cron_tick()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url TEXT;
  v_token TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.usetally_outbox o
    JOIN public.usetally_links l ON l.store_id = o.store_id AND l.status = 'active'
    WHERE o.status = 'pending' AND o.next_attempt_at <= now()
  ) THEN
    RETURN;
  END IF;

  BEGIN
    EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1 LIMIT 1'
      INTO v_url USING 'usetally_project_url';
    EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1 LIMIT 1'
      INTO v_token USING 'usetally_sync_token';
    IF v_url IS NULL OR v_token IS NULL THEN
      RETURN;
    END IF;
    EXECUTE 'SELECT net.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := 55000)'
      USING rtrim(v_url, '/') || '/functions/v1/usetally-sync',
            jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_token),
            jsonb_build_object('source', 'cron');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'usetally cron tick skipped: %', SQLERRM;
  END;
END;
$$;
REVOKE ALL ON FUNCTION public.usetally_cron_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.usetally_cron_tick() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net') THEN
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
        EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions';
      END IF;
      EXECUTE $cron$SELECT cron.schedule('usetally-sync', '* * * * *', 'SELECT public.usetally_cron_tick()')$cron$;
      RAISE NOTICE 'usetally-sync scheduled every minute with pg_cron';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'usetally-sync was not scheduled (%). Use an external scheduler; see the comment above.', SQLERRM;
    END;
  ELSE
    RAISE NOTICE 'pg_cron/pg_net are not available; usetally-sync must be scheduled externally.';
  END IF;
END $$;
