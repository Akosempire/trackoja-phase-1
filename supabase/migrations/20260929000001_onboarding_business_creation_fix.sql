-- gen_random_bytes belongs to pgcrypto, normally installed in Supabase's
-- extensions schema. These SECURITY DEFINER functions had search_path=public,
-- so creating a business slug (and later a checkout reference) could fail.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

DO $$
DECLARE
  v_crypto_schema NAME;
BEGIN
  SELECT n.nspname INTO v_crypto_schema
  FROM pg_catalog.pg_extension AS e
  JOIN pg_catalog.pg_namespace AS n ON n.oid = e.extnamespace
  WHERE e.extname = 'pgcrypto';

  IF v_crypto_schema IS NULL THEN
    RAISE EXCEPTION 'pgcrypto is required for onboarding and checkout';
  END IF;

  -- Both functions qualify their table and application-function references,
  -- so only pg_catalog and pgcrypto's real schema are needed here.
  EXECUTE format(
    'ALTER FUNCTION public.create_onboarding_business(text,text,text,text,text,text) SET search_path = pg_catalog, %I',
    v_crypto_schema
  );
  EXECUTE format(
    'ALTER FUNCTION public.start_plan_version_checkout(uuid) SET search_path = pg_catalog, %I',
    v_crypto_schema
  );
END;
$$;
