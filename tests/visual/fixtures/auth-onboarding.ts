// Sample data for the guest preview harness (tests/visual/guest.tsx): published
// plans, a checkout preview and a trial. The default export keeps the app harness
// contract (tests/visual/app.tsx calls every fixture's default) and mocks nothing there.
import type { PublishedPlan } from '../../../src/services/subscription.service';

const plan = (id: string, name: string, description: string, monthly: number | null, users: number | null, features: string[], extra: Partial<PublishedPlan> = {}): PublishedPlan => ({
  id, productKey: 'trackoja', productName: 'TrackOja', key: id, name, description,
  monthlyPrice: monthly, annualPrice: monthly === null ? null : monthly * 10, currency: 'NGN', billingCycle: 'monthly',
  userLimit: users, storeLimit: 1, features: features.map((label, i) => ({ key: `${id}-${i}`, label })),
  onboardingNote: null, setupFee: null, trialDays: 14, isDefault: id === 'starter', sortOrder: 0, publishedAt: null, effectiveFrom: null,
  monthlyVersionId: monthly === null ? null : `${id}-m`, annualVersionId: monthly === null ? null : `${id}-a`, monthlyVersion: 1, annualVersion: 1,
  monthlySetupFee: 0, annualSetupFee: 0, ...extra,
} as PublishedPlan);

export const plans: PublishedPlan[] = [
  plan('starter', 'Starter', 'For a single owner selling on their own.', 4000, 2, ['Sales recording', 'Products and stock', 'Receipts']),
  plan('standard', 'Standard', 'For a shop with a small team.', 12000, 5, ['Everything in Starter', 'Staff roles', 'Customer credit', 'Reports']),
  plan('premium', 'Premium', 'For busier shops that want hands-on help.', 30000, 10, ['Everything in Standard', 'Expense tracking', 'Priority support'], { onboardingNote: 'We set up your products with you.' }),
  plan('enterprise', 'Enterprise', 'For several branches and custom needs.', null, null, ['Everything in Premium', 'Custom onboarding']),
];

export const preview = { planVersionId: 'standard-m', planName: 'Standard', billingCycle: 'monthly', recurringAmountMinor: 1200000, setupFeeMinor: 0, amountDueMinor: 1200000, currency: 'NGN', billingEmail: 'ada@example.com', nextBillingDate: '2026-11-28' };
export const trial = { planName: 'Standard', trialDays: 14, trialEndsAt: '2026-11-11T00:00:00Z' };

const guestFixtures = { plans, preview, trial };
export { guestFixtures };
export default () => {};
