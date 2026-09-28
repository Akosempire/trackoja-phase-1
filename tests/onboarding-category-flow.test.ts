// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { act, createElement } from 'react';
import OnboardingPage from '../src/pages/onboarding/OnboardingPage';

const mocks = vi.hoisted(() => ({
  getOnboarding: vi.fn(),
  getPublishedPlans: vi.fn(),
  createBusiness: vi.fn(),
  refreshProfile: vi.fn(),
}));

vi.mock('../src/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'test-user', email: 'owner@example.com' }, refreshProfile: mocks.refreshProfile }),
}));
vi.mock('../src/components/ui/Toast', () => ({
  useToast: () => ({ loading: () => 'toast-1', update: vi.fn(), error: vi.fn(), dismiss: vi.fn() }),
}));
vi.mock('../src/services/subscription.service', () => ({
  SubscriptionService: { getOnboarding: mocks.getOnboarding, getPublishedPlans: mocks.getPublishedPlans },
}));
vi.mock('../src/services/organization.service', () => ({
  OrganizationService: { createOnboardingBusiness: mocks.createBusiness },
}));
vi.mock('../src/components/BusinessCategoryPicker', () => ({
  BusinessCategoryPicker: ({ onChange }: { onChange: (category: string) => void }) =>
    createElement('button', { type: 'button', onClick: () => onChange('restaurant') }, 'Restaurant / Food Vendor'),
}));
vi.mock('../src/components/BusinessCategoryIllustration', () => ({
  BusinessCategoryIllustration: () => null,
}));

let root: Root | null = null;
let host: HTMLDivElement | null = null;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.clearAllMocks();
});

describe('new business category selection', () => {
  it('moves to business creation without a category-save request', async () => {
    mocks.getOnboarding.mockResolvedValue({ state: 'account_ready', orgId: null, businessCategory: null });
    mocks.getPublishedPlans.mockResolvedValue([]);
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(createElement(MemoryRouter, {
        initialEntries: ['/onboarding'],
        future: { v7_startTransition: true, v7_relativeSplatPath: true },
      }, createElement(OnboardingPage)));
    });
    const click = async (label: string) => {
      const button = Array.from(host?.querySelectorAll('button') ?? []).find((item) => item.textContent?.includes(label));
      expect(button, `${label} button`).toBeDefined();
      await act(async () => button?.click());
    };

    await click('Set up my business');
    await click('Restaurant / Food Vendor');
    await click('Continue');

    expect(host.querySelector('#organizationName')).not.toBeNull();
    expect(host.textContent).toContain('Create your business');
    const enter = async (id: string, value: string) => {
      const input = host?.querySelector<HTMLInputElement>(`#${id}`);
      expect(input).not.toBeNull();
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
        input?.dispatchEvent(new Event('input', { bubbles: true }));
      });
    };
    await enter('organizationName', 'Ada Kitchen');
    await enter('storeName', 'Main branch');
    await act(async () => {
      host?.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(mocks.createBusiness).toHaveBeenCalledWith(expect.objectContaining({
      businessName: 'Ada Kitchen', storeName: 'Main branch', businessCategory: 'restaurant',
    }));
  });
});
