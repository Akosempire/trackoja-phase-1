# Deployment

## Latest deployment check — 30 September 2026

The merchant dashboard release `945cbec` is pushed to `origin/master`, including
its production build. A fresh HTTP check of `/` and `/platform` still returned
`/assets/index-a7e009af.js`; the release expects `/assets/index-a4338344.js`.
The public service worker also referenced the previous entry. This is a live
deployment mismatch, not an onboarding SQL or user-role issue.

The server checkout path and SSH connection are not configured in this workspace.
An operator with server access must update the **actual checkout serving this
domain**, using `git pull --ff-only origin master`, and confirm that its document
root serves that checkout's `dist/`. If a hosting panel copies files into another
document root, its deployment step must also run. Do not assume a GitHub push
automatically updates that directory.

Verify from the workstation after deployment:

```bash
node scripts/check-live-build.mjs https://trackoja.cv
```

The check compares three entry routes, the service-worker bytes and the entry
JavaScript bytes against the committed build. It exits unsuccessfully if stale.
The observed server headers cache HTML and `sw.js` for an hour with a further
day of stale revalidation. Configure the actual serving layer to revalidate
HTML and `sw.js` (`Cache-Control: no-cache`); hashed `/assets/` files can remain
long-lived. Check the headers after changing the server configuration.

The dated deployment observations below are historical, not confirmation that
the latest release is live.

Two independent targets serve this repository. They are updated by different
mechanisms, and knowing which is which saves a lot of confusion.

| Target | What serves it | How it updates |
| --- | --- | --- |
| `https://trackoja.cv` | A VPS at `193.181.212.65`, behind Caddy | `git pull` on the server |
| `https://trackoja-community.vercel.app` | A Vercel project named `trackoja-community` | `vercel deploy --prod` |

`trackoja.cv` is **not** Vercel. Its DNS `A` record points at the VPS and the
responses carry `Via: 1.1 Caddy`.

## What is verified about the live VPS

Checked on 2026-09-27 from a workstation, and recorded here so the next operator
starts from evidence rather than from this file's own claims:

| Claim | How it was checked | Result |
| --- | --- | --- |
| `trackoja.cv` resolves to `193.181.212.65` | `Resolve-DnsName trackoja.cv -Type A` | one `A` record, `193.181.212.65` |
| Caddy terminates it | response headers of `https://trackoja.cv/` | HTTP 200, `Via: 1.1 Caddy`, no `Server` header |
| The live bundle is the committed one | `sha256sum` of the served JS against `dist/assets/index-529d2438.js` | both `BFA57A34256D9CEB74ED7E284A435E31A1EBF3C042275572B8D2802E1F2BD184`, 993,017 bytes |
| `dist/` is what the server serves | `git ls-files dist` | 36 files tracked; `.gitignore` documents why `dist/` is not ignored |

**Currently verified deployed commit: `3eb5110`** (`fix(billing): record the cycle a
checkout charged, so an annual purchase buys a year`). The evidence is the hash pair
above: `dist/index.html` at `3eb5110` references `assets/index-529d2438.js`, and the
bytes served at that path are byte-identical to the file in the repository at that
commit. The two commits after it, `7e0490b` and `51502d9`, touch only
`BILLING_SINGLE_SOURCE.md`, so they ship no bytes and the live bundle is also
identical to the `dist/` at the current HEAD.

**What could not be verified from the workstation, and is therefore not asserted
anywhere below as fact:**

- The server's Caddy configuration: document root, SPA rewrite rule, headers,
  compression. There is **no Caddyfile, Dockerfile, compose file, CI workflow or
  deploy script in this repository** (`scripts/` holds only `generate-icons.mjs` and
  `send-reengagement-email.mjs`). Caddy is known from the `Via` header and from the
  operator's report, not from anything in this repository.
- The checkout path on the server, and whether that checkout is a git clone at all.
  `git pull` in the section below is the procedure this project has used; it is not
  something this repository can prove.
- Whether the server builds or only serves. A tracked `dist/` is consistent with
  serving only, and no server-side build step is recorded anywhere.
- Whether migrations `093`, `094` and `095` have been applied to the production
  database (see the migration table further down for what could be probed).

## Why `dist/` is committed

`dist/` is deliberately tracked in git, unlike most Vite projects. The VPS serves
the built files directly, so committing the build means bringing the live site up
to date needs nothing on the server but a pull — no Node install, no `npm ci`, no
build step, and therefore no way for the server's toolchain to produce a different
bundle from the one that was tested.

The consequence is a rule: **after any change under `src/`, run `npm run build`
and commit the rebuilt `dist/` in the same commit as the source change.** A commit
that changes source without rebuilding `dist/` leaves the VPS serving the previous
bundle even after it pulls. There is no way to notice this from the server except
by comparing the served hash, which is why the smoke test below starts there.

## Deploying a new commit to the VPS

### 1. Build on the workstation, not on the server

```bash
git pull --ff-only
npm ci
npm run build            # tsc --noEmit && vite build; rewrites dist/
git status               # dist/index.html and new dist/assets/* must show up as changed
git add dist src supabase/migrations
git commit -m "..."
git push
```

If `git status` shows no change under `dist/` after a source change, the build did
not run or did not write; stop and fix that before pushing. Nothing else in this
procedure will catch it.

### 2. Apply the database migration

Migrations reach the database separately from the bundle, and the order matters:
apply the migration first. The frontend tolerates a database that is ahead of it
(an unknown JSON key is ignored, an extra column is ignored), but a bundle that
expects a field the database does not return shows the honest "Not returned by this
query" state instead of a value. See "Database migrations" for the commands and for
the list of files that make up the billing work.

### 3. Pull on the server

```bash
cd <the repository checkout on the VPS>   # path is not recorded in this repository
git pull
```

That is the whole server-side procedure, because the build is committed.

### 4. Confirm the serving bundle actually changed

```bash
curl -s https://trackoja.cv/ | grep -o 'assets/index-[A-Za-z0-9]*\.\(js\|css\)' | sort -u
```

Compare the names with `dist/index.html` at the deployed commit. Then compare bytes,
which is the check that cannot be faked by a cached page:

```bash
curl -s https://trackoja.cv/assets/index-<new-hash>.js | sha256sum
sha256sum dist/assets/index-<new-hash>.js
```

The two hashes must be equal. If the served hash still matches the *previous*
bundle's hash, the pull did not happen, did not include the rebuilt `dist/`, or the
server serves a different directory than the one that was pulled. Do not describe
the VPS as updated until this comparison passes.

## Database migrations

Migrations are plain SQL files in `supabase/migrations/`, named
`YYYYMMDD` + a 6-digit sequence, for example
`20260927000096_platform_business_billing_email.sql`. Applying them in filename
order is the same as applying them in the order they were written; there is no
other ordering mechanism and no separate manifest.

**How they are applied.** Either the Supabase CLI, from the workstation, against
the linked project (`supabase/.temp/project-ref` is `wgcolmnlieefqvtzfvjt`):

```bash
npx supabase db push
```

which applies every local migration the remote `supabase_migrations.schema_migrations`
table does not record, in version order. Or, when no database password is available,
the Management API's SQL endpoint with a personal access token, one file at a time:

```bash
jq -Rs '{query: .}' supabase/migrations/20260927000096_platform_business_billing_email.sql > /tmp/096.json
curl -sS -X POST \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  "https://api.supabase.com/v1/projects/wgcolmnlieefqvtzfvjt/database/query" \
  --data-binary @/tmp/096.json
```

The exact command for the billing_email migration, if you apply nothing else, is
that second pair: write the file's contents as the `query` value, POST it to
`https://api.supabase.com/v1/projects/wgcolmnlieefqvtzfvjt/database/query`, then
record it, because the API path does not:

```sql
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260927000096', 'platform_business_billing_email')
ON CONFLICT (version) DO NOTHING;
```

Before applying anything, read what the database already has:

```sql
SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;
```

Treat that table as a record, not as proof: a migration applied through the
Management API without step 2 above is not listed even though it ran. If the CLI
re-pushes a file that already ran, the migration is written to be a no-op rather
than an error — that is the convention this repository follows, verified for 095 and
claimed for the rest in this file's earlier revisions rather than checked file by
file.

### The billing migrations, in the order they must be applied

| File | What it does | Production state on 2026-09-27 |
| --- | --- | --- |
| `20260927000089_platform_owner_hardening.sql` | adds `product_plans.billing_cycle`, gives `upsert_product_plan` its cycle parameter, hardens the platform surface | not verified |
| `20260927000090_entitlement_and_impersonation_fixes.sql` | entitlement and impersonation fixes | not verified |
| `20260927000091_platform_admin_management.sql` | platform admin accounts, levels and baselines | not verified |
| `20260927000092_billing_single_source.sql` | published plan catalogue, `get_my_entitlement`, `start_plan_checkout`, plan publishing | **applied**: `list_published_plans` returns the catalogue to an anonymous caller, and `get_my_entitlement` / `list_product_plans` exist while refusing anon, which is exactly the ACL 092 sets |
| `20260927000093_platform_role_baselines_billing.sql` | corrects the finance and developer baselines | **consistent with applied**: `platform_level_baseline` exists in the schema cache and refuses anon; not decisive, since 091 revokes the same grant |
| `20260927000094_checkout_records_its_cycle.sql` | records the billing cycle and the purchased plan on the transaction so an annual charge activates a year | not verifiable from outside: it changes function bodies and adds nullable columns, neither of which is visible to an anonymous probe |
| `20260927000096_platform_business_billing_email.sql` | returns `organizations.billing_email` from `get_platform_business`, and removes anon's EXECUTE on it | **not applied**: the file is new and has not been applied anywhere |

The probes above used only the publishable (anon) key that ships in the bundle,
against `https://wgcolmnlieefqvtzfvjt.supabase.co/rest/v1/rpc/<function>`. A missing
function answers HTTP 404 `PGRST202`; a function whose EXECUTE was revoked from anon
answers HTTP 401 `42501 permission denied for function`; `get_platform_business`
answers HTTP 400 `P0001 Authentication required`, which is how anon's surviving
EXECUTE on it was established rather than assumed.

`20260927000096` is the migration the billing_email work needs. It is additive: it
replaces one function body with the same signature and the same return type, adds no
column and rewrites no row.

## Rollback

**Code.** `dist/` is committed, so a rollback is a checkout, and the served bundle
follows the commit with no build step:

```bash
cd <the repository checkout on the VPS>
git checkout 3eb5110          # the last deployed commit, or another known-good one
```

or, if the server must stay on a branch, `git revert <bad-commit>` on the
workstation, `npm run build` to restore `dist/` to the reverted source, commit and
push, then `git pull` on the server. Either way, confirm with the same hash
comparison as in step 4: a rollback that is not confirmed by hash has not happened.

**Database.** This repository has no down migrations: every file in
`supabase/migrations/` is a forward migration and there is no rollback file, so
rolling the database back by hand is not a procedure this project has ever run. It
is also not needed for the rollbacks this runbook covers:

- `20260927000095` — the only migration the current billing work adds — is safe to
  leave in place. It adds a key to a JSONB response and tightens an ACL; a bundle
  that predates it never reads the key. The ACL change removes a path that was
  already refused at runtime (`Authentication required`), so nothing that worked
  before stops working.
- `20260927000094` is additive on the schema (two nullable columns) and changes
  function bodies only. Leaving it in place is safe: older bundles call
  `activate_subscription` with the same arguments and read the same return shape.
- `20260927000093` only adds permission keys to platform accounts. Leaving it in
  place gives an operator keys an older bundle does not use.
- `20260927000092` is the largest of the chain and is **not** safe to reason about by
  analogy: it replaced functions and moved the catalogue the live Billing page reads.
  Do not roll the code back past `3eb5110` without checking that combination against
  a database; the deployed `3eb5110` already requires 092, so `3eb5110` is as far
  back as this runbook covers.

So: rolling the code back does not require rolling the database back, for any
rollback within the range above. Never roll the database forward-only chain
backwards by hand to match an older bundle.

## Production smoke test

Run this after every deploy, in this order. Steps 1 and 2 prove the bundle and its
bytes; steps 3 to 6 prove the database behind it; step 7 proves the new behaviour.

1. `https://trackoja.cv/` returns 200 and its HTML names the assets in
   `dist/index.html` at the deployed commit.
2. `https://trackoja.cv/assets/index-<hash>.js` hashes equal to the committed
   `dist/assets/index-<hash>.js` (`sha256sum` both).
3. `https://trackoja.cv/#pricing` shows the published plans with prices while
   signed out. Empty or "startup" prices mean `list_published_plans` (092) is
   missing or its anon grant was lost.
4. Sign in as a platform owner and open `https://trackoja.cv/platform`. The
   overview loads, which proves `platform:view` and the dashboard RPCs.
5. `https://trackoja.cv/platform/businesses` lists businesses, then open one at
   `https://trackoja.cv/platform/businesses/<orgId>`. In the Business panel, read
   the **Billing email** row, which is what the current billing work adds:
   - a business with an address recorded shows the address;
   - a business whose address is NULL or blank shows
     "Not set: no billing email is recorded for this business";
   - if it shows "Not returned by this query, so its value is unknown rather than
     empty", migration 095 has not been applied to the database this deployment
     points at. That is the row working correctly, reporting a database still behind
     the bundle.
   Confirm against the database with
   `SELECT id, name, billing_email FROM organizations WHERE id = '<orgId>';`
6. `https://trackoja.cv/platform/billing` renders the plan catalogue and prices
   (a level holding `platform:manage_plans`).
7. Sign in as a business owner and open `https://trackoja.cv/billing`. The plans
   come from the published catalogue and both Monthly and Annual are offered. Do not
   complete a live charge during a smoke test: stop before paying, or use a business
   with `is_sandbox = true`.

Two database checks, if a token is available:

```sql
SELECT pg_get_functiondef('public.get_platform_business(uuid)'::regprocedure) LIKE '%billing_email%'
  AS returns_billing_email;                                   -- expect true after 095
SELECT has_function_privilege('anon', 'public.get_platform_business(uuid)', 'EXECUTE')
  AS anon_can_execute;                                        -- expect false after 095
```

## Environment names

The Platform Owner console shows which environment an operator is working in.
Environment is a property of the **deployment**, not of the database — the same
database is used by the live site and by local development — so it is declared per
build:

- `VITE_ENVIRONMENT` in `.env.production` (or a per-environment Vercel variable)
  is the primary source. A preview deployment can therefore say `staging` while
  the live one says `production`, against the same database.
- The `environment.name` platform setting is a fallback for a deployment that
  declares nothing.
- With neither, the console reads **Environment unknown**. That is deliberate: a
  production build that has not been told where it runs genuinely does not know,
  and guessing would be worse.

When the two disagree, the console reports the disagreement rather than silently
picking one — a development build pointed at the production database is exactly
the case worth flagging.

## Updating Vercel

```bash
vercel deploy --prod --yes --non-interactive
```

Vercel builds from source rather than using the committed `dist/`, and its project
environment variables override `.env.production` in the repository. A Vercel deploy
does not update `trackoja.cv`, and verifying Vercel says nothing about the VPS.

## Two operational notes

**The VPS is not updated until the deploy and the smoke test have both succeeded.**
A commit, a push or a `git pull` is not a deployment, and a migration is not a
deployment either. The only statements this file makes about what is live are the
ones backed by the hash comparison in "What is verified about the live VPS", and the
last one on record is `3eb5110`. Update that paragraph only after re-running the
hash comparison, and never from a commit message.

**`dist/` churn makes commits large.** Rebuilding renames the hashed asset files,
so each build commit shows a rename pair. That is expected and not a sign that
something was committed by accident.
