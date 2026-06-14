// utils/subscription-plan.ts
// Pure helpers for rendering subscription plan feature limits.
// feature_set values of -1 mean "unlimited" (see 030_subscriptions_seed.sql).

import type { SubscriptionFeatureSet } from '../types';

export function formatFeatureLimit(value: number): string {
  return value === -1 ? 'Unlimited' : value.toLocaleString();
}

export function formatFeatureSummary(featureSet: SubscriptionFeatureSet): string {
  return [
    `${formatFeatureLimit(featureSet.stores)} store${featureSet.stores === 1 ? '' : 's'}`,
    `${formatFeatureLimit(featureSet.products)} products`,
    `${formatFeatureLimit(featureSet.customers)} customers`,
    `${formatFeatureLimit(featureSet.team_members)} team members`,
  ].join(' · ');
}
