# Deployment

Two independent targets serve this repository. They are updated by different
mechanisms, and knowing which is which saves a lot of confusion.

| Target | What serves it | How it updates |
| --- | --- | --- |
| `https://trackoja.cv` | A VPS at `193.181.212.65`, behind Caddy | `git pull` on the server |
| `https://trackoja-community.vercel.app` | A Vercel project named `trackoja-community` | `vercel deploy --prod` |

`trackoja.cv` is **not** Vercel. Its DNS `A` record points at the VPS and the
responses carry `Via: 1.1 Caddy`.

## Why `dist/` is committed

`dist/` is deliberately tracked in git, unlike most Vite projects. The VPS serves
the built files directly, so committing the build means bringing the live site up
to date needs nothing on the server but a pull — no Node install, no `npm ci`, no
build step, and therefore no way for the server's toolchain to produce a different
bundle from the one that was tested.

The consequence is a rule: **after any change under `src/`, run `npm run build`
and commit the rebuilt `dist/` in the same commit as the source change.** A commit
that changes source without rebuilding `dist/` leaves the VPS serving the previous
bundle even after it pulls.

## Updating the VPS

On the server, in the repository checkout:

```bash
git pull
```

That is the whole procedure, because the build is committed. Then confirm it took
effect — the served asset filenames change with every build:

```bash
curl -s https://trackoja.cv/ | grep -o 'assets/index-[A-Za-z0-9]*\.\(js\|css\)' | sort -u
```

Compare those names with the ones in the repository's `dist/index.html`. If they
differ, the pull has not happened or did not include the rebuilt `dist/`.

## Updating Vercel

```bash
vercel deploy --prod --yes --non-interactive
```

Vercel builds from source rather than using the committed `dist/`, and its project
environment variables override `.env.production` in the repository.

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

## Database migrations

Migrations live in `supabase/migrations/` and are applied with the Supabase CLI
(`supabase db push`) or, when no database password is available, through the
Management API's SQL endpoint using a personal access token:

```bash
curl -X POST \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  "https://api.supabase.com/v1/projects/<project-ref>/database/query" \
  -d '{"query":"select 1"}'
```

Every migration in this repository is written to be **idempotent**, so a re-run is
a no-op rather than an error, and each of the platform migrations carries a
re-runnable verification script in `supabase/verification/` that asserts its own
behaviour against a live database.

Applying a migration file through the CLI records it automatically. Applying one
through the Management API does not, so record it explicitly:

```sql
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260927000091', 'platform_admin_management')
ON CONFLICT (version) DO NOTHING;
```

## Two operational notes

**A migration is not a deployment.** A schema change reaches the database
immediately; a frontend change reaches users only after the build is committed and
the relevant target has been updated. The two are easy to confuse when a screen
depends on a column that only just started existing.

**`dist/` churn makes commits large.** Rebuilding renames the hashed asset files,
so each build commit shows a rename pair. That is expected and not a sign that
something was committed by accident.
