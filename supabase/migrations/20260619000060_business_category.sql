-- Migration: 058_business_category.sql
-- Adds business_category + enabled_modules to organizations so TrackOja can
-- adapt its UI, navigation, and product fields to each merchant's industry.
-- Adds attributes JSONB to products for industry-specific fields (expiry date,
-- IMEI, sizes, etc.) without needing separate tables per category.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS business_category TEXT NOT NULL DEFAULT 'general_retail',
  ADD COLUMN IF NOT EXISTS enabled_modules TEXT[] NOT NULL DEFAULT ARRAY['inventory','sales','customers'];

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS attributes JSONB NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.organizations.business_category IS
  'Industry category chosen at onboarding. Drives which modules, fields and navigation items are shown.';
COMMENT ON COLUMN public.organizations.enabled_modules IS
  'Active feature modules for this org. Starts with defaults for the chosen category; owners can expand later.';
COMMENT ON COLUMN public.products.attributes IS
  'Industry-specific product fields (expiry date, IMEI, sizes, batch number, etc.) stored as JSONB.';
