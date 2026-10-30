-- ============================================================
-- 20261030004001: PRIVACY & DATA, DAILY EMAIL, TIME IN THE APP
-- ============================================================
--  1. Daily email: store_settings.daily_email (on by default) and a send log
--     so a store gets at most one digest a day. daily_digest_data(day) is what
--     the daily-digest Edge Function reads (service role only).
--  2. Download my data: export_store_data(store) returns everything a store
--     holds, for people who can change the store (store:update).
--  3. Delete business: the owner schedules it (typed name), 30 days to cancel,
--     then purge_due_businesses() removes it (daily, service role / pg_cron).
--     business_deletions keeps a record that it happened, without the data.
--  4. Delete my account: prepare_account_deletion() removes memberships and
--     scrubs the profile; the delete-account Edge Function then closes the
--     login. Refused while the person still owns a business.
--  5. Time in the app: usage_daily per person, store, day and screen area.
--     Counted only while the tab is visible and the person is active. Only
--     platform admins read it, through get_platform_usage(days).
-- ============================================================

-- 1 ----------------------------------------------------------------------------
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS daily_email BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS public.digest_log (
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  sent_to INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, day)
);
ALTER TABLE public.digest_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.digest_log FROM anon, authenticated;
GRANT ALL ON public.digest_log TO service_role;

-- owners and managers turn the daily email on or off for their store
CREATE OR REPLACE FUNCTION public.set_daily_email(p_store_id UUID, p_on BOOLEAN)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.user_has_permission(auth.uid(), p_store_id, 'store:update') THEN
    RAISE EXCEPTION 'Only an owner or manager can change this';
  END IF;
  INSERT INTO public.store_settings(store_id, daily_email) VALUES (p_store_id, COALESCE(p_on, TRUE))
    ON CONFLICT (store_id) DO UPDATE SET daily_email = EXCLUDED.daily_email, updated_at = now();
  RETURN COALESCE(p_on, TRUE);
END; $$;
REVOKE ALL ON FUNCTION public.set_daily_email(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_daily_email(UUID, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_daily_email(p_store_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT COALESCE((SELECT daily_email FROM public.store_settings WHERE store_id = p_store_id), TRUE)
  WHERE EXISTS (SELECT 1 FROM public.store_members m WHERE m.store_id = p_store_id AND m.user_id = auth.uid() AND m.status = 'active');
$$;
REVOKE ALL ON FUNCTION public.get_daily_email(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_daily_email(UUID) TO authenticated;

-- every active store with the email on and something to say about the given
-- day (in the store's own time zone): sales, how they were paid, low stock.
-- Recipients: the business owner and the store's owners and managers.
CREATE OR REPLACE FUNCTION public.daily_digest_data(p_day DATE DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE out JSONB := '[]'::JSONB; s RECORD; d DATE; v_from TIMESTAMPTZ; v_to TIMESTAMPTZ; sales JSONB; pays JSONB; low JSONB; rcpt JSONB;
BEGIN
  FOR s IN
    SELECT st.id, st.name, COALESCE(NULLIF(st.currency, ''), 'NGN') AS currency, COALESCE(NULLIF(st.timezone, ''), 'Africa/Lagos') AS tz, st.org_id
    FROM public.stores st
    LEFT JOIN public.store_settings ss ON ss.store_id = st.id
    JOIN public.organizations o ON o.id = st.org_id
    WHERE st.status = 'active' AND COALESCE(ss.daily_email, TRUE) AND NOT COALESCE(o.is_sandbox, FALSE)
  LOOP
    BEGIN
      d := COALESCE(p_day, ((now() AT TIME ZONE s.tz)::DATE - 1));
    EXCEPTION WHEN OTHERS THEN d := COALESCE(p_day, ((now() AT TIME ZONE 'Africa/Lagos')::DATE - 1)); s.tz := 'Africa/Lagos';
    END;
    IF EXISTS (SELECT 1 FROM public.digest_log WHERE store_id = s.id AND day = d) THEN CONTINUE; END IF;
    v_from := (d::TIMESTAMP AT TIME ZONE s.tz);
    v_to := ((d + 1)::TIMESTAMP AT TIME ZONE s.tz);

    SELECT jsonb_build_object('count', COUNT(*), 'total', COALESCE(SUM(total), 0), 'voided',
             (SELECT COUNT(*) FROM public.sales v WHERE v.store_id = s.id AND v.status = 'voided' AND v.voided_at >= v_from AND v.voided_at < v_to))
      INTO sales FROM public.sales x WHERE x.store_id = s.id AND x.status = 'completed' AND x.created_at >= v_from AND x.created_at < v_to;
    -- money taken by method; change given back comes out of cash
    SELECT COALESCE(jsonb_agg(jsonb_build_object('method', method, 'amount', amount) ORDER BY amount DESC), '[]'::JSONB) INTO pays FROM (
      SELECT sp.method, SUM(sp.amount) - CASE WHEN sp.method = 'cash' THEN COALESCE((SELECT SUM(change_due) FROM public.sales c
               WHERE c.store_id = s.id AND c.status = 'completed' AND c.created_at >= v_from AND c.created_at < v_to), 0) ELSE 0 END AS amount
      FROM public.sale_payments sp JOIN public.sales x ON x.id = sp.sale_id
      WHERE x.store_id = s.id AND x.status = 'completed' AND x.created_at >= v_from AND x.created_at < v_to AND sp.verification_status <> 'rejected'
      GROUP BY sp.method) p WHERE amount > 0;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('name', name, 'stock', stock_qty, 'reorder', reorder_level, 'unit', unit) ORDER BY stock_qty, name), '[]'::JSONB) INTO low FROM (
      SELECT name, stock_qty, reorder_level, unit FROM public.products
      WHERE store_id = s.id AND status = 'active' AND track_inventory AND reorder_level > 0 AND stock_qty <= reorder_level
      ORDER BY stock_qty, name LIMIT 25) l;

    IF (sales->>'count')::INT = 0 AND jsonb_array_length(low) = 0 THEN CONTINUE; END IF;

    SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object('email', u.email, 'name', NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), ''))), '[]'::JSONB)
      INTO rcpt FROM public.users u
      WHERE COALESCE(u.status, 'active') = 'active' AND u.email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND (
        u.id = (SELECT owner_id FROM public.organizations WHERE id = s.org_id)
        OR u.id IN (SELECT m.user_id FROM public.store_members m JOIN public.roles r ON r.id = m.role_id
                    WHERE m.store_id = s.id AND m.status = 'active' AND r.name IN ('owner', 'manager')));
    IF jsonb_array_length(rcpt) = 0 THEN CONTINUE; END IF;

    out := out || jsonb_build_array(jsonb_build_object('store_id', s.id, 'store', s.name, 'currency', s.currency, 'day', d,
      'sales', sales, 'payments', pays, 'low_stock', low, 'recipients', rcpt));
  END LOOP;
  RETURN out;
END; $$;
REVOKE ALL ON FUNCTION public.daily_digest_data(DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.daily_digest_data(DATE) TO service_role;

CREATE OR REPLACE FUNCTION public.record_digest_sent(p_store_id UUID, p_day DATE, p_sent INTEGER)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.digest_log(store_id, day, sent_to) VALUES (p_store_id, p_day, GREATEST(COALESCE(p_sent, 0), 0))
  ON CONFLICT (store_id, day) DO NOTHING;
$$;
REVOKE ALL ON FUNCTION public.record_digest_sent(UUID, DATE, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_digest_sent(UUID, DATE, INTEGER) TO service_role;

-- 2 ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.export_store_data(p_store_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r JSONB;
BEGIN
  IF NOT public.user_has_permission(auth.uid(), p_store_id, 'store:update') THEN
    RAISE EXCEPTION 'Only an owner or manager can download this store''s data';
  END IF;
  SELECT jsonb_build_object(
    'exported_at', now(),
    'store', (SELECT to_jsonb(s) FROM public.stores s WHERE s.id = p_store_id),
    'categories', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.name), '[]') FROM public.product_categories t WHERE t.store_id = p_store_id),
    'products', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.name), '[]') FROM (SELECT * FROM public.products WHERE store_id = p_store_id LIMIT 50000) t),
    'variants', (SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]') FROM (SELECT * FROM public.product_variants WHERE store_id = p_store_id LIMIT 50000) t),
    'customers', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.name), '[]') FROM (SELECT * FROM public.customers WHERE store_id = p_store_id LIMIT 50000) t),
    'suppliers', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.name), '[]') FROM public.suppliers t WHERE t.store_id = p_store_id),
    'sales', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.created_at), '[]') FROM (SELECT * FROM public.sales WHERE store_id = p_store_id ORDER BY created_at DESC LIMIT 50000) t),
    'sale_items', (SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]') FROM (SELECT i.* FROM public.sale_items i JOIN public.sales x ON x.id = i.sale_id WHERE x.store_id = p_store_id LIMIT 200000) t),
    'sale_payments', (SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]') FROM (SELECT p.* FROM public.sale_payments p JOIN public.sales x ON x.id = p.sale_id WHERE x.store_id = p_store_id LIMIT 200000) t),
    'refunds', (SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]') FROM public.refunds t WHERE t.store_id = p_store_id),
    'expenses', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.spent_on), '[]') FROM public.expenses t WHERE t.store_id = p_store_id),
    'purchases', (SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]') FROM public.purchases t WHERE t.store_id = p_store_id),
    'stock_movements', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.created_at), '[]') FROM (SELECT * FROM public.inventory_movements WHERE store_id = p_store_id ORDER BY created_at DESC LIMIT 100000) t)
  ) INTO r;
  INSERT INTO public.audit_logs (actor_id, org_id, store_id, action, resource_type, resource_name, details)
  SELECT auth.uid(), s.org_id, s.id, 'DATA_EXPORTED', 'store', s.name, '{}'::JSONB FROM public.stores s WHERE s.id = p_store_id;
  RETURN r;
END; $$;
REVOKE ALL ON FUNCTION public.export_store_data(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.export_store_data(UUID) TO authenticated;

-- 3 ----------------------------------------------------------------------------
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS deletion_due_at TIMESTAMPTZ;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS deletion_requested_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.business_deletions (
  org_id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  requested_by UUID,
  requested_at TIMESTAMPTZ,
  purged_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.business_deletions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.business_deletions FROM anon, authenticated;
GRANT ALL ON public.business_deletions TO service_role;

CREATE OR REPLACE FUNCTION public.is_business_owner(p_org_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = p_org_id AND o.owner_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.organization_members m WHERE m.org_id = p_org_id AND m.user_id = auth.uid() AND m.role = 'owner');
$$;
REVOKE ALL ON FUNCTION public.is_business_owner(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_business_owner(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_business_deletion(p_org_id UUID)
RETURNS JSONB LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT jsonb_build_object('owner', public.is_business_owner(o.id), 'name', o.name,
    'requested_at', o.deletion_requested_at, 'due_at', o.deletion_due_at)
  FROM public.organizations o
  WHERE o.id = p_org_id AND EXISTS (SELECT 1 FROM public.organization_members m WHERE m.org_id = o.id AND m.user_id = auth.uid()
                                   UNION SELECT 1 WHERE o.owner_id = auth.uid());
$$;
REVOKE ALL ON FUNCTION public.get_business_deletion(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_business_deletion(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.request_business_deletion(p_org_id UUID, p_confirm_name TEXT)
RETURNS TIMESTAMPTZ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.organizations%ROWTYPE; due TIMESTAMPTZ := now() + INTERVAL '30 days';
BEGIN
  SELECT * INTO o FROM public.organizations WHERE id = p_org_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_business_owner(p_org_id) THEN RAISE EXCEPTION 'Only the business owner can delete it'; END IF;
  IF lower(trim(COALESCE(p_confirm_name, ''))) <> lower(trim(o.name)) THEN RAISE EXCEPTION 'Type the business name exactly to confirm'; END IF;
  IF o.deletion_due_at IS NOT NULL THEN RETURN o.deletion_due_at; END IF;
  UPDATE public.organizations SET deletion_requested_at = now(), deletion_due_at = due, deletion_requested_by = auth.uid(), updated_at = now() WHERE id = p_org_id;
  INSERT INTO public.audit_logs (actor_id, org_id, action, resource_type, resource_name, details)
    VALUES (auth.uid(), p_org_id, 'BUSINESS_DELETION_SCHEDULED', 'organization', o.name, jsonb_build_object('due_at', due));
  RETURN due;
END; $$;
REVOKE ALL ON FUNCTION public.request_business_deletion(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_business_deletion(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_business_deletion(p_org_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.organizations%ROWTYPE;
BEGIN
  SELECT * INTO o FROM public.organizations WHERE id = p_org_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_business_owner(p_org_id) THEN RAISE EXCEPTION 'Only the business owner can cancel this'; END IF;
  IF o.deletion_due_at IS NULL THEN RETURN; END IF;
  UPDATE public.organizations SET deletion_requested_at = NULL, deletion_due_at = NULL, deletion_requested_by = NULL, updated_at = now() WHERE id = p_org_id;
  INSERT INTO public.audit_logs (actor_id, org_id, action, resource_type, resource_name, details)
    VALUES (auth.uid(), p_org_id, 'BUSINESS_DELETION_CANCELLED', 'organization', o.name, '{}'::JSONB);
END; $$;
REVOKE ALL ON FUNCTION public.cancel_business_deletion(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_business_deletion(UUID) TO authenticated;

-- removes businesses whose 30 days have passed (service role / daily pg_cron)
CREATE OR REPLACE FUNCTION public.purge_due_businesses()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o RECORD; n INTEGER := 0;
BEGIN
  FOR o IN SELECT id, name, deletion_requested_by, deletion_requested_at FROM public.organizations
           WHERE deletion_due_at IS NOT NULL AND deletion_due_at <= now() ORDER BY deletion_due_at LIMIT 50 LOOP
    BEGIN
      INSERT INTO public.business_deletions(org_id, name, requested_by, requested_at) VALUES (o.id, o.name, o.deletion_requested_by, o.deletion_requested_at)
        ON CONFLICT (org_id) DO NOTHING;
      -- children first, while their store still exists: their delete audit
      -- rows point at the store (and go with the business at the end)
      DELETE FROM public.merchant_payment_attempts WHERE org_id = o.id OR store_id IN (SELECT id FROM public.stores WHERE org_id = o.id);
      DELETE FROM public.sale_payments WHERE sale_id IN (SELECT x.id FROM public.sales x JOIN public.stores st ON st.id = x.store_id WHERE st.org_id = o.id);
      DELETE FROM public.sale_items WHERE sale_id IN (SELECT x.id FROM public.sales x JOIN public.stores st ON st.id = x.store_id WHERE st.org_id = o.id);
      DELETE FROM public.refunds WHERE store_id IN (SELECT id FROM public.stores WHERE org_id = o.id);
      DELETE FROM public.sales WHERE store_id IN (SELECT id FROM public.stores WHERE org_id = o.id);
      DELETE FROM public.inventory_movements WHERE store_id IN (SELECT id FROM public.stores WHERE org_id = o.id);
      DELETE FROM public.stock_lots WHERE store_id IN (SELECT id FROM public.stores WHERE org_id = o.id);
      DELETE FROM public.product_variants WHERE store_id IN (SELECT id FROM public.stores WHERE org_id = o.id);
      DELETE FROM public.purchases WHERE store_id IN (SELECT id FROM public.stores WHERE org_id = o.id);
      DELETE FROM public.products WHERE store_id IN (SELECT id FROM public.stores WHERE org_id = o.id);
      DELETE FROM public.product_categories WHERE store_id IN (SELECT id FROM public.stores WHERE org_id = o.id);
      DELETE FROM public.expenses WHERE store_id IN (SELECT id FROM public.stores WHERE org_id = o.id);
      DELETE FROM public.customers WHERE store_id IN (SELECT id FROM public.stores WHERE org_id = o.id);
      DELETE FROM public.suppliers WHERE store_id IN (SELECT id FROM public.stores WHERE org_id = o.id);
      DELETE FROM public.devices WHERE store_id IN (SELECT id FROM public.stores WHERE org_id = o.id);
      DELETE FROM public.tailoring_jobs WHERE store_id IN (SELECT id FROM public.stores WHERE org_id = o.id);
      DELETE FROM public.material_quotes WHERE store_id IN (SELECT id FROM public.stores WHERE org_id = o.id);
      UPDATE public.users SET current_org_id = NULL, current_store_id = NULL
        WHERE current_org_id = o.id OR current_store_id IN (SELECT id FROM public.stores WHERE org_id = o.id);
      DELETE FROM public.organizations WHERE id = o.id;
      n := n + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'business % was not purged: %', o.id, SQLERRM;
    END;
  END LOOP;
  RETURN n;
END; $$;
REVOKE ALL ON FUNCTION public.purge_due_businesses() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_due_businesses() TO service_role;

-- a business waiting to be deleted can't be used meanwhile: hide it from sign-in choices
-- (the app shows the countdown and a Cancel button to the owner)

-- 4 ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prepare_account_deletion()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me UUID := auth.uid(); owned TEXT;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Sign in to continue'; END IF;
  SELECT string_agg(o.name, ', ') INTO owned FROM public.organizations o
    WHERE (o.owner_id = me OR EXISTS (SELECT 1 FROM public.organization_members m WHERE m.org_id = o.id AND m.user_id = me AND m.role = 'owner'))
      AND o.deletion_due_at IS NULL;
  IF owned IS NOT NULL THEN
    RAISE EXCEPTION 'You own %. Delete the business first (or hand it to someone else), then delete your account.', owned;
  END IF;
  INSERT INTO public.audit_logs (actor_id, action, resource_type, resource_name, details)
    VALUES (me, 'ACCOUNT_DELETED', 'user', me::TEXT, '{}'::JSONB);
  DELETE FROM public.store_members WHERE user_id = me;
  DELETE FROM public.organization_members WHERE user_id = me AND role <> 'owner';
  DELETE FROM public.usage_daily WHERE user_id = me;
  UPDATE public.users SET email = 'deleted-' || me::TEXT || '@deleted.invalid', first_name = NULL, last_name = NULL, phone = NULL,
      avatar_url = NULL, current_org_id = NULL, current_store_id = NULL, status = 'inactive', updated_at = now()
    WHERE id = me;
  RETURN jsonb_build_object('user_id', me);
END; $$;
REVOKE ALL ON FUNCTION public.prepare_account_deletion() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prepare_account_deletion() TO authenticated;

-- 5 ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.usage_daily (
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  area TEXT NOT NULL CHECK (area ~ '^/[a-z0-9/:_-]{0,79}$'),
  seconds INTEGER NOT NULL DEFAULT 0 CHECK (seconds >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, store_id, day, area)
);
CREATE INDEX IF NOT EXISTS usage_daily_day_idx ON public.usage_daily(day);
ALTER TABLE public.usage_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.usage_daily FROM anon, authenticated;
GRANT ALL ON public.usage_daily TO service_role;

-- at most 5 minutes a call and 16 hours a day per person; platform admins aren't counted
CREATE OR REPLACE FUNCTION public.usage_add(p_store_id UUID, p_area TEXT, p_seconds INTEGER)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me UUID := auth.uid(); d DATE := (now() AT TIME ZONE 'Africa/Lagos')::DATE; total INTEGER; secs INTEGER := p_seconds;
BEGIN
  IF me IS NULL OR secs IS NULL OR secs <= 0 OR COALESCE(p_area, '') !~ '^/[a-z0-9/:_-]{0,79}$' THEN RETURN; END IF;
  IF public.is_platform_admin(me) THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.store_members WHERE store_id = p_store_id AND user_id = me AND status = 'active') THEN RETURN; END IF;
  SELECT COALESCE(SUM(seconds), 0) INTO total FROM public.usage_daily WHERE user_id = me AND day = d;
  secs := LEAST(secs, 300, GREATEST(0, 57600 - total));
  IF secs <= 0 THEN RETURN; END IF;
  INSERT INTO public.usage_daily(user_id, store_id, day, area, seconds) VALUES (me, p_store_id, d, p_area, secs)
    ON CONFLICT (user_id, store_id, day, area) DO UPDATE SET seconds = public.usage_daily.seconds + EXCLUDED.seconds, updated_at = now();
END; $$;
REVOKE ALL ON FUNCTION public.usage_add(UUID, TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.usage_add(UUID, TEXT, INTEGER) TO authenticated;

-- Platform → Usage: rows for the last N days (1–90), names attached
CREATE OR REPLACE FUNCTION public.get_platform_usage(p_days INTEGER DEFAULT 30)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE since DATE := (now() AT TIME ZONE 'Africa/Lagos')::DATE - (LEAST(GREATEST(COALESCE(p_days, 30), 1), 90) - 1);
BEGIN
  PERFORM public.require_platform_permission('platform:view');
  RETURN (SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', u.user_id, 'store_id', u.store_id, 'store', s.name, 'business', o.name,
      'day', u.day, 'area', u.area, 'seconds', u.seconds)), '[]'::JSONB)
    FROM (SELECT * FROM public.usage_daily WHERE day >= since LIMIT 100000) u
    JOIN public.stores s ON s.id = u.store_id JOIN public.organizations o ON o.id = s.org_id);
END; $$;
REVOKE ALL ON FUNCTION public.get_platform_usage(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_platform_usage(INTEGER) TO authenticated;

-- 6. SCHEDULE (pg_cron + pg_net when available) --------------------------------
-- daily at 07:00 Lagos (06:00 UTC): purge due businesses, then call daily-digest.
-- daily-digest needs two Vault secrets: usetally_project_url (already used by
-- the Usetally sync) and digest_token (= the DIGEST_TOKEN Edge secret).
CREATE OR REPLACE FUNCTION public.daily_jobs_tick()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_url TEXT; v_token TEXT;
BEGIN
  PERFORM public.purge_due_businesses();
  BEGIN
    EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1 LIMIT 1' INTO v_url USING 'usetally_project_url';
    EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1 LIMIT 1' INTO v_token USING 'digest_token';
    IF v_url IS NULL OR v_token IS NULL THEN RETURN; END IF;
    EXECUTE 'SELECT net.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := 55000)'
      USING rtrim(v_url, '/') || '/functions/v1/daily-digest',
            jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_token),
            jsonb_build_object('source', 'cron');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'daily digest tick skipped: %', SQLERRM;
  END;
END; $$;
REVOKE ALL ON FUNCTION public.daily_jobs_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.daily_jobs_tick() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog';
      END IF;
      EXECUTE $cron$SELECT cron.schedule('trackoja-daily-jobs', '0 6 * * *', 'SELECT public.daily_jobs_tick()')$cron$;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'daily jobs not scheduled: %', SQLERRM;
    END;
  ELSE
    RAISE NOTICE 'pg_cron is not available; schedule daily_jobs_tick() externally.';
  END IF;
END $$;
