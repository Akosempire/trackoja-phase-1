# TrackOja ↔ Usetally connection contract (v1)

Two apps, two Supabase projects, one signed link per shop. Usetally never holds
the shop's money: it records what TrackOja already collected.

## 1. Linking (OAuth-style, one-time code)

1. In TrackOja (Settings → Connected apps) the owner taps **Connect Usetally**.
   TrackOja stores a random `state` in sessionStorage and sends the browser to
   `https://usetally.cc/connect/pos?return_to=<url-encoded TrackOja callback>&state=<state>&store=<url-encoded store name>`.
   The TrackOja callback route is `/settings/usetally/callback`.
2. Usetally requires sign-in, shows the current business and what will be shared,
   and asks the user (role owner or manager) to approve.
   - `return_to` must start with an allowed origin: env `POS_RETURN_ORIGINS`
     (comma separated), default `https://trackoja.cv,http://localhost:5173,http://127.0.0.1:5173`.
   - Approve → Usetally creates a one-time code (32 random bytes, base64url;
     only its SHA-256 is stored; expires in 10 minutes; single use) and redirects to
     `<return_to>?code=<code>&state=<state>`.
   - Deny → `<return_to>?error=access_denied&state=<state>`.
3. The TrackOja callback page checks `state`, then calls the TrackOja Edge Function
   `usetally-connect` with `{ code }` (signed-in owner/manager of the store). The
   function calls Usetally server-to-server:

   `POST https://usetally.cc/api/pos/link`
   ```json
   { "code": "…", "store_id": "<uuid>", "store_name": "Ikeja branch",
     "callback_base": "https://<project-ref>.supabase.co/functions/v1" }
   ```
   → `200 { "key": "utpos_<40 base62 chars>", "business": { "id": "…", "name": "…", "currency": "NGN" } }`
   → `400 { "error": "Code is invalid or expired" }`

   Usetally stores: SHA-256 of the key (for auth), the key encrypted (for calling
   TrackOja back), last 4 chars, store id/name, `callback_base`.
   TrackOja stores: SHA-256 of the key, the key encrypted with Edge secret
   `USETALLY_LINK_SECRET` (AES-GCM), business id/name/currency.
   One active link per TrackOja store and per Usetally business; linking again replaces the old link.

## 2. Auth

Every call either way: `Authorization: Bearer utpos_…`. Unknown or revoked key → `401`.
On a 401 the caller marks its link as revoked and stops syncing.

## 3. Usetally API (called by TrackOja)

- `GET /api/pos/me` → `{ "business": { "id", "name", "currency" }, "connected_at": "ISO" }`
- `POST /api/pos/disconnect` → `204` (revokes the key)
- `POST /api/pos/sales` — import one completed POS sale. Idempotent on `id`.
  ```json
  {
    "id": "<TrackOja sale uuid>", "number": "000128", "created_at": "2026-10-28T19:40:00Z",
    "currency": "NGN",
    "store": { "id": "<uuid>", "name": "Ikeja branch" },
    "cashier": "Ada",
    "customer": { "name": "Mrs Bisi Adeyemi", "phone": "0803…", "email": "" },
    "items": [ { "product_id": "<uuid>", "name": "Peak Milk Tin 400g", "sku": "FD-012",
                 "quantity": 2, "unit_price_minor": 320000, "discount_minor": 0,
                 "tax_minor": 0, "line_total_minor": 640000 } ],
    "subtotal_minor": 640000, "discount_minor": 0, "tax_minor": 0, "total_minor": 640000,
    "payments": [ { "method": "cash" | "card" | "transfer" | "credit" | "other",
                    "amount_minor": 640000, "reference": "" } ],
    "change_minor": 0
  }
  ```
  `customer` may be null. Money is integer minor units (kobo).
  → `201 { "document_id", "number", "status" }` on first import, `200` with the same body on a repeat.
  → `422 { "error" }` when the payload can't be imported (wrong currency etc.); TrackOja marks the outbox row failed and does not retry.

  Usetally behaviour: creates an **invoice** marked `source = 'pos'`, `source_ref = <sale id>`,
  title `POS sale #<number>`, issued and sent at `created_at`, items as sent, sale discount as the
  document discount. Then records each non-credit payment (`cash`→cash, `card`→pos,
  `transfer`→bank_transfer, `other`→other), which issues receipts. A credit portion stays as
  balance due (the customer owes it). POS documents never count toward a plan's document allowance
  and never send emails.
- `POST /api/pos/sales/<id>/void` `{ "reason": "…" }` → `200` — voids the imported document
  (idempotent; `404` if never imported).

## 4. TrackOja API (called by Usetally)

Base: the `callback_base` sent at link time.

- `GET <base>/usetally-catalog?q=<search>&limit=50` →
  `{ "products": [ { "id", "name", "sku", "barcode", "unit", "price_minor", "stock_qty", "track_inventory" } ] }`
  (active products of the linked store, name order).
- `POST <base>/usetally-stock` — deduct stock for a Usetally invoice that became fully paid.
  Idempotent on `document_id`.
  ```json
  { "document_id": "<uuid>", "number": "INV-0042", "lines": [ { "product_id": "<uuid>", "quantity": 3 } ] }
  ```
  → `200 { "applied": true }` (or `"applied": false, "reason": "already applied"`).
  Stock may go negative (the sale already happened); TrackOja records an inventory movement
  of type `sale` with reason `Usetally invoice <number>`.

## 5. Delivery and retries (TrackOja)

A completed sale (or a void) writes a row to `usetally_outbox` when the store has an active link.
The `usetally-sync` Edge Function sends pending rows oldest first: on 2xx → `sent`; on 401 →
link revoked; on 422 → `failed` (no retry); otherwise retry with backoff (1, 5, 15, 60 min, then
hourly, max 24 attempts). It runs on a pg_cron schedule every minute and is also nudged right after
checkout. Settings shows last sync time, pending and failed counts, and a "Retry failed" button.

## 6. Setting it up (once)

**Usetally (Vercel + Supabase)**
1. Run `supabase/RUN_NEW_2026-10-29a.sql` in Usetally's Supabase SQL editor.
2. Optional: Vercel env `POS_RETURN_ORIGINS` if TrackOja moves off `https://trackoja.cv`
   (comma separated, e.g. `https://pos.usetally.cc,https://trackoja.cv`). Redeploy.

**TrackOja (its own Supabase project)**
1. Apply `supabase/migrations/20261029000001_usetally_link.sql` (`supabase db push`, or paste it in the SQL editor).
2. Edge Function secrets (Supabase → Edge Functions → Secrets):
   - `USETALLY_LINK_SECRET`: a random string of at least 32 characters (encrypts link keys). Never change it after shops connect.
   - `USETALLY_SYNC_TOKEN`: another random string (lets the every-minute job call usetally-sync).
   - `USETALLY_URL`: `https://usetally.cc` (optional; that is the default).
3. Deploy the functions: `supabase functions deploy usetally-connect usetally-disconnect usetally-sync usetally-catalog usetally-stock`.
4. Every-minute delivery: in the SQL editor run
   `select vault.create_secret('https://<project-ref>.supabase.co', 'usetally_project_url');`
   `select vault.create_secret('<the USETALLY_SYNC_TOKEN value>', 'usetally_sync_token');`
   (pg_cron and pg_net must be enabled under Database → Extensions; the migration schedules the job.)
5. Vercel env for the TrackOja site (optional): `VITE_USETALLY_URL` if Usetally is not at `https://usetally.cc`.

## 7. Known limits in v1

- Full voids reach Usetally. Partial refunds stay in TrackOja only; void and re-ring the sale if Usetally must match.
- Stock from Usetally invoices is applied at product level (no batch/lot picking).
- One TrackOja store per Usetally business. Linking another branch replaces the first link.

## 8. Tests

- Usetally: `npm test` (tests/pos.test.mjs) and `bash scripts/test-db.sh` (supabase/tests/pos.test.mjs).
- TrackOja: `npx vitest run tests/usetally-connect.test.ts` and `bash scripts/test-db.sh` (supabase/tests/usetally.test.mjs).
- Both together, local databases only: build both test databases, then in Usetally
  `node --import ./tests/register.mjs scripts/pos-e2e.mjs 50`. It rings 50 real TrackOja sales (tax, discounts,
  weights, change, credit, voids), delivers them, and checks both sides match to the kobo.
