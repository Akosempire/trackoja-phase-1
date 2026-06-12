# Phase 1 Setup Guide

## Prerequisites

- Node.js 18+
- PostgreSQL 13+ (via Supabase)
- Supabase account
- Git

## Installation

### 1. Clone and setup

```bash
cd phase-1
npm install
```

### 2. Supabase Setup

Create a new Supabase project:

1. Go to [supabase.com](https://supabase.com)
2. Create a new project
3. Copy your project URL and anon key
4. Create `.env.local` from `.env.local.example`
5. Fill in your Supabase credentials

### 3. Database Migration

Option A: Using Supabase Dashboard

1. Go to SQL Editor in your Supabase dashboard
2. Execute each migration file in order:
   - `database/001_auth_schema.sql`
   - `database/002_organizations_schema.sql`
   - `database/003_roles_permissions_schema.sql`
   - `database/004_stores_schema.sql`
   - `database/005_audit_logging_schema.sql`
   - `database/006_rls_policies.sql`
   - `database/007_seed_initial_data.sql`

Option B: Using Supabase CLI

```bash
supabase migration new <migration_name>
supabase migration up
```

### 4. Verify Installation

```bash
npm test              # Run all tests
npm run test:watch   # Watch mode
npm run dev          # Start dev server
```

## Project Structure

```
phase-1/
├── database/              # SQL migrations
│   ├── 001_auth_schema.sql
│   ├── 002_organizations_schema.sql
│   ├── 003_stores_schema.sql
│   ├── 004_roles_permissions_schema.sql
│   ├── 005_rls_policies.sql
│   ├── 006_audit_logging_schema.sql
│   ├── 007_seed_initial_data.sql
│   ├── RBAC_MATRIX.md
│   └── README.md
├── src/
│   ├── types.ts              # TypeScript type definitions
│   ├── config.supabase.ts    # Supabase client configuration
│   ├── services.auth.ts      # Authentication service
│   ├── services.organization.ts
│   ├── services.store.ts
│   ├── services.rbac.ts
│   ├── services.audit.ts
│   ├── services.member.ts
│   └── utils.store-context.ts
├── tests/
│   ├── tenant-isolation.test.ts
│   ├── store-switching.test.ts
│   ├── rbac.test.ts
│   ├── audit-logging.test.ts
│   └── integration.test.ts
├── .env.local.example
├── package.json
└── README.md
```

## Key Features

### Authentication
- Sign up with email and password
- Email verification
- Password reset
- Session management
- Login/logout audit trails

### Multi-Tenancy
- Organizations (Merchant accounts)
- Stores (Retail locations)
- Organization-level data isolation
- Store-level data isolation via RLS

### RBAC (Role-Based Access Control)
- 4 built-in roles: Owner, Manager, Cashier, Inventory Officer
- Database-driven permissions
- No hardcoded permissions
- Permission matrix fully defined

### Security
- Supabase Auth for identity
- Row-level security (RLS) policies on all tenant tables
- Organization isolation
- Store isolation
- Audit logging on critical actions

### Store Switching
- Persistent store context
- Global store selector
- Context-aware queries
- Event-based notifications

### Audit Logging
- Login/logout tracking
- Store creation tracking
- Store switching tracking
- Staff invitation tracking
- Membership changes tracking

## Database Schema

### Core Tables
- `users` - User profiles
- `organizations` - Merchant accounts
- `stores` - Retail locations
- `store_members` - User-store relationships

### RBAC Tables
- `roles` - Role definitions
- `permissions` - Permission definitions
- `role_permissions` - Role-permission mappings

### Audit Tables
- `audit_logs` - Critical action logs
- `activity_logs` - User activity
- `user_sessions` - Session management

## RLS Policies

All tables have RLS policies enforcing:
- Organization-level isolation
- Store-level isolation
- Membership validation
- Permission checks

## Testing

```bash
npm test                    # Run all tests
npm run test:watch        # Watch mode
npm run test:coverage     # Coverage report

# Specific test suites
npm test -- tenant-isolation.test.ts
npm test -- store-switching.test.ts
npm test -- rbac.test.ts
npm test -- audit-logging.test.ts
npm test -- integration.test.ts
```

## API Reference

### AuthService
- `signup(request)` - Create new user
- `login(request)` - Authenticate user
- `logout()` - End session
- `forgotPassword(email)` - Request reset
- `resetPassword(password)` - Update password
- `verifyOtp(email, token)` - Verify email
- `getCurrentUser()` - Get authenticated user
- `getSession()` - Get current session
- `onAuthStateChange(callback)` - Listen to auth changes

### OrganizationService
- `createOrganization(userId, name, timezone)` - Create org
- `getOrganization(orgId)` - Get org details
- `getUserOrganizations(userId)` - List user's orgs
- `updateOrganization(orgId, updates)` - Update org

### StoreService
- `createStore(orgId, userId, request)` - Create store
- `getStore(storeId)` - Get store details
- `getOrgStores(orgId)` - List org stores
- `getUserStores(userId)` - List user's stores
- `updateStore(storeId, updates)` - Update store
- `deleteStore(storeId)` - Delete store

### RbacService
- `getSystemRoles()` - Get all roles
- `getPermissions()` - Get all permissions
- `getUserPermissions(userId, storeId)` - Get user's permissions
- `hasPermission(userId, storeId, permissionName)` - Check permission
- `getRolePermissions(roleId)` - Get role's permissions

### AuditService
- `logAction(...)` - Log critical action
- `logLogin(...)` - Log login
- `logLogout(...)` - Log logout
- `logStoreCreated(...)` - Log store creation
- `logStoreSwitched(...)` - Log store switch
- `logStaffInvited(...)` - Log staff invitation
- `logStaffAccepted(...)` - Log staff acceptance
- `getOrgAuditLogs(orgId, limit, offset)` - Get org logs
- `getStoreAuditLogs(storeId, limit, offset)` - Get store logs

### MemberService
- `inviteStaff(storeId, invitedBy, request)` - Invite staff
- `acceptInvitation(userId, storeId)` - Accept invitation
- `getStoreMembers(storeId)` - List store members
- `getUserStoreMembership(userId, storeId)` - Get membership
- `removeMember(storeId, memberId)` - Remove member
- `updateMemberRole(storeId, memberId, roleId)` - Update role

### StoreContextManager
- `getContext()` - Get current context
- `setContext(context)` - Set context
- `switchStore(store, userId)` - Switch store
- `clearContext()` - Clear context
- `onContextChange(callback)` - Listen for changes

## Next Steps

After Phase 1 is complete, proceed to:

- Phase 2: Inventory Engine (products, categories, stock management)
- Phase 3: Sales Engine (checkout, transactions, receipts)
- Phase 4: Customer Management
- Phase 5: Reports and Analytics
- Phase 6+: Payments, Devices, Subscriptions, Integrations
