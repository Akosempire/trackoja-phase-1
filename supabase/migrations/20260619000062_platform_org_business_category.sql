-- Update list_platform_organizations to include business_category so the
-- platform dashboard can show each merchant's industry type.
-- Must DROP first because the return type changes (new column added).

DROP FUNCTION IF EXISTS public.list_platform_organizations();

CREATE OR REPLACE FUNCTION public.list_platform_organizations()
RETURNS TABLE (
  org_id UUID,
  name TEXT,
  slug TEXT,
  owner_email TEXT,
  billing_status TEXT,
  plan_name TEXT,
  subscription_status TEXT,
  store_count BIGINT,
  created_at TIMESTAMPTZ,
  business_category TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Permission denied: platform admin required';
  END IF;

  RETURN QUERY
  SELECT
    o.id AS org_id,
    o.name,
    o.slug,
    u.email AS owner_email,
    o.billing_status,
    sp.name AS plan_name,
    s.status AS subscription_status,
    (SELECT COUNT(*) FROM public.stores st WHERE st.org_id = o.id) AS store_count,
    o.created_at,
    COALESCE(o.business_category, 'general_retail') AS business_category
  FROM public.organizations o
  LEFT JOIN public.users u ON u.id = o.owner_id
  LEFT JOIN public.subscriptions s ON s.org_id = o.id
  LEFT JOIN public.subscription_plans sp ON sp.id = s.plan_id
  ORDER BY o.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_platform_organizations() TO authenticated;
