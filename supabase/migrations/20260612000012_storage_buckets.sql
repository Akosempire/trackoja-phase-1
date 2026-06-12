-- Migration: 012_storage_buckets.sql
-- Description: Provision the "media" storage bucket for org/store logos and user
--   avatars (Organization.logoUrl, Store.logoUrl, User.avatarUrl). Public read so
--   branding renders without auth; writes are scoped by path convention:
--     avatars/{user_id}/...  -> only that user may write
--     logos/{org_id}/...     -> only members/owners of that org may write
-- Author: TrackOja Team
-- Date: 2026-06-12

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('media', 'media', true, 5242880, ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- STORAGE.OBJECTS RLS POLICIES
-- ============================================================
DROP POLICY IF EXISTS media_public_read ON storage.objects;
CREATE POLICY media_public_read ON storage.objects
  FOR SELECT
  USING (bucket_id = 'media');

DROP POLICY IF EXISTS media_insert_own_scope ON storage.objects;
CREATE POLICY media_insert_own_scope ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'media'
    AND (
      ((storage.foldername(name))[1] = 'avatars' AND (storage.foldername(name))[2] = auth.uid()::text)
      OR (
        (storage.foldername(name))[1] = 'logos'
        AND (storage.foldername(name))[2]::uuid IN (
          SELECT public.get_user_org_ids(auth.uid())
          UNION
          SELECT public.get_owned_org_ids(auth.uid())
        )
      )
    )
  );

DROP POLICY IF EXISTS media_modify_own_scope ON storage.objects;
CREATE POLICY media_modify_own_scope ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'media'
    AND (
      ((storage.foldername(name))[1] = 'avatars' AND (storage.foldername(name))[2] = auth.uid()::text)
      OR (
        (storage.foldername(name))[1] = 'logos'
        AND (storage.foldername(name))[2]::uuid IN (
          SELECT public.get_user_org_ids(auth.uid())
          UNION
          SELECT public.get_owned_org_ids(auth.uid())
        )
      )
    )
  );

DROP POLICY IF EXISTS media_delete_own_scope ON storage.objects;
CREATE POLICY media_delete_own_scope ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'media'
    AND (
      ((storage.foldername(name))[1] = 'avatars' AND (storage.foldername(name))[2] = auth.uid()::text)
      OR (
        (storage.foldername(name))[1] = 'logos'
        AND (storage.foldername(name))[2]::uuid IN (
          SELECT public.get_user_org_ids(auth.uid())
          UNION
          SELECT public.get_owned_org_ids(auth.uid())
        )
      )
    )
  );
