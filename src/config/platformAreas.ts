import type { ComponentType, SVGProps } from 'react';
import {
  BuildingIcon,
  CodeIcon,
  HomeIcon,
  KeyIcon,
  PlugIcon,
  PulseIcon,
  SettingsIcon,
  ShieldIcon,
  SubscriptionIcon,
  TicketIcon,
} from '../components/icons';

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

export type PlatformAreaId =
  | 'overview'
  | 'businesses'
  | 'billing'
  | 'activation'
  | 'support'
  | 'integrations'
  | 'health'
  | 'developer'
  | 'audit'
  | 'settings';

export type PlatformGroupId = 'customers' | 'operations' | 'governance';

/**
 * How much of an area the backend can actually serve today.
 *
 * `live`      — the screens read real platform RPCs end to end.
 * `partial`   — the core reads are real, but named capabilities are not built.
 * `specified` — no backend exists; the screen states that plainly and shows the
 *               contract that would be needed. Nothing is faked.
 */
export type AreaCapability = 'live' | 'partial' | 'specified';

export interface PlatformArea {
  id: PlatformAreaId;
  /** Route path, relative to /platform. '' is the index route. */
  path: string;
  label: string;
  /** Shorter label for narrow viewports. */
  short: string;
  description: string;
  icon: IconComponent;
  /**
   * Permission keys this area needs. Any one is enough. Empty means "any
   * platform admin" — the server still re-authorises every call.
   */
  permissions: string[];
  /** Only reachable with an active developer grant (or as a super admin). */
  developerOnly?: boolean;
  group: PlatformGroupId | null;
  capability: AreaCapability;
  /** Named capabilities this area cannot serve yet, shown in the UI. */
  gaps?: string[];
}

export interface PlatformGroup {
  id: PlatformGroupId;
  label: string;
}

export const PLATFORM_GROUPS: PlatformGroup[] = [
  { id: 'customers', label: 'Customers' },
  { id: 'operations', label: 'Operations' },
  { id: 'governance', label: 'Governance' },
];

/**
 * The ten areas, grouped so the sidebar stays scannable: one ungrouped entry
 * point, then customers, operations and governance.
 */
export const PLATFORM_AREAS: PlatformArea[] = [
  {
    id: 'overview',
    path: '',
    label: 'Overview',
    short: 'Overview',
    description: 'What needs attention across every business right now.',
    icon: HomeIcon,
    permissions: ['platform:view'],
    group: null,
    capability: 'partial',
    gaps: [
      'Growth over time and MRR/ARR need a metrics series endpoint — none exists.',
      'Platform revenue cannot be attributed per product: the revenue functions report per plan only.',
    ],
  },
  {
    id: 'businesses',
    path: 'businesses',
    label: 'Businesses & users',
    short: 'Businesses',
    description: 'The customer directory, each business in detail, and staff accounts.',
    icon: BuildingIcon,
    permissions: ['platform:manage_businesses'],
    group: 'customers',
    capability: 'partial',
    gaps: [
      'No create, edit, suspend, reinstate or delete business endpoint exists.',
      'Platform staff management and user suspension are not implemented server-side.',
    ],
  },
  {
    id: 'billing',
    path: 'billing',
    label: 'Subscriptions & billing',
    short: 'Billing',
    description: 'Plans and prices, entitlements, payments and subscription changes.',
    icon: SubscriptionIcon,
    permissions: ['platform:manage_plans', 'platform:manage_payments', 'platform:view_payments'],
    group: 'customers',
    capability: 'partial',
    gaps: [
      'No invoices or receipts, and no proration on plan changes.',
      'No grace period, dunning or automatic expiry sweep.',
    ],
  },
  {
    id: 'activation',
    path: 'activation',
    label: 'Activation keys',
    short: 'Activation',
    description: 'Issue, trace and revoke the keys that turn a payment into access.',
    icon: KeyIcon,
    permissions: ['platform:manage_activation'],
    group: 'customers',
    capability: 'partial',
    gaps: [
      'A key is masked after issue and cannot be re-displayed, extended or unbound.',
      'Key events are recorded but no endpoint lists them.',
    ],
  },
  {
    id: 'support',
    path: 'support',
    label: 'Support',
    short: 'Support',
    description: 'Tickets and customer feedback, with the notes already on each business.',
    icon: TicketIcon,
    permissions: ['platform:support'],
    group: 'customers',
    capability: 'specified',
    gaps: [
      'No ticket table exists — only flat, append-only business notes.',
      'No assignee, severity, category, reply threads, attachments or customer inbox.',
    ],
  },
  {
    id: 'integrations',
    path: 'integrations',
    label: 'Integrations',
    short: 'Integrations',
    description: 'Payment gateway, email delivery and platform service connections.',
    icon: PlugIcon,
    permissions: ['platform:manage_integrations'],
    group: 'operations',
    capability: 'specified',
    gaps: [
      'No integration registry, connection test or credential store exists.',
      'No webhook event log, so failed or unknown deliveries cannot be inspected.',
      'Paystack and OPay secrets live only in Edge Function environment variables.',
    ],
  },
  {
    id: 'health',
    path: 'health',
    label: 'System health',
    short: 'Health',
    description: 'Platform condition and incidents, with honest coverage of what is measured.',
    icon: PulseIcon,
    permissions: ['platform:view_health', 'platform:view'],
    group: 'operations',
    capability: 'partial',
    gaps: [
      'No uptime, latency, background-job or email-delivery measurement exists.',
      'No incident table, acknowledgement or resolution workflow.',
      'Nothing schedules the one expiry sweep that does exist.',
    ],
  },
  {
    id: 'developer',
    path: 'developer',
    label: 'Developer tools',
    short: 'Developer',
    description: 'Environment, diagnostics, sandbox businesses and developer access.',
    icon: CodeIcon,
    permissions: ['developer:access'],
    developerOnly: true,
    group: 'operations',
    capability: 'partial',
    gaps: [
      'The write guard covers only the twenty tenant tables it is attached to, and never a caller with no session token.',
      'Sandbox businesses are created empty and cannot be deleted.',
      'Feature flags have no read or write endpoint.',
    ],
  },
  {
    id: 'audit',
    path: 'audit',
    label: 'Audit logs',
    short: 'Audit',
    description: 'Who changed what, when, and which environment it affected.',
    icon: ShieldIcon,
    permissions: ['platform:view_audit', 'platform:support'],
    group: 'governance',
    capability: 'partial',
    gaps: [
      'Permission denials leave no record at all, so refused attempts are invisible.',
      'Audit rows carry no environment column: the environment shown is the one you are reading from, not one recorded at the time.',
    ],
  },
  {
    id: 'settings',
    path: 'settings',
    label: 'Platform settings',
    short: 'Settings',
    description: 'Platform identity, billing defaults, support details and templates.',
    icon: SettingsIcon,
    permissions: ['platform:manage_settings'],
    group: 'governance',
    capability: 'partial',
    gaps: [
      'Settings cannot be created or deleted through the interface — only existing keys can be updated.',
      'No application sender reads the notification templates; the only email the product can trigger is the authentication service resending its own verification message.',
      'Several stored settings are read by no code, so changing them has no effect.',
    ],
  },
];

export const PLATFORM_BASE_PATH = '/platform';

export function platformAreaPath(area: PlatformArea): string {
  return area.path ? `${PLATFORM_BASE_PATH}/${area.path}` : PLATFORM_BASE_PATH;
}

interface AccessLike {
  isSuperAdmin: boolean;
  developerMode: boolean;
  permissions: string[];
}

export function canSeeArea(area: PlatformArea, access: AccessLike): boolean {
  // A super admin reaches everything: they are the only role that can grant
  // developer access, so hiding the developer area until a grant exists would
  // make the first grant impossible.
  if (access.isSuperAdmin) return true;
  if (area.developerOnly) return access.developerMode;
  if (area.permissions.length === 0) return true;
  return area.permissions.some((permission) => access.permissions.includes(permission));
}

export function visiblePlatformAreas(access: AccessLike): PlatformArea[] {
  return PLATFORM_AREAS.filter((area) => canSeeArea(area, access));
}

/** Resolves the area owning a pathname, longest path first. */
export function findPlatformArea(pathname: string): PlatformArea | undefined {
  const candidates = [...PLATFORM_AREAS]
    .filter((area) => area.path !== '')
    .sort((a, b) => b.path.length - a.path.length);
  const match = candidates.find((area) => pathname.startsWith(platformAreaPath(area)));
  if (match) return match;
  return PLATFORM_AREAS.find((area) => area.id === 'overview');
}

export function areasInGroup(group: PlatformGroupId): PlatformArea[] {
  return PLATFORM_AREAS.filter((area) => area.group === group);
}
