-- Migration: 054_product_images_storage.sql
-- Description: Allow store members to upload/manage product images under
--   products/{store_id}/... in the existing public "media" bucket
--   (see 012_storage_buckets.sql). Public read is already covered by the
--   media_public_read policy; this adds the "products" branch to the
--   insert/update/delete policies alongside the existing avatars/logos scopes.
-- Author: TrackOja Team
-- Date: 2026-06-15

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
      OR (
        (storage.foldername(name))[1] = 'products'
        AND (storage.foldername(name))[2]::uuid IN (SELECT public.get_user_active_store_ids(auth.uid()))
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
      OR (
        (storage.foldername(name))[1] = 'products'
        AND (storage.foldername(name))[2]::uuid IN (SELECT public.get_user_active_store_ids(auth.uid()))
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
      OR (
        (storage.foldername(name))[1] = 'products'
        AND (storage.foldername(name))[2]::uuid IN (SELECT public.get_user_active_store_ids(auth.uid()))
      )
    )
  );
