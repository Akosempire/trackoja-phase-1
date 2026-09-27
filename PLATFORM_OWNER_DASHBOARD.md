# Platform Owner dashboard — inventory, audit and specification

This document is the reconnaissance the Platform Owner dashboard was built from.
It records what already existed, where the current platform screens departed from
Waya, what had to be added to Waya, and — importantly — which backend capabilities
are real and which do not exist yet.

Nothing in this document describes a mockup as a working integration. Where a
capability is missing it is listed as missing, and the screen that needs it renders
**Not configured** or **No data** rather than inventing a value.

---

## 1. Waya, as documented and as implemented

Sources read: `WAYA_DESIGN_SYSTEM.md`, `src/styles/tokens.css`, `src/styles/waya.css`,
`src/styles/app.css`.

| Layer | File | Role |
| --- | --- | --- |
| Tokens | `src/styles/tokens.css` | Palette (light/dark), type scale, spacing, radii, borders, motion, layout, shadows, icon sizes, z-index |
| Mapping | `src/styles/waya.css` | Maps existing components onto Waya: editorial headings, compact UI, hairline sections, quiet panels, neutral selection, restrained accent |
| Commerce geometry | `src/styles/app.css` | Component geometry for the customer product |
| **New: Waya components** | `src/styles/waya-components.css` | Reusable primitives Waya lacked, built only from tokens |

Documented rules that the platform screens were measured against:

- **"Avoid new page-specific literal colors."** (WAYA_DESIGN_SYSTEM.md)
- **"Neutral selection, restrained accent."** (WAYA_DESIGN_SYSTEM.md)
- Hairline sections, quiet panels, wide desktop content.
- Dialogs contain focus, dismiss on Escape, and restore trigger focus.
- Button variants are accent, neutral, outline, quiet (`btn-ghost`) and danger.
- Loading pages use geometry-preserving skeletons.
- Mobile/tablet use a modal navigation drawer.

Token families actually available (values read from the file, never guessed):
`--color-*` (page, surface, raised, panel, subtle, hover, selected, text\nstrong, text, text\secondary, text\muted, text\soft, border, border\control,
accent, accent\hover, danger, success, warning, info, workspace, neutral\action),
`--text-*`, `--space-0…80`, `--radius-*`, `--shadow-popover/dialog`,
`--sidebar-width` 247px / `--sidebar-collapsed` 60px, `--control-height` 38px,
`--icon-*`, `--duration-*`, `--ease-*`, `--z-*`, plus semantic aliases
(`--surf`, `--border2`, `--t1`, `--brand`, `--green`, `--amber`, `--red`, `--r2`, `--tr`).

---

## 2. Inventory of reusable components that already existed

### React components

| Component | Path | Reusable? |
| --- | --- | --- |
| `Button` | `src/components/ui/Button.tsx` | Yes — variants primary/neutral/outline/ghost/danger, `loading` |
| `FormField` | `src/components/ui/FormField.tsx` | Yes — label, hint, error association, password reveal |
| `PageLoader` | `src/components/ui/PageLoader.tsx` | Yes — geometry-preserving skeleton |
| `ToastProvider` / `useToast` | `src/components/ui/Toast.tsx` | Yes — success/error/warning/info/loading |
| `SideNav` | `src/components/SideNav.tsx` | Merchant workspace navigation (not platform) |
| `BottomNav`, `StoreSwitcher`, `ThemeSelect`, `OfflineBanner` | `src/components/` | Merchant shell |
| `DeveloperModeBanner` | `src/components/DeveloperModeBanner.tsx` | Yes — developer/impersonation indicators |
| `icons.tsx` | `src/components/icons.tsx` | Yes — inline SVG icons |

### CSS primitives

Layout and shell: `.page`, `.page-header`, `.page-title`, `.page-subtitle`,
`.stats-grid`, `.stats-grid-3`, `.card`.
Surfaces and lists: `.card`, `.stat-card`, `.list`, `.list-item`,
`.list-item-title`, `.list-item-subtitle`, `.empty-state`.
Buttons and controls: `.btn` + `.btn-neutral|outline|ghost|danger|sm`, `.icon-button`,
`.sidebar-toggle`, `.spinner`, `.btn-spinner`.
Forms: `.form-label`, `.form-input`, `.select-input`, `.form-hint`, `.form-error`,
`.search-input`.
Selection: `.chip-row`, `.chip`, `.chip.active` — **Waya's selection idiom is an
underline, not a filled pill.**
Badges: `.badge`, `.badge-default|warning|success|danger|error`.
Alerts: `.alert`, `.alert-error`, `.alert-success`.
Navigation: `.side-nav*` (247px/60px, collapsed tooltips, modal drawer), `.bottom-nav*`.
Feedback: `.skeleton*`, `.page-loader`, `.page-skeleton`.
Tables: `.import-table` — the only table precedent, with a `data-label` stacked
fallback on small screens (waya.css).
Charts: **none.** `package.json` has no charting dependency.
Overlays: native `<dialog>` used by `ScannerOverlay` and `.mobile-nav-dialog`.

### Confirmed absent before this work

No data-table component, no chart primitive, no dialog/confirm component, no
pagination, no card/section header, no environment indicator, no timeline, no
definition list, no status-tone scale beyond four ad-hoc badge variants, no
permission-denied or unavailable state.

---

## 3. Audit: where the platform screens departed from Waya

Evidence is from `src/styles/app.css` lines 2150–2454 (the `Platform dashboard`
block), `src/styles/platform-admin.css`, and the three platform page files.

**1. Literal colours outside the palette.** The legacy platform block hardcodes
`#ef4444`, `#22c55e`, `#f59e0b` (with `var(--danger, …)` fallbacks that never
apply) and raw `rgba(239,68,68,.07)`, `rgba(34,197,94,.12)` values, instead of
`--color-danger` `#ba3a35`, `--color-success` `#00a94f`, `--color-warning` `#d89600`
and `color-mix()` the way Waya does. This directly breaks *"Avoid new page-specific
literal colors"*.

**2. Raw pixel values instead of tokens.** `gap: 10px`, `padding: 14px 12px`,
`font-size: 26px`, `border-radius: 999px`, `height: 8px`, `width: 160px` and others
throughout, where Waya uses `--space-*`, `--text-*`, `--radius-pill`.

**3. Three competing selection idioms in one area.** `.plat-filter-pill.active`
fills with `--brand`; `.plat-admin-tab.is-active` fills with `--color-accent` on a
purple background; `.chip.active` uses Waya's neutral underline. Waya documents
*"neutral selection"*. The purple-filled tab is the clearest violation.

**4. Uppercase micro-labels.** `.plat-kpi-label` and `.plat-section-title` set
`text-transform: uppercase` with letter-spacing while `waya.css` resets those very
classes to `text-transform: none` — a live conflict settled only by load order.
`.plat-section-sub` keeps uppercase and is not reset at all.

**5. Weight inflation.** `.plat-kpi-value` and `.plat-health-value` use
`font-weight: 800`, `.plat-revenue-value` `800`, titles `700`; `waya.css` overrides
the KPI values to `500`. Another load-order-dependent conflict.

**6. Inline styles in the JSX.** `PlatformDashboardPage.tsx` carries inline
`style={{ marginBottom: 16 }}`, `style={{ flex: 1 }}`, `style={{ textAlign: 'center', padding: '20px 0' }}`,
`style={{ width: pct + '%' }}` and similar, with raw numbers rather than tokens.
It also uses `className="input"` — **a class that does not exist anywhere in the
project**, so that search field renders unstyled.

**7. Styles split across two files with an override layer.** Platform geometry lives
in `app.css` (`.plat-kpi-*`, `.plat-health-*`, `.plat-org-*`, `.plat-category-*`,
`.plat-plan-*`, `.plat-revenue-*`), continuing in `platform-admin.css`
(`.plat-admin-*`, `.plat-section*`, `.plat-field`, `.plat-form*`, `.plat-key`,
`.plat-sandbox`, `.plat-perm-*`, `.plat-setting-*`, `.plat-diagnostics`), and partly
overridden in `waya.css`. Only four files use these classes, all of them platform
files, so the block was safe to replace.

**8. Emoji used as business-category icons** (`plat-org-category`, `plat-category-emoji`)
while the rest of the product uses `BusinessCategoryIllustration`.

**9. Misleading "System Health".** `get_platform_system_health()` returns four
*business-data* counts — failed audit events, failed transactions, past-due
organizations, suspended organizations. Presenting those under "System Health" implies
application/infrastructure monitoring that does not exist. The brief requires showing
`Not configured` where there is no working health check.

**10. Loading and states.** A full `PageLoader` is rendered *inside* a card for the
revenue panel; there are no error states on individual panels; filter buttons lack
`aria-pressed`; the search input has no accessible label.

**11. No environment indicator.** Nothing in the UI distinguishes development,
staging or production, which the brief requires to be unmistakable.

---

## 4. What was added to Waya

Added in `src/styles/waya-components.css` — reusable, token-only, and shared:

`.section-head/-title/-sub/-actions` · complete `.badge` tone scale
(`neutral|brand|success|warning|danger|info|workspace|outline` + `.badge-dot`) which
also settles the old literal-rgba badge rules · `.env-badge` with
`production|staging|development|unknown` · `.data-table` (generalising `.import-table`,
including the stacked mobile fallback) · `.toolbar*` · native `<dialog>` `.dialog*`
with danger and wide variants · `.state-block` (empty/error/denied/unavailable) ·
`.meter-*` categorical bars · `.chart-*` inline-SVG trend primitives · `.kpi-*` cards
that can be actionable buttons · `.timeline-*` · `.def-list` · `.pager` · `.mono`,
`.secret-mask`, `.code-panel` · `.callout` · `.is-locked` · extra skeletons.

React primitives added under `src/components/ui/` (all reusable by the customer
product, none platform-specific):

| Component | File | Purpose |
| --- | --- | --- |
| `Badge`, `BadgeTone` | `Badge.tsx` | The tone scale (neutral/brand/success/warning/danger/info/workspace/outline) |
| `StatusBadge`, `statusLabel`, `statusTone` | `StatusBadge.tsx` | One status vocabulary for the whole console, replacing three duplicated per-screen maps |
| `DataTable`, `DataTableColumn` | `DataTable.tsx` | Generic table with a `data-label` stacked layout below 900px, sticky quiet header, tabular figures and built-in sorting |
| `Dialog`, `ConfirmDialog` | `Dialog.tsx` | Native `<dialog>` wrapper with focus containment, Escape and backdrop dismissal; `ConfirmDialog` requires a reason for consequential actions |
| `StateBlock`, `SectionState` | `StateBlock.tsx` | The empty / error / denied / unavailable ladder, so a section cannot skip a state |
| `KpiCard`, `KpiGrid` | `KpiCard.tsx` | Metric tiles; a tile with `onClick` becomes a control that opens the view it summarises |
| `MeterList`, `MeterItem` | `MeterList.tsx` | Categorical comparison, successor to the ad-hoc `.plat-*-bar` rules |
| `TrendChart`, `TrendPoint` | `TrendChart.tsx` | Inline-SVG single-series trend, coloured entirely from tokens |
| `Pagination` | `Pagination.tsx` | Offset paging that is honest when the endpoint reports no total |
| `Timeline`, `TimelineEntry` | `Timeline.tsx` | Activity trails for tickets, audit events and subscription changes |
| `DefList`, `DefRow` | `DefList.tsx` | Label/value detail panels |
| `SectionHead` | `SectionHead.tsx` | Card section header with optional actions |

Plus `src/components/platform/` (`PlatformProvider`/`usePlatform`,
`PlatformLayout`, `PlatformSideNav`, `EnvironmentBadge`/`EnvironmentMarker`,
`PlatformPageHead`/`AreaCoverage`/`PermissionDenied`/`RefreshButton`, area icons),
`src/config/platformAreas.ts` (the ten-area IA with per-area capability and gap
declarations), `src/config/environment.ts` and `src/utils/format.ts` (one shared
formatter, replacing three divergent private copies).

---

## 5. Backend capability matrix

Verified against the live project (`wgcolmnlieefqvtzfvjt`) and its 86 migrations.

### Present and usable

| Area | Capability |
| --- | --- |
| Permissions | `platform_permissions` (**18 keys** — the original 12 plus `platform:view_payments`, `platform:manage_subscriptions`, `platform:manage_integrations`, `platform:view_health`, `platform:view_audit`, `platform:manage_tickets`), `platform_admins` (`super_admin`, `admin`, `support`, `developer`, **`finance_operator`**), `platform_admin_permissions`, `require_platform_permission`, `platform_user_has_permission`, `get_my_platform_permissions`, `is_platform_admin` (**now honours `platform_admins`, not just the legacy column**), `is_platform_super_admin` |
| Audit browse | `list_platform_audit_logs(...)` — filterable, paginated, with `redact_secret_keys()` applied to `changes`/`details`; the only way to read platform-scoped audit rows, which RLS hides from every tenant |
| Overview | `get_platform_overview`, `get_platform_overview_v2(product_key)`, `get_platform_revenue_summary(from,to)`, `get_platform_revenue_by_plan(from,to)`, `get_platform_inventory_overview`, `list_platform_recent_errors(limit)` |
| Businesses | `list_platform_organizations`, `list_product_businesses(product_key,search,status,limit,offset)` (paginated), `get_platform_business(org_id)` |
| Products | `list_platform_products`, `upsert_platform_product(...)` |
| Plans | `list_product_plans(product_key)`, `upsert_product_plan(...)`, `list_plan_revisions(plan_id,limit)`, `product_plan_revisions` |
| Subscriptions | `organization_products` with **`agreed_monthly_price` / `agreed_annual_price` / `agreed_user_limit`** (list price and agreed price are already separate — the brief's "never silently change an agreed price" is supported by the model), `subscription_adjustments`, `record_subscription_adjustment(...)`, `list_subscription_adjustments(...)`, `initiate_subscription_checkout`, `activate_subscription`, `mark_subscription_transaction_failed` |
| Payments | `subscription_transactions` (amount, status, reference, `paystack_data`, `is_sandbox`), `handle_opay_webhook`, `verify_sale_payment` |
| Activation keys | `activation_keys` (issued_by, valid_from/until, bound_email, redeemed_at/by, revoked_at/by, revoke_reason, payment_reference, subscription_transaction_id, is_sandbox), `activation_key_events`, `issue_activation_key`, `list_activation_keys`, `revoke_activation_key`, `redeem_activation_key` |
| Users | `list_platform_users(product_key,search,limit)`, `list_platform_admin_accounts`, `set_platform_admin_permission` |
| Support notes | `platform_support_notes`, `add_support_note`, `list_support_notes` |
| Feature flags | `feature_flags` (key, enabled, scope, product_id, org_id, is_sandbox) — **table only, no RPC** |
| Settings | `platform_settings`, `list_platform_settings`, `set_platform_setting`, `notification_templates`, `list_notification_templates`, `upsert_notification_template` |
| Developer | `developer_access_grants`, `developer_sessions`, `grant_developer_mode`, `revoke_developer_mode`, `list_developer_grants`, `start/end_developer_session`, `get_developer_diagnostics(org_id)`, `expire_stale_developer_state`, `create_sandbox_business`, `list_sandbox_businesses` |
| Impersonation | `impersonation_sessions`, `start_impersonation(org_id,reason,minutes)`, `end_impersonation`, `get_active_impersonation`, `is_impersonating` |
| Audit | `audit_logs` (actor, org, store, action, resource, `changes`, `details`, status), `create_audit_log(...)`, ~30 audit triggers on commerce tables |

Audit entries exist for commerce actions (sales, products, stock, customers, devices,
payments, subscriptions, stores, staff, login). Note: **platform-level actions are not
consistently audited** — `activation_keys`, `product_plans`, `platform_settings`,
`platform_admins` and `developer_access_grants` have no audit triggers.

### Missing — must be specified, not mocked

| # | Missing | Needed for |
| --- | --- | --- |
| 1 | **Support tickets.** Only `platform_support_notes` exists. No ticket status, assignee, severity, category, requester, replies, attachments or activity timeline | Area 5 |
| 2 | **Integrations registry.** No table, no RPC. No stored-credential mechanism in the app database (SMTP lives in Supabase Auth config, outside the app) | Area 6 |
| 3 | **System health signals.** `get_platform_system_health()` returns business counts, not application/infrastructure health. No uptime, API-failure, DB-connectivity, job or webhook-processing signal | Area 7 |
| 4 | **Incidents.** No table, no acknowledgement/resolution/audit | Area 7 |
| 5 | **Webhook event log.** `handle_opay_webhook` processes payments but stores no inspectable event | Areas 6, 8 |
| 6 | **Background jobs.** No table, no run history, no retry | Area 8 |
| 7 | **Email delivery results.** No record of sent/failed messages | Area 6 |
| 8 | **Invoices / receipts.** Only `subscription_transactions` | Area 3 |
| 9 | ~~**Finance Operator role**~~ — **resolved** in migration 089: `finance_operator` is now an allowed level and the finance permission keys exist. What remains unimplemented is the *narrowing* of table-level reads, because the platform tables' RLS SELECT policies still key on `is_platform_admin`, so any active platform admin gets full table SELECT and the finer keys only govern the RPC layer (see defect D below) | Areas 3, 9 |
| 10 | **Feature-flag RPC.** Table exists but there is no function to read or set a flag | Area 8 |

### Defects found during this work, and their status

| # | Defect | Status |
| --- | --- | --- |
| A | **A paid Paystack payment never activated the entitlement.** `activate_subscription()` updated `subscriptions`, `organizations` and `subscription_transactions` but never wrote `organization_products` — the table every platform metric, the seat trigger and `get_platform_overview_v2` read. A paying customer stayed `pending` forever. | **Fixed in 089.** Proven behaviourally: activation now writes `status='active'`, `source='payment'`, resolves the product plan, snapshots `agreed_monthly_price=5000.00` / `agreed_user_limit=2` from `product_plans`, and sets `expires_at` from `current_period_end`; a repeat activation is idempotent. |
| B | **`is_platform_admin()` read only the legacy `users.is_platform_admin` column.** A person appointed via `platform_admins` alone passed every permission-gated RPC but failed every RLS SELECT policy on every platform table, and was refused by both UI gates. | **Fixed in 089.** It now returns true when the legacy flag is set **or** an active `platform_admins` row exists. |
| C | **`create_audit_log()` and `log_activity()` had no `GRANT`/`REVOKE`, so Postgres defaulted to `EXECUTE TO PUBLIC`** — any anonymous caller could forge `audit_logs` rows with an arbitrary `actor_id`. | **Fixed in 089.** Both are revoked from `PUBLIC`, `anon` and `authenticated` and granted to `service_role`; an authenticated call is now rejected at runtime, while the internal callers still work. |
| D | **Read-only impersonation was not enforced.** `block_writes_while_impersonating()` was attached to no table, and once attached its predicate exempted platform admins — the only people who can ever be impersonating. | **Trigger attachment fixed in 089** (20 tables). The **predicate** is fixed in 090, which drops the self-defeating exemption. Remaining limitation: the guard covers only those 20 tables. |
| E | **A paid activation could grant access that never expires.** For an organization with no `subscriptions` row, `activate_subscription` had no `current_period_end` to copy, so the entitlement landed with `expires_at = NULL`. Two production organizations were in that state. **The consequence was worse than first described:** `enforce_seat_limit()` tests `(status = 'active' AND (expires_at IS NULL OR expires_at > now()))`, so a NULL expiry is treated as *live* — it over-grants rather than blocking. | **Fixed in 090**: the function now inserts the missing `subscriptions` row and derives the expiry from it, and the two affected organizations are backfilled to a consistent state. Both remain `pending`/`trial` and therefore still have no paid access — the repair set only `expires_at`, because flipping them to `active` would have handed seats to a business whose trial lapsed on 2026-07-12. |
| F | **Platform revenue double-counted sandbox rows** and could not be attributed per product, because `get_platform_revenue_summary`/`_by_plan` predate the `product_id` and `is_sandbox` columns. | **Fixed in 089** — both now filter `is_sandbox = FALSE`. Return types were verified unchanged. |
| G | **Most platform actions were unaudited.** Activation keys, support notes, subscription changes, settings and templates wrote only their own journal tables; `set_platform_setting` also lost the previous value entirely. | **Fixed in 089** — six actions now write `audit_logs`, and settings changes carry `changes = {previous, new}`. Permission *denials* still leave no record. |
| H | **The impersonation guard performs three indexed lookups per row** on all 20 guarded tables. Before 090 the predicate short-circuited on the platform-admin exemption for admins, so the lookups were skipped; now that the guard actually applies, they run on every guarded write made by an impersonating admin. | **Known, not measured, not fixed.** Watch bulk `create_sale`/`sale_items` writes; the remedy is to reduce `is_impersonating()` to a single lookups or to attach the trigger more narrowly. |
| I | **Permission separation is enforced only at the RPC layer.** The platform tables' RLS SELECT policies key on `is_platform_admin`, so a support agent or finance operator who is an active platform admin gets table-level `SELECT` regardless of which finer permission keys they hold. | **Known, not fixed.** Each screen still gates its own controls on the specific key, and every mutating RPC re-authorises server-side. |
| J | **Money-moving and internal functions were executable by anyone.** `activate_subscription` and `mark_subscription_transaction_failed` were executable by `anon` and `authenticated`. Migration 031 revoked EXECUTE "FROM PUBLIC", which achieves nothing here: this project's `ALTER DEFAULT PRIVILEGES` grants EXECUTE on every new `public` function **directly** to `anon`, `authenticated` and `service_role`, so the live ACL was `{postgres, anon, authenticated, service_role}`. A customer could call the legitimately client-callable `initiate_subscription_checkout` to mint a pending reference to their own organisation, then call `activate_subscription` with that reference to mark the subscription active and create the entitlement — paid access with no payment. The same class of leak covered **33 trigger functions** and `_apply_inventory_movement_internal`, a private helper with no permission check that took `created_by` as an argument, so an anonymous caller could forge inventory movements attributed to any user. | **Fixed.** Naming `anon` and `authenticated` (and `PUBLIC`, for the functions still carrying the PostgreSQL default entry) is what removes the grant. Thirty-seven functions were revoked from `PUBLIC, anon, authenticated`, with `service_role` retained on the three server-to-server entry points. `initiate_subscription_checkout` deliberately stays client-callable, as do the RLS predicate helpers — revoking those would break policy evaluation. Recorded in migration 090, which also proves behaviourally that revoking EXECUTE on a trigger function does not stop it firing. **Residual, reported not fixed:** 113 public functions still carry an anon grant from the same default privilege; none is a trigger function or one of the newly locked entry points, and anon holds no JWT so each still fails its own `auth.uid()` check — but the surface is wider than intended. |
| K | **Editing any plan silently reset its billing cycle to monthly.** Migration 089 added `product_plans.billing_cycle` and gave `upsert_product_plan` a `p_billing_cycle` parameter that defaults to `'monthly'` and is written unconditionally, but the service never sent it. Any unrelated plan edit — a description tweak, a price change — rewrote an annual or custom plan as monthly. | **Fixed** in `PlatformAdminService.savePlan`, which now reads the stored cycle and preserves it unless the caller explicitly asks for a change; a genuinely new plan still starts on monthly. Guarded by `tests/platform-plans.test.ts`. |

---

## 6. Required additions, specified

The following are the explicit contracts for what is missing. Where implemented,
the migration is named; where not implemented, the UI shows `Not configured` and
this document is the specification — no fabricated data is displayed.

### 6.1 Role model (implemented)

Extend `platform_admins.level` with `finance_operator`. Add permission keys so the
five roles compose from grants rather than a hardcoded level:

| Role | Composition |
| --- | --- |
| Platform Owner | `super_admin` — every permission, including `platform:manage_users` and `developer:manage` |
| Platform Admin | `admin` + businesses, users, plans, products, support, activation, view |
| Developer/Technical Operator | `developer` + `developer:access`, `platform:view`, integrations and health read |
| Support Agent | `support` + `platform:support`, `platform:view`, `platform:manage_businesses` (read) |
| Finance Operator | `finance_operator` + `platform:manage_payments`, `platform:manage_plans`, `platform:manage_activation` |
| New keys | `platform:manage_integrations`, `platform:manage_health`, `platform:view_audit` |

Server enforcement is by `require_platform_permission()` in every RPC. The UI hides
actions a role cannot perform **and** the underlying route is protected.

### 6.2 Support tickets

```
support_tickets(
  id uuid pk, reference text unique,        -- human id e.g. TKT-1042
  org_id uuid null references organizations(id) on delete set null,
  product_key text null,
  requester_user_id uuid null references users(id) on delete set null,
  requester_email text, requester_name text,
  category text check in (bug, billing, feature_request, account, how_to, other),
  severity text check in (low, normal, high, urgent),
  status text check in (new, open, pending_customer, resolved, closed),
  subject text, body text,
  assignee_user_id uuid null references users(id) on delete set null,
  subscription_product_id uuid null,      -- links to organization_products
  incident_id uuid null,                  -- links to incidents when 6.3 lands
  first_response_at timestamptz null, resolved_at timestamptz null,
  is_sandbox boolean not null default false,
  created_at, updated_at
)
support_ticket_messages(
  id uuid pk, ticket_id uuid not null references support_tickets(id) on delete cascade,
  author_user_id uuid null, author_email text,
  visibility text check in (internal, customer),   -- internal notes never leave the platform
  body text, created_at
)
```

Functions: `create_support_ticket`, `list_support_tickets(status,severity,category,assignee,search,limit,offset)`,
`get_support_ticket(ticket_id)`, `assign_support_ticket(ticket_id,assignee,reason)`,
`set_support_ticket_status(ticket_id,status,reason)`, `add_ticket_message(ticket_id,body,visibility)`,
`support_ticket_stats()`.

Permissions: read `platform:support`; assign/status `platform:support`; internal notes
`platform:support`. Every mutation writes `audit_logs`. Customer-visible replies are
the only rows a customer may read; internal rows are filtered server-side by the RPC,
never by the browser.

### 6.3 Integrations

```
platform_integrations(
  id uuid pk, key text unique,               -- opay | brevo_smtp | supabase
  name text, category text check in (payments, email, platform),
  environment text check in (test, live),
  status text check in (not_configured, configured, verified, failing),
  config jsonb not null default '{}',        -- non-secret settings only
  secret_ref text null,                      -- pointer to the secret store, never the value
  last_checked_at timestamptz null, last_ok_at timestamptz null,
  last_error text null, updated_by uuid null, created_at, updated_at
)
```

Rules: secrets are written through an Edge Function that stores them outside the
table; the browser only ever receives `secret_ref` and a masked hint (last 4). No
function returns `config` values marked secret, and no value is written to logs.

Functions: `list_platform_integrations()`, `set_integration_config(key,config,environment)`,
`verify_integration(key)` (performs a real connection test and records the result),
`list_integration_events(key,limit)`.

### 6.4 Health signals and incidents

The honest design: a signal that has no working check returns `status = 'not_instrumented'`
and the UI prints **Not configured**.

```
platform_health_signals(
  id uuid pk, key text unique, name text, category text,
  meaning text,                              -- what this signal means, shown in the UI
  check_kind text check in (query, http, none),
  status text check in (ok, degraded, failing, not_instrumented, unknown),
  observed_value numeric null, threshold_warning numeric null, threshold_failing numeric null,
  last_checked_at timestamptz null, last_detail text null
)
platform_incidents(
  id uuid pk, reference text unique, title text, severity text, status text
    check in (open, acknowledged, resolved),
  summary text, signal_keys text[],
  opened_at timestamptz, acknowledged_at timestamptz null, acknowledged_by uuid null,
  resolved_at timestamptz null, resolved_by uuid null, resolution_note text null
)
```

Only signals that map to something genuinely measurable are seeded as `query`
checks: database reachability, failed subscription transactions in 24h, failed audit
events in 24h, webhook processing failures. Everything else — uptime, API latency,
Email delivery, background jobs — is seeded `not_instrumented` and the UI says so.

### 6.5 Webhook events and background jobs

```
webhook_events(id, provider, event_type, external_ref, payload jsonb,
  signature_valid boolean, status check in (received, processed, failed, ignored),
  attempts int, last_error text, received_at, processed_at)
background_jobs(id, key, name, schedule, last_run_at, last_status, last_error,
  runs_24h, failures_24h, avg_duration_ms)
```

Retry is a function (`retry_webhook_event(id)`, `run_background_job(key)`) that
requires `platform:manage_integrations` and writes an audit row. Until a real job
runner exists, `background_jobs` is empty and the UI shows **No data**.

---

## 7. Journeys, and what was actually verified

Each journey is marked with how far it was verified. "Database-verified" means a
query against the live project, not a reading of the SQL.

| # | Journey | Status |
| --- | --- | --- |
| 1 | **Onboarding a business** | **Verified.** Creating an organization fires `handle_new_organization_subscription` (a Starter `trialing` row) and `handle_new_organization_product_entitlement` (one TrackOja entitlement, `status='pending'`, `source='trial'`, prices and the 2-seat limit snapshotted from the default plan, `trial_ends_at` copied from the organization). Migration 090 asserts every organization on the platform now has exactly one `subscriptions` row (0 with none, 0 with more than one). |
| 2 | **Assigning a plan** | **Verified server-side.** `record_subscription_adjustment` handles all twelve change types, snapshots `previous_values`/`new_values`, requires a reason of at least five characters, writes a support note, and (since 089) writes an audit row. Its fifteen distinct refusal messages were enumerated from the migration and the Billing screen validates against the server's own wording. |
| 3 | **Confirming payment** | **Verified behaviourally.** Before 089, a paid transaction left the entitlement untouched; the fix was proven by a self-rolling-back transaction: `entitlements 5 → 6`, `status=active`, `source=payment`, plan resolved, `agreed_monthly=5000.00`, `agreed_user_limit=2`, `expires_at` set, a repeat activation idempotent, and zero rows left behind. Migration 090 additionally proves that an organization with no `subscriptions` row now gets one created rather than a NULL expiry. |
| 4 | **Activating access** | **Verified server-side.** `issue_activation_key` → `redeem_activation_key` upserts the entitlement with `source='activation_key'`, snapshotting the plan prices, the key's seat limit and `valid_until` as `expires_at`, under `SELECT … FOR UPDATE` so a key cannot be redeemed twice. Every refusal the customer can hit is enumerated in the migration and mirrored on the Activation screen, along with the fact that a key is masked after issue and cannot be recovered. |
| 5 | **Handling a failed payment** | **Verified.** `mark_subscription_transaction_failed` is now reachable only by `service_role` (asserted in migration 090's verification), so a customer cannot mark their own payment failed or, more importantly, activate one. |
| 6 | **Responding to a ticket** | **Cannot be performed: no backend.** There is no ticket table and no ticket RPC. The Support screen states this and specifies the required tables, functions and permission key rather than showing an empty queue that would read as "no tickets". |
| 7 | **Diagnosing an incident** | **Cannot be performed: no backend.** There is no incident table. The System Health screen renders the four signals that genuinely exist as measured values, renders the seven that do not as **Not configured** rather than green, and specifies the incident model. |
| 8 | **Updating an integration** | **Cannot be performed: no backend.** There is no registry, no connection test and no credential store; the two payment integrations are configured through Edge Function environment variables that this application cannot read. The Integrations screen shows the real status of each (`configured` / `not configured`), shows `No data` for last-checked and recent events, and states plainly that a green indicator would be fabricated. |

**Permission and error states** are covered by the migrations' verification scripts
(42 checks for 089, 37 for 090) and by `tests/platform-areas.test.ts`, which asserts
that a platform owner sees every area, that an admin without a grant cannot see the
developer area, that a support agent sees only support and overview, and that a user
holding no platform permission sees nothing at all. The interface hides what a role
cannot do, and every mutating RPC re-authorises server-side regardless.

## 8. Browser verification

Measured against the production bundle (`index-20ccb78b.js`) served from
`vite preview`, signed in as real accounts against the live database. Screenshots
are in `artifacts/platform-console/`.

**Every area renders.** All ten routes return their own heading with no error
state, no permission-denied state and **zero console errors**, at 1440px. That was
not true before this pass: the Developer area showed an error for a super admin,
because listing sandboxes is refused without an active developer grant. That
refusal is expected — a platform owner reaches the area *in order to grant
developer mode* — so it now renders as an unavailable state with the reason, the
gated call is skipped rather than made and refused, and the create control is
disabled until a grant exists.

**No horizontal overflow at any width.** `documentElement.scrollWidth` equals the
viewport at 1440, 1024, 820, 390 and 320 on the overview, businesses, billing and
activation screens — the standard `WAYA_DESIGN_SYSTEM.md` sets. Billing and
activation previously forced a **400px** layout viewport into a 320px screen:
`.callout` and `.section-head` are flex containers whose children keep
`min-width: auto`, so one long unbroken string — a UUID, a migration filename —
made the callout wider than its card and the page wider than the screen. Fixed in
the Waya layer with `min-width: 0` on the flex children and `overflow-wrap:
anywhere` on the text, so every screen using those primitives benefits.

**Shell behaviour.** The sidebar is 247px, collapses to 60px and persists the
choice. At 820px and below it is hidden and the drawer opens with all ten entries
and closes on Escape. The merchant bottom navigation is absent at every width, as
it must be for a console with no store.

**Permissions, measured against the live server.**

| Account | Sidebar offers | Direct visit to a forbidden area |
| --- | --- | --- |
| Owner (`super_admin`) | all ten | — |
| Support agent (`platform:view`, `platform:support`) | Overview, Support, Health, Audit | Activation → denied; Audit allowed, because the RPC accepts `platform:support` as a fallback gate |
| Finance operator (`platform:view`, `platform:view_payments`, `platform:manage_subscriptions`) | Overview, Billing, Health | Activation → denied; Audit → denied |

One thing to note rather than celebrate: a support agent can open **Platform
Settings** read-only, because `list_platform_settings` is gated on
`platform:view`, which they hold, while *changing* a setting needs
`platform:manage_settings`, which they do not. The page renders read-only with no
edit controls, so nothing is exposed that the backend did not already permit — but
the sidebar hides an area that is reachable and showing data. Narrowing that would
need a settings-specific read permission, which does not exist.

**Honest states, confirmed in the browser.** Integrations renders `Not configured`
and `No data` (4 and 11 occurrences) with **no** healthy claim; System Health
renders seven signals as `Not instrumented` and never as OK; Support states that
the ticket backend does not exist. No screen claims a green status for a system
with no working check.

**Cleanup.** The three temporary verification accounts were deleted from
production: `auth.users` 13 → 10, `platform_admins` 4 → 1, with zero rows left in
`public.users`, `platform_admin_permissions` or `audit_logs`. The only platform
admin remaining is the platform owner.

## 9. Platform roles, and how they are administered

The rewrite of this console dropped platform user and role administration
entirely: the previous screen could list admin accounts and toggle their
permission keys, and `listAdminAccounts`/`setAdminPermission` became unused. More
seriously, `platform_admins` had **no INSERT, UPDATE or DELETE path at all** — a
platform admin could only be appointed by running SQL by hand, so the five product
roles existed as a CHECK constraint and nothing else.

Migration 091 (`platform_admin_management`) closes that:

| Function | What it does |
| --- | --- |
| `grant_platform_admin(user, level, note)` | Appoints an admin, seeds the level's baseline permissions, and sets the legacy platform flags |
| `set_platform_admin_level(user, level, note)` | Changes the level, reseeding permissions — cleared when moving to owner, because that level implies every key |
| `revoke_platform_admin(user, reason)` | Clears permissions, revokes developer access, ends open developer sessions, clears both legacy flags |
| `list_platform_admin_accounts_v2()` | The roster with effective permission counts, developer state and who granted each account |

All three mutations are restricted to a platform owner, all three audit their
change with before/after values, and all three carry guards that keep the console
from locking itself out: the last platform owner cannot be demoted or revoked, and
self-revocation is refused.

**The levels, and what they actually mean.** For every level except platform
owner, an account's abilities are *exactly* the permission keys granted to it — so
Platform Admin, Support Agent and Developer differ only by which keys they hold,
and the level decides only which keys are seeded at appointment:

| Level | Seeded with |
| --- | --- |
| Platform owner | nothing — it holds all eighteen keys implicitly |
| Platform admin | `platform:view`, `platform:manage_businesses`, `platform:support` |
| Support agent | `platform:view`, `platform:support` |
| Finance operator | `platform:view`, `platform:view_payments`, `platform:manage_subscriptions` |
| Developer | `platform:view`, `developer:access` |

Two details were easy to get wrong and are worth recording. Seeding permissions is
not optional: a level granted with no keys produces an account that can do nothing
at all, which looks like a broken grant rather than a strict one. And
`users.is_platform_admin` must be kept in step, because every RLS SELECT policy on
the platform tables still keys on that legacy column — without it a new admin
passes the RPC gates and can read no table.

**The screen** is a "Platform users and roles" section in the Businesses & Users
area — that area is the one named for users, and the ten-area structure does not
gain an eleventh. It renders only for an operator holding `platform:manage_users`,
lists the roster, explains each level, and offers appoint, change level and revoke
with a required reason. Verified in a browser at 1440 and 390: the roster renders,
all five levels are explained, and there is no horizontal overflow.

Verified by `supabase/verification/platform_admin_management_verification.sql`
(**20/20 checks**), which is re-runnable and self-cleaning — it exercises all four
seeded baselines, every guard listed above, the audit trail, and the privilege
surface, then restores its fixture and asserts that nothing was left behind.



