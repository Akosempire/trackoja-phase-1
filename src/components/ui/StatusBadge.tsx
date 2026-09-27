import { Badge, type BadgeTone } from './Badge';

/**
 * One status vocabulary for the whole platform surface.
 *
 * Every stored token maps to a human label and a WAYA tone here, so screens stop
 * duplicating their own badge maps and a value like `past_due` reads the same in a
 * table, a detail panel and a filter chip.
 */
const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  // Business / subscription lifecycle
  trial: { label: 'Trial', tone: 'info' },
  trialing: { label: 'Trialing', tone: 'info' },
  active: { label: 'Active', tone: 'success' },
  verified: { label: 'Verified', tone: 'success' },
  ok: { label: 'OK', tone: 'success' },
  healthy: { label: 'Healthy', tone: 'success' },
  success: { label: 'Successful', tone: 'success' },
  successful: { label: 'Successful', tone: 'success' },
  paid: { label: 'Paid', tone: 'success' },
  resolved: { label: 'Resolved', tone: 'success' },
  redeemed: { label: 'Redeemed', tone: 'success' },
  processed: { label: 'Processed', tone: 'success' },
  configured: { label: 'Configured', tone: 'info' },

  // Attention
  pending: { label: 'Pending', tone: 'warning' },
  pending_customer: { label: 'Waiting on customer', tone: 'warning' },
  past_due: { label: 'Past due', tone: 'warning' },
  degraded: { label: 'Degraded', tone: 'warning' },
  grace_period: { label: 'Grace period', tone: 'warning' },
  expiring: { label: 'Expiring soon', tone: 'warning' },
  acknowledged: { label: 'Acknowledged', tone: 'warning' },
  attempted: { label: 'Attempted', tone: 'warning' },
  high: { label: 'High', tone: 'warning' },

  // Failure
  failed: { label: 'Failed', tone: 'danger' },
  failing: { label: 'Failing', tone: 'danger' },
  suspended: { label: 'Suspended', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
  canceled: { label: 'Cancelled', tone: 'danger' },
  expired: { label: 'Expired', tone: 'danger' },
  revoked: { label: 'Revoked', tone: 'danger' },
  urgent: { label: 'Urgent', tone: 'danger' },
  error: { label: 'Error', tone: 'danger' },
  open: { label: 'Open', tone: 'danger' },

  // Inert / not yet real
  draft: { label: 'Draft', tone: 'neutral' },
  issued: { label: 'Issued', tone: 'neutral' },
  retired: { label: 'Retired', tone: 'neutral' },
  closed: { label: 'Closed', tone: 'neutral' },
  ignored: { label: 'Ignored', tone: 'neutral' },
  inactive: { label: 'Inactive', tone: 'neutral' },
  unknown: { label: 'Unknown', tone: 'neutral' },
  none: { label: 'None', tone: 'neutral' },
  low: { label: 'Low', tone: 'neutral' },
  normal: { label: 'Normal', tone: 'neutral' },

  // Truthful absences
  not_configured: { label: 'Not configured', tone: 'outline' },
  not_instrumented: { label: 'Not instrumented', tone: 'outline' },
  no_data: { label: 'No data', tone: 'outline' },
  received: { label: 'Received', tone: 'info' },

  // Ticket / feedback categories
  new: { label: 'New', tone: 'brand' },
  bug: { label: 'Bug', tone: 'danger' },
  billing: { label: 'Billing', tone: 'brand' },
  feature_request: { label: 'Feature request', tone: 'info' },
  account: { label: 'Account', tone: 'info' },
  how_to: { label: 'How-to', tone: 'neutral' },
  other: { label: 'Other', tone: 'neutral' },

  // Entitlement source
  activation_key: { label: 'Activation key', tone: 'info' },
  manual: { label: 'Manual', tone: 'info' },
  trial_grant: { label: 'Trial grant', tone: 'info' },
  self_service: { label: 'Self-service', tone: 'info' },

  // Subscription adjustments
  upgrade: { label: 'Upgrade', tone: 'info' },
  downgrade: { label: 'Downgrade', tone: 'warning' },
  renew: { label: 'Renewal', tone: 'info' },
  renewal: { label: 'Renewal', tone: 'info' },
  extend: { label: 'Extended', tone: 'info' },
  cancel: { label: 'Cancellation', tone: 'danger' },
  plan_change: { label: 'Plan change', tone: 'info' },
  user_limit_change: { label: 'Seat change', tone: 'info' },
  manual_grant: { label: 'Manual grant', tone: 'info' },

  // Platform administration levels
  super_admin: { label: 'Platform owner', tone: 'brand' },
  admin: { label: 'Platform admin', tone: 'brand' },
  support: { label: 'Support agent', tone: 'brand' },
  finance_operator: { label: 'Finance operator', tone: 'brand' },
  developer: { label: 'Developer', tone: 'workspace' },

  // Products / plans
  public: { label: 'Public', tone: 'success' },
  private: { label: 'Private', tone: 'neutral' },
  beta: { label: 'Beta', tone: 'info' },
  coming_soon: { label: 'Coming soon', tone: 'neutral' },
};

/** Human label for a stored token, even when it is not in the map. */
export function statusLabel(status: string | null | undefined): string {
  if (!status) return '—';
  const known = STATUS[status.toLowerCase()];
  if (known) return known.label;
  return status
    .replace(/[_-]+/g, ' ')
    .replace(/^\w/, (character) => character.toUpperCase());
}

export function statusTone(status: string | null | undefined): BadgeTone {
  if (!status) return 'neutral';
  return STATUS[status.toLowerCase()]?.tone ?? 'neutral';
}

interface StatusBadgeProps {
  status: string | null | undefined;
  /** Overrides the label while keeping the mapped tone, e.g. "3 days left". */
  label?: string;
  dot?: boolean;
}

export function StatusBadge({ status, label, dot }: StatusBadgeProps) {
  const tone = statusTone(status);
  return (
    <Badge tone={tone} dot={dot}>
      {label ?? statusLabel(status)}
    </Badge>
  );
}
