# Product photos on Cloudflare R2

The browser asks the `media-upload-url` Edge Function for a 10-minute signed
upload link, then uploads the photo straight to the `trackoja-media` bucket. The
R2 keys stay in Edge Function secrets. Until all five secrets are set, photos keep
going to Supabase Storage as before. Photos already saved keep working.

## Set up (once)

TrackOja's Supabase project → Edge Functions → Secrets → add:

| Name | Value |
| --- | --- |
| `R2_ACCOUNT_ID` | Cloudflare account ID (R2 overview, right side) |
| `R2_BUCKET` | `trackoja-media` |
| `R2_ACCESS_KEY_ID` | from the R2 API token (S3 credentials) |
| `R2_SECRET_ACCESS_KEY` | from the R2 API token (S3 credentials) |
| `R2_PUBLIC_URL` | `https://media.trackoja.cv` or the bucket's `https://pub-….r2.dev` URL |

Then deploy: `npx supabase functions deploy media-upload-url`.

Bucket CORS must allow PUT from the app's address (trackoja.cv, and the Vercel
address once it moves). Uploads: JPG, PNG or WebP, up to 5 MB, by people with
product:create or product:update on the store.

Rolling the R2 token later: create the new token, replace `R2_ACCESS_KEY_ID` and
`R2_SECRET_ACCESS_KEY`, then delete the old token. No redeploy needed.
