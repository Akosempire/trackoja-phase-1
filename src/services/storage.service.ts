// services/storage.service.ts
// Product photos. With Cloudflare R2 set up (Edge secrets R2_*), the
// media-upload-url function hands out a 10-minute signed upload link and the
// browser uploads straight to R2. Without it, photos go to the public "media"
// Supabase Storage bucket as before (database/012 and 054). Photos already
// saved keep working either way: a product stores the full public URL.

import { supabase } from '../config/supabase';

const MEDIA_BUCKET = 'media';

export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const PRODUCT_IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp';

type SignedUpload = { uploadUrl: string; publicUrl: string };

/** R2 upload link, or null when R2 isn't set up (the function answers 503 with fallback). */
async function signedUpload(storeId: string, file: File): Promise<SignedUpload | null> {
  const { data, error } = await supabase.functions.invoke('media-upload-url', {
    body: { storeId, contentType: file.type, size: file.size },
  });
  if (error) {
    const context = (error as { context?: Response }).context;
    let payload: { error?: string; fallback?: boolean } | null = null;
    try { payload = context?.json ? await context.json() : null; } catch { payload = null; }
    // not set up, or the function isn't deployed yet: keep using Supabase Storage
    if (payload?.fallback || context?.status === 404 || !context) return null;
    throw new Error(payload?.error || 'The photo could not be uploaded');
  }
  if (!data?.uploadUrl || !data?.publicUrl) return null;
  return data as SignedUpload;
}

export class StorageService {
  /**
   * Uploads a product photo and returns its public URL.
   */
  static async uploadProductImage(storeId: string, file: File): Promise<string> {
    if (!PRODUCT_IMAGE_ACCEPT.split(',').includes(file.type)) throw new Error('Use a JPG, PNG or WebP photo');
    if (file.size > PRODUCT_IMAGE_MAX_BYTES) throw new Error('The photo must be 5 MB or smaller');

    const signed = await signedUpload(storeId, file);
    if (signed) {
      const res = await fetch(signed.uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      if (!res.ok) throw new Error('The photo could not be uploaded. Try again.');
      return signed.publicUrl;
    }

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
