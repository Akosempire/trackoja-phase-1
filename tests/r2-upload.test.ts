// Product photos on Cloudflare R2: the SigV4 presigner matches AWS's published
// example, and uploads are limited to small JPG/PNG/WebP photos per store.
import { describe, expect, it } from 'vitest';
import { checkPhoto, presign, productPhotoUpload, r2Config } from '../supabase/functions/_shared/r2';

describe('presign', () => {
  it("matches AWS's documented presigned GET example", async () => {
    // https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html (example)
    const url = await presign({
      method: 'GET', host: 'examplebucket.s3.amazonaws.com', path: '/test.txt', region: 'us-east-1',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      expiresSeconds: 86400, now: new Date('2013-05-24T00:00:00Z'),
    });
    expect(url).toContain('X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404');
  });
});

describe('R2 settings and photo checks', () => {
  const env: Record<string, string> = {
    R2_ACCOUNT_ID: 'E0A0A55AB04E4EF9EF8E9A40800EF212', R2_BUCKET: 'trackoja-media',
    R2_ACCESS_KEY_ID: 'id', R2_SECRET_ACCESS_KEY: 'secret', R2_PUBLIC_URL: 'https://media.trackoja.cv/',
  };
  it('needs every setting, else photos stay on Supabase Storage', () => {
    expect(r2Config((n) => env[n])?.publicUrl).toBe('https://media.trackoja.cv');
    expect(r2Config((n) => (n === 'R2_SECRET_ACCESS_KEY' ? '' : env[n]))).toBeNull();
    expect(r2Config((n) => (n === 'R2_PUBLIC_URL' ? 'http://x' : env[n]))).toBeNull();
  });
  it('accepts small JPG, PNG and WebP only', () => {
    expect(checkPhoto('image/jpeg', 1000)).toEqual({ ext: 'jpg' });
    expect(checkPhoto('image/svg+xml', 1000)).toHaveProperty('error');
    expect(checkPhoto('image/png', 6 * 1024 * 1024)).toHaveProperty('error');
    expect(checkPhoto('image/png', 0)).toHaveProperty('error');
  });
  it('signs a 10-minute PUT under the store, bound to the content type', async () => {
    const cfg = r2Config((n) => env[n])!;
    const out = await productPhotoUpload(cfg, 'store-1', 'image/webp', 'webp', 'abc', new Date('2026-10-29T08:00:00Z'));
    const u = new URL(out.uploadUrl);
    expect(u.host).toBe('e0a0a55ab04e4ef9ef8e9a40800ef212.r2.cloudflarestorage.com');
    expect(u.pathname).toBe('/trackoja-media/products/store-1/abc.webp');
    expect(u.searchParams.get('X-Amz-Expires')).toBe('600');
    expect(u.searchParams.get('X-Amz-SignedHeaders')).toBe('content-type;host');
    expect(out.publicUrl).toBe('https://media.trackoja.cv/products/store-1/abc.webp');
    expect(out.uploadUrl).not.toContain('secret');
  });
});
