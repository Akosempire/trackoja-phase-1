// Dashboard metric contract.
//
// A metric in a business experience may only be marked `implemented: true` if the
// dashboard can actually source a number for it. This list is the single source of
// truth for that, and tests/business-experience.test.ts enforces the link in both
// directions, so the model can never claim a card that would render as nothing.
//
// Kept in a plain .ts module (no React, no services) so the test can import it
// without pulling in the component tree.

export const RESOLVABLE_METRIC_KEYS = [
  /** Completed sales revenue for the business-local day. */
  'sales_today',
  /** Count of completed sales today. */
  'transactions_today',
  /** Products at or below their reorder level. */
  'low_stock',
  /** Active products that cannot be sold because none remain. */
  'unavailable_items',
  /** Restaurant fulfilment queue, by preparation state. */
  'open_orders',
  'preparing',
  'ready',
  /** Stock approaching its expiry date. */
  'near_expiry',
  /** Same idea, named for supermarket terminology. */
  'expiring',
  /** Stock already past its expiry date. */
  'expired',
  /** Customer/clients on file. */
  'clients',
  /** Refunds recorded today. */
  'returns',
] as const;

export type ResolvableMetricKey = (typeof RESOLVABLE_METRIC_KEYS)[number];

export function isResolvableMetric(key: string): key is ResolvableMetricKey {
  return (RESOLVABLE_METRIC_KEYS as readonly string[]).includes(key);
}
