# Phase 1: Multi-Tenant SaaS Foundation

## Overview

TrackOja Phase 1 Foundation transforms the prototype into a secure, production-ready multi-tenant SaaS platform.

## What's Included

### ✓ Database Schema
- Authentication and user management
- Organizations (merchant accounts)
- Stores (retail locations)
- Role-based access control (RBAC)
- Audit logging
- Complete migrations and seed data

### ✓ Security
- Row-level security (RLS) policies
- Organization-level isolation
- Store-level isolation
- Membership-based access control
- Immutable audit trails

### ✓ Authentication
- Sign up and login
- Email verification
- Password reset
- Session management
- Auth state management

### ✓ Multi-Tenancy
- Organizations (merchant accounts)
- Stores (retail locations)
- Multi-store per organization
- Store memberships
- Store switching

### ✓ RBAC (Role-Based Access Control)
- Owner role (full access)
- Manager role (admin except delete)
- Cashier role (sales focused)
- Inventory Officer role (inventory focused)
- 11 core permissions
- Database-driven, no hardcoding

### ✓ Staff Management
- Invite staff to stores
- Accept invitations
- Manage memberships
- Update roles
- Remove members

### ✓ Audit Logging
- Login/logout tracking
- Store creation tracking
- Store switching tracking
- Staff invitation tracking
- Membership changes tracking

### ✓ Services Layer
- AuthService for authentication
- OrganizationService for merchant accounts
- StoreService for store management
- RbacService for permissions
- AuditService for audit trails
- MemberService for staff management
- StoreContextManager for context switching

### ✓ TypeScript
- Complete type definitions
- Type-safe services
- API response/request types
- Context types

### ✓ Testing
- Tenant isolation tests
- Store switching tests
- RBAC permission tests
- Audit logging tests
- Integration flow tests

### ✓ Documentation
- Database migration guide
- RBAC matrix
- Setup guide
- Implementation summary
- API reference

## Quick Start

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure Supabase**
   - Create a Supabase project
   - Copy `.env.local.example` to `.env.local`
   - Add your Supabase URL and keys

3. **Run migrations**
   - Execute SQL files in `database/` directory in order
   - Or use Supabase CLI: `supabase migration up`

4. **Verify setup**
   ```bash
   npm test
   npm run dev
   ```

See [SETUP_GUIDE.md](./SETUP_GUIDE.md) for detailed instructions.

## Project Structure

```
phase-1/
├── database/                   # SQL migrations
│   ├── 001_auth_schema.sql
│   ├── 002_organizations_schema.sql
│   ├── 003_stores_schema.sql
│   ├── 004_roles_permissions_schema.sql
│   ├── 005_rls_policies.sql
│   ├── 006_audit_logging_schema.sql
│   ├── 007_seed_initial_data.sql
│   ├── RBAC_MATRIX.md
│   └── README.md
├── src/                        # TypeScript services and utilities
│   ├── types.ts
│   ├── config.supabase.ts
│   ├── services.auth.ts
│   ├── services.organization.ts
│   ├── services.store.ts
│   ├── services.rbac.ts
│   ├── services.audit.ts
│   ├── services.member.ts
│   └── utils.store-context.ts
├── tests/                      # Test suites
│   ├── tenant-isolation.test.ts
│   ├── store-switching.test.ts
│   ├── rbac.test.ts
│   ├── audit-logging.test.ts
│   └── integration.test.ts
├── .env.local.example
├── package.json
├── SETUP_GUIDE.md
├── IMPLEMENTATION_SUMMARY.md
└── README.md
```

## Key Features

### 1. Multi-Tenancy
- Multiple organizations per platform
- Multiple stores per organization
- Complete data isolation
- RLS-enforced tenant boundaries

### 2. Authentication
- Email/password signup and login
- Email verification
- Forgot password flow
- Secure session management
- Supabase Auth integration

### 3. RBAC
- 4 built-in roles
- 11 core permissions
- Database-driven permission management
- Role hierarchy (Owner → Manager → Cashier/Inventory Officer)
- Permission matrix fully defined

### 4. Store Switching
- Persistent store selector
- Global store context
- Event-based context management
- Secure store access control

### 5. Audit Logging
- All critical actions logged
- Organization and store scoped
- Immutable audit trail
- Compliance ready

### 6. Security
- Supabase Auth
- RLS on all tables
- Organization isolation
- Store isolation
- Membership validation
- Audit logging

## Services API

### AuthService
```typescript
signup(request: SignUpRequest)
login(request: LoginRequest)
logout()
forgotPassword(email: string)
resetPassword(password: string)
verifyOtp(email: string, token: string)
getCurrentUser()
getSession()
onAuthStateChange(callback)
```

### OrganizationService
```typescript
createOrganization(userId, name, timezone)
getOrganization(orgId)
getUserOrganizations(userId)
updateOrganization(orgId, updates)
```

### StoreService
```typescript
createStore(orgId, userId, request)
getStore(storeId)
getOrgStores(orgId)
getUserStores(userId)
updateStore(storeId, updates)
deleteStore(storeId)
```

### RbacService
```typescript
getSystemRoles()
getPermissions()
getUserPermissions(userId, storeId)
hasPermission(userId, storeId, permissionName)
getRolePermissions(roleId)
```

### AuditService
```typescript
logAction(actor, org, action, resource, ...)
logLogin(userId, orgId)
logLogout(userId, orgId)
logStoreCreated(userId, orgId, storeId, storeName)
logStoreSwitched(userId, orgId, fromStore, toStore, toStoreName)
logStaffInvited(userId, orgId, storeId, email, role)
logStaffAccepted(userId, orgId, storeId, storeName)
getOrgAuditLogs(orgId, limit, offset)
getStoreAuditLogs(storeId, limit, offset)
```

### MemberService
```typescript
inviteStaff(storeId, invitedBy, request)
acceptInvitation(userId, storeId)
getStoreMembers(storeId)
getUserStoreMembership(userId, storeId)
removeMember(storeId, memberId)
updateMemberRole(storeId, memberId, roleId)
```

### StoreContextManager
```typescript
getContext()
setContext(context)
switchStore(store, userId)
clearContext()
onContextChange(callback)
```

## Database Schema

### Users
```sql
users (id, email, first_name, last_name, phone, avatar_url, current_org_id, current_store_id, email_verified_at, last_login_at, status, created_at, updated_at)
```

### Organizations
```sql
organizations (id, name, slug, logo_url, description, owner_id, billing_email, billing_status, trial_ends_at, subscription_plan_id, timezone, created_at, updated_at)
```

### Stores
```sql
stores (id, org_id, name, slug, address, city, state, postal_code, country, phone, email, logo_url, status, timezone, currency, created_by, created_at, updated_at)
```

### Store Members
```sql
store_members (id, store_id, user_id, role_id, status, invited_by, invited_at, accepted_at, invited_email, joined_at, created_at, updated_at)
```

### Roles & Permissions
```sql
roles (id, org_id, name, description, is_system, level, created_at, updated_at)
permissions (id, name, resource, action, description, category, created_at)
role_permissions (id, role_id, permission_id, created_at)
```

### Audit & Activity
```sql
audit_logs (id, actor_id, org_id, store_id, action, resource_type, resource_id, resource_name, changes, details, ip_address, user_agent, status, created_at)
activity_logs (id, user_id, org_id, store_id, activity_type, description, context, ip_address, created_at)
```

## Testing

```bash
npm test                    # Run all tests
npm run test:watch        # Watch mode
npm run test:coverage     # Coverage report

# Specific tests
npm test -- tenant-isolation.test.ts
npm test -- store-switching.test.ts
npm test -- rbac.test.ts
npm test -- audit-logging.test.ts
npm test -- integration.test.ts
```

## RLS Policies

All tables have RLS enabled with policies enforcing:
- ✓ Organization isolation
- ✓ Store isolation
- ✓ Membership validation
- ✓ Permission checks
- ✓ Immutable audit logs

See [database/005_rls_policies.sql](./database/005_rls_policies.sql) for full details.

## Next Steps

After Phase 1, proceed to:

- **Phase 2**: Inventory Engine
- **Phase 3**: Sales & Checkout
- **Phase 4**: Customer Management
- **Phase 5**: Reports & Analytics
- **Phase 6+**: Payments, Devices, Subscriptions, Integrations

## Support

- [Supabase Documentation](https://supabase.com/docs)
- [Supabase Auth Guide](https://supabase.com/docs/guides/auth)
- [RLS Policy Examples](https://supabase.com/docs/guides/auth/row-level-security)

## License

TrackOja Phase 1 Foundation
