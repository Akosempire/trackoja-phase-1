-- ============================================================
-- 20261030001000: TILL SESSIONS, CASH MOVEMENTS, CASHIER PINS
-- ============================================================
-- 1. till_sessions: a cashier opens the till with a float and closes it by
--    counting the cash. Expected cash at close =
--      float + cash taken − change given + cash in − cash out − cash refunds
--    for the sales and refunds linked to the session. The close stores a
--    snapshot (the end-of-day "Z" report) in report.
-- 2. till_cash_movements: money put in or taken out mid-shift (float top-up,
--    paying a supplier from the drawer, a bank drop).
-- 3. sales / refunds get till_session_id and cashier_id, filled by BEFORE
--    INSERT triggers, so create_sale / process_refund keep their signatures.
--    The session is the account's open session in that store, else the store's
--    only open session. cashier_id is the person identified by PIN on this
--    account (see 4), else the signed-in account.
--    store_settings.require_open_till (default off) refuses a sale when no till
--    is open.
-- 4. Cashier PINs: owners/managers set a 4-6 digit PIN per staff member
--    (bcrypt via pgcrypto; never readable). On a shared device a staff member
--    enters their PIN to be the acting cashier for 12 hours. A PIN identifies
--    who is selling; permissions stay those of the signed-in account. A
--    manager's PIN can approve a void or refund the signed-in account can't do.
--    5 wrong PINs lock PIN entry for that account in that store for 5 minutes.
-- ============================================================

ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS require_open_till BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS public.till_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  opened_by UUID NOT NULL REFERENCES public.users(id),
  opened_cashier_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  opening_float NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (opening_float >= 0),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  closed_by UUID REFERENCES public.users(id),
  closed_cashier_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  counted_cash NUMERIC(14,2) CHECK (counted_cash IS NULL OR counted_cash >= 0),
  expected_cash NUMERIC(14,2),
  difference NUMERIC(14,2),
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 1000),
  report JSONB,
  CHECK ((status = 'open' AND closed_at IS NULL) OR (status = 'closed' AND closed_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS till_sessions_one_open_per_account
  ON public.till_sessions(store_id, opened_by) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS till_sessions_store_opened ON public.till_sessions(store_id, opened_at DESC);

CREATE TABLE IF NOT EXISTS public.till_cash_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.till_sessions(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('in', 'out')),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 2 AND 200),
  created_by UUID NOT NULL REFERENCES public.users(id),
  cashier_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS till_cash_movements_session ON public.till_cash_movements(session_id, created_at);

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS till_session_id UUID REFERENCES public.till_sessions(id) ON DELETE SET NULL;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS cashier_id UUID REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.refunds ADD COLUMN IF NOT EXISTS till_session_id UUID REFERENCES public.till_sessions(id) ON DELETE SET NULL;
ALTER TABLE public.refunds ADD COLUMN IF NOT EXISTS cashier_id UUID REFERENCES public.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS sales_till_session ON public.sales(till_session_id) WHERE till_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS refunds_till_session ON public.refunds(till_session_id) WHERE till_session_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.staff_pins (
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  pin_hash TEXT NOT NULL,
  updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.till_acting_cashiers (
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  cashier_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  set_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (store_id, account_id)
);

CREATE TABLE IF NOT EXISTS public.pin_attempts (
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  failures INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  PRIMARY KEY (store_id, account_id)
);

ALTER TABLE public.till_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.till_cash_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.till_acting_cashiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pin_attempts ENABLE ROW LEVEL SECURITY;

-- People who see reports see every session; everyone else sees their own.
DROP POLICY IF EXISTS till_sessions_read ON public.till_sessions;
CREATE POLICY till_sessions_read ON public.till_sessions FOR SELECT USING (
  opened_by = auth.uid() OR public.user_has_permission(auth.uid(), store_id, 'reports:view'));
DROP POLICY IF EXISTS till_cash_movements_read ON public.till_cash_movements;
CREATE POLICY till_cash_movements_read ON public.till_cash_movements FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.till_sessions s WHERE s.id = session_id
          AND (s.opened_by = auth.uid() OR public.user_has_permission(auth.uid(), s.store_id, 'reports:view'))));
DROP POLICY IF EXISTS till_acting_read ON public.till_acting_cashiers;
CREATE POLICY till_acting_read ON public.till_acting_cashiers FOR SELECT USING (account_id = auth.uid());
-- staff_pins and pin_attempts: no policies, so nobody reads them from the app.
REVOKE ALL ON public.staff_pins, public.pin_attempts FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.till_sessions, public.till_cash_movements, public.till_acting_cashiers FROM anon, authenticated;

-- ------------------------------------------------------------
-- Helpers
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._till_session_for(p_store_id UUID, p_account UUID)
RETURNS UUID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID; v_count INTEGER;
BEGIN
  SELECT id INTO v_id FROM public.till_sessions WHERE store_id = p_store_id AND status = 'open' AND opened_by = p_account;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  SELECT count(*), min(id::text)::uuid INTO v_count, v_id FROM public.till_sessions WHERE store_id = p_store_id AND status = 'open';
  RETURN CASE WHEN v_count = 1 THEN v_id END;
END; $$;

CREATE OR REPLACE FUNCTION public._till_acting_cashier(p_store_id UUID, p_account UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT cashier_id FROM public.till_acting_cashiers
  WHERE store_id = p_store_id AND account_id = p_account AND expires_at > now();
$$;

CREATE OR REPLACE FUNCTION public.till_tag_sale()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_required BOOLEAN;
BEGIN
  IF NEW.till_session_id IS NULL THEN NEW.till_session_id := public._till_session_for(NEW.store_id, NEW.created_by); END IF;
  IF NEW.cashier_id IS NULL THEN NEW.cashier_id := COALESCE(public._till_acting_cashier(NEW.store_id, NEW.created_by), NEW.created_by); END IF;
  IF NEW.till_session_id IS NULL AND NEW.status IN ('completed', 'pending_payment') THEN
    SELECT require_open_till INTO v_required FROM public.store_settings WHERE store_id = NEW.store_id;
    IF COALESCE(v_required, FALSE) THEN
      RAISE EXCEPTION 'Open the till before selling (Till → Open till)';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS till_tag_sale ON public.sales;
CREATE TRIGGER till_tag_sale BEFORE INSERT ON public.sales FOR EACH ROW EXECUTE FUNCTION public.till_tag_sale();

CREATE OR REPLACE FUNCTION public.till_tag_refund()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.till_session_id IS NULL THEN NEW.till_session_id := public._till_session_for(NEW.store_id, NEW.created_by); END IF;
  IF NEW.cashier_id IS NULL THEN NEW.cashier_id := COALESCE(public._till_acting_cashier(NEW.store_id, NEW.created_by), NEW.created_by); END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS till_tag_refund ON public.refunds;
CREATE TRIGGER till_tag_refund BEFORE INSERT ON public.refunds FOR EACH ROW EXECUTE FUNCTION public.till_tag_refund();

CREATE OR REPLACE FUNCTION public._person_name(p_user UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(NULLIF(trim(concat_ws(' ', first_name, last_name)), ''), split_part(email, '@', 1), 'Staff member')
  FROM public.users WHERE id = p_user;
$$;

-- The numbers for one session, now (open) or as they stand (closed: the
-- stored report is the record).
CREATE OR REPLACE FUNCTION public._till_numbers(p_session UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s public.till_sessions;
  v_sales INTEGER; v_gross NUMERIC; v_disc NUMERIC; v_tax NUMERIC; v_change NUMERIC;
  v_voids INTEGER; v_void_total NUMERIC;
  v_refunds INTEGER; v_refund_total NUMERIC; v_refund_cash NUMERIC;
  v_cash NUMERIC; v_in NUMERIC; v_out NUMERIC; v_methods JSONB; v_moves JSONB; v_cashiers JSONB;
BEGIN
  SELECT * INTO s FROM public.till_sessions WHERE id = p_session;
  IF s.id IS NULL THEN RETURN NULL; END IF;
  SELECT count(*), COALESCE(sum(total), 0), COALESCE(sum(discount_total), 0), COALESCE(sum(tax_total), 0), COALESCE(sum(change_due), 0)
    INTO v_sales, v_gross, v_disc, v_tax, v_change
    FROM public.sales WHERE till_session_id = s.id AND status = 'completed';
  SELECT count(*), COALESCE(sum(total), 0) INTO v_voids, v_void_total
    FROM public.sales WHERE till_session_id = s.id AND status = 'voided';
  SELECT COALESCE(sum(p.amount), 0) INTO v_cash
    FROM public.sale_payments p JOIN public.sales x ON x.id = p.sale_id
    WHERE x.till_session_id = s.id AND x.status = 'completed' AND p.method = 'cash' AND p.verification_status <> 'rejected';
  SELECT COALESCE(jsonb_object_agg(method, total), '{}'::jsonb) INTO v_methods FROM (
    SELECT p.method, sum(p.amount) AS total FROM public.sale_payments p JOIN public.sales x ON x.id = p.sale_id
    WHERE x.till_session_id = s.id AND x.status = 'completed' AND p.verification_status <> 'rejected' GROUP BY p.method) m;
  SELECT count(*), COALESCE(sum(amount), 0), COALESCE(sum(amount) FILTER (WHERE method = 'cash'), 0)
    INTO v_refunds, v_refund_total, v_refund_cash FROM public.refunds WHERE till_session_id = s.id;
  SELECT COALESCE(sum(amount) FILTER (WHERE kind = 'in'), 0), COALESCE(sum(amount) FILTER (WHERE kind = 'out'), 0),
         COALESCE(jsonb_agg(jsonb_build_object('kind', kind, 'amount', amount, 'reason', reason, 'at', created_at,
           'by', public._person_name(COALESCE(cashier_id, created_by))) ORDER BY created_at), '[]'::jsonb)
    INTO v_in, v_out, v_moves FROM public.till_cash_movements WHERE session_id = s.id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('name', public._person_name(cashier_id), 'sales', n, 'total', t) ORDER BY t DESC), '[]'::jsonb)
    INTO v_cashiers FROM (SELECT cashier_id, count(*) n, sum(total) t FROM public.sales
      WHERE till_session_id = s.id AND status = 'completed' GROUP BY cashier_id) c;
  RETURN jsonb_build_object(
    'session_id', s.id, 'store_id', s.store_id, 'status', s.status,
    'opened_at', s.opened_at, 'closed_at', s.closed_at,
    'opened_by', public._person_name(COALESCE(s.opened_cashier_id, s.opened_by)),
    'closed_by', CASE WHEN s.closed_by IS NOT NULL THEN public._person_name(COALESCE(s.closed_cashier_id, s.closed_by)) END,
    'opening_float', s.opening_float,
    'sales_count', v_sales, 'sales_total', v_gross, 'discounts', v_disc, 'tax', v_tax,
    'by_method', v_methods, 'cash_taken', v_cash, 'change_given', v_change,
    'voids_count', v_voids, 'voids_total', v_void_total,
    'refunds_count', v_refunds, 'refunds_total', v_refund_total, 'refunds_cash', v_refund_cash,
    'cash_in', v_in, 'cash_out', v_out, 'movements', v_moves, 'cashiers', v_cashiers,
    'expected_cash', s.opening_float + v_cash - v_change + v_in - v_out - v_refund_cash,
    'counted_cash', s.counted_cash, 'difference', s.difference, 'notes', s.notes);
END; $$;

-- ------------------------------------------------------------
-- Till: open, cash in/out, summary, close
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.till_open(p_store_id UUID, p_opening_float NUMERIC)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT public.user_has_permission(auth.uid(), p_store_id, 'sales:create') THEN
    RAISE EXCEPTION 'You do not have permission to use the till in this branch';
  END IF;
  IF p_opening_float IS NULL OR p_opening_float < 0 OR p_opening_float > 100000000 THEN
    RAISE EXCEPTION 'Enter the cash in the drawer (0 or more)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.till_sessions WHERE store_id = p_store_id AND opened_by = auth.uid() AND status = 'open') THEN
    RAISE EXCEPTION 'Your till is already open';
  END IF;
  INSERT INTO public.till_sessions(store_id, opened_by, opened_cashier_id, opening_float)
  VALUES (p_store_id, auth.uid(), public._till_acting_cashier(p_store_id, auth.uid()), round(p_opening_float, 2))
  RETURNING id INTO v_id;
  INSERT INTO public.audit_logs (actor_id, org_id, store_id, action, resource_type, resource_id, details)
  SELECT auth.uid(), org_id, p_store_id, 'TILL_OPENED', 'till_session', v_id, jsonb_build_object('opening_float', p_opening_float)
  FROM public.stores WHERE id = p_store_id;
  RETURN public._till_numbers(v_id);
END; $$;

-- The caller's open session in this store with live numbers, or null.
CREATE OR REPLACE FUNCTION public.till_current(p_store_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT public.user_has_permission(auth.uid(), p_store_id, 'sales:create') THEN RETURN NULL; END IF;
  SELECT id INTO v_id FROM public.till_sessions WHERE store_id = p_store_id AND opened_by = auth.uid() AND status = 'open';
  RETURN CASE WHEN v_id IS NULL THEN NULL ELSE public._till_numbers(v_id) END;
END; $$;

CREATE OR REPLACE FUNCTION public._till_can_manage(s public.till_sessions)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.opened_by = auth.uid() OR public.user_has_permission(auth.uid(), s.store_id, 'store:update');
$$;

CREATE OR REPLACE FUNCTION public.till_cash_move(p_session_id UUID, p_kind TEXT, p_amount NUMERIC, p_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.till_sessions;
BEGIN
  SELECT * INTO s FROM public.till_sessions WHERE id = p_session_id FOR UPDATE;
  IF s.id IS NULL OR NOT public._till_can_manage(s) THEN RAISE EXCEPTION 'Till not found'; END IF;
  IF s.status <> 'open' THEN RAISE EXCEPTION 'This till is already closed'; END IF;
  IF p_kind NOT IN ('in', 'out') THEN RAISE EXCEPTION 'Choose money in or money out'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 100000000 THEN RAISE EXCEPTION 'Enter an amount greater than 0'; END IF;
  IF length(trim(COALESCE(p_reason, ''))) < 2 THEN RAISE EXCEPTION 'Add a short reason'; END IF;
  INSERT INTO public.till_cash_movements(session_id, store_id, kind, amount, reason, created_by, cashier_id)
  VALUES (s.id, s.store_id, p_kind, round(p_amount, 2), left(trim(p_reason), 200), auth.uid(), public._till_acting_cashier(s.store_id, auth.uid()));
  RETURN public._till_numbers(s.id);
END; $$;

CREATE OR REPLACE FUNCTION public.till_report(p_session_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.till_sessions;
BEGIN
  SELECT * INTO s FROM public.till_sessions WHERE id = p_session_id;
  IF s.id IS NULL OR NOT (s.opened_by = auth.uid() OR public.user_has_permission(auth.uid(), s.store_id, 'reports:view')) THEN
    RAISE EXCEPTION 'Till not found';
  END IF;
  IF s.status = 'closed' AND s.report IS NOT NULL THEN RETURN s.report; END IF;
  RETURN public._till_numbers(s.id);
END; $$;

CREATE OR REPLACE FUNCTION public.till_close(p_session_id UUID, p_counted_cash NUMERIC, p_notes TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.till_sessions; v_numbers JSONB; v_expected NUMERIC; v_report JSONB;
BEGIN
  SELECT * INTO s FROM public.till_sessions WHERE id = p_session_id FOR UPDATE;
  IF s.id IS NULL OR NOT public._till_can_manage(s) THEN RAISE EXCEPTION 'Till not found'; END IF;
  IF s.status <> 'open' THEN RAISE EXCEPTION 'This till is already closed'; END IF;
  IF p_counted_cash IS NULL OR p_counted_cash < 0 OR p_counted_cash > 100000000 THEN RAISE EXCEPTION 'Enter the cash you counted'; END IF;
  v_numbers := public._till_numbers(s.id);
  v_expected := (v_numbers->>'expected_cash')::NUMERIC;
  UPDATE public.till_sessions SET status = 'closed', closed_at = now(), closed_by = auth.uid(),
    closed_cashier_id = public._till_acting_cashier(s.store_id, auth.uid()),
    counted_cash = round(p_counted_cash, 2), expected_cash = v_expected,
    difference = round(p_counted_cash, 2) - v_expected, notes = NULLIF(left(trim(COALESCE(p_notes, '')), 1000), '')
  WHERE id = s.id;
  v_report := public._till_numbers(s.id);
  UPDATE public.till_sessions SET report = v_report WHERE id = s.id;
  INSERT INTO public.audit_logs (actor_id, org_id, store_id, action, resource_type, resource_id, details)
  SELECT auth.uid(), org_id, s.store_id, 'TILL_CLOSED', 'till_session', s.id,
    jsonb_build_object('expected_cash', v_expected, 'counted_cash', p_counted_cash, 'difference', round(p_counted_cash, 2) - v_expected)
  FROM public.stores WHERE id = s.store_id;
  RETURN v_report;
END; $$;

-- Till history: newest first. Managers (reports:view) see every session.
CREATE OR REPLACE FUNCTION public.till_history(p_store_id UUID, p_limit INTEGER DEFAULT 50)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(row ORDER BY (row->>'opened_at') DESC), '[]'::jsonb) FROM (
    SELECT jsonb_build_object('id', s.id, 'status', s.status, 'opened_at', s.opened_at, 'closed_at', s.closed_at,
      'opened_by', public._person_name(COALESCE(s.opened_cashier_id, s.opened_by)),
      'opening_float', s.opening_float, 'expected_cash', s.expected_cash, 'counted_cash', s.counted_cash, 'difference', s.difference,
      'sales_total', COALESCE((s.report->>'sales_total')::NUMERIC,
        (SELECT COALESCE(sum(total), 0) FROM public.sales WHERE till_session_id = s.id AND status = 'completed'))) AS row
    FROM public.till_sessions s
    WHERE s.store_id = p_store_id AND auth.uid() IS NOT NULL
      AND (s.opened_by = auth.uid() OR public.user_has_permission(auth.uid(), p_store_id, 'reports:view'))
    ORDER BY s.opened_at DESC LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
  ) t;
$$;

CREATE OR REPLACE FUNCTION public.till_set_required(p_store_id UUID, p_required BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.user_has_permission(auth.uid(), p_store_id, 'store:update') THEN RAISE EXCEPTION 'Only a manager can change this'; END IF;
  INSERT INTO public.store_settings(store_id, require_open_till) VALUES (p_store_id, COALESCE(p_required, FALSE))
  ON CONFLICT (store_id) DO UPDATE SET require_open_till = EXCLUDED.require_open_till;
END; $$;

-- ------------------------------------------------------------
-- PINs
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._pin_ok(p_pin TEXT) RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(p_pin, '') ~ '^[0-9]{4,6}$';
$$;

-- Finds the store member whose PIN this is, counting failures per account.
-- Raises a friendly error when locked or wrong.
CREATE OR REPLACE FUNCTION public._pin_match(p_store_id UUID, p_pin TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE a public.pin_attempts; v_user UUID; v_left INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO a FROM public.pin_attempts WHERE store_id = p_store_id AND account_id = auth.uid();
  IF a.locked_until IS NOT NULL AND a.locked_until > now() THEN
    RAISE EXCEPTION 'Too many wrong PINs. Try again in % minute(s)', GREATEST(1, ceil(extract(epoch FROM a.locked_until - now()) / 60)::INTEGER);
  END IF;
  IF public._pin_ok(p_pin) THEN
    SELECT p.user_id INTO v_user FROM public.staff_pins p
      JOIN public.store_members m ON m.store_id = p.store_id AND m.user_id = p.user_id AND m.status = 'active'
      WHERE p.store_id = p_store_id AND p.pin_hash = crypt(p_pin, p.pin_hash) LIMIT 1;
  END IF;
  IF v_user IS NOT NULL THEN
    DELETE FROM public.pin_attempts WHERE store_id = p_store_id AND account_id = auth.uid();
    RETURN v_user;
  END IF;
  INSERT INTO public.pin_attempts(store_id, account_id, failures) VALUES (p_store_id, auth.uid(), 1)
  ON CONFLICT (store_id, account_id) DO UPDATE SET
    failures = CASE WHEN public.pin_attempts.locked_until IS NOT NULL THEN 1 ELSE public.pin_attempts.failures + 1 END,
    locked_until = NULL
  RETURNING * INTO a;
  IF a.failures >= 5 THEN
    UPDATE public.pin_attempts SET locked_until = now() + interval '5 minutes' WHERE store_id = p_store_id AND account_id = auth.uid();
    RETURN NULL;
  END IF;
  RETURN NULL;
END; $$;

CREATE OR REPLACE FUNCTION public._pin_wrong(p_store_id UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN locked_until > now() THEN 'Too many wrong PINs. PIN entry is locked for 5 minutes'
              ELSE format('That PIN is not right. %s tries left', 5 - failures) END
  FROM public.pin_attempts WHERE store_id = p_store_id AND account_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.set_staff_pin(p_store_id UUID, p_user_id UUID, p_pin TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF NOT public.user_has_permission(auth.uid(), p_store_id, 'store:update') THEN RAISE EXCEPTION 'Only an owner or manager can set PINs'; END IF;
  IF NOT public._pin_ok(p_pin) THEN RAISE EXCEPTION 'A PIN is 4 to 6 digits'; END IF;
  IF p_pin IN ('0000', '1111', '1234', '000000', '123456', '111111', '12345') THEN RAISE EXCEPTION 'Choose a less obvious PIN'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.store_members WHERE store_id = p_store_id AND user_id = p_user_id AND status = 'active') THEN
    RAISE EXCEPTION 'This person is not active in this branch';
  END IF;
  IF EXISTS (SELECT 1 FROM public.staff_pins WHERE store_id = p_store_id AND user_id <> p_user_id AND pin_hash = crypt(p_pin, pin_hash)) THEN
    RAISE EXCEPTION 'Someone else in this branch already uses that PIN. Choose another';
  END IF;
  INSERT INTO public.staff_pins(store_id, user_id, pin_hash, updated_by)
  VALUES (p_store_id, p_user_id, crypt(p_pin, gen_salt('bf', 8)), auth.uid())
  ON CONFLICT (store_id, user_id) DO UPDATE SET pin_hash = EXCLUDED.pin_hash, updated_by = auth.uid(), updated_at = now();
END; $$;

CREATE OR REPLACE FUNCTION public.clear_staff_pin(p_store_id UUID, p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.user_has_permission(auth.uid(), p_store_id, 'store:update') THEN RAISE EXCEPTION 'Only an owner or manager can remove PINs'; END IF;
  DELETE FROM public.staff_pins WHERE store_id = p_store_id AND user_id = p_user_id;
  DELETE FROM public.till_acting_cashiers WHERE store_id = p_store_id AND cashier_id = p_user_id;
END; $$;

-- Which members have a PIN (never the PIN itself), for the Staff screen.
CREATE OR REPLACE FUNCTION public.staff_pin_status(p_store_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(user_id), '[]'::jsonb) FROM public.staff_pins
  WHERE store_id = p_store_id AND public.user_has_permission(auth.uid(), p_store_id, 'store:update');
$$;

-- "Switch cashier": the person whose PIN this is becomes the acting cashier
-- on this account for 12 hours.
CREATE OR REPLACE FUNCTION public.identify_cashier(p_store_id UUID, p_pin TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user UUID; v_msg TEXT;
BEGIN
  IF NOT public.user_has_permission(auth.uid(), p_store_id, 'sales:create') THEN RAISE EXCEPTION 'You cannot sell in this branch'; END IF;
  v_user := public._pin_match(p_store_id, p_pin);
  IF v_user IS NULL THEN
    v_msg := public._pin_wrong(p_store_id);
    -- the failure count must survive the error, so it is returned, not raised
    RETURN jsonb_build_object('ok', false, 'error', COALESCE(v_msg, 'That PIN is not right'));
  END IF;
  INSERT INTO public.till_acting_cashiers(store_id, account_id, cashier_id, expires_at)
  VALUES (p_store_id, auth.uid(), v_user, now() + interval '12 hours')
  ON CONFLICT (store_id, account_id) DO UPDATE SET cashier_id = EXCLUDED.cashier_id, set_at = now(), expires_at = EXCLUDED.expires_at;
  RETURN jsonb_build_object('ok', true, 'user_id', v_user, 'name', public._person_name(v_user));
END; $$;

CREATE OR REPLACE FUNCTION public.current_cashier(p_store_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('user_id', cashier_id, 'name', public._person_name(cashier_id), 'expires_at', expires_at)
  FROM public.till_acting_cashiers WHERE store_id = p_store_id AND account_id = auth.uid() AND expires_at > now();
$$;

CREATE OR REPLACE FUNCTION public.clear_cashier(p_store_id UUID)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.till_acting_cashiers WHERE store_id = p_store_id AND account_id = auth.uid();
$$;

-- A manager's PIN approves a void or refund the signed-in account can't do.
-- The action runs as that manager (their permission is checked, and the
-- audit trail names them), then the session is restored.
CREATE OR REPLACE FUNCTION public._run_as_manager(p_store_id UUID, p_pin TEXT, p_permission TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user UUID;
BEGIN
  v_user := public._pin_match(p_store_id, p_pin);
  IF v_user IS NULL THEN RETURN NULL; END IF;
  IF NOT public.user_has_permission(v_user, p_store_id, p_permission) THEN
    RAISE EXCEPTION 'That PIN belongs to someone who cannot approve this';
  END IF;
  RETURN v_user;
END; $$;

CREATE OR REPLACE FUNCTION public.void_sale_with_pin(p_sale_id UUID, p_reason TEXT, p_pin TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_store UUID; v_mgr UUID; v_prev TEXT; v_sale public.sales;
BEGIN
  SELECT store_id INTO v_store FROM public.sales WHERE id = p_sale_id;
  IF v_store IS NULL OR NOT public.user_has_permission(auth.uid(), v_store, 'sales:create') THEN RAISE EXCEPTION 'Sale not found'; END IF;
  v_mgr := public._run_as_manager(v_store, p_pin, 'sales:void');
  IF v_mgr IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', COALESCE(public._pin_wrong(v_store), 'That PIN is not right')); END IF;
  v_prev := current_setting('request.jwt.claim.sub', true);
  PERFORM set_config('request.jwt.claim.sub', v_mgr::TEXT, true);
  v_sale := public.void_sale(p_sale_id, p_reason);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(v_prev, ''), true);
  RETURN jsonb_build_object('ok', true, 'approved_by', public._person_name(v_mgr), 'sale_id', v_sale.id);
END; $$;

CREATE OR REPLACE FUNCTION public.process_refund_with_pin(p_sale_id UUID, p_amount NUMERIC, p_reason TEXT, p_method TEXT, p_items JSONB, p_pin TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_store UUID; v_mgr UUID; v_prev TEXT; v_refund public.refunds;
BEGIN
  SELECT store_id INTO v_store FROM public.sales WHERE id = p_sale_id;
  IF v_store IS NULL OR NOT public.user_has_permission(auth.uid(), v_store, 'sales:create') THEN RAISE EXCEPTION 'Sale not found'; END IF;
  v_mgr := public._run_as_manager(v_store, p_pin, 'sales:refund');
  IF v_mgr IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', COALESCE(public._pin_wrong(v_store), 'That PIN is not right')); END IF;
  v_prev := current_setting('request.jwt.claim.sub', true);
  PERFORM set_config('request.jwt.claim.sub', v_mgr::TEXT, true);
  v_refund := public.process_refund(p_sale_id, p_amount, p_reason, p_method, p_items);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(v_prev, ''), true);
  RETURN jsonb_build_object('ok', true, 'approved_by', public._person_name(v_mgr), 'refund_id', v_refund.id);
END; $$;

-- ------------------------------------------------------------
-- Grants: app callers get the entry points only.
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public._till_session_for(UUID, UUID), public._till_acting_cashier(UUID, UUID), public._person_name(UUID),
  public._till_numbers(UUID), public._till_can_manage(public.till_sessions), public._pin_match(UUID, TEXT), public._pin_wrong(UUID),
  public._run_as_manager(UUID, TEXT, TEXT), public.till_tag_sale(), public.till_tag_refund() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.till_open(UUID, NUMERIC), public.till_current(UUID), public.till_cash_move(UUID, TEXT, NUMERIC, TEXT),
  public.till_report(UUID), public.till_close(UUID, NUMERIC, TEXT), public.till_history(UUID, INTEGER), public.till_set_required(UUID, BOOLEAN),
  public.set_staff_pin(UUID, UUID, TEXT), public.clear_staff_pin(UUID, UUID), public.staff_pin_status(UUID),
  public.identify_cashier(UUID, TEXT), public.current_cashier(UUID), public.clear_cashier(UUID),
  public.void_sale_with_pin(UUID, TEXT, TEXT), public.process_refund_with_pin(UUID, NUMERIC, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.till_open(UUID, NUMERIC), public.till_current(UUID), public.till_cash_move(UUID, TEXT, NUMERIC, TEXT),
  public.till_report(UUID), public.till_close(UUID, NUMERIC, TEXT), public.till_history(UUID, INTEGER), public.till_set_required(UUID, BOOLEAN),
  public.set_staff_pin(UUID, UUID, TEXT), public.clear_staff_pin(UUID, UUID), public.staff_pin_status(UUID),
  public.identify_cashier(UUID, TEXT), public.current_cashier(UUID), public.clear_cashier(UUID),
  public.void_sale_with_pin(UUID, TEXT, TEXT), public.process_refund_with_pin(UUID, NUMERIC, TEXT, TEXT, JSONB, TEXT) TO authenticated;
