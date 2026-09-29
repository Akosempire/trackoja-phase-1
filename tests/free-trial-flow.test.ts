// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OnboardingPage from '../src/pages/onboarding/OnboardingPage';

const mocks = vi.hoisted(() => ({ availability: vi.fn(), trial: vi.fn(), checkout: vi.fn(), preview: vi.fn() }));
vi.mock('../src/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'owner' }, refreshProfile: vi.fn() }) }));
vi.mock('../src/components/ui/Toast', () => ({ useToast: () => ({ loading: () => 'toast', update: vi.fn(), error: vi.fn(), dismiss: vi.fn() }) }));
vi.mock('../src/services/subscription.service', () => ({ SubscriptionService: {
  getBillingAvailability: mocks.availability, startTrial: mocks.trial, startPlanCheckout: mocks.checkout,
  getCheckoutPreview: mocks.preview,
  getOnboarding: async () => ({ orgId: 'org', state: 'business_profile_completed' }),
  getPublishedPlans: async () => [{ id: 'starter', name: 'Starter', monthlyPrice: 5000, annualPrice: 50000,
    monthlyVersionId: 'monthly-version', annualVersionId: 'annual-version', userLimit: 2, features: [], currency: 'NGN' }],
} }));

let root: Root;
let host: HTMLDivElement;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  mocks.availability.mockResolvedValue({ paymentSystem: 'DISABLED', trialEnabled: true, trialDays: 21 });
  mocks.preview.mockResolvedValue({ planVersionId: 'monthly-version', planName: 'Starter', billingCycle: 'monthly',
    recurringAmountMinor: 500000, setupFeeMinor: 0, amountDueMinor: 500000, currency: 'NGN' });
  mocks.trial.mockResolvedValue({ planName: 'Starter', trialDays: 21, trialEndsAt: '2026-10-20T00:00:00Z' });
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
async function render() { await act(async () => root.render(createElement(MemoryRouter, {}, createElement(OnboardingPage)))); }
async function click(text: string) {
  const button = Array.from(host.querySelectorAll('button')).find((item) => item.textContent === text);
  expect(button, text).toBeDefined(); await act(async () => button!.click());
}

describe('trial onboarding', () => {
  it.each(['DISABLED', 'TEST'])('starts an explicit trial without checkout in %s mode', async (paymentSystem) => {
    mocks.availability.mockResolvedValue({ paymentSystem, trialEnabled: true, trialDays: 21 });
    await render();
    expect(host.textContent).toContain('21-day free trial');
    await click('Start Free Trial');
    expect(host.querySelector('.billing-preview-total')?.textContent).toContain('₦0');
    await click('Confirm free trial');
    expect(mocks.trial).toHaveBeenCalledWith('monthly-version');
    expect(mocks.checkout).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Your free trial has started');
    expect(host.textContent).toContain('Go to Dashboard');
  });
  it('preserves published prices and payment review when LIVE', async () => {
    mocks.availability.mockResolvedValue({ paymentSystem: 'LIVE', trialEnabled: true, trialDays: 21 });
    await render(); await click('Review billing');
    expect(host.querySelector('.billing-preview-total')?.textContent).toContain('₦5,000');
    expect(host.textContent).toContain('Continue to secure payment');
    expect(mocks.trial).not.toHaveBeenCalled();
  });
  it('offers retry instead of checkout when availability cannot be loaded', async () => {
    mocks.availability.mockRejectedValueOnce(new Error('Plan availability could not be loaded.'));
    await render(); expect(host.textContent).toContain('Retry');
    await click('Retry'); expect(host.textContent).toContain('Start Free Trial');
    expect(mocks.checkout).not.toHaveBeenCalled();
  });
  it('keeps activation failures on the confirmation screen', async () => {
    mocks.trial.mockRejectedValueOnce(new Error('Your trial could not be started. Please try again or contact support.'));
    await render(); await click('Start Free Trial'); await click('Confirm free trial');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Your trial could not be started');
    expect(host.textContent).not.toContain('Your free trial has started');
    expect(mocks.checkout).not.toHaveBeenCalled();
  });
});
