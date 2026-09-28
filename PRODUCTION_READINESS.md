# Production Readiness: Credential and Environment Isolation

This document is a plan, not a record of work done. Nothing in this document has
been executed: no secret was rotated, no database was touched, and no file in this
repository other than this one was created or changed.

Every claim below is tagged:

- **Verified** — I read the file or ran the command named, and the statement is what
  that evidence shows.
- **Inferred** — the statement follows from evidence but is not itself directly
  observed. Each inference says what it rests on.

**No secret value appears in this document.** Secrets are referred to by name and by
location only. Supabase project *refs* (`xegcukmbinkyffzmfejc`,
`wgcolmnlieefqvtzfvjt`) and project URLs *do* appear: they are not credentials, they
ship inside the JavaScript bundle that every visitor of the site downloads, and a
plan that hides them cannot be followed. Publishable/anon keys, Personal Access
Tokens, database passwords, and service-role keys are never reproduced, not even
truncated.

---

## 1. What is true today

### 1.1 The findings that change what you do next

| # | Finding | Severity | Evidence |
| --- | --- | --- | --- |
| F1 | The committed production build config points production at the **development** project, not the live one | Critical | Verified |
| F2 | The bundle actually served by `trackoja.cv` is wired to the **development** project | Critical | Verified |
| F3 | `paystack-initialize` hands out paid subscriptions for free when `PAYSTACK_SECRET_KEY` is unset (mock mode) | Critical | Verified |
| F4 | `opay-webhook` **skips signature verification entirely** when `OPAY_SECRET_KEY` is unset, and still processes the payload | Critical | Verified |
| F5 | One Supabase Personal Access Token (`sbp_...`) and the `trackoja-dev` database password sit in plaintext on this machine, outside git | Critical | Verified |
| F6 | Those same files also contain 7 `service_role` JWTs, which are the broadest credential Supabase issues | Critical | Verified |
| F7 | Production and local development use the **same** Supabase project | High | Verified |
| F8 | The migration that fixes mock mode is **uncommitted**, and no Edge Function implements it | High | Verified |
| F9 | Two different migration files claim the same version number `20260927000095` | High | Verified |
| F10 | No literal Paystack webhook URL is documented anywhere inside the repository | Medium | Verified |
| F11 | No *true secret* is committed in this repository's git history | (good news) | Verified |

F11 is the direct answer to the most important question asked of me, and it is worth
stating precisely before the bad news is described, because the two are easily
confused:

- **The `sbp_...` Personal Access Token is NOT in git.** It is not in the working
  tree of this repository either.
- **The `trackoja-dev` database password is NOT in git.**
- **No `service_role` key is committed.** I decoded the payload of every JWT-shaped
  string in every tracked file and looked at the `role` claim; none of them is
  `service_role`.
- **`.env.local` has never been tracked.** `git log --all --oneline -- .env.local`
  returns nothing, and `.gitignore:6` lists `.env.local`.

What *is* committed is `.env.production`, and that is finding F1.

### 1.2 Where secrets live today

#### 1.2.1 Secrets the Edge Functions read (verified)

Every `Deno.env.get(...)` call in `supabase/functions/`:

| Secret name | Read at | Set by |
| --- | --- | --- |
| `SUPABASE_URL` | `log-logout/index.ts:26`, `paystack-initialize/index.ts:37`, `paystack-webhook/index.ts:76`, `opay-initiate-payment/index.ts:43`, `opay-webhook/index.ts:92` | Supabase, injected automatically |
| `SUPABASE_ANON_KEY` | `log-logout/index.ts:27`, `paystack-initialize/index.ts:38`, `opay-initiate-payment/index.ts:44` | Supabase, injected automatically |
| `SUPABASE_SERVICE_ROLE_KEY` | `log-logout/index.ts:28`, `paystack-initialize/index.ts:39`, `paystack-webhook/index.ts:77`, `opay-initiate-payment/index.ts:45`, `opay-webhook/index.ts:93` | Supabase, injected automatically |
| `PAYSTACK_SECRET_KEY` | `paystack-initialize/index.ts:40`, `paystack-webhook/index.ts:37` | Operator, via `supabase secrets set` |
| `OPAY_SECRET_KEY` | `opay-initiate-payment/index.ts:46`, `opay-webhook/index.ts:56` | Operator, via `supabase secrets set` |

So the operator-settable list is exactly two names: **`PAYSTACK_SECRET_KEY`** and
**`OPAY_SECRET_KEY`**. The other three are supplied by the Supabase runtime for every
function and must never be set by hand — setting `SUPABASE_SERVICE_ROLE_KEY`
manually is how a project ends up with a stale service key after a key rotation.

Names referenced only in local tooling config, not by any function:

- `OPENAI_API_KEY` — `supabase/config.toml:101`, for Supabase Studio's AI feature
  locally only. The field is `openai_api_key = "env(OPENAI_API_KEY)"`, i.e. the
  supported `env(...)` indirection, so the value is not in the file.
- `SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN` — `supabase/config.toml:294`, Twilio disabled
  at `config.toml:290`.
- `SUPABASE_AUTH_EXTERNAL_APPLE_SECRET` — `supabase/config.toml:326`, Apple provider
  disabled at `config.toml:323`.
- `S3_HOST` / `S3_REGION` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` — `config.toml:411-417`,
  all commented out.
- `BREVO_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` — read from the shell environment by
  `scripts/send-reengagement-email.mjs:19-20`. This one-off script hardcodes the *live*
  project URL at line 18 and takes the service-role key from the environment, which is
  the right pattern.

#### 1.2.2 The env files (verified; values not printed)

`.env.local` — **not tracked**, ignored by `.gitignore:6`. Variable names and whether a
value is present:

| Line | Name | Value present |
| --- | --- | --- |
| 3 | `VITE_SUPABASE_URL` | yes |
| 4 | `VITE_SUPABASE_ANON_KEY` | yes |
| 5 | `VITE_APP_NAME` | yes |
| 8 | `VERCEL_OIDC_TOKEN` | yes (a 1343-character JWT) |

`.env.production` — **tracked in git**. Variable names and whether a value is present:

| Line | Name | Value present |
| --- | --- | --- |
| 7 | `VITE_SUPABASE_URL` | yes |
| 8 | `VITE_SUPABASE_ANON_KEY` | yes |
| 9 | `VITE_APP_NAME` | yes |
| 14 | `VITE_ENVIRONMENT` | yes, `production` |

`.env.local.example` — tracked, placeholders only (lines 7, 8, 11); its own line 13 says
"Never commit actual keys to version control!", which is exactly what `.env.production`
does with the line 7/8 pair.

The committed key is **not a service secret**. I classified it: it is an
`sb_publishable_...` key (46 characters), which Supabase designs to be embedded in
browser code, with RLS as the actual protection. `.env.local:2` says the same thing.
So committing it is an environment-management mistake, not a credential leak — but the
*project ref* it carries is the finding F1 problem.

#### 1.2.3 Whether a secret is exposed in git history (verified)

Commands run, and what they returned:

- `git ls-files | Select-String -Pattern "env"` returns exactly:
  `.env.local.example`, `.env.production`, `src/components/platform/EnvironmentBadge.tsx`,
  `src/config/environment.ts`, `src/vite-env.d.ts`.
- `git log --all --oneline -- .env.local` returns **nothing** — never tracked.
- `git log --all --oneline -- .env.production` returns three commits; the file was
  added by `56a9786` ("Add welcome onboarding carousel and fix build-time Supabase env
  vars").
- `git ls-files --error-unmatch .env.local` fails with "did not match any file(s) known
  to git". `git ls-files --error-unmatch .env.production` succeeds.
- A scan of every blob in `git rev-list --all` for the `sbp_` pattern returns no
  filenames.
- A scan of every tracked file for JWTs whose decoded `role` claim is `service_role`
  returns none.
- Every `sk_test_` / `sk_live_` occurrence in the repository is a documentation
  placeholder with a trailing ellipsis (`supabase/functions/paystack-initialize/index.ts:8`,
  `src/pages/platform/areas/IntegrationsArea.tsx:436`, `PHASE_6_SUBSCRIPTIONS.md:110`,
  `TODO.md:277,281`), plus the same strings compiled into
  `dist/assets/index-529d2438.js`. No Paystack key value is committed.

**Verified conclusion: no secret value is committed to this repository's git history.**
The git-tracked environment problem is F1 — the wrong *project target* is committed —
not a leaked credential.

#### 1.2.4 Where the real credentials are (verified)

`C:\Users\USER\Documents\Trackoja\.claude\settings.local.json` — a 48,409-byte file in
the workspace root, **outside the git repository**. `git rev-parse --show-toplevel` run
from that directory fails with "not a git repository (or any of the parent
directories)", and `git ls-files` in `trackoja-phase-1` contains no `.claude` entry, so
this file is not tracked by the repository or by any parent repository.

Its contents, described without reproducing any value:

- **21 occurrences of one single distinct Supabase Personal Access Token** beginning
  `sbp_`, 44 characters long. It is written literally into an allowlist of previously
  approved shell commands.
- **56 JWT-shaped strings**, of which 28 are complete three-part JWTs. Decoding the
  payloads by their `role` claim: **7 are `service_role`**, 5 are `authenticated`, 16
  are `anon`. By `ref` claim: 19 belong to `wgcolmnlieefqvtzfvjt` (trackoja-dev) and 4
  to `xegcukmbinkyffzmfejc` (the live project). The `service_role` keys for both
  projects are therefore on disk in plaintext.
- **The `trackoja-dev` database password, in plaintext, twice**: exported as
  `SUPABASE_DB_PASSWORD` at line 38 and passed as a `--password` argument to
  `supabase db push` at line 70. The value is a short, human-typeable string rather
  than a generated high-entropy password, which is itself worth fixing.
- Commands that used the PAT to reach the **live** project as well as the dev one,
  including `projects api-keys` (line 178) against `xegcukmbinkyffzmfejc` and
  `link --project-ref xegcukmbinkyffzmfejc` (line 195).

`C:\Users\USER\AppData\Local\Temp\tk-shot\` — a scratch directory of roughly 150
automation scripts and SQL probes (verified by listing). Most of them read credentials
from environment variables, which is correct (`SUPABASE_ACCESS_TOKEN`,
`SUPABASE_DB_URL`, `SUPABASE_PROJECT_REF`, `SUPABASE_ANON_KEY`, `SUPABASE_URL`). Two
items do not:

- `prod-db-password.txt`, 25 bytes, a single token with no `=` and no newline: a bare
  password file. Its content is not reproduced here and I did not test it against
  anything.
- `env.production.live-backup`, named by `.env.production:6` as "a backup of the
  previous contents": the live project URL plus an `anon` JWT (not `service_role`).

### 1.3 The current environment model

**How the app decides what environment it is (verified).**

`src/config/environment.ts` is the whole mechanism:

- The type is `'production' | 'staging' | 'development' | 'unknown'` (line 1), and the
  platform setting key is the string `environment.name` (line 4).
- `normalise()` (lines 39-46) accepts aliases: `prod`/`live` map to production,
  `stage`/`preview` to staging, `dev`/`local` to development.
- `resolveEnvironment()` (lines 66-112) resolves in this order: **`import.meta.env.VITE_ENVIRONMENT`
  first** (line 67, returned at lines 80-88), the database's `environment.name` setting
  second (lines 68, 90-97), the Vite build mode third but only when it is
  `development` or `staging` (lines 99-104), and `unknown` otherwise.
- When the build and the database both declare an environment and they disagree, the
  disagreement is reported rather than resolved (lines 70-78). `src/components/platform/EnvironmentBadge.tsx:13,39-41`
  renders it, and `PlatformContext.tsx:56-57` feeds the setting row into the resolver.

**What `VITE_ENVIRONMENT` and `environment.name` actually do (verified).**

- `VITE_ENVIRONMENT` is a build-time value. `.env.production:14` sets it to
  `production`. It is what makes the Platform console label a deployment, and it is
  documentation-grade: nothing in the app changes behaviour because of it. It selects
  warning copy only — `environment.ts:32-37` defines the strings, and
  `DeveloperArea.tsx:43-48` defines what the operator is told it means.
- `environment.name` is a row in `platform_settings`. It is **declared by no migration
  and cannot be created through the UI**: `SettingsArea.tsx:576-580` states this, and
  `DeveloperArea.tsx:574-578` explains why — `set_platform_setting()` refuses any key a
  migration has not declared. So in practice the setting does not exist, `resolveEnvironment`
  receives `undefined`, and the build declaration is the only source. A useful
  consequence: the mismatch warning at `environment.ts:70-78` can never fire today,
  because it requires the database to declare something.

**A documentation defect worth fixing (verified).** `DeveloperArea.tsx:572-573` tells
the operator the resolution order is "the `environment.name` setting, then this build's
`VITE_ENVIRONMENT`, then the Vite build mode". That is the reverse of the code, which
returns the build value first at `environment.ts:80` and only reaches the setting at
line 90. An operator debugging a mislabelled environment would be told to check the
wrong source first.

**Is the same database shared between the live site and local development? Yes
(verified).**

Three independent pieces of evidence, all pointing the same way:

1. `environment.ts:60-63` says so in prose: "the same database here is used by the live
   site and by local development". `DEPLOYMENT.md:56-63` repeats it: "the same database
   is used by the live site and by local development".
2. The value of `VITE_SUPABASE_URL` in `.env.local:3` and in `.env.production:7` is
   **identical** — same length (40), same SHA-256 fingerprint. Both point at
   `wgcolmnlieefqvtzfvjt`, which is `trackoja-dev`. The same is true of
   `VITE_SUPABASE_ANON_KEY` (lines 4 and 8 respectively).
3. The built, committed, served bundle agrees. `dist/index.html` loads
   `assets/index-529d2438.js`; that tracked file inlines
   `https://wgcolmnlieefqvtzfvjt.supabase.co` and the same publishable key.
   `DEPLOYMENT.md:14-25` states that the VPS at `trackoja.cv` serves `dist/` directly
   and updates by `git pull`. So **the live site is served a bundle wired to the
   development project.**

**Why `.env.production` points at the dev project (verified).** Its own comment,
lines 2-6, says it: "TEMPORARILY points at the trackoja-dev project
(wgcolmnlieefqvtzfvjt) so the new multi-product admin and landing page work while the
live database is migrated. RESTORE the live project once `supabase db push` has run
against `xegcukmbinkyffzmfejc`." The temporary state is committed and was never
reverted.

**When it changed (verified).** Reading `.env.production` out of each commit that
touched it:

| Commit | `VITE_SUPABASE_URL` assigned | `VITE_ENVIRONMENT` |
| --- | --- | --- |
| `56a9786` (file added) | `xegcukmbinkyffzmfejc` (live) | absent |
| `dd8718a` | `wgcolmnlieefqvtzfvjt` (dev) | absent |
| `e649661` | `wgcolmnlieefqvtzfvjt` (dev) | `production` |
| `HEAD` | `wgcolmnlieefqvtzfvjt` (dev) | `production` |

The switch to the dev project happened in `dd8718a` ("feat(stock): stock identity -
variants, batches, rolls, serials, and per-line units") and stayed. Note the
combination at HEAD: a build that declares itself `production` while connected to the
development database. That is precisely the situation `environment.ts:18-22` was
written to warn about, and it cannot warn, because nothing declares the environment on
the database side.

**Which target serves which backend (inferred, must be verified by a human).**
`DEPLOYMENT.md:51-52` says Vercel builds from source and that "its project environment
variables override `.env.production` in the repository". `TODO.md:19-22` (outside the
repository) says the Vercel project's `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` were
set to the live project `xegcukmbinkyffzmfejc`. If both remain true, then
`trackoja.cv` (VPS, committed `dist/`) talks to `trackoja-dev` while
`trackoja-community.vercel.app` (Vercel, env vars) talks to the live project — two public
front doors writing to two different databases. I could not verify the Vercel project's
current settings from the repository, and I did not call any API. Treat this as the
first thing to check.

### 1.4 Paystack configuration

**`paystack-initialize` (`supabase/functions/paystack-initialize/index.ts`)**

Reads, in order: `SUPABASE_URL` (37), `SUPABASE_ANON_KEY` (38),
`SUPABASE_SERVICE_ROLE_KEY` (39), `PAYSTACK_SECRET_KEY` (40). The first three use the
non-null assertion `!`, so a missing injected variable throws and the function returns
its 500 catch (lines 125-130). `PAYSTACK_SECRET_KEY` is deliberately read without `!`
because absence is a branch, not an error:

- **If `PAYSTACK_SECRET_KEY` is unset (lines 71-91):** the function calls
  `activate_subscription` with `p_paystack_data: { mock: true }` (lines 76-80),
  activating the subscription immediately with no gateway session and no payment, then
  returns `authorizationUrl` equal to the caller's `callbackUrl` and an access code of
  `MOCK-<reference>` (lines 83-90). The file header says the same at lines 7-10, and
  `IntegrationsArea.tsx:440-441` warns the operator: "Mock mode activates a subscription
  without any payment until that secret exists." `TODO.md:265-268` records the business
  risk in capitals. **This is fail-open: a missing secret is a free paid plan.**
- **If it is set (lines 93-124):** it posts to `https://api.paystack.co/transaction/initialize`
  with `Authorization: Bearer <PAYSTACK_SECRET_KEY>` (96), the amount in kobo
  (`Math.round(amount * 100)`, line 101), the transaction's own reference (103) and the
  caller's `callback_url` (104).

**`paystack-webhook` (`supabase/functions/paystack-webhook/index.ts`)**

Reads `PAYSTACK_SECRET_KEY` (37), `SUPABASE_URL` (76), `SUPABASE_SERVICE_ROLE_KEY` (77).

- **If `PAYSTACK_SECRET_KEY` is unset (lines 38-43):** it returns HTTP 500,
  "Paystack is not configured on this server". **This one fails closed**, the opposite
  of `paystack-initialize`, which is an inconsistency between two halves of the same
  payment flow.
- Signature verification is HMAC-SHA512 of the raw body compared against the
  `x-paystack-signature` header (lines 20-30, 45-53), which is why the function must be
  deployed with JWT verification off.
- On `charge.success` it calls `activate_subscription` (lines 81-88); on `charge.failed`
  it calls `mark_subscription_transaction_failed` (89-95). Both are `service_role`-only
  per `20260614000031_subscriptions_functions.sql:129-130`.
- It returns 200 even when the handler throws (lines 100-107), with a comment explaining
  that Paystack retries non-2xx.

**Is there any notion of test versus live mode? No (verified).** The only distinction in
the code is secret-present versus secret-absent. The key string is used verbatim at
`paystack-initialize/index.ts:96` and at `paystack-webhook/index.ts:48`; nothing inspects
whether it begins `sk_test_` or `sk_live_`, and nothing records which one was used.
`IntegrationsArea.tsx:318` is UI copy that mentions the two prefixes.

A migration exists that would introduce the distinction but is **not committed and not
implemented**. `supabase/migrations/20260927000095_payments_fail_closed.sql` (untracked
— `git status` reports it as `??`):

- Its header (lines 4-12) names the exact defect above and says "a missing secret is a
  configuration error, and a configuration error must never be a free subscription."
- It adds `payment_mode`, `environment`, `expected_amount`, `expected_currency`,
  `gateway_reference`, `verified_at`, `settled_by`, `failure_reason` and `is_test_data`
  to `subscription_transactions` (lines 53-93), with check constraints restricting
  `payment_mode` to `('live','test','mock')` and `environment` to
  `('production','staging','development')` (lines 95-126).
- It states that the mode is resolved **only from Edge Function secrets** via a module
  at `_shared/payments.ts` (line 40), and reaches the database only through
  `record_payment_attempt`, granted to `service_role` alone (lines 469-530).
- `settle_verified_payment` becomes the single activating path and refuses unless
  reference, business, amount, currency, mode, environment and plan all match what was
  stamped at initialization (lines 532-559 and onward).
- It **revokes `activate_subscription` from `service_role`** (lines 693 and 999), so
  `paystack-initialize` and `paystack-webhook` can no longer activate at all until they
  are rewritten.

**Verified gap:** `supabase/functions/_shared/` contains only `cors.ts` (236 bytes).
There is no `payments.ts`. A grep of the whole `supabase/functions` tree for
`settle_verified_payment`, `record_payment_attempt`, `start_plan_checkout` and
`payments.ts` returns **no matches**. So migration 095 describes an architecture the
Edge Functions do not implement, and applying 095 as things stand would break payment
activation in both directions: the mock path would fail on a permission error, and the
real webhook path would fail too. That may be acceptable as fail-closed behaviour, but
it must be a deliberate decision, not a surprise during a production cutover.

**The webhook endpoint the operator must register.** The URL is:

```
https://<project-ref>.supabase.co/functions/v1/paystack-webhook
```

The path is fixed by how Supabase routes functions, and `supabase/config.toml:388-392`
records the required deployment setting, with the reason: "Paystack webhook is called
directly by Paystack (no Supabase user JWT), so it must skip the default JWT
verification. `paystack-initialize` keeps the default (`verify_jwt = true`)". The same
block does it for OPay at lines 394-398.

**Where that URL is documented today.** Nowhere inside the repository (verified: a
recursive search of every `.ts`, `.tsx`, `.js`, `.md`, `.sql`, `.toml`, `.json`, `.mjs`
and `.html` file for the literal string `functions/v1/paystack-webhook` returns no
matches). Inside the repository, `src/pages/platform/areas/IntegrationsArea.tsx:434-442`
documents the *step* without the URL: "point the Paystack dashboard webhook at the
deployed `paystack-webhook` URL and subscribe to `charge.success` and `charge.failed`".
The literal URL with the live ref appears only in `C:\Users\USER\Documents\Trackoja\TODO.md:280`,
which is outside the repository and untracked. `TODO.md:292` has the OPay equivalent.
This is F10: the one irreversible external step in the payment setup is documented in a
scratch note rather than in the repo.

### 1.5 What `trackoja-dev` is

**Verified:**

- The string `trackoja-dev` appears **nowhere** in `trackoja-phase-1`. A recursive grep
  of the whole repository returns no matches.
- It appears three times in `C:\Users\USER\Documents\Trackoja\TODO.md`, which sits
  outside the repository: line 23, line 272, line 283.
- `TODO.md:23-26` defines it: "A second Supabase project, `trackoja-dev` (ref
  `wgcolmnlieefqvtzfvjt`), also has all 48 migrations + 5 Edge Functions applied from
  earlier in this session, but is **not** the one the live site uses - it's a
  spare/dev project, not currently wired to anything public."
- `TODO.md:272` contrasts it with the live backend: "The live site's backend is
  `xegcukmbinkyffzmfejc` (not `trackoja-dev`)".
- `TODO.md:283-286` records a defect on it: it "has a secret named
  `PAYSTACK_SECRET_KEy` (lowercase `y`, a typo - the Edge Functions read
  `PAYSTACK_SECRET_KEY`)". A typo'd secret name means the function sees no key at all,
  so that project is in mock mode.
- Its credentials are on disk in `.claude/settings.local.json`: the database password
  at lines 38 and 70, and 19 JWTs bearing `ref: wgcolmnlieefqvtzfvjt` including
  `service_role` ones.

**Inferred, and this matters more than the note it comes from:** `TODO.md` is dated
2026-06-14 and says trackoja-dev is "not currently wired to anything public". That
sentence is now **stale**. `trackoja-dev` *is* wired to the live site: it is the target
of `.env.local:3`, of the committed `.env.production:7`, and of the bundle in `dist/`
that the VPS serves at `trackoja.cv` (section 1.3). Whatever `trackoja-dev` holds today
is what the public site reads and writes.

**What breaks if its database password is rotated (verified by inspection of every
consumer):**

- **Nothing in the deployed application breaks.** The browser client authenticates with
  the publishable key, not the database password (`src/config/supabase.ts:6-13`). The
  Edge Functions reach the database through injected `SUPABASE_URL` and
  `SUPABASE_SERVICE_ROLE_KEY` over the REST API and never use a Postgres connection
  string — there is no `postgres://` anywhere in `supabase/functions/`. Rotating the
  database password does not invalidate the publishable key or the JWT secret.
- **The CLI and scripts that use it break until updated.** `supabase db push --password ...`
  and any `supabase link` that relied on the stored password
  (`.claude/settings.local.json:70`), `apply-migrations.js` in the TEMP directory,
  which reads `SUPABASE_DB_URL`, and any `psql` session.
- **The `.claude/settings.local.json` entries at lines 38 and 70 stop working**, which
  is harmless: they are permission allowlist strings, not a live connection.
- **The important non-effect:** rotating the password does *not* stop production from
  writing to `trackoja-dev`. It only closes the door to direct Postgres access. The
  application-level sharing described in section 1.3 continues until the project
  reference is changed. Do not treat the rotation as a substitute for F1.

### 1.6 Migration inventory

- `supabase/migrations/` holds **94 files**: 92 tracked at HEAD plus 2 untracked.
  `DEPLOYMENT.md:76` names this directory as the place migrations live.
- `database/` holds 61 files (59 `.sql` plus `README.md` and `RBAC_MATRIX.md`). Its
  `README.md` documents a manual numbered order. I compared three pairs by SHA-256 and
  they are **byte-identical** to their timestamped counterparts:
  `database/001_auth_schema.sql` = `supabase/migrations/20260612000001_auth_schema.sql`,
  the `031` pair, and the `012` pair. So `database/` is a redundant mirror, not a
  separate lineage. Apply one set only, and prefer `supabase/migrations/` because it is
  what the CLI tracks and what `DEPLOYMENT.md` documents.
- **F9 (verified):** the two untracked files both claim version `20260927000095`:
  `20260927000095_payments_fail_closed.sql` and
  `20260927000096_platform_business_billing_email.sql`. `supabase_migrations.schema_migrations`
  is keyed on version, and `DEPLOYMENT.md:93-100` shows that version being written
  explicitly. Two files with one version will collide. Renumber one — the billing-email
  migration is the smaller and more self-contained change (`20260927000096_platform_business_billing_email.sql:1-25`
  appends one JSONB key to `get_platform_business`) — before pushing to any project.
- `DEPLOYMENT.md:88-91` states every migration is written to be idempotent, and that
  each platform migration has a re-runnable verification script in
  `supabase/verification/`. There are 17 such scripts. There is **no** verification
  script for 095, which is consistent with 095 being uncommitted work in progress.

---

## 2. Credential exposure and rotation

Two credentials are exposed. They have different blast radii and they must be rotated
in a specific order, for a specific reason: the PAT is the credential you need in order
to do most of the rest of this plan, so it is replaced first (create the successor,
then revoke the predecessor), and the database password is rotated afterwards, once the
decision about which project production should use has been made, because rotating it
while production is still pointed at `trackoja-dev` fixes nothing that matters and
costs a window of CLI breakage.

### 2.1 Exposed Supabase Personal Access Token (`sbp_...`)

**What is exposed.** One token, 44 characters, prefixed `sbp_`, appearing 21 times in
`C:\Users\USER\Documents\Trackoja\.claude\settings.local.json`, written literally into
an allowlist of shell commands that were approved in earlier sessions. The value is not
reproduced here. It is not in git (section 1.2.3); it is in a plaintext file on this
machine and in whatever backups, syncs, screenshots or transcripts that file has
travelled through.

**Blast radius.** A Supabase PAT authenticates the *account*, not a project. What the
token's own recorded uses demonstrate it can do (each of these is a command line
containing the token, at the `.claude/settings.local.json` line given):

- Read and modify a project's Auth configuration: lines 60, 62, 66, 67 target
  `https://api.supabase.com/v1/projects/<ref>/config/auth`. Line 66-67 is a `PATCH`
  enabling `mailer_autoconfirm`, which is the difference between "email must be
  confirmed" and "anyone can sign up with any address".
- List a project's API keys: line 101 (dev project), line 178 (**the live project**).
- Push migrations and deploy functions: lines 107, 108, 195, 196.
- Run arbitrary SQL. `DEPLOYMENT.md:80-86` documents this path: a `POST` to
  `https://api.supabase.com/v1/projects/<project-ref>/database/query` with
  `Authorization: Bearer $SUPABASE_ACCESS_TOKEN`. Anything SQL can do to any project the
  account can reach is in scope, including reading every row of every table and dropping
  schema.
- Delete projects.

Because line 178 and line 195 reach `xegcukmbinkyffzmfejc` — the live project — the
blast radius is **the live customer database**, not merely the dev project. Treat the
token as fully compromised and assume it may already have been read.

**Exact rotation steps.**

Owner-only steps are marked **[console]**: they can only be done by the account owner in
the Supabase web console, and no agent or operator with repository access can do them.

1. **[console]** Sign in to `supabase.com/dashboard`. Decide first whether the new
   token should be scoped: Supabase issues account-level PATs, so if the account also
   owns unrelated projects, the cleanest structural fix is a separate account or
   organisation for TrackOja, so a future leak cannot reach unrelated work.
2. **[console]** Create the successor token. Record where its value goes *before*
   creating it — a password manager or the OS credential store — so the value never
   needs to be typed into a shell.
3. **Choose a storage mechanism that keeps the value out of shell history.** The
   correct pattern already exists in this repository: `DEPLOYMENT.md:82` uses
   `-H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN"`, a variable reference. Keep that.
   For interactive CLI use, `supabase login` stores the credential in the OS credential
   store rather than a profile file, which is strictly better than exporting it. If an
   environment variable is unavoidable, set it from the credential store at the start of
   a session and never write the literal value into a command, a file, a transcript or a
   screenshot.
4. **Update every consumer.** The dependents are: the Supabase CLI sessions that used
   the token; the TEMP scripts that read `SUPABASE_ACCESS_TOKEN`
   (`annualcheck.js`, `apply-api.js`, `sbq.js`, and others in
   `%TEMP%\tk-shot\`); and the `.claude/settings.local.json` allowlist entries, which
   should be deleted rather than updated, because an allowlist entry is a permanent copy
   of a credential that serves no purpose once the command has been approved.
5. **Verify the successor works before revoking the predecessor** — this is the whole
   reason for the ordering. Confirm it can list projects and read one project's API keys
   (names only; `supabase projects api-keys` prints key names and prefixes, and the
   output should not be pasted anywhere). If the successor works, nothing is broken by
   the revocation in the next step.
6. **[console]** Revoke the old token in Account settings, Access Tokens.
7. **Verify the revocation** by re-running the same check with the old value: it must
   now return 401. Do not print the old value while doing this — read it from the file,
   or simply confirm the dashboard shows it gone.
8. **Scrub the plaintext copies.** Rotating is the security fix; scrubbing is so that a
   future reader, backup or sync cannot reuse the old value or infer the new account's
   shape. The files are `.claude/settings.local.json` (both the token and the database
   password, lines 38, 70, and the 21 token occurrences) and `%TEMP%\tk-shot\prod-db-password.txt`.
   Note the second-order copies that a scrub of that one file will not reach: the
   token appears in whatever terminal scrollback, editor history, shell history file and
   clipboard manager recorded those commands.

**Order of operations, and why.** Create-then-verify-then-revoke. Revoking first would
leave the operator with no way to run the very commands needed to update the other
systems, and would make a mistake unrecoverable. Within that window, the old token is
still live, so the window should be minutes, not days.

### 2.2 `trackoja-dev` database password

**What is exposed.** The Postgres password for project `wgcolmnlieefqvtzfvjt`, in
plaintext, twice, in `.claude/settings.local.json` (line 38 as an exported
`SUPABASE_DB_PASSWORD`, line 70 as a `--password` argument). It is a short,
human-typeable string. The value is not reproduced here.

**Blast radius.** Direct Postgres access as the project's `postgres` role: read and
write every table, bypass RLS entirely, read `auth.users`, alter schema, create roles,
and install extensions. This is strictly broader than what the service-role key grants,
because it is not mediated by PostgREST or by RLS at all. Two aggravating factors: the
password is short enough that offline guessing is realistic rather than theoretical if
it was ever exposed alongside a connection string or hash; and per section 1.5, this
project is the database the public site is currently wired to, so it holds whatever the
live site has been writing.

**Exact rotation steps.**

1. **Decide first whether this project should remain the production backend.** Rotating
   a password on a project that production should not be using consumes the operator's
   attention on the wrong problem. If F1 is fixed first, this rotation becomes lower
   stakes. If it is not fixed, do the rotation anyway — a compromised password on the
   live-serving database is worse than one on a genuine dev project.
2. **Freeze writes and deploys.** No `git pull` on the VPS, no `vercel deploy`, no
   `supabase db push` for the duration. `DEPLOYMENT.md:35` shows the VPS update is a
   plain `git pull`; a build landing mid-rotation would bake an unknown configuration
   into the served bundle.
3. **Enumerate dependents before touching anything.** Verified list: the CLI's stored
   link credential, `.claude/settings.local.json` lines 38 and 70, and
   `%TEMP%\tk-shot\apply-migrations.js` (reads `SUPABASE_DB_URL`). Nothing in the
   deployed application (section 1.5). Re-run that enumeration at the time, because the
   list is a snapshot.
4. **[console]** Project Settings, Database, Reset database password. Supabase requires
   a strong generated password; accept one rather than inventing a short one. Note the
   reset takes effect immediately, so step 5 must follow at once.
5. **Store the new value in the credential store immediately**, before doing anything
   else with it. Do not paste it into a shell, a `.env` file inside the repository, a
   chat message, or a ticket.
6. **Re-link the CLI** (`supabase link --project-ref wgcolmnlieefqvtzfvjt`, entering the
   password at the prompt rather than passing it as an argument), then re-run
   `supabase db push --dry-run` if you need to confirm connectivity.
7. **Verify with a read-only query** through `psql` using a connection string supplied
   from the credential store, for example `select 1;`. Then confirm the old password is
   rejected. Never put the password in the connection string on a command line where it
   can be read from the process list or the shell history.
8. **Update the TEMP script** (`apply-migrations.js`) to read its connection string from
   the credential store, or delete it. A one-off migration applier that needs a database
   password is a credential hazard that has already served its purpose.

**Do not** reuse this password anywhere else, and do not reuse it as the new production
database password. Reuse is why a single leaked string can compromise two environments.

### 2.3 The other credentials in the same file (a decision, not a step)

`.claude/settings.local.json` also contains 7 `service_role` JWTs — for both the dev and
the live project. A service-role key bypasses RLS, which is the entire security model
for a Supabase browser client. These were not named in the task, but they are exposed by
the same file, so leaving them unaddressed would leave the exposure open.

Two options, with the trade-off stated:

- **Rotate the JWT secret** in the project's Auth settings. This invalidates every
  existing key and **signs out every currently logged-in user**, because refresh tokens
  are signed with the same secret. It is the only way to make the leaked
  `service_role` keys useless. Plan it for a low-traffic window and tell users.
- **Do nothing about the keys, and treat the file as the thing being contained.** This
  is defensible only if the file is genuinely deleted from every location it reached. It
  is not defensible if the file was ever in a backup, a screenshot, or a shared
  transcript — and given that it is an agent-tool configuration file, it very likely was.

My recommendation is to rotate the JWT secret for both projects, once the production
project exists, so the new project is born clean.

### 2.4 What only the account owner can do

- Revoke and create Personal Access Tokens. **[console]**
- Reset a project's database password. **[console]**
- Create the production Supabase project and choose its region and organisation. **[console]**
- Read or set Edge Function secret *values* (`supabase secrets set` requires a PAT, so
  the owner either runs it or issues a scoped token for it).
- Rotate the JWT secret (Auth settings). **[console]**
- Configure Auth: site URL, redirect allow-list, SMTP, email confirmation, password
  policy. **[console]**
- Register webhook URLs in the Paystack dashboard, separate for test and live mode. **[console]**
- Set Vercel project environment variables. **[console]**
- Delete the plaintext files from this machine, and check the account's audit log for
  uses of the token that predate the leak being noticed.

---

## 3. Secret management process

### 3.1 The rule

**No secret value is ever printed, echoed, logged, screenshotted, piped into a file,
or written into a report.** Secrets are referred to by name. This applies to agent
transcripts and command output as much as to committed files, because a transcript is a
file. Where a version of this document needed to prove which Supabase project a value
points at, it compared one-way SHA-256 fingerprints rather than printing the values;
that technique is available for future audits and is the recommended one.

A corollary that is easy to miss: **a secret must never be passed as a command-line
argument.** Arguments appear in shell history, in the process list, and in the tool
output of whatever ran them. `.claude/settings.local.json:70` is the worked example of
how a database password ends up committed to an allowlist this way.

### 3.2 Setting secrets for Edge Functions

The supported mechanism is `supabase secrets set`, which writes to the project's
function-secret store, encrypted, separate from the repository and from `config.toml`.
Two shapes, preferred first:

```bash
# Preferred: read every secret from a file that lives OUTSIDE the repository.
# Keeping it outside the repository is the point: no .gitignore rule can be forgotten
# if the file was never in the tree to begin with.
supabase secrets set --env-file "%USERPROFILE%\.trackoja\functions.production.env" \
  --project-ref <PRODUCTION_PROJECT_REF>
```

```bash
# Acceptable for a single value, when the value is supplied from a secret manager
# through a shell variable and not typed literally. Note the variable reference.
supabase secrets set PAYSTACK_SECRET_KEY="$PAYSTACK_LIVE_SECRET_KEY" \
  --project-ref <PRODUCTION_PROJECT_REF>
```

Never this shape, which is a leak:

```bash
# WRONG - the literal value lands in shell history, the process list and the transcript.
supabase secrets set PAYSTACK_SECRET_KEY=sk_live_<actual value> --project-ref <ref>
```

The file named in the first shape must have the same variable names the functions read
(section 1.2.1), one `NAME=value` per line, and must not be inside
`C:\Users\USER\Documents\Trackoja\trackoja-phase-1`. Do not add it to the repository and
rely on `.gitignore`: `.env.production` is the existing proof that a file intended to
hold environment configuration does get committed here, because it is not in
`.gitignore` at all.

Operational note from the repository: `TODO.md:27-31` records that the installed
Supabase CLI (v2.102.0) errored on `secrets list`/`secrets set` with "Access token not
provided" while `functions deploy` worked, and that `npx supabase@2.106.0 secrets ...`
worked. If `secrets set` fails with that message, that is the documented workaround, not
a reason to put the value somewhere else.

To confirm which secret *names* exist on a project without revealing values:
`supabase secrets list --project-ref <ref>` lists names and digests. Paste the names,
never the digests.

### 3.3 Where secrets must not live

- **Not in `.env.production`.** It is tracked. It should carry only
  `VITE_`-prefixed, non-secret build configuration. Today it carries a project ref and a
  publishable key, both of which caused F1.
- **Not in `.env.local.example`.** It is tracked and is a template; placeholders only.
- **Not in `supabase/config.toml`.** It is tracked. Where a value must reach local
  tooling, use the `env(NAME)` indirection the file already demonstrates at
  `config.toml:101`, `294` and `326`.
- **Not in any `supabase/functions/**` source file.** Functions must read secrets from
  `Deno.env.get(...)` and nowhere else. Absence must fail closed — see section 5.
- **Not in the Platform Owner console.** Nothing in this codebase should display a
  secret; there is no key store (`DeveloperArea.tsx:66` says so explicitly: "No API key
  management: no key store exists"), and adding one would create a new exposure surface
  on a page that is reachable by more than one person.
- **Not in a `VITE_`-prefixed variable.** Vite inlines every `VITE_` value into the
  client bundle at build time. This is exactly how the served bundle came to contain the
  project URL and publishable key. Anything `VITE_`-prefixed is public.
- **Not on a command line**, per section 3.1.
- **Not in an agent or editor allowlist file.** `.claude/settings.local.json` is the
  worked example: 21 copies of a PAT and two copies of a database password, in a file
  whose purpose is to record which commands were approved.

### 3.4 Logging rules for the Edge Functions

- Never log a secret, a request's `Authorization` header, a webhook signature, or a full
  connection string. `paystack-webhook/index.ts:101` and `opay-webhook/index.ts:108` log
  only the caught error object, and `opay-webhook/index.ts:68` logs a warning about
  missing configuration without printing the configuration — that is the right level.
  Keep it.
- When a signature check fails, log that it failed and for which provider, not the
  expected or received digest.
- Never widen an error response to include configuration detail. `paystack-webhook/index.ts:39`
  returns "Paystack is not configured on this server", which tells an attacker the
  server's state but leaks no value. Prefer even less: a generic 500.

---

## 4. Production project separation

The goal is that production has its own Supabase project; its own credentials; its own
Auth configuration; no path by which a development or preview build can write real data;
and no path by which production can fall back to a test or mock payment mode.

### 4.1 Before creating anything: fix the blockers

Complete these first, because each one makes the new project either unbuildable or
unsafe:

1. **F9 — renumber the duplicate migration version.** Two files claim
   `20260927000095` (section 1.6). Rename the billing-email migration to
   `20260927000096_platform_business_billing_email.sql` or similar, and commit both
   files. Do this before any `db push`, or the migration will collide in
   `supabase_migrations.schema_migrations`.
2. **F8 — decide what to do about migration 095.** Either implement it (create
   `supabase/functions/_shared/payments.ts`, change `paystack-initialize` to resolve the
   mode from its secrets and call `record_payment_attempt`, change `paystack-webhook` to
   call `settle_verified_payment`) and deploy the functions in the same maintenance
   window, or exclude 095 from the production push and accept that F3 remains open. Do
   not push 095 and leave the functions as they are: 095 revokes `activate_subscription`
   from `service_role` (`...095_payments_fail_closed.sql:693,999`) while both functions
   still call it, so every activation path fails.
3. **F1 — decide the target of `.env.production`.** Either restore it to the live
   project (the file's own comment at lines 2-6 says this is the intent) or accept the
   dev target explicitly and stop calling it production. An ambiguous answer here
   produces a production project nothing points at.
4. **F3 and F4 — treat fail-open payments as a release blocker** (section 5).

### 4.2 Create the production project

1. **[console]** Create a new Supabase project in the same region as the current live
   project, in the TrackOja organisation. Record the new project ref. Do not reuse the
   `trackoja-dev` name pattern; name it for the environment it serves.
2. **[console]** Record the new project's `anon`/publishable key, `service_role` key and
   database password in the credential store. The `service_role` key is not needed by
   the frontend and must never appear in a `VITE_` variable.
3. **Do not copy `.env.production` as your starting point.** Write the production
   environment file from scratch, with placeholders, so the dev project's ref and key
   cannot be carried across by accident. That is precisely how F1 happened.

### 4.3 Apply migrations, in order

`supabase/migrations/` is authoritative; `database/` is a byte-identical mirror and must
not also be applied (section 1.6).

```bash
# 1. Link to the NEW production project.
supabase link --project-ref <PRODUCTION_PROJECT_REF>

# 2. See what will be applied, before applying it. Read the list.
supabase db push --linked --dry-run

# 3. Apply, in filename order. The CLI orders by the version prefix, which is why the
#    timestamps are 2026MMDDNNNNNNN - they sort chronologically by construction.
supabase db push --linked
```

Order matters and is not arbitrary: the prefixes are `20260612000001` through
`20260927000095`, and later migrations redefine earlier objects
(`activate_subscription` is defined in `20260614000031`, then redefined in
`20260927000089:117`, `...090:230`, `...094:284` and `...095:810`). Applying them out of
order would leave an earlier definition in force.

If no database password is available, `DEPLOYMENT.md:78-86` documents the alternative:
the Management API's SQL endpoint with a PAT. If you use that path, **record each
migration explicitly**, because the API does not:

```sql
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('<version>', '<name>')
ON CONFLICT (version) DO NOTHING;
```

`DEPLOYMENT.md:93-100` gives the shape and the reason. Skipping this is how a project
ends up re-applying migrations it has already run.

Then run the verification scripts. `DEPLOYMENT.md:88-91` states each platform migration
has a re-runnable verification script under `supabase/verification/` that asserts its own
behaviour. Run every one against the new project; they are designed to be run against a
live database. There is no verification script for 095, which is one more reason to
resolve F8 before the push.

### 4.4 Set the Edge Function secrets on the production project

Only two names are operator-set (section 1.2.1). Using the file-based form from
section 3.2:

| Secret name | Production value | Development value |
| --- | --- | --- |
| `PAYSTACK_SECRET_KEY` | the **live** key (`sk_live_...`) | a **test** key (`sk_test_...`), or unset only if mock mode is deliberately permitted here |
| `OPAY_SECRET_KEY` | the live credential | the sandbox credential |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the
runtime and must not be set by hand on any project.

Deploy the functions with the same JWT settings the repository declares, or the webhooks
will 401 at the platform before reaching the signature check:
`supabase/config.toml:388-398` sets `verify_jwt = false` for `paystack-webhook` and
`opay-webhook` and leaves it at the default for the other three.

```bash
supabase functions deploy --project-ref <PRODUCTION_PROJECT_REF>
```

### 4.5 Auth settings that differ per environment

`supabase/config.toml` is the *local* stack configuration, not the hosted project's
settings. The values in it are localhost-oriented and must be set per project in the
dashboard. Evidence that these live in the project rather than the repository: the
recorded commands in `.claude/settings.local.json:60-67` read and `PATCH`
`https://api.supabase.com/v1/projects/<ref>/config/auth`, several of them to change
`mailer_autoconfirm`. Nothing in this repository sets them.

| Setting | Local value in `config.toml` | What production needs, and why |
| --- | --- | --- |
| `site_url` (line 159) | `http://127.0.0.1:3000` | the production origin. It is the base for auth emails and the redirect allow-list; leaving it at localhost breaks every confirmation and password-reset link. |
| `additional_redirect_urls` (line 163) | `https://127.0.0.1:3000` | the production origin, and any preview origin deliberately allowed. An entry here is an allowance for a token to be delivered to that host. |
| `enable_confirmations` (line 226) | `false` | `true` in production. With confirmation off, an account exists the moment someone types an address they do not own. The dev project was deliberately set to autoconfirm at some point (`.claude/settings.local.json:66-67`), which is a reasonable dev choice and an unacceptable production one. |
| `minimum_password_length` (line 182) | `6` | raise it. Six characters is below current guidance and this is the only password policy in force. |
| `password_requirements` (line 185) | `""` | consider `lower_upper_letters_digits` for production. |
| `enable_signup` (line 176) | `true` | decide deliberately. If signup is open, the rate limits at lines 197-211 are the only throttle; `email_sent = 2` per hour (line 199) is the stored value and will look like an outage on a busy day. |
| SMTP (lines 236-244, commented) | none | configure a production SMTP provider. `IntegrationsArea.tsx:457-461` documents that this lives in the project and not the database, and that the console cannot read it back — so it is easy to forget and impossible to verify from the app. |
| `enable_anonymous_sign_ins` (line 178) | `false` | keep false. |
| MFA (lines 297-312) | disabled | out of scope, but note it is a paid-plan feature. |
| Network restrictions (`config.toml:73-81`) | disabled, `0.0.0.0/0` | consider restricting direct Postgres access by CIDR on the production project. It does not affect the REST API or the Edge Functions; it only narrows who can attempt a direct connection. |

### 4.6 Keeping development and production data apart

The current situation is the opposite of separated: one project serves both, and the
public site is on the dev side (section 1.3). To separate:

1. **Production** = the new project, with its own credentials, its own Auth settings, and
   its own payment secrets.
2. **Development** should stop being a shared cloud project. `supabase/config.toml`
   already describes a complete local stack — API on 54321, Postgres on 54322, Studio on
   54323, an email-capture server on 54324 (lines 9-15, 35, 97, 108), seed data enabled
   at lines 66-71, and `npm run db:reset` / `db:migrate` in `package.json`. Running
   `supabase start` gives a disposable database with no customer data and no shared
   credentials, which is strictly safer than a shared cloud dev project and removes an
   entire class of "which database am I on" accidents. If a shared cloud dev project is
   still wanted for collaboration, it must be a *third* project, not the one production
   is pointed at.
3. **Never** point a development or preview build at production. `DEPLOYMENT.md:56-68`
   describes per-build declaration via `VITE_ENVIRONMENT` for exactly this reason.
4. **Declare the environment on the database side too, if you want the mismatch guard to
   work.** `environment.name` cannot be created through the UI
   (`SettingsArea.tsx:576-580`) and `set_platform_setting()` refuses a key no migration
   has declared (`DeveloperArea.tsx:574-578`). So the guard at `environment.ts:70-78` is
   inert today. To activate it, add a migration that declares the key and inserts
   `{"name":"production"}` on the production project and `{"name":"development"}` on the
   dev project. Until then, the console's environment label is a build-time claim with no
   cross-check, and — per the code-vs-copy mismatch noted in section 1.3 — the console
   tells the operator to check it in the wrong order.
5. **Decide the fate of the existing data on `trackoja-dev`.** Whatever the live site has
   written there since the swap in `dd8718a` is the live dataset. Moving it to the
   production project is a data migration with its own risks, and doing nothing leaves
   the production project empty and the live site still writing to dev. This is a
   business decision that must be made explicitly; the `.env.production:2-6` comment
   implies the original plan was the reverse (migrate the live database, then repoint),
   and it is worth checking whether that ever completed.

### 4.7 Verifying that separation actually holds

Separation is only real if it can be observed. Each check below has an observable result:

| Check | Observable evidence |
| --- | --- |
| The production bundle points at production | Build with the production env, then search the built JS for the project ref. Exactly one ref appears, and it is the production one. Never check by reading a key value. |
| The dev bundle points at dev | Same check on a dev build; a different, and non-production, ref. |
| No preview build can reach production | Set the Vercel preview environment variables to a non-production project and confirm the built preview bundle's inlined ref. `DEPLOYMENT.md:51-52` states Vercel project variables override `.env.production`, so this must be checked per Vercel environment, not just in the repository. |
| Production has no test payment key | `supabase secrets list --project-ref <PRODUCTION_PROJECT_REF>` shows `PAYSTACK_SECRET_KEY` present; separately confirm the *mode* it resolves to, which the present code cannot report — see section 5. |
| Production data is not the dev data | Compare row counts in a table that only ever grows, such as `audit_logs`, between the two projects. Equal counts mean the check was run against the same database. |
| A test charge does not activate a real subscription | After 095 is implemented: `subscription_transactions.is_test_data` is `TRUE` for a test-mode settlement and the resulting entitlement is marked test data. |
| Auth differs | Read each project's Auth settings in the dashboard and compare `site_url`, redirect allow-list, confirmation requirement, and SMTP. They must not be identical if one is localhost-oriented. |
| The dev password cannot reach production | Attempt a `psql` connection to the production project using the dev password. It must fail. |

---

## 5. Paystack key isolation

The requirement is that a non-production environment cannot use a live key, and that a
production environment cannot silently fall back to a test key or to mock mode. Today
**neither half holds**: there is one variable, `PAYSTACK_SECRET_KEY`, whose only
distinction is present versus absent, and absence is a free subscription
(`paystack-initialize/index.ts:71-91`).

The full design already exists in writing, in
`supabase/migrations/20260927000095_payments_fail_closed.sql`. Its stated rules are the
right ones and I am not inventing alternatives:

1. **Resolve the mode from the Edge Function secret only, never from the client.** The
   migration says it directly at lines 37-43: the mode "is resolved ONLY from Edge
   Function secrets (`_shared/payments.ts`)" and reaches the database through
   `record_payment_attempt`, which is granted to `service_role` alone.
   `start_plan_checkout` "takes a plan and a cycle from the customer and nothing else; it
   cannot name a mode even if it wanted to." The reason is that any client-supplied mode
   is an attacker-supplied mode.
2. **Derive the mode from the key itself, server-side.** The natural signal is the key
   prefix Paystack already uses — `sk_live_` or `sk_test_`. Classifying the key by prefix
   inside the Edge Function means the mode cannot drift from the credential that actually
   charges money, which a separately-set `MODE` variable could.
3. **Stamp the mode and environment on the attempt, from the server.**
   `record_payment_attempt(p_reference, p_payment_mode, p_environment, p_expected_amount,
   p_expected_currency, p_gateway_reference)` (migration lines 469-521) refuses an
   unsupported mode (485-487) or environment (489-491), refuses to re-initialize an
   attempt under a different mode (504-507) — so a live attempt cannot be downgraded to a
   mock one — and sets `is_test_data = (p_payment_mode <> 'live')` (515).
4. **Verify before activating.** `settle_verified_payment` (line 556 onward) is the only
   activating path, and per its comment (lines 535-548) it refuses on an unknown
   reference, a non-pending transaction, a mode or environment that disagrees with what
   was stamped, an amount or currency that disagrees with the quote, a business mismatch,
   and a transaction with no recorded expectation at all. Amount verification against
   `expected_amount` rather than the plan's current price is deliberate (lines 59-62):
   a plan edited between checkout and settlement must not change what the customer agreed
   to pay.
5. **Make the absence of configuration fail closed.** This is the migration's title and
   its opening paragraph (lines 4-12). In the function code this means deleting the mock
   branch at `paystack-initialize/index.ts:71-91`, so a missing key produces an error
   rather than a subscription. If mock mode is wanted for development, it must be
   reachable only when the environment is explicitly declared `development` **and** the
   database is a development database — never as a fallback for a missing key, because a
   missing key in production is exactly the case where the fallback does the most damage.
6. **Match `opay-webhook` to the same standard.** `opay-webhook/index.ts:59-69` skips
   signature verification when `OPAY_SECRET_KEY` is unset and proceeds to process the
   payload, calling `handle_opay_webhook` (97-101). Anyone who knows the URL can change a
   device transaction's status. `IntegrationsArea.tsx:447-453` warns about the ordering
   consequence ("set the secret before registering the webhook"). This must fail closed
   like `paystack-webhook/index.ts:38-43` does.

**Environment-to-key mapping, as the deployment must enforce it:**

| Environment | Project | `PAYSTACK_SECRET_KEY` | Paystack dashboard mode whose webhook points here |
| --- | --- | --- | --- |
| production | the new production project | live key, `sk_live_...` | live mode |
| staging | a staging project, if one exists | test key, `sk_test_...` | test mode |
| development | local stack or the dev project | test key, `sk_test_...`; mock permitted only under an explicit development declaration | test mode, if webhooks are exercised at all |

**Webhook endpoints, one per environment.** The URL is
`https://<project-ref>.supabase.co/functions/v1/paystack-webhook`, and the project ref is
what makes it environment-specific:

- Production: `https://<PRODUCTION_PROJECT_REF>.supabase.co/functions/v1/paystack-webhook`,
  registered against the **live** mode webhook configuration in the Paystack dashboard.
- Development: the same path on the development project's ref, registered against the
  **test** mode configuration.

Two failure modes to design against, both of which are silent today:

- **Cross-wired environments.** If a live-mode webhook points at a project holding a test
  key, every delivery fails the HMAC check at `paystack-webhook/index.ts:48-53` and
  returns 401. Nothing is written for a signature failure —
  `src/pages/platform/areas/HealthArea.tsx:144` says the `webhook_events` ledger is
  supposed to record this and migration 095 says the table did not exist, so the failure
  currently looks identical to silence, which is why the URL must be verified rather than
  assumed.
- **Signature verification with the wrong mode's secret.** The HMAC is computed with
  whatever `PAYSTACK_SECRET_KEY` holds (lines 20-30, 48). A test key must therefore
  verify only test-mode deliveries, which is another reason the secret and the dashboard
  mode must be chosen together.

The webhook registration step must be documented in the repository, not in a scratch
note (F10). `IntegrationsArea.tsx:434-442` is the right place and already describes the
step; it should carry the literal URL shape and the per-environment table above.

---

## 6. Verification checklist

Nothing below can be confirmed by reading the repository alone. Each row states the
observable evidence that proves the item is done, so that "done" is a fact rather than
an intention.

### 6.1 Credential rotation

| # | Item | Observable evidence |
| --- | --- | --- |
| 1 | The exposed PAT is revoked | The Supabase dashboard's Access Tokens page no longer lists the old token; a request made with the old value returns 401; a search for the `sbp_` pattern under `C:\Users\USER\Documents\Trackoja\` returns zero matches. |
| 2 | A successor PAT exists and is stored safely | The dashboard lists one active token, created after the incident, and its value is in the credential store. It appears in no file, command, transcript or screenshot. |
| 3 | Every PAT-dependent script works with the successor | `annualcheck.js`, `apply-api.js`, `sbq.js` in `%TEMP%\tk-shot\` read `SUPABASE_ACCESS_TOKEN` from the environment and complete a read-only call. |
| 4 | The plaintext copies are gone | `.claude/settings.local.json` contains zero `sbp_` occurrences and no `SUPABASE_DB_PASSWORD` or `--password` argument; `%TEMP%\tk-shot\prod-db-password.txt` no longer exists. Also check shell history and editor history. |
| 5 | The `service_role` JWTs on disk are either useless or the risk is accepted in writing | Either the JWT secret was rotated for both projects (all users were signed out, and a new sign-in works) or the decision not to rotate is recorded with its rationale. |
| 6 | The `trackoja-dev` database password is rotated | The old password fails a `psql` connection; the new one succeeds and is in the credential store; the CLI re-links and `supabase db push --dry-run` reports what it should. |
| 7 | No password is left on a command line | The new password exists only in the credential store and in the OS/CLI credential store entry. Grep local files and shell history for the name `SUPABASE_DB_PASSWORD` and for `--password`; the only remaining hits should be variable references, like `DEPLOYMENT.md:82`. |

### 6.2 Repository hygiene

| # | Item | Observable evidence |
| --- | --- | --- |
| 8 | No secret is in git history | `git ls-files \| Select-String env` lists only `.env.production` and `.env.local.example`; a scan of all blobs for `sbp_`, `sb_live`, `sb_secret_` and `sk_live_` returns filenames only, and those filenames contain documentation placeholders. |
| 9 | `.env.production` no longer carries a project-specific target | Either it is deleted from tracking (and `.env.production.example` added), or it contains placeholders only. The strongest fix: production configuration lives in the deployment platform's environment variables, per `DEPLOYMENT.md:51-52`, which already override the file. |
| 10 | The fake `production` label is resolved | `VITE_ENVIRONMENT` and the project ref in `.env.production` name the same environment. A file that says `production` while pointing at a dev project is the F1 defect. |
| 11 | Duplicate migration version is resolved | `Get-ChildItem supabase/migrations \| Group-Object { $_.Name.Substring(0,13) } \| Where-Object Count -gt 1` returns nothing. |
| 12 | Migration 095 is either committed with its function changes, or excluded deliberately | `git status` is clean, and the decision is recorded. The dangerous state is 095 pushed with the current functions, which breaks activation in both directions. |
| 13 | The webhook URL is documented in the repository | `IntegrationsArea.tsx` carries the literal per-environment URL, and a grep for `functions/v1/paystack-webhook` matches a tracked file (it currently matches none). |

### 6.3 Environment separation

| # | Item | Observable evidence |
| --- | --- | --- |
| 14 | Production build points at production only | Build it, then confirm exactly one project ref is inlined in `dist/assets/*.js`, and that it is the production ref. |
| 15 | The VPS and Vercel serve the same backend, deliberately | Fetch each site's served bundle and compare the inlined refs. If they differ, that is the two-front-doors problem from section 1.3 and it needs a decision, not a silent fix. |
| 16 | Development cannot reach production | A dev build's inlined ref is not the production ref; and a connection attempt to production with dev credentials fails. |
| 17 | Production data is separate from dev data | Row counts in a monotonically growing table differ between the two projects, and the production project contains the records the live site has been creating. |
| 18 | Auth settings are correct per environment | Dashboard comparison of `site_url`, redirect allow-list, email confirmation and SMTP across projects. |
| 19 | The environment mismatch guard is live, or its absence is understood | Either `environment.name` exists on both projects via a migration and the console reports the mismatched case when a dev build points at production, or the gap in `SettingsArea.tsx:576-580` is knowingly accepted. |

### 6.4 Payments

| # | Item | Observable evidence |
| --- | --- | --- |
| 20 | A missing Paystack key can no longer grant access | With `PAYSTACK_SECRET_KEY` unset on a scratch project, an attempted checkout returns an error and creates no active subscription. |
| 21 | The `opay-webhook` fail-open is closed | With `OPAY_SECRET_KEY` unset, a POST to the webhook with no signature returns 401 or 500 and changes no device transaction status. |
| 22 | Production uses a live key | `supabase secrets list --project-ref <PRODUCTION_PROJECT_REF>` shows the secret present; a real low-value live charge succeeds end to end and the transaction records a live mode. |
| 23 | Development uses a test key | Same on the dev project, with a test-mode charge, and the transaction records a test mode and `is_test_data = TRUE`. |
| 24 | A test settlement cannot activate a production subscription | A test-mode webhook delivered to the production project is refused, or produces an entitlement marked as test data. |
| 25 | Re-initializing cannot downgrade a live attempt | `record_payment_attempt` raises for a second call with a different mode (migration lines 504-507). |
| 26 | Amount tampering is caught | A webhook whose `amount` disagrees with `expected_amount` is refused rather than activating. |
| 27 | Both webhooks are registered, per mode, per environment | The Paystack dashboard shows live-mode webhooks pointing at the production function URL and test-mode webhooks pointing at the dev function URL. |
| 28 | Webhook deliveries actually succeed | The Paystack delivery log shows 2xx for `charge.success`; after 095, `webhook_events` contains a corresponding row. Before 095 there is no ledger, so the Paystack log is the only evidence. |
| 29 | Both webhook functions are deployed with JWT verification off | A delivery from Paystack reaches the signature check instead of failing at the platform; `config.toml:388-398` is the setting, and the deployed function's settings must match. |

---

## 7. What still requires a human with console access

Every item below is impossible to complete from this repository, and most are
impossible for anyone but the account owner.

1. **Revoke the exposed Personal Access Token and create its successor** in the Supabase
   dashboard. Nothing in the repository can revoke a token.
2. **Reset the `trackoja-dev` database password**, and store the new value.
3. **Create the production Supabase project**, and record its three credentials.
4. **Set Edge Function secret values** on each project (`supabase secrets set` needs a
   PAT, so the owner either runs it or issues a token for it).
5. **Decide whether to rotate the JWT secret**, given that it signs out every logged-in
   user, and perform it if so.
6. **Configure Auth per project**: site URL, redirect allow-list, email confirmation,
   password policy, SMTP.
7. **Register the Paystack webhook URLs**, separately in live mode and test mode, and
   confirm the delivery log shows 2xx.
8. **Set the Vercel project's environment variables** for production and preview, and
   confirm which backend the Vercel deployment actually serves.
9. **Decide the fate of the data currently in `trackoja-dev`** — migrate it to the
   production project, or accept the production project starting empty. This is a
   business decision, not a technical one.
10. **Delete the plaintext credential files from the operator's machine** and review the
    account's audit log for any use of the token that the owner cannot account for. No
    amount of repository work removes a secret from a transcript, a backup or a
    screenshot.

---

## 8. What I could not determine from the repository

Stated plainly rather than guessed:

- **Whether the Vercel deployment points at the live project or the dev project.**
  `TODO.md:19-22` says its variables were set to the live project, and
  `DEPLOYMENT.md:51-52` says Vercel variables override `.env.production`. Both are
  historical statements. I did not call the Vercel API, and the answer determines whether
  two public front doors are writing to two different databases.
- **Which project currently holds real customer data.** Related to the above and to
  whether the live site has been writing to `trackoja-dev` since `dd8718a`.
- **Whether the live project's Edge Functions have `PAYSTACK_SECRET_KEY` or
  `OPAY_SECRET_KEY` set.** `TODO.md:275-292` says neither was set as of 2026-06-14, which
  would mean both live payment paths are in mock mode, but that note is old and I did not
  query the project.
- **Whether every migration has actually been applied to either cloud project.** I read
  migration *files*; I did not read `supabase_migrations.schema_migrations`.
- **Whether `20260927000095_payments_fail_closed.sql` has been applied to any project.**
  It is untracked, which suggests work in progress, but untracked and unapplied are not
  the same thing.
- **Whether the `database/` mirror and `supabase/migrations/` diverge anywhere.** I
  sampled three pairs and they are byte-identical. I did not compare all 59.
- **Whether the exposed PAT or database password have been used by anyone other than
  this machine's operator.** That requires the Supabase account's audit log.
- **Whether `%TEMP%\tk-shot\prod-db-password.txt` holds the live project's password or
  the dev project's.** The filename says "prod"; I deliberately did not test it against
  either database, and I did not compare it to anything. Treat it as live until proven
  otherwise.
- **The current values of any secret.** By design: this document is written so that it
  remains safe to read, commit and share.
