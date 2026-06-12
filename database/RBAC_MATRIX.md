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

### Sales Management
| Permission | Resource | Action | Owner | Manager | Cashier | Inventory Officer |
|------------|----------|--------|-------|---------|---------|-------------------|
| sales:create | sales | create | ✓ | ✓ | ✓ | ✗ |

### Reports & Analytics
| Permission | Resource | Action | Owner | Manager | Cashier | Inventory Officer |
|------------|----------|--------|-------|---------|---------|-------------------|
| reports:view | reports | read | ✓ | ✓ | ✓ | ✓ |

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

## Future Enhancements

In later phases, the RBAC system will support:
- Custom roles per organization
- Feature-based permission gating
- Resource-level access control (e.g., specific store-only permissions)
- Audit trail of permission changes
- Permission delegation workflows
