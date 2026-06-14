# TrackOja Phase 1 RBAC Matrix

## Overview
This document defines the role-based access control (RBAC) matrix for Phase 1. All permissions are database-driven and managed through the `roles`, `permissions`, and `role_permissions` tables.

## Roles

| Role | Level | Description | Owner | Manager | Cashier | Inventory Officer |
|------|-------|-------------|-------|---------|---------|-------------------|
| **Owner** | 1 | Store owner with full access | ✓ | - | - | - |
| **Manager** | 2 | Store manager with admin access | - | ✓ | - | - |
| **Cashier** | 3 | Cashier with checkout access | - | - | ✓ | - |
| **Inventory Officer** | 4 | Inventory officer with stock management | - | - | - | ✓ |

## Permission Matrix

### Store Management
| Permission | Resource | Action | Owner | Manager | Cashier | Inventory Officer |
|------------|----------|--------|-------|---------|---------|-------------------|
| store:read | stores | read | ✓ | ✓ | ✓ | ✓ |
| store:create | stores | create | ✓ | ✓ | ✗ | ✗ |
| store:update | stores | update | ✓ | ✓ | ✗ | ✗ |
| store:delete | stores | delete | ✓ | ✗ | ✗ | ✗ |
| settings:update | settings | update | ✓ | ✓ | ✗ | ✗ |

### Staff Management
| Permission | Resource | Action | Owner | Manager | Cashier | Inventory Officer |
|------------|----------|--------|-------|---------|---------|-------------------|
| member:invite | store_members | invite | ✓ | ✓ | ✗ | ✗ |
| member:manage | store_members | manage | ✓ | ✓ | ✗ | ✗ |
| member:remove | store_members | remove | ✓ | ✓ | ✗ | ✗ |

### Inventory Management
| Permission | Resource | Action | Owner | Manager | Cashier | Inventory Officer |
|------------|----------|--------|-------|---------|---------|-------------------|
| inventory:view | inventory | read | ✓ | ✓ | ✓ | ✓ |
| product:create | products | create | ✓ | ✓ | ✗ | ✓ |
| product:update | products | update | ✓ | ✓ | ✗ | ✓ |
| product:delete | products | delete | ✓ | ✓ | ✗ | ✗ |
| category:create | product_categories | create | ✓ | ✓ | ✗ | ✓ |
| category:update | product_categories | update | ✓ | ✓ | ✗ | ✓ |
| category:delete | product_categories | delete | ✓ | ✓ | ✗ | ✗ |
| inventory:adjust | inventory_movements | create | ✓ | ✓ | ✗ | ✓ |

### Sales Management
| Permission | Resource | Action | Owner | Manager | Cashier | Inventory Officer |
|------------|----------|--------|-------|---------|---------|-------------------|
| sales:create | sales | create | ✓ | ✓ | ✓ | ✗ |
| sales:view | sales | read | ✓ | ✓ | ✓ | ✓ |
| sales:void | sales | update | ✓ | ✓ | ✗ | ✗ |
| sales:refund | sales | refund | ✓ | ✓ | ✗ | ✗ |

### Reports & Analytics
| Permission | Resource | Action | Owner | Manager | Cashier | Inventory Officer |
|------------|----------|--------|-------|---------|---------|-------------------|
| reports:view | reports | read | ✓ | ✓ | ✓ | ✓ |

### Customer Management
| Permission | Resource | Action | Owner | Manager | Cashier | Inventory Officer |
|------------|----------|--------|-------|---------|---------|-------------------|
| customer:view | customers | read | ✓ | ✓ | ✓ | ✗ |
| customer:create | customers | create | ✓ | ✓ | ✓ | ✗ |
| customer:update | customers | update | ✓ | ✓ | ✗ | ✗ |
| customer:delete | customers | delete | ✓ | ✓ | ✗ | ✗ |
| customer:manage_credit | customers | update | ✓ | ✓ | ✗ | ✗ |

### Devices Management
| Permission | Resource | Action | Owner | Manager | Cashier | Inventory Officer |
|------------|----------|--------|-------|---------|---------|-------------------|
| devices:view | devices | read | ✓ | ✓ | ✓ | ✓ |
| devices:manage | devices | manage | ✓ | ✓ | ✗ | ✗ |

## Database Implementation

### Roles Table
All roles are system roles (`is_system = TRUE`) in Phase 1. They are stored in the `roles` table with:
- `id`: UUID
- `org_id`: NULL for system roles (will reference org in future)
- `name`: Role name
- `description`: Human-readable description
- `is_system`: TRUE for Phase 1
- `level`: Numeric level for sorting and comparison

### Permissions Table
Permissions are global and immutable in Phase 1. They are stored in the `permissions` table with:
- `id`: UUID
- `name`: Unique permission identifier
- `resource`: Resource category
- `action`: Action type
- `description`: Human-readable description
- `category`: Permission category

### Role-Permission Mapping
The `role_permissions` junction table maps roles to permissions:
- `id`: UUID
- `role_id`: Foreign key to role
- `permission_id`: Foreign key to permission

## Permission Resolution

When checking if a user has a permission:

1. Get the user's `store_members` record for the active store.
2. Get the associated `role_id` from the `store_members` record.
3. Query `role_permissions` for the role_id.
4. Check if the required permission_id is in the result set.

## Phase 1 Scope

Phase 1 implements:
- ✓ Owner, Manager, Cashier, Inventory Officer roles
- ✓ Store, member, inventory, sales, reports permissions
- ✓ Database-driven permission resolution
- ✓ RLS enforcement

Phase 1 does NOT implement:
- ✗ Custom roles per organization
- ✗ Fine-grained resource-level permissions (coming in Phase 2+)
- ✗ Time-based or conditional permissions
- ✗ Delegation or temporary escalation

## Phase 2 Additions

Phase 2 (Inventory Engine) adds the `product:*`, `category:*`, and
`inventory:adjust` permissions above, assigned to the existing system roles per
`PHASE_2_INVENTORY.md`. No new roles are introduced. Permission resolution for
these is performed by the `user_has_permission()` SQL helper
(`014_inventory_rbac_seed.sql`), used directly in RLS policies and inside
`apply_inventory_movement()`.

## Phase 3 Additions

Phase 3 (Sales Engine) adds `sales:view` and `sales:void` (`sales:create`
already existed). No new roles are introduced. `user_has_permission()` gates
read access to `sales`/`sale_items`/`sale_payments` via RLS, and is also used
inside `create_sale()` (`sales:create`) and `void_sale()` (`sales:void`) per
`PHASE_3_SALES.md`.

## Phase 4 Additions

Phase 4 (Customers, Credit Tracking, Loyalty) adds the `customer:view`,
`customer:create`, `customer:update`, `customer:delete`, and
`customer:manage_credit` permissions above. No new roles are introduced.
`user_has_permission()` gates read/write access to `customers` and the
`customer_credit_transactions`/`customer_loyalty_transactions` ledgers via RLS,
and is also used inside `adjust_customer_credit()` and
`adjust_customer_loyalty()` (both require `customer:manage_credit`) and the
Phase 4 extensions to `create_sale()`/`void_sale()` per `PHASE_4_CUSTOMERS.md`.

## Phase 5 Additions

Phase 5 (Reports / Analytics) introduces no new permissions, roles, tables, or
RLS policies. The existing `reports:view` permission (already granted to all
four system roles) now also gates five new `SECURITY DEFINER` reporting
functions - `get_sales_summary()`, `get_sales_by_payment_method()`,
`get_top_products()`, `get_inventory_valuation()`, and
`get_customer_balances_summary()` - via `user_has_permission()`, per
`PHASE_5_REPORTS.md`.

## Phase 6 Additions

Phase 6 (Subscriptions, Billing, Paystack) introduces no new store-scoped
permissions or roles - billing is gated at the organization level via
`organizations.owner_id = auth.uid()`, matching the existing
`org_update_owner_only` policy:

- `subscription_plans` - readable by any `authenticated` user (`status =
  'active'`), powering the pricing/upgrade UI for all store members.
- `subscriptions` and `subscription_transactions` - readable only by the
  owning organization's owner (`organizations.owner_id = auth.uid()`).
- `initiate_subscription_checkout()` - `SECURITY DEFINER`, callable by
  `authenticated`, but raises unless `auth.uid() = organizations.owner_id`.
- `activate_subscription()` and `mark_subscription_transaction_failed()` -
  `SECURITY DEFINER`, granted only to `service_role` (the Paystack webhook
  Edge Function); not callable by `authenticated` users.

See `PHASE_6_SUBSCRIPTIONS.md`.

## Phase 7 Additions

Phase 7 (Platform Dashboard) introduces no new store-scoped permissions,
roles, or tables, and no changes to existing RLS policies. Cross-organization
access is gated by a single new flag and helper function:

- `users.is_platform_admin` (`BOOLEAN`, default `FALSE`) - granted manually
  via SQL, not via any signup/invite flow. Readable on one's own row via the
  existing `users_read_own_profile` policy.
- `is_platform_admin(p_user_id)` - `SECURITY DEFINER`, `STABLE`. Returns
  whether `p_user_id` has the flag set.
- `get_platform_overview()`, `list_platform_organizations()`,
  `get_platform_revenue_summary()`, `get_platform_revenue_by_plan()`,
  `get_platform_system_health()`, `list_platform_recent_errors()` -
  `SECURITY DEFINER`, callable by `authenticated`, but each raises
  `'Permission denied: platform admin required'` unless
  `is_platform_admin(auth.uid())`. Because they run as the table owner they
  bypass RLS on `organizations`/`stores`/`users`/`subscriptions`/
  `subscription_transactions`/`audit_logs` for cross-org aggregate reads.

See `PHASE_7_PLATFORM_DASHBOARD.md`.

## Phase 8 Additions

Phase 8 (Payments Infrastructure) adds a single new permission,
`sales:refund` (Owner/Manager only, distinct from `sales:void`), mirroring the
high-trust pattern of `customer:manage_credit`. No new roles are introduced.
`user_has_permission()` gates:

- `process_refund()` - processes a full/partial refund against a completed
  sale, optionally returning line items to stock and reversing a proportional
  share of any credit/loyalty impact.
- `verify_sale_payment()` - confirms or rejects a `pending` transfer/card/other
  payment on a sale.
- `list_pending_sale_payments()` and `list_recent_refunds()` - read-only lists
  for the Payments page.
- The `refunds_select` RLS policy (mirrors `sale_payments_select`, requires
  `sales:view`).

`create_sale()` and `void_sale()` were also redefined: `create_sale()` now
accepts an optional `pending` flag per payment (sets
`sale_payments.verification_status = 'pending'`), and `void_sale()` now blocks
voiding a sale that already has `refunded_amount > 0`.

See `PHASE_8_PAYMENTS.md`.

## Phase 9 Additions

Phase 9 (Devices Infrastructure) adds two new permissions: `devices:view`
(all four system roles, matching the `inventory:view` precedent - any staff
member operating a device needs to see it) and `devices:manage` (Owner/Manager
only, matching `category:delete`/`product:delete`). No new roles are
introduced. `user_has_permission()` gates:

- `devices_select`/`device_sessions_select`/`device_transactions_select` RLS
  policies (require `devices:view`); `devices_insert`/`devices_update` RLS
  policies (require `devices:manage`). `devices` has no DELETE policy -
  decommissioning is `UPDATE devices SET status = 'decommissioned'`.
- `start_device_session()`, `record_device_transaction()`, and
  `update_device_transaction_status()` - require `devices:view`.
- `end_device_session()` - the session's own `user_id`, or `devices:manage`.
- `record_device_heartbeat()` - the session's own `user_id` only.

See `PHASE_9_DEVICES.md`.

## Phase 10 Additions

Phase 10 (OPay Integration) introduces no new store-scoped permissions or
roles. `devices:view`/`devices:manage` (Phase 9) are unchanged. Two new
credential types are used instead of `user_has_permission()`:

- `service_role` - `handle_opay_webhook()` is `SECURITY DEFINER`, granted only
  to `service_role` (the `opay-webhook` Edge Function), matching the Phase 6
  Paystack webhook pattern. Not callable by `authenticated` or `anon`.
- `device_sessions.session_token` (+ `expires_at`) - `device_heartbeat_by_token()`,
  `record_device_transaction_by_token()`, and `end_device_session_by_token()`
  are `SECURITY DEFINER`, granted to `anon`/`authenticated`. Each resolves the
  session by `session_token` and raises unless `status = 'active'` and
  `expires_at` (set by `start_device_session()`, 24h from session start) is in
  the future. The token itself is the credential - no RLS or
  `user_has_permission()` check applies, and `anon` has no other access to
  `devices`/`device_sessions`/`device_transactions` (Phase 9 RLS policies are
  unchanged).

See `PHASE_10_OPAY.md`.

## Future Enhancements

In later phases, the RBAC system will support:
- Custom roles per organization
- Feature-based permission gating
- Resource-level access control (e.g., specific store-only permissions)
- Audit trail of permission changes
- Permission delegation workflows
