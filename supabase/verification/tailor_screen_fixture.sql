-- Creates a throwaway business for verifying per-business-type navigation.
-- Run with --file to avoid shell escaping of dollar-quoted blocks.

DELETE FROM public.organizations WHERE slug = 'zz-tailor-test';

DO $$
DECLARE
  v_uid uuid;
  v_org uuid;
  v_store uuid;
  v_role uuid;
BEGIN
  SELECT id INTO v_uid FROM public.users WHERE email = 'owner@trackoja.test';
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'test user owner@trackoja.test is missing';
  END IF;

  INSERT INTO public.organizations (name, slug, owner_id, timezone, business_category, trial_ends_at)
  VALUES ('ZZ Tailor Test', 'zz-tailor-test', v_uid, 'UTC', 'tailor', now() + interval '14 days')
  RETURNING id INTO v_org;

  INSERT INTO public.stores (org_id, name, slug, created_by, currency, timezone)
  VALUES (v_org, 'ZZ Tailor Store', 'zz-tailor-store', v_uid, 'NGN', 'UTC')
  RETURNING id INTO v_store;

  SELECT id INTO v_role FROM public.roles WHERE name = 'owner' AND is_system LIMIT 1;

  INSERT INTO public.store_members (store_id, user_id, role_id, status)
  VALUES (v_store, v_uid, v_role, 'active');

  UPDATE public.users
  SET current_org_id = v_org,
      current_store_id = v_store
  WHERE id = v_uid;
END $$;

SELECT o.business_category, o.name AS org, s.name AS store,
       (SELECT count(*) FROM public.organization_products op WHERE op.org_id = o.id) AS entitlements
FROM public.organizations o
JOIN public.stores s ON s.org_id = o.id
WHERE o.slug = 'zz-tailor-test';
