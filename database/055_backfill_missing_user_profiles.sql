-- Migration: 055_backfill_missing_user_profiles.sql
-- Description: Backfill public.users rows for any auth.users accounts created
--   before the handle_new_auth_user trigger (009) existed, and mark the
--   platform owner account as a platform admin. Without a public.users row,
--   AuthService.getUserProfile() returns null, which forces the user into the
--   "Set up your business" onboarding flow (and that flow then fails because
--   downstream inserts/updates reference a non-existent users row).
-- Author: TrackOja Team
-- Date: 2026-06-15

INSERT INTO public.users (id, email, first_name, last_name, status, email_verified_at)
SELECT
  au.id,
  au.email,
  COALESCE(
    au.raw_user_meta_data->>'first_name',
    split_part(au.raw_user_meta_data->>'full_name', ' ', 1)
  ),
  COALESCE(
    au.raw_user_meta_data->>'last_name',
    NULLIF(trim(substring(au.raw_user_meta_data->>'full_name' from length(split_part(au.raw_user_meta_data->>'full_name', ' ', 1)) + 1)), '')
  ),
  'active',
  au.email_confirmed_at
FROM auth.users au
LEFT JOIN public.users pu ON pu.id = au.id
WHERE pu.id IS NULL
ON CONFLICT (id) DO NOTHING;

-- The platform owner's account predates this batch of migrations, so it is
-- one of the rows backfilled above. Grant it platform admin access.
UPDATE public.users
SET is_platform_admin = true
WHERE email = 'ibroakoss@gmail.com';
