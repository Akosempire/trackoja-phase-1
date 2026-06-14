-- Migration: 050_fix_create_sale_overload.sql
-- Description: Fixes a bug where create_sale() has two overloads in the
--   database. 020_sales_functions.sql created create_sale() with 7
--   parameters. 025_customers_functions.sql (Phase 4) and
--   038_payments_functions.sql (Phase 8) added an 8th parameter
--   (p_customer_id UUID DEFAULT NULL); because PostgreSQL treats functions
--   with different argument lists as distinct objects, CREATE OR REPLACE
--   created a second overload instead of replacing the original, leaving
--   both the 7-param and 8-param create_sale() in place. PostgREST cannot
--   resolve which overload to call (PGRST203), so every checkout fails.
--   This drops the obsolete 7-param overload, leaving only the current
--   8-param version from 038_payments_functions.sql.
-- Author: TrackOja Team
-- Date: 2026-06-14

DROP FUNCTION IF EXISTS public.create_sale(UUID, JSONB, JSONB, TEXT, TEXT, NUMERIC, TEXT);
