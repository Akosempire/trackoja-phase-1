# TrackOja Phase 1 Database Schema

This directory contains all database migrations for Phase 1 of TrackOja.

## Migration Order

Run migrations in this order:

1. `001_auth_schema.sql` - Users and auth foundation
2. `002_organizations_schema.sql` - Merchant accounts and organizations
3. `003_roles_permissions_schema.sql` - RBAC tables
4. `004_stores_schema.sql` - Store entities and ownership
5. `005_audit_logging_schema.sql` - Audit trail tables
6. `006_rls_policies.sql` - Row-level security policies
7. `007_seed_initial_data.sql` - Initial roles, permissions, and demo data

## Running Migrations

Option 1: Supabase Dashboard
- Copy-paste SQL from each file into the SQL Editor and execute in order.

Option 2: Supabase CLI
```bash
supabase migration new <migration_name>
# Edit the migration file
supabase migration up
```

Option 3: Direct PostgreSQL
```bash
psql -h <host> -U postgres -d postgres < 001_auth_schema.sql
# ... repeat for other migrations
```

## Schema Overview

- `auth.users` - Supabase Auth managed users
- `public.users` - User profiles and app-level metadata
- `public.organizations` - Merchant accounts
- `public.stores` - Retail locations
- `public.store_members` - User-store relationships and roles
- `public.roles` - Role definitions
- `public.permissions` - Permission definitions
- `public.role_permissions` - Role-permission associations
- `public.audit_logs` - All audit events
