-- ============================================================
-- 20261031002001: ROLES, ACTING CASHIER PERMISSIONS, MANAGER OVERRIDES,
--                 DISCOUNT LIMIT, COST PRIVACY (POS UX upgrade, section 9)
-- ============================================================
-- 1. Roles. Owner, Manager, Cashier and Inventory officer get exactly the
--    capabilities in docs/POS_UX_UPGRADE_SPEC.md section 9. New permissions:
--    cost:view, price:edit, sales:view_all, sales:override, settings:view.
-- 2. A PIN switch changes permissions, not just attribution. When a staff
--    member is the acting cashier on an account (till_acting_cashiers), every
--    user_has_permission(account, store, ...) call is answered for the ACTING
--    member, in every branch of that business. auth.uid() stays the device
--    login. The acting cashier stays until someone switches (no silent expiry
--    back to the owner). Clearing it (going back to the signed-in account)
--    needs that account's own role to allow it, or a manager override.
--    Branch lock: in a branch where the acting member isn't active, the account
--    has no permissions and the branch drops out of get_user_active_store_ids.
-- 3. Manager overrides: request_manager_override(store, action, pin, context)
--    checks a manager/owner PIN (same hashing and 5-try lockout as cashier
--    PINs) and records a single-use approval valid for 2 minutes, plus an audit
--    log naming both people. Voids, refunds and discounts above the store's
--    limit consume one. void_sale_with_pin / process_refund_with_pin now record
--    the approval too; void_sale_approved / process_refund_approved take an
--    approval id instead of a PIN.
-- 4. store_settings.discount_limit_percent (null = no limit), enforced when a
--    sale's totals are written. require_open_till defaults to TRUE for stores
--    created from now on (existing stores keep their setting). store_settings
--    gets row-level security (it had none).
-- 5. Cost privacy: products.cost_price, product_variants.cost_price,
--    stock_lots.cost_per_unit and stock_count_lines.unit_cost are no longer
--    selectable by app users directly. get_product_costs / get_variant_costs /
--    get_stock_lot_costs return them to people with cost:view. Any later
--    migration that adds a column to one of these tables must end with
--    SELECT public._apply_cost_privacy(); so the new column is readable.
-- 6. Price edits: a direct product update that changes selling_price or
--    cost_price needs price:edit. Changes made inside the app's own database
--    functions (receiving stock re-averages cost) are not affected.
-- 7. Staff: only people with member:manage change roles or status, nobody
--    changes their own role, and only an owner gives or takes the owner role.
-- 8. Acting user and approver on records: inventory_movements.acting_user_id,
--    sales.approved_by, refunds.approved_by (sales and till rows already carry
--    cashier_id). Cashiers see only their own sales from today
--    (sales:view_all sees everything).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Permissions and roles
-- ------------------------------------------------------------
INSERT INTO public.permissions (name, resource, action, description, category)
SELECT v.name, split_part(v.name, ':', 1), split_part(v.name, ':', 2), v.description, v.category
FROM (VALUES
  ('cost:view', 'See cost prices and margins', 'inventory'),
  ('price:edit', 'Change selling and cost prices', 'inventory'),
  ('sales:view_all', 'See every sale in the branch, not only your own today', 'sales'),
  ('sales:override', 'Approve discounts, price overrides and register exits with a PIN', 'sales'),
  ('settings:view', 'Open branch settings', 'settings')
) AS v(name, description, category)
WHERE NOT EXISTS (SELECT 1 FROM public.permissions p WHERE p.name = v.name);

-- exact capability lists for the two front-line roles; owner and manager keep
-- what they had and gain the new permissions
CREATE OR REPLACE FUNCTION public._set_role_permissions(p_role TEXT, p_names TEXT[], p_exact BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role UUID;
BEGIN
  SELECT id INTO v_role FROM public.roles WHERE name = p_role AND is_system ORDER BY created_at LIMIT 1;
  IF v_role IS NULL THEN RETURN; END IF;
  IF p_exact THEN
    DELETE FROM public.role_permissions rp USING public.permissions p
    WHERE rp.role_id = v_role AND rp.permission_id = p.id AND NOT (p.name = ANY (p_names));
  END IF;
  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT v_role, p.id FROM public.permissions p
  WHERE p.name = ANY (p_names)
    AND NOT EXISTS (SELECT 1 FROM public.role_permissions x WHERE x.role_id = v_role AND x.permission_id = p.id);
END; $$;

SELECT public._set_role_permissions('owner',
  ARRAY(SELECT name FROM public.permissions WHERE name NOT LIKE 'platform:%' AND name NOT LIKE 'developer:%'), FALSE);
SELECT public._set_role_permissions('manager',
  ARRAY['cost:view', 'price:edit', 'sales:view_all', 'sales:override', 'settings:view'], FALSE);
SELECT public._set_role_permissions('cashier',
  ARRAY['sales:create', 'sales:view', 'customer:view', 'customer:create', 'inventory:view', 'store:read', 'devices:view'], TRUE);
SELECT public._set_role_permissions('inventory_officer',
  ARRAY['inventory:view', 'inventory:adjust', 'product:create', 'product:update', 'category:create', 'category:update',
        'purchase:view', 'purchase:create', 'supplier:view', 'supplier:create', 'supplier:update', 'store:read', 'cost:view'], TRUE);
REVOKE ALL ON FUNCTION public._set_role_permissions(TEXT, TEXT[], BOOLEAN) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 2. Acting member resolver
-- ------------------------------------------------------------
-- The acting member for an account in the business that owns p_store_id, or
-- null when the account acts as itself.
CREATE OR REPLACE FUNCTION public._acting_member(p_account UUID, p_store_id UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.cashier_id FROM public.till_acting_cashiers a
  JOIN public.stores s1 ON s1.id = a.store_id
  JOIN public.stores s2 ON s2.id = p_store_id AND s2.org_id = s1.org_id
  WHERE a.account_id = p_account AND a.cashier_id <> p_account
    -- an approved action runs as the approver's own role (see _void_as)
    AND p_account::TEXT IS DISTINCT FROM NULLIF(current_setting('trackoja.approved_as', true), '')
  ORDER BY a.set_at DESC LIMIT 1;
$$;

-- The member's own role, ignoring any acting cashier (used to check approvers).
CREATE OR REPLACE FUNCTION public._member_has_permission(p_user_id UUID, p_store_id UUID, p_permission_name TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.store_members sm
    JOIN public.role_permissions rp ON rp.role_id = sm.role_id
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE sm.user_id = p_user_id AND sm.store_id = p_store_id AND sm.status = 'active' AND p.name = p_permission_name);
$$;

CREATE OR REPLACE FUNCTION public.user_has_permission(p_user_id UUID, p_store_id UUID, p_permission_name TEXT)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT public._member_has_permission(COALESCE(public._acting_member(p_user_id, p_store_id), p_user_id), p_store_id, p_permission_name)
  AND NOT EXISTS (
    SELECT 1 FROM public.organization_products op
    JOIN public.platform_products pp ON pp.id = op.product_id AND pp.key = 'trackoja'
    JOIN public.stores s ON s.org_id = op.org_id
    WHERE s.id = p_store_id AND op.source = 'trial' AND op.trial_started_at IS NOT NULL
      AND NOT public.product_entitlement_has_access(op.org_id, op.product_id)
  );
$$;

-- who is really working on this account in this branch
CREATE OR REPLACE FUNCTION public.effective_user_id(p_store_id UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(public._acting_member(auth.uid(), p_store_id), auth.uid());
$$;

-- Branch lock for store-scoped reads: with an acting member, only the
-- branches that member works in.
CREATE OR REPLACE FUNCTION public.get_user_active_store_ids(p_user_id UUID)
RETURNS SETOF UUID LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT sm.store_id FROM public.store_members sm JOIN public.stores s ON s.id = sm.store_id
  WHERE sm.user_id = p_user_id AND sm.status = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM public.organization_products op JOIN public.platform_products pp ON pp.id = op.product_id
      WHERE op.org_id = s.org_id AND pp.key = 'trackoja' AND op.trial_started_at IS NOT NULL
        AND op.source = 'trial' AND NOT public.product_entitlement_has_access(op.org_id, op.product_id))
    AND (public._acting_member(p_user_id, sm.store_id) IS NULL OR EXISTS (
      SELECT 1 FROM public.store_members a WHERE a.store_id = sm.store_id
        AND a.user_id = public._acting_member(p_user_id, sm.store_id) AND a.status = 'active'));
$$;

-- Owner-only business actions (deletion) are not available while someone else
-- is the acting cashier on the owner's account.
CREATE OR REPLACE FUNCTION public.is_business_owner(p_org_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = p_org_id AND o.owner_id = auth.uid())
       OR EXISTS (SELECT 1 FROM public.organization_members m WHERE m.org_id = p_org_id AND m.user_id = auth.uid() AND m.role = 'owner'))
    AND NOT EXISTS (SELECT 1 FROM public.till_acting_cashiers a JOIN public.stores s ON s.id = a.store_id
                    WHERE s.org_id = p_org_id AND a.account_id = auth.uid() AND a.cashier_id <> auth.uid());
$$;

-- The acting cashier stays until someone switches: attribution and permissions
-- must agree, so expiry no longer matters.
CREATE OR REPLACE FUNCTION public._till_acting_cashier(p_store_id UUID, p_account UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT cashier_id FROM public.till_acting_cashiers WHERE store_id = p_store_id AND account_id = p_account;
$$;

CREATE OR REPLACE FUNCTION public.current_cashier(p_store_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('user_id', a.cashier_id, 'name', public._person_name(a.cashier_id), 'expires_at', a.expires_at,
    'role', (SELECT r.name FROM public.store_members m JOIN public.roles r ON r.id = m.role_id
             WHERE m.store_id = p_store_id AND m.user_id = a.cashier_id AND m.status = 'active'))
  FROM public.till_acting_cashiers a WHERE a.store_id = p_store_id AND a.account_id = auth.uid();
$$;

-- Switching needs the signed-in account itself to belong to the branch (the
-- acting member may not be allowed to sell, e.g. an inventory officer).
CREATE OR REPLACE FUNCTION public.identify_cashier(p_store_id UUID, p_pin TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user UUID; v_msg TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.store_members WHERE store_id = p_store_id AND user_id = auth.uid() AND status = 'active') THEN
    RAISE EXCEPTION 'You cannot sell in this branch';
  END IF;
  v_user := public._pin_match(p_store_id, p_pin);
  IF v_user IS NULL THEN
    v_msg := public._pin_wrong(p_store_id);
    RETURN jsonb_build_object('ok', false, 'error', COALESCE(v_msg, 'That PIN is not right'));
  END IF;
  -- one acting member per account per business
  DELETE FROM public.till_acting_cashiers a USING public.stores s1, public.stores s2
  WHERE a.account_id = auth.uid() AND s1.id = a.store_id AND s2.id = p_store_id AND s1.org_id = s2.org_id AND a.store_id <> p_store_id;
  INSERT INTO public.till_acting_cashiers(store_id, account_id, cashier_id, expires_at)
  VALUES (p_store_id, auth.uid(), v_user, now() + interval '100 years')
  ON CONFLICT (store_id, account_id) DO UPDATE SET cashier_id = EXCLUDED.cashier_id, set_at = now(), expires_at = EXCLUDED.expires_at;
  INSERT INTO public.audit_logs (actor_id, org_id, store_id, action, resource_type, resource_name, details)
  SELECT auth.uid(), s.org_id, s.id, 'CASHIER_SWITCHED', 'store_member', public._person_name(v_user),
         jsonb_build_object('account', auth.uid(), 'acting_user', v_user)
  FROM public.stores s WHERE s.id = p_store_id;
  RETURN jsonb_build_object('ok', true, 'user_id', v_user, 'name', public._person_name(v_user),
    'role', (SELECT r.name FROM public.store_members m JOIN public.roles r ON r.id = m.role_id WHERE m.store_id = p_store_id AND m.user_id = v_user));
END; $$;

-- ------------------------------------------------------------
-- 3. Manager overrides
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.manager_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  acting_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  approver_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('void', 'refund', 'discount', 'price_override', 'remove_after_payment', 'open_drawer', 'exit_register')),
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '2 minutes',
  used_at TIMESTAMPTZ,
  used_for UUID
);
CREATE INDEX IF NOT EXISTS manager_approvals_open ON public.manager_approvals(store_id, account_id, action, created_at DESC) WHERE used_at IS NULL;
ALTER TABLE public.manager_approvals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_approvals_read ON public.manager_approvals;
CREATE POLICY manager_approvals_read ON public.manager_approvals FOR SELECT USING (
  store_id IN (SELECT public.get_user_active_store_ids(auth.uid())) AND public.user_has_permission(auth.uid(), store_id, 'reports:view'));

CREATE OR REPLACE FUNCTION public._override_permission(p_action TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_action WHEN 'void' THEN 'sales:void' WHEN 'refund' THEN 'sales:refund' ELSE 'sales:override' END;
$$;

CREATE OR REPLACE FUNCTION public._record_approval(p_store_id UUID, p_action TEXT, p_approver UUID, p_context JSONB, p_used_for UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID; v_acting UUID := public.effective_user_id(p_store_id);
BEGIN
  INSERT INTO public.manager_approvals (store_id, account_id, acting_user_id, approver_id, action, context, used_at, used_for)
  VALUES (p_store_id, auth.uid(), v_acting, p_approver, p_action, COALESCE(p_context, '{}'::jsonb),
          CASE WHEN p_used_for IS NOT NULL THEN now() END, p_used_for)
  RETURNING id INTO v_id;
  INSERT INTO public.audit_logs (actor_id, org_id, store_id, action, resource_type, resource_id, resource_name, details)
  SELECT auth.uid(), s.org_id, s.id, 'MANAGER_OVERRIDE', 'manager_approval', v_id, p_action,
         jsonb_build_object('action', p_action, 'acting_user', v_acting, 'acting_name', public._person_name(v_acting),
                            'approver', p_approver, 'approver_name', public._person_name(p_approver), 'context', COALESCE(p_context, '{}'::jsonb))
  FROM public.stores s WHERE s.id = p_store_id;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.request_manager_override(p_store_id UUID, p_action TEXT, p_pin TEXT, p_context JSONB DEFAULT '{}'::jsonb)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_mgr UUID; v_id UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.store_members WHERE store_id = p_store_id AND user_id = auth.uid() AND status = 'active') THEN
    RAISE EXCEPTION 'You cannot work in this branch';
  END IF;
  IF p_action NOT IN ('void', 'refund', 'discount', 'price_override', 'remove_after_payment', 'open_drawer', 'exit_register') THEN
    RAISE EXCEPTION 'Unknown action';
  END IF;
  v_mgr := public._pin_match(p_store_id, p_pin);
  IF v_mgr IS NULL THEN
    -- returned, not raised, so the wrong-PIN count survives
    RETURN jsonb_build_object('ok', false, 'error', COALESCE(public._pin_wrong(p_store_id), 'That PIN is not right'));
  END IF;
  IF NOT public._member_has_permission(v_mgr, p_store_id, public._override_permission(p_action)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'That PIN belongs to someone who cannot approve this. Ask a manager or the owner');
  END IF;
  v_id := public._record_approval(p_store_id, p_action, v_mgr, p_context, NULL);
  RETURN jsonb_build_object('ok', true, 'approval_id', v_id, 'approver_name', public._person_name(v_mgr),
                            'expires_at', now() + interval '2 minutes');
END; $$;

-- Uses one approval for this account, branch and action: the given one, or
-- the newest open one. Returns the approver, or null.
CREATE OR REPLACE FUNCTION public._consume_approval(p_store_id UUID, p_action TEXT, p_approval_id UUID, p_used_for UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.manager_approvals;
BEGIN
  SELECT * INTO v FROM public.manager_approvals
  WHERE store_id = p_store_id AND account_id = auth.uid() AND action = p_action AND used_at IS NULL AND expires_at > now()
    AND (p_approval_id IS NULL OR id = p_approval_id)
  ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF v.id IS NULL THEN RETURN NULL; END IF;
  UPDATE public.manager_approvals SET used_at = now(), used_for = p_used_for WHERE id = v.id;
  RETURN v.approver_id;
END; $$;

-- Going back to the signed-in account: allowed when that account's own role
-- is a manager or owner and the current acting member is one too, or with an
-- 'exit_register' approval.
DROP FUNCTION IF EXISTS public.clear_cashier(UUID);
CREATE OR REPLACE FUNCTION public.clear_cashier(p_store_id UUID, p_approval_id UUID DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_acting UUID := public._acting_member(auth.uid(), p_store_id);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF v_acting IS NOT NULL AND NOT public._member_has_permission(v_acting, p_store_id, 'sales:override') THEN
    IF public._consume_approval(p_store_id, 'exit_register', p_approval_id, NULL) IS NULL THEN
      RAISE EXCEPTION 'A manager or the owner needs to approve this with their PIN';
    END IF;
  END IF;
  DELETE FROM public.till_acting_cashiers a USING public.stores s1, public.stores s2
  WHERE a.account_id = auth.uid() AND s1.id = a.store_id AND s2.id = p_store_id AND s1.org_id = s2.org_id;
END; $$;

-- Manager PIN checks use the approver's own role.
CREATE OR REPLACE FUNCTION public._run_as_manager(p_store_id UUID, p_pin TEXT, p_permission TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user UUID;
BEGIN
  v_user := public._pin_match(p_store_id, p_pin);
  IF v_user IS NULL THEN RETURN NULL; END IF;
  IF NOT public._member_has_permission(v_user, p_store_id, p_permission) THEN
    RAISE EXCEPTION 'That PIN belongs to someone who cannot approve this';
  END IF;
  RETURN v_user;
END; $$;

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.refunds ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

-- Runs void_sale / process_refund as the approver, so their permission is the
-- one checked and the records name them; the caller's identity comes back after.
CREATE OR REPLACE FUNCTION public._void_as(p_sale_id UUID, p_reason TEXT, p_mgr UUID)
RETURNS public.sales LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_prev TEXT; v_sale public.sales;
BEGIN
  v_prev := current_setting('request.jwt.claim.sub', true);
  PERFORM set_config('request.jwt.claim.sub', p_mgr::TEXT, true);
  PERFORM set_config('trackoja.approved_as', p_mgr::TEXT, true);
  BEGIN
    v_sale := public.void_sale(p_sale_id, p_reason);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('request.jwt.claim.sub', COALESCE(v_prev, ''), true);
    PERFORM set_config('trackoja.approved_as', '', true);
    RAISE;
  END;
  PERFORM set_config('request.jwt.claim.sub', COALESCE(v_prev, ''), true);
  PERFORM set_config('trackoja.approved_as', '', true);
  UPDATE public.sales SET approved_by = p_mgr WHERE id = p_sale_id;
  RETURN v_sale;
END; $$;

CREATE OR REPLACE FUNCTION public._refund_as(p_sale_id UUID, p_amount NUMERIC, p_reason TEXT, p_method TEXT, p_items JSONB, p_mgr UUID)
RETURNS public.refunds LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_prev TEXT; v_refund public.refunds;
BEGIN
  v_prev := current_setting('request.jwt.claim.sub', true);
  PERFORM set_config('request.jwt.claim.sub', p_mgr::TEXT, true);
  PERFORM set_config('trackoja.approved_as', p_mgr::TEXT, true);
  BEGIN
    v_refund := public.process_refund(p_sale_id, p_amount, p_reason, p_method, p_items);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('request.jwt.claim.sub', COALESCE(v_prev, ''), true);
    PERFORM set_config('trackoja.approved_as', '', true);
    RAISE;
  END;
  PERFORM set_config('request.jwt.claim.sub', COALESCE(v_prev, ''), true);
  PERFORM set_config('trackoja.approved_as', '', true);
  UPDATE public.refunds SET approved_by = p_mgr WHERE id = v_refund.id;
  RETURN v_refund;
END; $$;

CREATE OR REPLACE FUNCTION public.void_sale_with_pin(p_sale_id UUID, p_reason TEXT, p_pin TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_store UUID; v_mgr UUID; v_sale public.sales;
BEGIN
  SELECT store_id INTO v_store FROM public.sales WHERE id = p_sale_id;
  IF v_store IS NULL OR NOT EXISTS (SELECT 1 FROM public.store_members WHERE store_id = v_store AND user_id = auth.uid() AND status = 'active') THEN
    RAISE EXCEPTION 'Sale not found';
  END IF;
  v_mgr := public._run_as_manager(v_store, p_pin, 'sales:void');
  IF v_mgr IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', COALESCE(public._pin_wrong(v_store), 'That PIN is not right')); END IF;
  PERFORM public._record_approval(v_store, 'void', v_mgr, jsonb_build_object('sale_id', p_sale_id, 'reason', p_reason), p_sale_id);
  v_sale := public._void_as(p_sale_id, p_reason, v_mgr);
  RETURN jsonb_build_object('ok', true, 'approved_by', public._person_name(v_mgr), 'sale_id', v_sale.id);
END; $$;

CREATE OR REPLACE FUNCTION public.process_refund_with_pin(p_sale_id UUID, p_amount NUMERIC, p_reason TEXT, p_method TEXT, p_items JSONB, p_pin TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_store UUID; v_mgr UUID; v_refund public.refunds;
BEGIN
  SELECT store_id INTO v_store FROM public.sales WHERE id = p_sale_id;
  IF v_store IS NULL OR NOT EXISTS (SELECT 1 FROM public.store_members WHERE store_id = v_store AND user_id = auth.uid() AND status = 'active') THEN
    RAISE EXCEPTION 'Sale not found';
  END IF;
  v_mgr := public._run_as_manager(v_store, p_pin, 'sales:refund');
  IF v_mgr IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', COALESCE(public._pin_wrong(v_store), 'That PIN is not right')); END IF;
  PERFORM public._record_approval(v_store, 'refund', v_mgr, jsonb_build_object('sale_id', p_sale_id, 'amount', p_amount, 'reason', p_reason), p_sale_id);
  v_refund := public._refund_as(p_sale_id, p_amount, p_reason, p_method, p_items, v_mgr);
  RETURN jsonb_build_object('ok', true, 'approved_by', public._person_name(v_mgr), 'refund_id', v_refund.id);
END; $$;

-- The same with an approval from request_manager_override instead of a PIN.
CREATE OR REPLACE FUNCTION public.void_sale_approved(p_sale_id UUID, p_reason TEXT, p_approval_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_store UUID; v_mgr UUID;
BEGIN
  SELECT store_id INTO v_store FROM public.sales WHERE id = p_sale_id;
  IF v_store IS NULL THEN RAISE EXCEPTION 'Sale not found'; END IF;
  v_mgr := public._consume_approval(v_store, 'void', p_approval_id, p_sale_id);
  IF v_mgr IS NULL THEN RAISE EXCEPTION 'That approval has expired or was already used. Ask for the PIN again'; END IF;
  PERFORM public._void_as(p_sale_id, p_reason, v_mgr);
  RETURN jsonb_build_object('ok', true, 'approved_by', public._person_name(v_mgr), 'sale_id', p_sale_id);
END; $$;

CREATE OR REPLACE FUNCTION public.process_refund_approved(p_sale_id UUID, p_amount NUMERIC, p_reason TEXT, p_method TEXT, p_items JSONB, p_approval_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_store UUID; v_mgr UUID; v_refund public.refunds;
BEGIN
  SELECT store_id INTO v_store FROM public.sales WHERE id = p_sale_id;
  IF v_store IS NULL THEN RAISE EXCEPTION 'Sale not found'; END IF;
  v_mgr := public._consume_approval(v_store, 'refund', p_approval_id, p_sale_id);
  IF v_mgr IS NULL THEN RAISE EXCEPTION 'That approval has expired or was already used. Ask for the PIN again'; END IF;
  v_refund := public._refund_as(p_sale_id, p_amount, p_reason, p_method, p_items, v_mgr);
  RETURN jsonb_build_object('ok', true, 'approved_by', public._person_name(v_mgr), 'refund_id', v_refund.id);
END; $$;

-- ------------------------------------------------------------
-- 4. Settings: discount limit, require an open till for new stores, RLS
-- ------------------------------------------------------------
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS discount_limit_percent NUMERIC(5,2)
  CHECK (discount_limit_percent IS NULL OR (discount_limit_percent >= 0 AND discount_limit_percent <= 100));
ALTER TABLE public.store_settings ALTER COLUMN require_open_till SET DEFAULT TRUE;

ALTER TABLE public.store_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS store_settings_read ON public.store_settings;
CREATE POLICY store_settings_read ON public.store_settings FOR SELECT USING (
  store_id IN (SELECT public.get_user_active_store_ids(auth.uid()))
  OR store_id IN (SELECT s.id FROM public.stores s WHERE s.org_id IN (SELECT public.get_owned_org_ids(auth.uid()))));
DROP POLICY IF EXISTS store_settings_insert ON public.store_settings;
CREATE POLICY store_settings_insert ON public.store_settings FOR INSERT WITH CHECK (
  store_id IN (SELECT s.id FROM public.stores s WHERE s.org_id IN (SELECT public.get_owned_org_ids(auth.uid())))
  OR public.user_has_permission(auth.uid(), store_id, 'store:update'));
DROP POLICY IF EXISTS store_settings_update ON public.store_settings;
CREATE POLICY store_settings_update ON public.store_settings FOR UPDATE USING (
  public.user_has_permission(auth.uid(), store_id, 'store:update') OR public.user_has_permission(auth.uid(), store_id, 'settings:update'));

CREATE OR REPLACE FUNCTION public.set_discount_limit(p_store_id UUID, p_percent NUMERIC)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.user_has_permission(auth.uid(), p_store_id, 'store:update') THEN RAISE EXCEPTION 'Only an owner or manager can change this'; END IF;
  IF p_percent IS NOT NULL AND (p_percent < 0 OR p_percent > 100) THEN RAISE EXCEPTION 'Enter a percentage from 0 to 100'; END IF;
  INSERT INTO public.store_settings (store_id, discount_limit_percent) VALUES (p_store_id, p_percent)
  ON CONFLICT (store_id) DO UPDATE SET discount_limit_percent = EXCLUDED.discount_limit_percent, updated_at = now();
END; $$;

-- Discounts above the branch limit need sales:override or a 'discount' approval.
-- Counts the sale discount and the line discounts against the sale before
-- discounts. Checked when create_sale writes the totals.
CREATE OR REPLACE FUNCTION public.enforce_discount_limit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_limit NUMERIC; v_lines NUMERIC; v_pct NUMERIC; v_mgr UUID;
BEGIN
  IF auth.uid() IS NULL OR COALESCE(NEW.subtotal, 0) <= 0 THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.discount_total IS NOT DISTINCT FROM OLD.discount_total AND NEW.subtotal IS NOT DISTINCT FROM OLD.subtotal THEN RETURN NEW; END IF;
  SELECT discount_limit_percent INTO v_limit FROM public.store_settings WHERE store_id = NEW.store_id;
  IF v_limit IS NULL THEN RETURN NEW; END IF;
  SELECT COALESCE(sum(discount_amount), 0) INTO v_lines FROM public.sale_items WHERE sale_id = NEW.id;
  v_pct := (COALESCE(NEW.discount_total, 0) + v_lines) * 100 / NEW.subtotal;
  IF v_pct <= v_limit + 0.005 OR public.user_has_permission(auth.uid(), NEW.store_id, 'sales:override') THEN RETURN NEW; END IF;
  v_mgr := public._consume_approval(NEW.store_id, 'discount', NULL, NEW.id);
  IF v_mgr IS NULL THEN
    RAISE EXCEPTION 'A discount above % percent needs a manager PIN', trim(to_char(v_limit, 'FM990.##'));
  END IF;
  NEW.approved_by := v_mgr;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS enforce_discount_limit ON public.sales;
CREATE TRIGGER enforce_discount_limit BEFORE UPDATE OF discount_total, subtotal ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.enforce_discount_limit();

-- ------------------------------------------------------------
-- 5. Cost privacy
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._apply_cost_privacy()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t RECORD; v_cols TEXT;
BEGIN
  FOR t IN SELECT * FROM (VALUES ('products', 'cost_price'), ('product_variants', 'cost_price'),
                                 ('stock_lots', 'cost_per_unit'), ('stock_count_lines', 'unit_cost')) AS x(tbl, hidden)
  LOOP
    IF to_regclass('public.' || t.tbl) IS NULL THEN CONTINUE; END IF;
    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_cols
    FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t.tbl AND column_name <> t.hidden;
    EXECUTE format('REVOKE SELECT ON public.%I FROM anon, authenticated', t.tbl);
    EXECUTE format('GRANT SELECT (%s) ON public.%I TO anon, authenticated', v_cols, t.tbl);
  END LOOP;
END; $$;
SELECT public._apply_cost_privacy();
REVOKE ALL ON FUNCTION public._apply_cost_privacy() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_product_costs(p_store_id UUID)
RETURNS TABLE (product_id UUID, cost_price NUMERIC) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.cost_price FROM public.products p
  WHERE p.store_id = p_store_id AND public.user_has_permission(auth.uid(), p_store_id, 'cost:view');
$$;
CREATE OR REPLACE FUNCTION public.get_variant_costs(p_store_id UUID)
RETURNS TABLE (variant_id UUID, cost_price NUMERIC) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT v.id, v.cost_price FROM public.product_variants v
  WHERE v.store_id = p_store_id AND public.user_has_permission(auth.uid(), p_store_id, 'cost:view');
$$;
CREATE OR REPLACE FUNCTION public.get_stock_lot_costs(p_store_id UUID)
RETURNS TABLE (lot_id UUID, cost_per_unit NUMERIC) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT l.id, l.cost_per_unit FROM public.stock_lots l
  WHERE l.store_id = p_store_id AND public.user_has_permission(auth.uid(), p_store_id, 'cost:view');
$$;

CREATE OR REPLACE FUNCTION public.get_stock_count_costs(p_count_id UUID)
RETURNS TABLE (product_id UUID, unit_cost NUMERIC) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT l.product_id, l.unit_cost FROM public.stock_count_lines l JOIN public.stock_counts c ON c.id = l.count_id
  WHERE l.count_id = p_count_id AND public.user_has_permission(auth.uid(), c.store_id, 'cost:view');
$$;

-- ------------------------------------------------------------
-- 6. Price edits need price:edit (direct app updates only)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_price_edit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  -- inside the app's own database functions current_user is their owner, not
  -- the app role; those (receiving stock, variants) do their own checks
  IF current_user IN ('authenticated', 'anon')
     AND (NEW.selling_price IS DISTINCT FROM OLD.selling_price OR NEW.cost_price IS DISTINCT FROM OLD.cost_price)
     AND NOT public.user_has_permission(auth.uid(), NEW.store_id, 'price:edit') THEN
    RAISE EXCEPTION 'Only an owner or manager can change prices';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS guard_price_edit ON public.products;
CREATE TRIGGER guard_price_edit BEFORE UPDATE OF selling_price, cost_price ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.guard_price_edit();

-- ------------------------------------------------------------
-- 7. Staff role changes
-- ------------------------------------------------------------
-- Is the person working on this account (the acting member, else the
-- account) the owner of this branch's business?
CREATE OR REPLACE FUNCTION public._effective_is_owner(p_store_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public._member_has_permission(public.effective_user_id(p_store_id), p_store_id, 'store:delete')
      OR EXISTS (SELECT 1 FROM public.stores s JOIN public.organizations o ON o.id = s.org_id
                 WHERE s.id = p_store_id AND o.owner_id = public.effective_user_id(p_store_id));
$$;
CREATE OR REPLACE FUNCTION public._is_owner_role(p_role UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.roles WHERE id = p_role AND name = 'owner');
$$;

CREATE OR REPLACE FUNCTION public.guard_member_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_me UUID; v_owner BOOLEAN;
BEGIN
  -- only direct changes from the app; the app's own functions check for themselves
  IF current_user NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;
  v_me := public.effective_user_id(NEW.store_id);
  v_owner := public._effective_is_owner(NEW.store_id);
  IF TG_OP = 'INSERT' THEN
    IF NOT public.user_has_permission(auth.uid(), NEW.store_id, 'member:invite') AND NOT v_owner THEN
      RAISE EXCEPTION 'You cannot add staff in this branch';
    END IF;
    IF public._is_owner_role(NEW.role_id) AND NOT v_owner THEN RAISE EXCEPTION 'Only the owner can add another owner'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.role_id IS DISTINCT FROM OLD.role_id OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.store_id IS DISTINCT FROM OLD.store_id THEN
    -- accepting your own invitation is the one change you make to yourself
    IF NEW.user_id = auth.uid() AND OLD.status = 'invited' AND NEW.status = 'active'
       AND NEW.role_id IS NOT DISTINCT FROM OLD.role_id THEN
      RETURN NEW;
    END IF;
    IF NOT public.user_has_permission(auth.uid(), NEW.store_id, 'member:manage') AND NOT v_owner THEN
      RAISE EXCEPTION 'You cannot change staff in this branch';
    END IF;
    IF OLD.user_id = v_me AND NEW.role_id IS DISTINCT FROM OLD.role_id THEN RAISE EXCEPTION 'You cannot change your own role'; END IF;
    IF (public._is_owner_role(OLD.role_id) OR public._is_owner_role(NEW.role_id)) AND NOT v_owner THEN
      RAISE EXCEPTION 'Only the owner can change an owner''s role';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS guard_member_change ON public.store_members;
CREATE TRIGGER guard_member_change BEFORE INSERT OR UPDATE ON public.store_members
  FOR EACH ROW EXECUTE FUNCTION public.guard_member_change();

-- ------------------------------------------------------------
-- 8. Acting user on stock movements; cashiers see their own sales today
-- ------------------------------------------------------------
ALTER TABLE public.inventory_movements ADD COLUMN IF NOT EXISTS acting_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL;
CREATE OR REPLACE FUNCTION public.tag_movement_actor()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.acting_user_id IS NULL AND auth.uid() IS NOT NULL THEN
    NEW.acting_user_id := public.effective_user_id(NEW.store_id);
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS tag_movement_actor ON public.inventory_movements;
CREATE TRIGGER tag_movement_actor BEFORE INSERT ON public.inventory_movements FOR EACH ROW EXECUTE FUNCTION public.tag_movement_actor();

CREATE OR REPLACE FUNCTION public._can_see_sale(p_store_id UUID, p_cashier UUID, p_created_by UUID, p_created_at TIMESTAMPTZ)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.user_has_permission(auth.uid(), p_store_id, 'sales:view_all')
      OR (public.user_has_permission(auth.uid(), p_store_id, 'sales:view')
          AND COALESCE(p_cashier, p_created_by) = public.effective_user_id(p_store_id)
          AND (p_created_at AT TIME ZONE 'Africa/Lagos')::date = (now() AT TIME ZONE 'Africa/Lagos')::date);
$$;

DROP POLICY IF EXISTS sales_select ON public.sales;
CREATE POLICY sales_select ON public.sales FOR SELECT USING (
  store_id IN (SELECT public.get_user_active_store_ids(auth.uid()))
  AND public._can_see_sale(store_id, cashier_id, created_by, created_at));
DROP POLICY IF EXISTS sale_items_select ON public.sale_items;
CREATE POLICY sale_items_select ON public.sale_items FOR SELECT USING (sale_id IN (SELECT s.id FROM public.sales s));
DROP POLICY IF EXISTS sale_payments_select ON public.sale_payments;
CREATE POLICY sale_payments_select ON public.sale_payments FOR SELECT USING (sale_id IN (SELECT s.id FROM public.sales s));
DROP POLICY IF EXISTS refunds_select ON public.refunds;
CREATE POLICY refunds_select ON public.refunds FOR SELECT USING (
  store_id IN (SELECT public.get_user_active_store_ids(auth.uid())) AND sale_id IN (SELECT s.id FROM public.sales s));

-- ------------------------------------------------------------
-- 9. What the app asks: my role and permissions here (for the acting member)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_permissions(p_store_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH me AS (SELECT public.effective_user_id(p_store_id) AS uid)
  SELECT jsonb_build_object(
    'role', (SELECT to_jsonb(r) - 'created_at' - 'updated_at' FROM public.store_members m JOIN public.roles r ON r.id = m.role_id, me
             WHERE m.store_id = p_store_id AND m.user_id = me.uid AND m.status = 'active'),
    'acting', (SELECT CASE WHEN me.uid IS DISTINCT FROM auth.uid() THEN jsonb_build_object('user_id', me.uid, 'name', public._person_name(me.uid)) END FROM me),
    'permissions', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'resource', p.resource, 'action', p.action,
                                                                  'description', p.description, 'category', p.category) ORDER BY p.name)
                             FROM public.permissions p WHERE public.user_has_permission(auth.uid(), p_store_id, p.name)), '[]'::jsonb));
$$;

-- ------------------------------------------------------------
-- Grants
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public._acting_member(UUID, UUID), public._member_has_permission(UUID, UUID, TEXT),
  public._record_approval(UUID, TEXT, UUID, JSONB, UUID), public._consume_approval(UUID, TEXT, UUID, UUID),
  public._void_as(UUID, TEXT, UUID), public._refund_as(UUID, NUMERIC, TEXT, TEXT, JSONB, UUID),
  public.enforce_discount_limit(), public.tag_movement_actor(),
  public._can_see_sale(UUID, UUID, UUID, TIMESTAMPTZ), public._override_permission(TEXT) FROM PUBLIC, anon, authenticated;
-- used inside policies and invoker triggers, so the app role must be able to call them
GRANT EXECUTE ON FUNCTION public._can_see_sale(UUID, UUID, UUID, TIMESTAMPTZ), public._effective_is_owner(UUID), public._is_owner_role(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public._effective_is_owner(UUID), public._is_owner_role(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.request_manager_override(UUID, TEXT, TEXT, JSONB), public.clear_cashier(UUID, UUID),
  public.void_sale_approved(UUID, TEXT, UUID), public.process_refund_approved(UUID, NUMERIC, TEXT, TEXT, JSONB, UUID),
  public.set_discount_limit(UUID, NUMERIC), public.get_product_costs(UUID), public.get_variant_costs(UUID),
  public.get_stock_lot_costs(UUID), public.get_stock_count_costs(UUID), public.get_my_permissions(UUID), public.effective_user_id(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_manager_override(UUID, TEXT, TEXT, JSONB), public.clear_cashier(UUID, UUID),
  public.void_sale_approved(UUID, TEXT, UUID), public.process_refund_approved(UUID, NUMERIC, TEXT, TEXT, JSONB, UUID),
  public.set_discount_limit(UUID, NUMERIC), public.get_product_costs(UUID), public.get_variant_costs(UUID),
  public.get_stock_lot_costs(UUID), public.get_stock_count_costs(UUID), public.get_my_permissions(UUID), public.effective_user_id(UUID) TO authenticated;
