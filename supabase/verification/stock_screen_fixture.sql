-- Fixture for verifying the stock screen through the UI: a fabric business with a
-- product measured in metres.

DELETE FROM public.organizations WHERE slug = 'zz-fabric-test';

DO $$
DECLARE
  v_uid uuid;
  v_org uuid;
  v_store uuid;
  v_role uuid;
  v_product uuid;
BEGIN
  SELECT id INTO v_uid FROM public.users WHERE email = 'owner@trackoja.test';
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'test user owner@trackoja.test is missing';
  END IF;

  INSERT INTO public.organizations (name, slug, owner_id, timezone, business_category, trial_ends_at)
  VALUES ('ZZ Fabric Test', 'zz-fabric-test', v_uid, 'UTC', 'fabric_textile', now() + interval '14 days')
  RETURNING id INTO v_org;

  INSERT INTO public.stores (org_id, name, slug, created_by, currency, timezone)
  VALUES (v_org, 'ZZ Fabric Store', 'zz-fabric-store', v_uid, 'NGN', 'UTC')
  RETURNING id INTO v_store;

  SELECT id INTO v_role FROM public.roles WHERE name = 'owner' AND is_system LIMIT 1;

  INSERT INTO public.store_members (store_id, user_id, role_id, status)
  VALUES (v_store, v_uid, v_role, 'active');

  INSERT INTO public.products (store_id, name, sku, unit, cost_price, selling_price,
                               track_inventory, stock_qty, created_by, status)
  VALUES (v_store, 'Ankara Wax Print', 'ZZ-FABRIC-001', 'metre', 1200, 2500, true, 0, v_uid, 'active')
  RETURNING id INTO v_product;

  UPDATE public.users
  SET current_org_id = v_org, current_store_id = v_store
  WHERE id = v_uid;
END $$;

SELECT o.business_category, o.name AS org, s.name AS store,
       (SELECT count(*) FROM public.products pr WHERE pr.store_id = s.id) AS products,
       (SELECT count(*) FROM public.stock_lots sl WHERE sl.store_id = s.id) AS lots
FROM public.organizations o
JOIN public.stores s ON s.org_id = o.id
WHERE o.slug = 'zz-fabric-test';
