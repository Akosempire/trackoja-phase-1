// Guest screen preview harness: renders signed-out and setup screens directly.
// Usage: /tests/visual/guest.html?page=login&theme=dark
// Pages: login signup forgot reset verify callback welcome onboarding landing privacy startup
// Extra: onboarding&state=new|category|org, landing&pricing=failed, reset&ready=false
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../../src/components/ui/Toast';
import { AuthService } from '../../src/services/auth.service';
import { SubscriptionService } from '../../src/services/subscription.service';
import { OrganizationService } from '../../src/services/organization.service';
import LoginPage from '../../src/pages/auth/LoginPage';
import SignUpPage from '../../src/pages/auth/SignUpPage';
import ForgotPasswordPage from '../../src/pages/auth/ForgotPasswordPage';
import ResetPasswordPage from '../../src/pages/auth/ResetPasswordPage';
import VerifyEmailPage from '../../src/pages/auth/VerifyEmailPage';
import AuthCallbackPage from '../../src/pages/auth/AuthCallbackPage';
import WelcomePage from '../../src/pages/WelcomePage';
import OnboardingPage from '../../src/pages/onboarding/OnboardingPage';
import LandingPage from '../../src/pages/landing/LandingPage';
import LegalPlaceholderPage from '../../src/pages/landing/LegalPlaceholderPage';
import { StartupScreen } from '../../src/components/StartupScreen';
import { guestFixtures as fixtures } from './fixtures/auth-onboarding';
import '@fontsource-variable/figtree';
import '../../src/styles/index.css';

const params = new URLSearchParams(location.search);
const define = (target: object, key: string, value: unknown) =>
  Object.defineProperty(target, key, { configurable: true, value: typeof value === 'function' ? value : async () => value });

const plans = fixtures.plans;
const state = params.get('state') ?? 'new';
define(AuthService, 'login', async () => { throw new Error('Invalid login credentials'); });
define(AuthService, 'getSession', params.get('ready') === 'false' ? null : { user: { id: 'u' } });
define(AuthService, 'resendVerification', null);
define(SubscriptionService, 'getPublishedPlans', params.get('pricing') === 'failed' ? async () => { throw new Error('offline'); } : plans);
define(SubscriptionService, 'getBillingAvailability', { paymentSystem: 'DISABLED', trialEnabled: true, trialDays: 14 });
define(SubscriptionService, 'getOnboarding', {
  orgId: state === 'org' ? 'org' : null,
  businessCategory: state === 'category' ? 'supermarket' : null,
  state: state === 'org' ? 'business_profile_completed' : 'started',
});
define(SubscriptionService, 'getCheckoutPreview', fixtures.preview);
define(SubscriptionService, 'startTrial', fixtures.trial);
define(OrganizationService, 'createOnboardingBusiness', null);

const pages: Record<string, [string, ReactElement]> = {
  login: ['/login', <LoginPage />],
  signup: ['/signup', <SignUpPage />],
  forgot: ['/forgot-password', <ForgotPasswordPage />],
  reset: ['/reset-password', <ResetPasswordPage />],
  verify: ['/verify-email?email=ada%40example.com', <VerifyEmailPage />],
  callback: ['/auth/callback', <AuthCallbackPage />],
  welcome: ['/welcome', <WelcomePage />],
  onboarding: ['/onboarding', <OnboardingPage />],
  landing: ['/', <LandingPage />],
  privacy: ['/privacy', <LegalPlaceholderPage title="Privacy notice" summary="How TrackOja handles business and customer information." />],
  startup: ['/startup', <StartupScreen />],
};
const [path, element] = pages[params.get('page') ?? 'login'] ?? pages.login;
const route = path.split('?')[0];

document.documentElement.dataset.theme = params.get('theme') ?? 'light';
try { localStorage.setItem('trackoja-theme', params.get('theme') ?? 'light'); } catch { /* preview only */ }
createRoot(document.getElementById('root')!).render(
  <MemoryRouter initialEntries={[path]}>
    <ToastProvider>
      <Routes>
        <Route path={route} element={element} />
        <Route path="*" element={<p style={{ padding: 24 }}>Navigated away</p>} />
      </Routes>
    </ToastProvider>
  </MemoryRouter>
);
