# Phase 0 runbook: make the live site safe

Do these steps in order. Steps marked **You** need your Supabase login and can't be
done by Claude. Nothing here prints or stores a secret.

## 1. Rotate the exposed credentials (You, ~15 minutes)

The old machine held these in plain text, outside git. Treat them as leaked.

1. **Supabase access token (`sbp_...`)**
   supabase.com → avatar (top right) → Account preferences → Access Tokens →
   delete every token you don't recognise or that was on the old machine → Generate
   new token (only if you use the CLI) → keep it in your password manager.
2. **trackoja-dev database password**
   Project `trackoja-dev` → Project Settings → Database → Reset database password.
   Do the same on the live project (`xegcukmbinkyffzmfejc`) to be safe.
3. **Service role keys (both projects)**
   Project Settings → API Keys → if the project uses the new keys, create a new
   *secret* key and delete the old one; if it uses legacy JWT keys, use "Rotate JWT
   secret" (this also changes the anon key, so step 5 will pick up the new one).
   Then re-enter the new value wherever an Edge Function secret needs it:
   Edge Functions → Secrets.
4. Delete the old files on the old machine (`TODO.md` and any `.env` copies outside
   the repo) once the new values are in your password manager.

## 2. Bring the live database up to date (You, ~10 minutes)

The live site currently uses the **dev** database because the live one is missing
the September migrations.

```bash
cd trackoja-phase-1
npx supabase login                       # uses the new access token
npx supabase link --project-ref xegcukmbinkyffzmfejc
npx supabase db push --dry-run           # read the list first
npx supabase db push
```

If real shops have been signing up on trackoja.cv since 27 September, their data is
in the **dev** project. Tell Claude before step 3 and we'll move it across first.

## 3. Point production at the live project (Claude can do this once step 2 is done)

Replace the two lines in `.env.production` with the live project's URL and its
**publishable/anon** key (Project Settings → API Keys). The anon key is public by
design and is safe to commit.

```
VITE_SUPABASE_URL=https://xegcukmbinkyffzmfejc.supabase.co
VITE_SUPABASE_ANON_KEY=<live anon/publishable key>
```

Then build and commit `dist/` (see DEPLOYMENT.md) and `git pull` on the VPS.

## 4. Check payments are live, not mock (You, ~5 minutes)

On the **live** project → Edge Functions → Secrets:

- `PAYSTACK_SECRET_KEY` is set and starts with `sk_live_`
- `OPAY_SECRET_KEY` is set
- `PAYMENTS_MOCK_ENABLED` is **absent** or not `true`

The code already refuses to fake a payment unless `PAYMENTS_MOCK_ENABLED` is exactly
`true`, and refuses OPay webhooks without a valid signature.

## 5. Gate

- trackoja.cv signs in against `xegcukmbinkyffzmfejc` (check the Network tab)
- the old access token and database passwords no longer work
- `npm test` passes
