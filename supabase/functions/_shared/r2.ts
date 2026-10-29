// Cloudflare R2 (S3 API) for product photos: a presigned PUT URL so the
// browser uploads straight to the bucket and the R2 keys stay on the server.
// AWS Signature V4, query-string form, with WebCrypto only (Deno and Node 18+).

const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (s: string) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(data));
}
// RFC 3986 encoding as SigV4 wants it; '/' kept in paths
const uri = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export interface PresignInput {
  method: 'PUT' | 'GET';
  host: string;            // e.g. <account>.r2.cloudflarestorage.com
  path: string;            // /bucket/key (path-style)
  region: string;          // 'auto' for R2
  accessKeyId: string;
  secretAccessKey: string;
  expiresSeconds: number;  // max 604800
  now?: Date;
  signedHeaders?: Record<string, string>; // lower-case names, e.g. content-type
}

export async function presign(i: PresignInput): Promise<string> {
  const now = i.now ?? new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${i.region}/s3/aws4_request`;
  const headers: Record<string, string> = { host: i.host, ...(i.signedHeaders ?? {}) };
  const names = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const query: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${i.accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(Math.min(Math.max(1, Math.floor(i.expiresSeconds)), 604800)),
    'X-Amz-SignedHeaders': names.join(';'),
  };
  const canonicalQuery = Object.keys(query).sort().map((k) => `${uri(k)}=${uri(query[k])}`).join('&');
  const canonicalHeaders = names.map((n) => `${n}:${String(headers[n]).trim()}\n`).join('');
  const canonicalPath = i.path.split('/').map((seg) => uri(decodeURIComponent(seg))).join('/');
  const canonical = [i.method, canonicalPath, canonicalQuery, canonicalHeaders, names.join(';'), 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256(canonical)].join('\n');
  let key: ArrayBuffer = await hmac(enc.encode(`AWS4${i.secretAccessKey}`), day);
  for (const part of [i.region, 's3', 'aws4_request']) key = await hmac(key, part);
  const signature = hex(await hmac(key, toSign));
  return `https://${i.host}${canonicalPath}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

export const PHOTO_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

export interface R2Config { accountId: string; bucket: string; accessKeyId: string; secretAccessKey: string; publicUrl: string }

/** The R2 settings from Edge secrets, or null when photos should stay on Supabase Storage. */
export function r2Config(get: (name: string) => string | undefined): R2Config | null {
  const accountId = (get('R2_ACCOUNT_ID') ?? '').trim().toLowerCase();
  const bucket = (get('R2_BUCKET') ?? '').trim();
  const accessKeyId = (get('R2_ACCESS_KEY_ID') ?? '').trim();
  const secretAccessKey = (get('R2_SECRET_ACCESS_KEY') ?? '').trim();
  const publicUrl = (get('R2_PUBLIC_URL') ?? '').trim().replace(/\/+$/, '');
  if (!/^[0-9a-f]{32}$/.test(accountId) || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket) || !accessKeyId || !secretAccessKey || !/^https:\/\/[^/?#]+(\/[^?#]*)?$/.test(publicUrl)) return null;
  return { accountId, bucket, accessKeyId, secretAccessKey, publicUrl };
}

/** Checks what the browser wants to upload: { ext } or { error }. */
export function checkPhoto(contentType: unknown, size: unknown): { ext: string } | { error: string } {
  const ext = typeof contentType === 'string' ? PHOTO_TYPES[contentType.toLowerCase()] : undefined;
  if (!ext) return { error: 'Use a JPG, PNG or WebP photo' };
  const n = Number(size);
  if (!Number.isFinite(n) || n <= 0) return { error: 'The photo is empty' };
  if (n > PHOTO_MAX_BYTES) return { error: 'The photo must be 5 MB or smaller' };
  return { ext };
}

/** A presigned PUT for products/<storeId>/<uuid>.<ext>, valid 10 minutes, bound to its content type. */
export async function productPhotoUpload(cfg: R2Config, storeId: string, contentType: string, ext: string, id = crypto.randomUUID(), now?: Date) {
  const key = `products/${storeId}/${id}.${ext}`;
  const uploadUrl = await presign({
    method: 'PUT', host: `${cfg.accountId}.r2.cloudflarestorage.com`, path: `/${cfg.bucket}/${key}`, region: 'auto',
    accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, expiresSeconds: 600, now,
    signedHeaders: { 'content-type': contentType.toLowerCase() },
  });
  return { uploadUrl, publicUrl: `${cfg.publicUrl}/${key}`, key };
}
