// services/storage.service.ts
// Uploads to the shared public "media" Supabase Storage bucket (see
// database/012_storage_buckets.sql and 054_product_images_storage.sql)

import { supabase } from '../config/supabase';

const MEDIA_BUCKET = 'media';

export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const PRODUCT_IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp';

export class StorageService {
  /**
   * Uploads a product photo to products/{storeId}/... and returns its public URL
   */
  static async uploadProductImage(storeId: string, file: File): Promise<string> {
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const path = `products/${storeId}/${crypto.randomUUID()}.${ext}`;

    const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, file, {
      cacheControl: '3600',
      contentType: file.type,
    });
    if (error) throw error;

    const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path);
    return data.publicUrl;
  }
}
