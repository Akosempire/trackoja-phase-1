/**
 * Which permission each app screen needs. The database checks every RPC and
 * table on its own; this map only decides whether to show the screen or the
 * friendly "You don't have access" page instead of a broken half-loaded one.
 *
 * Rules are matched top to bottom, first match wins, so put specific paths
 * before their parents. `any` = at least one of the permissions. `owner` =
 * only the owner role (billing).
 */
export interface RouteRule { pattern: RegExp; any?: string[]; owner?: boolean; label: string }

export const ROUTE_RULES: RouteRule[] = [
  { pattern: /^\/dashboard\/?$/, any: ['reports:view'], label: 'the dashboard' },
  { pattern: /^\/reports(\/|$)/, any: ['reports:view'], label: 'reports' },
  { pattern: /^\/activity(\/|$)/, any: ['reports:view'], label: 'activity' },
  { pattern: /^\/billing(\/|$)/, owner: true, label: 'the subscription' },
  { pattern: /^\/settings\/payments(\/|$)/, owner: true, label: 'payment provider settings' },
  { pattern: /^\/settings\/usetally(\/|$)/, owner: true, label: 'payment provider settings' },
  { pattern: /^\/settings(\/|$)/, any: ['store:update', 'settings:update', 'settings:view'], label: 'settings' },
  { pattern: /^\/staff(\/|$)/, any: ['member:manage', 'member:invite'], label: 'staff' },
  { pattern: /^\/expenses(\/|$)/, any: ['expense:view'], label: 'expenses' },
  { pattern: /^\/payments(\/|$)/, any: ['sales:view_all'], label: 'payments' },
  { pattern: /^\/devices(\/|$)/, any: ['devices:view'], label: 'devices' },
  { pattern: /^\/inventory\/products\/bulk-import\/?$/, any: ['product:create'], label: 'bulk import' },
  { pattern: /^\/inventory\/products\/new\/?$/, any: ['product:create'], label: 'adding products' },
  { pattern: /^\/inventory\/products\/[^/]+\/?$/, any: ['product:update'], label: 'editing products' },
  { pattern: /^\/inventory\/stock\/?$/, any: ['inventory:adjust'], label: 'stock adjustments' },
  { pattern: /^\/inventory\/count\/?$/, any: ['inventory:adjust'], label: 'stock counts' },
  { pattern: /^\/inventory\/transfers(\/|$)/, any: ['inventory:adjust'], label: 'transfers' },
  { pattern: /^\/inventory\/lots\/?$/, any: ['cost:view'], label: 'stock lots' },
  { pattern: /^\/inventory\/(restock|receive|suppliers|purchases|low-stock)(\/|$)/, any: ['purchase:view'], label: 'restocking' },
  { pattern: /^\/inventory\/categories\/?$/, any: ['category:update', 'category:create'], label: 'categories' },
  { pattern: /^\/inventory(\/|$)/, any: ['inventory:view'], label: 'inventory' },
  { pattern: /^\/sales\/checkout\/?$/, any: ['sales:create'], label: 'the register' },
  { pattern: /^\/sales(\/|$)/, any: ['sales:view'], label: 'sales' },
  { pattern: /^\/till(\/|$)/, any: ['sales:create'], label: 'the till' },
  { pattern: /^\/customers\/new\/?$/, any: ['customer:create'], label: 'adding customers' },
  { pattern: /^\/customers\/[^/]+\/edit\/?$/, any: ['customer:update'], label: 'editing customers' },
  { pattern: /^\/customers(\/|$)/, any: ['customer:view'], label: 'customers' },
  { pattern: /^\/jobs(\/|$)/, any: ['job:view'], label: 'jobs' },
  { pattern: /^\/kitchen(\/|$)/, any: ['sales:view'], label: 'the kitchen screen' },
  { pattern: /^\/pharmacy(\/|$)/, any: ['inventory:view'], label: 'expiry alerts' },
];

export type Access =
  | { allowed: true }
  | { allowed: false; label: string; redirect?: string };

export function checkRouteAccess(
  pathname: string,
  can: (permission: string) => boolean,
  roleName: string | null,
): Access {
  const rule = ROUTE_RULES.find(r => r.pattern.test(pathname));
  if (!rule) return { allowed: true };
  const ok = rule.owner ? roleName === 'owner' : (rule.any ?? []).some(can);
  if (ok) return { allowed: true };
  // People without reports land on the screen they actually use
  if (/^\/dashboard\/?$/.test(pathname)) {
    if (can('sales:create')) return { allowed: false, label: rule.label, redirect: '/sales/checkout' };
    if (can('inventory:view')) return { allowed: false, label: rule.label, redirect: '/inventory/products' };
  }
  return { allowed: false, label: rule.label };
}
