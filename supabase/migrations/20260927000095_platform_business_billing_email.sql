-- Migration: 095_platform_business_billing_email.sql
-- Description: get_platform_business returns organizations.billing_email, so the
--   business detail stops printing "Not set" for a field its query never asked for.
--
--   THE DEFECT, measured. The Platform console's business detail rendered the row as
--
--     { term: 'Billing email', value: str(organization, 'billing_email') ?? 'Not set' }
--
--   and the JSONB that public.get_platform_business builds (069, and unchanged
--   since: no later migration redefines it) has no billing_email key. `str()` returns
--   null both for an empty string and for a missing key, so every business on the
--   platform reported "Not set" - a sentence that means "this business has no billing
--   email recorded" while the actual fact was "the query did not ask". The column is
--   real: organizations.billing_email has existed since 002 and is written by
--   OrganizationService.updateOrganization, so an operator could change a value that
--   the console refused to show.
--
--   WHAT CHANGES. One key appended to the `organization` object. The console then has
--   three answers it can tell apart rather than one: a value, a key present with no
--   value in it, and a key that is not in the response at all.
--
--   NO DROP IS NEEDED HERE, and this is checked rather than assumed. The function
--   RETURNS JSONB - it does not RETURNS TABLE(...) - so the added key does not touch
--   the OUT-column list that CREATE OR REPLACE cannot change. The signature
--   `public.get_platform_business(uuid)` and the return type are both unchanged, so
--   CREATE OR REPLACE rewrites the body and leaves the ACL for section 2 to state.
--   (A RETURNS TABLE function would have had to be dropped and recreated, which drops
--   its grants with it; that is not the shape this function has.)
--
--   WHY billing_email IS NULL-ABLE, AND WHAT NULL MEANS. The column is TEXT NULL.
--   jsonb_build_object writes a SQL NULL as JSON null rather than omitting the key, so
--   an organization with nothing recorded returns 'billing_email': null. That means
--   "the column holds no value"; it does not mean "the query did not ask". Those are
--   different facts and the client keeps them apart - BusinessDetail.billingEmail is
--   string | null | undefined, where undefined is the absent key and null is this one.
--
-- Author: TrackOja Team
-- Date: 2026-09-27

-- ============================================================
-- 1. THE FUNCTION, WITH billing_email APPENDED
-- ============================================================
-- Body copied from 069 unchanged except for the one key, so a reader can diff the two
-- and see that this migration moved nothing else. The key sits beside billing_status
-- because those two are read together: an operator asking "is this business billed"
-- needs both the address it is billed to and the state of that billing.

CREATE OR REPLACE FUNCTION public.get_platform_business(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  PERFORM public.require_platform_permission('platform:manage_businesses');

  SELECT jsonb_build_object(
    'organization', (
      SELECT jsonb_build_object(
        'id', o.id, 'name', o.name, 'slug', o.slug, 'billing_status', o.billing_status,
        'billing_email', o.billing_email,
        'business_category', COALESCE(o.business_category, 'general_retail'),
        'is_sandbox', o.is_sandbox, 'trial_ends_at', o.trial_ends_at,
        'owner_email', u.email, 'owner_name',
          NULLIF(trim(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''),
        'created_at', o.created_at
      )
      FROM public.organizations o
      LEFT JOIN public.users u ON u.id = o.owner_id
      WHERE o.id = p_org_id
    ),
    'products', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_key', pr.key, 'product_name', pr.name,
        'plan_key', pp.key, 'plan_name', pp.name,
        'status', op.status, 'source', op.source,
        'agreed_user_limit', op.agreed_user_limit,
        'agreed_monthly_price', op.agreed_monthly_price,
        'currency', op.currency,
        'trial_ends_at', op.trial_ends_at,
        'expires_at', op.expires_at,
        'is_sandbox', op.is_sandbox
      ) ORDER BY pr.sort_order)
      FROM public.organization_products op
      JOIN public.platform_products pr ON pr.id = op.product_id
      LEFT JOIN public.product_plans pp ON pp.id = op.plan_id
      WHERE op.org_id = p_org_id
    ), '[]'::jsonb),
    'stores', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'status', s.status)
             ORDER BY s.created_at)
      FROM public.stores s WHERE s.org_id = p_org_id
    ), '[]'::jsonb),
    'staff', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'user_id', sm.user_id, 'email', su.email, 'role', r.name, 'status', sm.status,
        'store_name', s.name) ORDER BY sm.created_at)
      FROM public.store_members sm
      JOIN public.stores s ON s.id = sm.store_id
      LEFT JOIN public.roles r ON r.id = sm.role_id
      LEFT JOIN public.users su ON su.id = sm.user_id
      WHERE s.org_id = p_org_id
    ), '[]'::jsonb),
    'seat_used', (
      SELECT COUNT(DISTINCT sm.user_id)
      FROM public.store_members sm
      JOIN public.stores s ON s.id = sm.store_id
      WHERE s.org_id = p_org_id AND sm.status = 'active' AND sm.user_id IS NOT NULL
    ),
    'payments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'reference', st.reference, 'amount', st.amount, 'currency', st.currency,
        'status', st.status, 'created_at', st.created_at, 'paid_at', st.paid_at,
        'is_sandbox', st.is_sandbox) ORDER BY st.created_at DESC)
      FROM (
        SELECT * FROM public.subscription_transactions
        WHERE org_id = p_org_id ORDER BY created_at DESC LIMIT 20
      ) st
    ), '[]'::jsonb),
    'support_notes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', n.id, 'note_type', n.note_type, 'body', n.body,
        'admin_email', au.email, 'created_at', n.created_at) ORDER BY n.created_at DESC)
      FROM (
        SELECT * FROM public.platform_support_notes
        WHERE org_id = p_org_id ORDER BY created_at DESC LIMIT 20
      ) n
      LEFT JOIN public.users au ON au.id = n.admin_user_id
    ), '[]'::jsonb),
    'adjustments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id, 'adjustment_type', a.adjustment_type, 'reason', a.reason,
        'created_at', a.created_at) ORDER BY a.created_at DESC)
      FROM (
        SELECT * FROM public.subscription_adjustments
        WHERE org_id = p_org_id ORDER BY created_at DESC LIMIT 20
      ) a
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_platform_business(UUID) IS
  'One business, as the Platform console''s detail screen needs it: organization identity and billing, '
  'entitlements, stores, staff, recent payments, support notes and subscription adjustments. '
  'organization.billing_email is returned since 095 and is NULL-able, because organizations.billing_email is '
  'TEXT NULL: JSON null means the column holds no address for this business - nothing is recorded - and it is '
  'deliberately NOT the same answer as the key being absent from the response, which would mean the query did '
  'not ask. The console distinguishes all three (a value, an empty value, an absent key) so that "Not set" is '
  'never printed for a field that was simply not selected. Gated on platform:manage_businesses.';

-- ============================================================
-- 2. THE PRIVILEGE SURFACE
-- ============================================================
-- 069 granted EXECUTE to authenticated and revoked nothing. That missing revoke has a
-- measured consequence: calling this function over PostgREST with only the publishable
-- (anon) key returns
--
--   HTTP 400  {"code":"P0001","message":"Authentication required"}
--
-- not `42501 permission denied for function`, which is what anon gets from the
-- functions 092 and 093 revoked by name. So anon holds EXECUTE on a function whose body
-- is require_platform_permission('platform:manage_businesses') and whose only caller is
-- the signed-in Platform console. The grant comes from this project's
-- ALTER DEFAULT PRIVILEGES, which hands EXECUTE on every new public function straight
-- to anon and authenticated (090 section 5, restated in 092 and 094), so
-- `REVOKE ... FROM PUBLIC` alone removes nothing. CREATE OR REPLACE does not reset an
-- ACL either, so naming the roles is the only way this file can state what the ACL is.

REVOKE ALL ON FUNCTION public.get_platform_business(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_platform_business(UUID) TO authenticated;

-- ============================================================
-- 3. WHAT THIS MIGRATION ASSERTS ABOUT ITSELF
-- ============================================================
-- Applied through the Management API, a silently failed statement leaves the console
-- reading a function that does not project the field, which is the state this migration
-- exists to end. These checks fail the migration instead.

DO $$
DECLARE
  v_source TEXT;
BEGIN
  IF to_regprocedure('public.get_platform_business(uuid)') IS NULL THEN
    RAISE EXCEPTION '095: public.get_platform_business(uuid) does not exist after this migration ran';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.get_platform_business(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '095: authenticated lost EXECUTE on public.get_platform_business(uuid); the Platform console calls it with a signed-in session';
  END IF;

  IF has_function_privilege('anon', 'public.get_platform_business(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '095: anon can execute public.get_platform_business(uuid). It is gated on platform:manage_businesses and no anonymous surface reads it, so the ALTER DEFAULT PRIVILEGES grant has to be named and removed, not left to REVOKE ... FROM PUBLIC';
  END IF;

  v_source := pg_get_functiondef('public.get_platform_business(uuid)'::regprocedure);
  IF position('billing_email' IN v_source) = 0 THEN
    RAISE EXCEPTION '095: the installed get_platform_business does not mention billing_email, so the projection this migration exists for is not in place';
  END IF;
  IF pg_get_function_result('public.get_platform_business(uuid)'::regprocedure) <> 'jsonb' THEN
    RAISE EXCEPTION '095: get_platform_business no longer returns jsonb, it returns %. The console reads the response as one object, so the detail screen would break on a different return type', pg_get_function_result('public.get_platform_business(uuid)'::regprocedure);
  END IF;
END;
$$;
