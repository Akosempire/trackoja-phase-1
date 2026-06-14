# TrackOja Database Schema

This directory contains all database migrations for TrackOja, starting with the
Phase 1 multi-tenant foundation and extending into later phases.

## Migration Order

Run migrations in this order:

1. `001_auth_schema.sql` - Users and auth foundation
2. `002_organizations_schema.sql` - Merchant accounts and organizations
3. `003_roles_permissions_schema.sql` - RBAC tables
4. `004_stores_schema.sql` - Store entities and ownership
5. `005_audit_logging_schema.sql` - Audit trail tables
6. `006_rls_policies.sql` - Row-level security policies
7. `007_seed_initial_data.sql` - Initial roles, permissions, and demo data
8. `008_missing_insert_policies.sql` - INSERT policies for signup/onboarding
9. `009_handle_new_user_trigger.sql` - Auto-create user profile on signup
10. `010_fix_rls_recursion.sql` - SECURITY DEFINER helper functions and recursion fixes
11. `011_audit_log_triggers.sql` - Database-layer audit log triggers
12. `012_storage_buckets.sql` - Media storage bucket and policies

### Phase 2 - Inventory Engine

13. `013_products_categories_schema.sql` - `product_categories` and `products` tables
14. `014_inventory_rbac_seed.sql` - Product/category/inventory permissions, role assignments, `user_has_permission()` helper
15. `015_inventory_movements_schema.sql` - `inventory_movements` ledger and `apply_inventory_movement()` function
16. `016_inventory_rls_policies.sql` - RLS policies for products, categories, and inventory movements
17. `017_inventory_audit_triggers.sql` - Audit triggers for product/category/stock events

See `PHASE_2_INVENTORY.md` (repo root) for the full specification.

### Phase 3 - Sales Engine

18. `018_sales_schema.sql` - `sales`, `sale_items`, `sale_payments`, and `store_sale_counters` tables
19. `019_sales_rbac_seed.sql` - `sales:view`/`sales:void` permissions and role assignments
20. `020_sales_functions.sql` - `_apply_inventory_movement_internal()` helper, `create_sale()`, and `void_sale()` functions
21. `021_sales_rls_policies.sql` - RLS policies for sales, sale items, and sale payments
22. `022_sales_audit_triggers.sql` - Audit triggers for sale created/voided events

See `PHASE_3_SALES.md` (repo root) for the full specification.

### Phase 4 - Customers, Credit Tracking, Loyalty

23. `023_customers_schema.sql` - `customers`, `customer_credit_transactions`, `customer_loyalty_transactions` tables; adds `customer_id`/`loyalty_points_earned` to `sales`, `credit` to `sale_payments.method`, and `loyalty_enabled`/`loyalty_earn_rate` to `store_settings`
24. `024_customers_rbac_seed.sql` - `customer:view`/`create`/`update`/`delete`/`manage_credit` permissions and role assignments
25. `025_customers_functions.sql` - `adjust_customer_credit()`, `adjust_customer_loyalty()`, and `create_sale()`/`void_sale()` updates for credit sales and loyalty points
26. `026_customers_rls_policies.sql` - RLS policies for customers and the credit/loyalty ledgers
27. `027_customers_audit_triggers.sql` - Audit triggers for customer created/updated/deleted and credit/loyalty adjustment events

See `PHASE_4_CUSTOMERS.md` (repo root) for the full specification.

### Phase 5 - Reports / Analytics

28. `028_reports_functions.sql` - Read-only reporting functions: `get_sales_summary()`, `get_sales_by_payment_method()`, `get_top_products()`, `get_inventory_valuation()`, and `get_customer_balances_summary()`, all gated by the existing `reports:view` permission

See `PHASE_5_REPORTS.md` (repo root) for the full specification.

### Phase 6 - Subscriptions, Billing, Paystack

29. `029_subscriptions_schema.sql` - `subscription_plans`, `subscriptions`, and `subscription_transactions` tables; adds an FK from `organizations.subscription_plan_id` to `subscription_plans(id)`
30. `030_subscriptions_seed.sql` - Free/Starter/Pro plan catalog (NGN pricing, informational feature limits)
31. `031_subscriptions_functions.sql` - `initiate_subscription_checkout()` (org owner), `activate_subscription()` and `mark_subscription_transaction_failed()` (service_role only, called from the Paystack webhook)
32. `032_subscriptions_rls_policies.sql` - RLS policies for subscription plans, subscriptions, and subscription transactions
33. `033_subscriptions_audit_triggers.sql` - Initial Free-plan subscription on org creation, and audit logging for subscription status changes and payment outcomes

See `PHASE_6_SUBSCRIPTIONS.md` (repo root) for the full specification.

### Phase 7 - Platform Dashboard

34. `034_platform_admin_schema.sql` - `users.is_platform_admin` flag and the `is_platform_admin(p_user_id)` SECURITY DEFINER helper
35. `035_platform_dashboard_functions.sql` - Cross-org read functions for platform admins: `get_platform_overview()`, `list_platform_organizations()`, `get_platform_revenue_summary()`, `get_platform_revenue_by_plan()`, `get_platform_system_health()`, `list_platform_recent_errors()`

See `PHASE_7_PLATFORM_DASHBOARD.md` (repo root) for the full specification, including how to grant platform admin access.

### Phase 8 - Payments Infrastructure

36. `036_payments_schema.sql` - `sales.refunded_amount`, `sale_items.refunded_quantity`, `sale_payments.verification_status`/`verified_by`/`verified_at`, and the new `refunds` table
37. `037_payments_rbac_seed.sql` - `sales:refund` permission (Owner/Manager only)
38. `038_payments_functions.sql` - `process_refund()`, `verify_sale_payment()`, `list_pending_sale_payments()`, `list_recent_refunds()`, and updated `create_sale()`/`void_sale()` definitions
39. `039_payments_rls_policies.sql` - RLS policy for `refunds`
40. `040_payments_audit_triggers.sql` - Audit triggers for refund and payment verification events

See `PHASE_8_PAYMENTS.md` (repo root) for the full specification.

### Phase 9 - Devices Infrastructure

41. `041_devices_schema.sql` - `devices`, `device_sessions`, and `device_transactions` tables
42. `042_devices_rbac_seed.sql` - `devices:view` (all roles) and `devices:manage` (Owner/Manager only) permissions
43. `043_devices_functions.sql` - `start_device_session()`, `end_device_session()`, `record_device_heartbeat()`, `record_device_transaction()`, and `update_device_transaction_status()`
44. `044_devices_rls_policies.sql` - RLS policies for `devices` (direct CRUD), `device_sessions`, and `device_transactions` (select-only)
45. `045_devices_audit_triggers.sql` - Audit triggers for device registration, status changes, and recorded transactions

See `PHASE_9_DEVICES.md` (repo root) for the full specification.

### Phase 10 - OPay Integration

46. `046_devices_session_token_auth.sql` - `device_sessions.expires_at`; redefines `start_device_session()` to set it; adds `device_heartbeat_by_token()`, `record_device_transaction_by_token()`, and `end_device_session_by_token()` (granted to `anon`/`authenticated`, authenticated via `session_token` instead of `auth.uid()`)
47. `047_opay_webhook_functions.sql` - `handle_opay_webhook()` (`service_role` only), maps OPay payment confirmations onto `device_transactions` and `sale_payments.verification_status`
48. `048_devices_transaction_status_audit.sql` - `DEVICE_TRANSACTION_STATUS_CHANGED` audit trigger on `device_transactions`

See `PHASE_10_OPAY.md` (repo root) for the full specification.

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
- `public.product_categories` - Product categories (Phase 2)
- `public.products` - Product catalog with pricing and stock levels (Phase 2)
- `public.inventory_movements` - Append-only stock movement ledger (Phase 2)
- `public.sales` - Completed/voided checkout transactions (Phase 3)
- `public.sale_items` - Line items of a sale, with price/tax snapshots (Phase 3)
- `public.sale_payments` - Payment records for a sale, supports split tender (Phase 3)
- `public.store_sale_counters` - Per-store sequential sale numbering (Phase 3, internal)
- `public.customers` - Customer directory with balance, credit limit, and loyalty points (Phase 4)
- `public.customer_credit_transactions` - Append-only ledger of customer balance changes (Phase 4)
- `public.customer_loyalty_transactions` - Append-only ledger of customer loyalty point changes (Phase 4)
- Reporting functions (Phase 5) - read-only aggregations over `sales`/`sale_items`/`sale_payments`/`products`/`customers`, gated by `reports:view`; no new tables
- `public.subscription_plans` - Subscription plan catalog (Free/Starter/Pro pricing and feature limits) (Phase 6)
- `public.subscriptions` - Per-organization subscription record (status, billing period, plan) (Phase 6)
- `public.subscription_transactions` - Paystack checkout attempts and payment history (Phase 6)
- `public.users.is_platform_admin` - Flag granting cross-org read access to the Platform Dashboard (Phase 7)
- Platform dashboard functions (Phase 7) - read-only cross-org aggregations over `organizations`/`stores`/`users`/`subscriptions`/`subscription_transactions`/`audit_logs`, gated by `is_platform_admin()`; no new tables
- `public.refunds` - Append-only ledger of full/partial refunds against completed sales (Phase 8)
- `public.sales.refunded_amount`, `public.sale_items.refunded_quantity` - Cumulative refund tracking on sales and their line items (Phase 8)
- `public.sale_payments.verification_status`/`verified_by`/`verified_at` - Pending/verified/rejected status for transfer/card/other payments (Phase 8)
- `public.devices` - Device registry (payment terminals, scanners, printers, tablets, mobiles) per store (Phase 9)
- `public.device_sessions` - Staff sessions using a registered device (started/ended/heartbeat); `expires_at` bounds `session_token` validity (Phase 9, extended Phase 10)
- `public.device_transactions` - Ledger of device-initiated payment actions, optionally linked to `sales`/`sale_payments`/`refunds` (Phase 9); status transitions also driven by OPay webhooks (Phase 10)
- OPay integration functions (Phase 10) - `device_heartbeat_by_token()`, `record_device_transaction_by_token()`, `end_device_session_by_token()` (session_token-authenticated, `anon`), and `handle_opay_webhook()` (`service_role`); no new tables
