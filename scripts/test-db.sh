#!/usr/bin/env bash
# Rebuilds a throwaway LOCAL Postgres database from every migration and runs the
# database tests in supabase/tests. Never point this at a Supabase project.
set -euo pipefail
cd "$(dirname "$0")/.."
export PGHOST=${PGHOST:-/tmp} PGPORT=${PGPORT:-54322} PGUSER=${PGUSER:-postgres} PGOPTIONS="-c client_min_messages=warning"
psql -q -d postgres -c "drop database if exists tk_test with (force)" -c "create database tk_test"
psql -q -X -v ON_ERROR_STOP=1 -d tk_test -f supabase/tests/00_supabase_shim.sql
for f in supabase/migrations/*.sql; do psql -q -X -v ON_ERROR_STOP=1 -d tk_test -f "$f" >/dev/null || { echo "Migration failed: $f"; exit 1; }; done
if ls supabase/tests/*.test.mjs >/dev/null 2>&1; then PGDATABASE=tk_test node --test supabase/tests/*.test.mjs; fi
