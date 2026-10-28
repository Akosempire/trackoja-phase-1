import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { BusinessCategoryPicker } from '../../components/BusinessCategoryPicker';
import { BusinessCategoryIllustration } from '../../components/BusinessCategoryIllustration';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { PageLoader } from '../../components/ui/PageLoader';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { BrandLockup } from '../../components/AuthLayout';
import { Card, Pill, cn } from '../../components/kit';
import { APP_MARK, APP_NAME } from '../../config/brand';
import { useToast } from '../../components/ui/Toast';
import { useAuth } from '../../contexts/AuthContext';
import { BUSINESS_CATEGORIES, type BusinessCategory } from '../../config/businessModules';
import { OrganizationService } from '../../services/organization.service';
import {
  SubscriptionService,
  type CheckoutPreview,
  type PublishedPlan,
  type BillingAvailability,
  type TrialActivation,
} from '../../services/subscription.service';
import { formatDate, formatMoney, formatSeatLimit } from '../../utils/format';

type Step = 'welcome' | 'category' | 'business' | 'plan' | 'preview' | 'payment' | 'verifying' | 'complete';
type Cycle = 'monthly' | 'annual';

function versionFor(plan: PublishedPlan, cycle: Cycle) {
  return cycle === 'monthly' ? plan.monthlyVersionId : plan.annualVersionId;
}

function failureMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error) return cause.message;
  if (cause && typeof cause === 'object' && 'message' in cause && typeof cause.message === 'string') {
    return cause.message;
  }
  return fallback;
}

export default function OnboardingPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, refreshProfile } = useAuth();
  const toast = useToast();
  const [step, setStep] = useState<Step>('welcome');
  const [selectedCategory, setSelectedCategory] = useState<BusinessCategory | ''>('');
  const [organizationName, setOrganizationName] = useState('');
  const [storeName, setStoreName] = useState('');
  const [billingEmail, setBillingEmail] = useState(user?.email ?? '');
  const [plans, setPlans] = useState<PublishedPlan[]>([]);
  const [cycle, setCycle] = useState<Cycle>('monthly');
  const [selectedPlan, setSelectedPlan] = useState<PublishedPlan | null>(null);
  const [preview, setPreview] = useState<CheckoutPreview | null>(null);
  const [billing, setBilling] = useState<BillingAvailability | null>(null);
  const [trial, setTrial] = useState<TrialActivation | null>(null);
  const trialFlow = billing?.paymentSystem !== 'LIVE';
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [pendingReference, setPendingReference] = useState<string | null>(null);

  const callbackReference = searchParams.get('reference') ?? searchParams.get('trxref');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    Promise.all([SubscriptionService.getOnboarding(), SubscriptionService.getPublishedPlans(), SubscriptionService.getBillingAvailability()])
      .then(([progress, catalogue, availability]) => {
        if (!alive) return;
        setPlans(catalogue);
        setBilling(availability);
        if (progress.businessCategory && BUSINESS_CATEGORIES.some((item) => item.value === progress.businessCategory)) {
          setSelectedCategory(progress.businessCategory as BusinessCategory);
        }
        if (callbackReference) setStep('verifying');
        else if (availability.paymentSystem === 'LIVE' && progress.state === 'payment_pending' && progress.checkoutReference) {
          setPendingReference(progress.checkoutReference);
          setStep('payment');
        } else if (progress.orgId) setStep('plan');
        else if (progress.businessCategory) setStep('business');
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Onboarding could not be loaded.'))
      .finally(() => setLoading(false));
    return () => { alive = false; };
  }, [callbackReference, loadAttempt]);

  useEffect(() => {
    if (!callbackReference || step !== 'verifying') return;
    const toastId = toast.loading('Verifying your payment…', { dedupeKey: 'onboarding-verification' });
    SubscriptionService.verifyPayment(callbackReference)
      .then(async (result) => {
        if (!result.settled) throw new Error('Payment has not been confirmed yet. Please try again shortly.');
        toast.update(toastId, {
          variant: 'success',
          message: result.testData ? 'Test payment verified' : 'Payment verified',
          description: `${APP_NAME} access is active for this business.`,
        });
        setPendingReference(callbackReference);
        setStep('complete');
      })
      .catch((cause) => {
        const message = cause instanceof Error ? cause.message : 'Payment could not be verified.';
        setError(message);
        setPendingReference(callbackReference);
        setStep('payment');
        toast.update(toastId, { variant: 'error', message: 'Payment not verified', description: message });
      });
  }, [callbackReference, step, navigate, refreshProfile, toast]);

  const chosen = useMemo(
    () => BUSINESS_CATEGORIES.find((item) => item.value === selectedCategory),
    [selectedCategory],
  );

  async function createBusiness(event: FormEvent) {
    event.preventDefault();
    if (!selectedCategory) return;
    setBusy(true);
    setError(null);
    const toastId = toast.loading('Creating your business…', { dedupeKey: 'onboarding-business' });
    try {
      await OrganizationService.createOnboardingBusiness({
        businessName: organizationName,
        storeName,
        businessCategory: selectedCategory,
        billingEmail,
      });
    } catch (cause) {
      const message = failureMessage(cause, 'Business could not be created.');
      setError(message);
      toast.update(toastId, { variant: 'error', message: 'Business was not created', description: message });
      setBusy(false);
      return;
    }

    // The database has already committed. A profile refresh error cannot
    // truthfully be reported as a failed business creation.
    let profileRefreshed = true;
    try {
      await refreshProfile();
    } catch {
      profileRefreshed = false;
    }
    toast.update(toastId, {
      variant: 'success',
      message: 'Business created',
      description: profileRefreshed
        ? 'Now choose a plan for your business.'
        : 'Choose a plan. Your account details will refresh when you next sign in.',
    });
    setStep('plan');
    setBusy(false);
  }

  function continueFromCategory() {
    if (!selectedCategory) return;
    setError(null);
    // The category is saved atomically by create_onboarding_business together
    // with the business profile. No separate RPC is needed at this step.
    setStep('business');
  }

  async function review(plan: PublishedPlan) {
    const planVersionId = versionFor(plan, cycle);
    if (!planVersionId) return;
    setBusy(true);
    setSelectedPlan(plan);
    setError(null);
    try {
      const value = await SubscriptionService.getCheckoutPreview(planVersionId);
      setSelectedPlan(plan);
      setPreview(value);
      setStep('preview');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Billing preview could not be loaded.';
      setError(message);
      toast.error('Billing preview unavailable', { description: message });
    } finally {
      setBusy(false);
    }
  }

  async function startCheckout() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    const toastId = toast.loading(trialFlow ? 'Starting your free trial…' : 'Opening secure checkout…', { dedupeKey: 'onboarding-checkout' });
    try {
      if (trialFlow) {
        setTrial(await SubscriptionService.startTrial(preview.planVersionId));
        toast.update(toastId, { variant: 'success', message: 'Your free trial has started' });
        setStep('complete');
        setBusy(false);
        return;
      }
      const result = await SubscriptionService.startPlanCheckout(
        preview.planVersionId,
        `${window.location.origin}/onboarding`,
      );
      toast.dismiss(toastId);
      window.location.assign(result.authorizationUrl);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Checkout could not be started.';
      setError(message);
      toast.update(toastId, { variant: 'error', message: 'Checkout unavailable', description: message });
      setBusy(false);
    }
  }

  async function checkPendingPayment() {
    if (!pendingReference) return;
    setBusy(true);
    setError(null);
    const toastId = toast.loading('Checking payment…', { dedupeKey: 'onboarding-payment-check' });
    try {
      const result = await SubscriptionService.verifyPayment(pendingReference);
      if (!result.settled) throw new Error('Payment is still awaiting confirmation. Please try again shortly.');
      toast.update(toastId, { variant: 'success', message: 'Payment verified' });
      setStep('complete');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Payment could not be verified.';
      setError(message);
      toast.update(toastId, { variant: 'error', message: 'Payment not verified', description: message });
    } finally { setBusy(false); }
  }

  async function enterTrackOja() {
    setBusy(true);
    try {
      await refreshProfile();
      navigate('/dashboard', { replace: true });
    } catch {
      setError('Your access is saved. We could not open your workspace. Please try again.');
    } finally { setBusy(false); }
  }

  if (!loading && !billing) {
    return (
      <OnboardingShell>
        <div className="mx-auto max-w-[520px]">
          <Card className="text-center">
            <h1 className="m-0 text-xl font-semibold text-ink">We could not load your setup</h1>
            <p role="alert" className="m-0 mt-2 text-sm text-danger">{error ?? 'Plan availability could not be loaded.'}</p>
            <div className="mt-5 flex justify-center"><Button onClick={() => setLoadAttempt((value) => value + 1)}>Retry</Button></div>
          </Card>
        </div>
      </OnboardingShell>
    );
  }

  if (loading || step === 'verifying') return <PageLoader />;

  const currentStep = { welcome: 0, category: 0, business: 0, plan: 1, preview: 2, payment: 3, verifying: 3, complete: 3 }[step];
  const wide = step === 'category' || step === 'plan';

  return (
    <OnboardingShell
      progress={
        <ol className="m-0 flex list-none items-center gap-1.5 p-0 sm:gap-2" aria-label="Onboarding progress">
          {['Business', 'Plan', 'Review', 'Activate'].map((label, index) => {
            const done = index < currentStep;
            const active = index === currentStep;
            return (
              <li key={label} className="flex min-w-0 items-center gap-1.5 sm:gap-2" aria-current={active ? 'step' : undefined}>
                {index > 0 && <span aria-hidden="true" className={cn('h-px w-3 sm:w-6', index <= currentStep ? 'bg-brand' : 'bg-line-strong')} />}
                <span aria-hidden="true" className={cn('inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums',
                  done && 'bg-brand text-white', active && 'bg-brand-soft text-brand-ink ring-1 ring-brand', !done && !active && 'bg-tray text-ink-3')}>{index + 1}</span>
                <span className={cn('text-[13px] font-medium', active ? 'text-ink' : 'hidden text-ink-3 sm:inline')}>{label}</span>
              </li>
            );
          })}
        </ol>
      }
    >
      <div className={cn('mx-auto w-full', step === 'plan' && plans.length >= 4 ? 'max-w-[1160px]' : wide ? 'max-w-[960px]' : 'max-w-[560px]')}>
        {error && <div className="mb-5 rounded-md bg-danger-soft px-3.5 py-2.5 text-[13px] text-danger" role="alert">{error}</div>}

        {step === 'welcome' && (
          <Card className="px-6 py-8 text-center sm:px-10 sm:py-12">
            <span aria-hidden="true" className="mx-auto inline-flex size-14 items-center justify-center rounded-2xl bg-brand text-2xl font-bold text-white">{APP_MARK}</span>
            <p className="m-0 mt-6 text-[13px] font-medium text-ink-3">{APP_NAME}</p>
            <h1 className="m-0 mt-1 text-2xl font-semibold leading-8 tracking-tight text-ink sm:text-[28px] sm:leading-9">Welcome to {APP_NAME}</h1>
            <p className="m-0 mx-auto mt-2 max-w-[420px] text-sm leading-[22px] text-ink-2">Set up your business, choose your plan, and start working. Once your business is created, you can leave and continue later.</p>
            <ul className="m-0 mx-auto mt-6 grid max-w-[420px] list-none gap-2 p-0 text-left sm:grid-cols-3">
              {['Pick your business type', 'Name your first store', 'Choose a plan'].map((item, index) => (
                <li key={item} className="flex items-center gap-2.5 rounded-lg bg-subtle px-3 py-2.5 text-[13px] text-ink-2 sm:flex-col sm:items-start sm:gap-1.5">
                  <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-surface text-xs font-semibold text-ink shadow-card">{index + 1}</span>{item}
                </li>
              ))}
            </ul>
            <div className="mt-8 flex justify-center"><Button className="btn-lg w-full sm:w-auto" onClick={() => setStep('category')}>Set up my business</Button></div>
          </Card>
        )}

        {step === 'category' && (
          <>
            <StepHeader title="What type of business do you run?" subtitle={`This shapes your ${APP_NAME} workspace. It does not choose or activate a paid plan.`} />
            <BusinessCategoryPicker value={selectedCategory} onChange={setSelectedCategory} />
            <div className="sticky bottom-0 z-10 -mx-4 mt-6 border-t border-line bg-canvas/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:backdrop-blur-none">
              <div className="flex items-center justify-between gap-3">
                <p className="m-0 min-w-0 truncate text-[13px] text-ink-2">{chosen ? <>Selected: <span className="font-semibold text-ink">{chosen.label}</span></> : 'Choose one to continue'}</p>
                <Button className="btn-lg shrink-0" onClick={continueFromCategory} disabled={!selectedCategory}>Continue</Button>
              </div>
            </div>
          </>
        )}

        {step === 'business' && (
          <>
            <BackButton onClick={() => setStep('category')}>Back</BackButton>
            <StepHeader
              title="Create your business"
              subtitle="Your billing email will appear on checkout, invoices, and receipts."
              badge={chosen && (
                <span className="mb-3 inline-flex items-center gap-2 rounded-full border border-line bg-surface py-1 pl-1 pr-3 text-[13px] font-medium text-ink shadow-card">
                  <span className="inline-flex size-8 items-center justify-center overflow-hidden rounded-full bg-subtle"><BusinessCategoryIllustration category={chosen.value} compact /></span>
                  <span>{chosen.label}</span>
                </span>
              )}
            />
            <Card>
              <form onSubmit={createBusiness}>
                <FormField id="organizationName" label="Business name" value={organizationName} onChange={setOrganizationName} autoComplete="organization" required />
                <FormField id="storeName" label="First store or branch" value={storeName} onChange={setStoreName} required />
                <FormField id="billingEmail" label="Billing email" type="email" value={billingEmail} onChange={setBillingEmail} autoComplete="email" required hint="Used for commercial documents and billing notices." />
                <Button type="submit" loading={busy} className="btn-lg mt-2 w-full">Create business</Button>
              </form>
            </Card>
          </>
        )}

        {step === 'plan' && (
          <>
            <StepHeader title={`Choose your ${APP_NAME} plan`} subtitle={trialFlow ? `Online subscription payments are not available yet. ${billing?.trialEnabled ? `Start with a ${billing.trialDays}-day free trial. No payment is required.` : 'Please contact support for access.'}` : 'Choose the plan that fits your business.'} />
            <div className="mb-5 flex justify-center">
              <SegmentedControl label="Billing cycle" value={cycle} options={[{ value: 'monthly', label: 'Monthly' }, { value: 'annual', label: 'Annual' }]} onChange={setCycle} />
            </div>
            <div className={cn('grid gap-4 sm:grid-cols-2', plans.length >= 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3')}>
              {plans.map((plan) => {
                const price = cycle === 'monthly' ? plan.monthlyPrice : plan.annualPrice;
                const setup = cycle === 'monthly' ? plan.monthlySetupFee : plan.annualSetupFee;
                return (
                  <Card className="flex flex-col" key={plan.id}>
                    <h2 className="m-0 text-[17px] font-semibold text-ink">{plan.name}</h2>
                    {plan.description && <p className="m-0 mt-1 text-[13px] leading-5 text-ink-2">{plan.description}</p>}
                    <p className="m-0 mt-4 text-[28px] font-semibold leading-9 tracking-tight text-ink tabular-nums">
                      {price === null ? 'Contact sales' : formatMoney(price, plan.currency)}
                      <small className="text-sm font-medium tracking-normal text-ink-3">{price === null ? '' : ` / ${cycle === 'monthly' ? 'month' : 'year'}`}</small>
                    </p>
                    <dl className="m-0 mt-4 divide-y divide-line border-y border-line text-[13px]">
                      <div className="flex justify-between gap-3 py-2"><dt className="text-ink-3">Users</dt><dd className="m-0 font-medium text-ink">{formatSeatLimit(plan.userLimit)}</dd></div>
                      <div className="flex justify-between gap-3 py-2"><dt className="text-ink-3">Setup fee</dt><dd className="m-0 font-medium tabular-nums text-ink">{setup ? formatMoney(setup, plan.currency) : 'None'}</dd></div>
                      {trialFlow && billing?.trialEnabled && <div className="flex justify-between gap-3 py-2"><dt className="text-ink-3">Free trial</dt><dd className="m-0 font-medium text-ink">{billing.trialDays} days</dd></div>}
                    </dl>
                    <ul className="m-0 mt-4 mb-5 flex-1 list-none space-y-2 p-0 text-[13px] text-ink-2">
                      {plan.features.map((feature) => (
                        <li key={feature.key} className="flex gap-2">
                          <svg aria-hidden="true" viewBox="0 0 16 16" className="mt-0.5 size-4 shrink-0 text-success" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 8.5l3 3 6-7" /></svg>
                          <span>{feature.label}{feature.upcoming ? ' (coming soon)' : ''}</span>
                        </li>
                      ))}
                    </ul>
                    <Button variant="outline" className="w-full" onClick={() => review(plan)} loading={busy && selectedPlan?.id === plan.id} disabled={busy || !versionFor(plan, cycle) || price === null || !billing || (trialFlow && !billing.trialEnabled)}>{trialFlow ? 'Start Free Trial' : 'Review billing'}</Button>
                  </Card>
                );
              })}
            </div>
          </>
        )}

        {step === 'preview' && preview && (
          <>
            <BackButton onClick={() => setStep('plan')}>Back to plans</BackButton>
            <StepHeader title={trialFlow ? 'Confirm your free trial' : 'Review your billing'} subtitle={trialFlow ? `${billing?.trialDays} days to try your plan. No payment or card required.` : 'Check your plan and total before continuing.'} />
            <Card>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><h2 className="m-0 text-[17px] font-semibold text-ink">{preview.planName}</h2><p className="m-0 mt-0.5 text-[13px] capitalize text-ink-3">{preview.billingCycle}</p></div>
                <Pill tone="brand">{preview.currency}</Pill>
              </div>
              <dl className="m-0 mt-4 divide-y divide-line text-sm">
                <div className="flex justify-between gap-3 py-3"><dt className="text-ink-2">Subscription</dt><dd className="m-0 font-medium tabular-nums text-ink">{formatMoney(preview.recurringAmountMinor / 100, preview.currency)}</dd></div>
                <div className="flex justify-between gap-3 py-3"><dt className="text-ink-2">Setup fee</dt><dd className="m-0 font-medium tabular-nums text-ink">{preview.setupFeeMinor ? formatMoney(preview.setupFeeMinor / 100, preview.currency) : 'None'}</dd></div>
                {trialFlow && <div className="flex justify-between gap-3 py-3"><dt className="text-ink-2">Free trial</dt><dd className="m-0 font-medium text-ink">{billing?.trialDays} days</dd></div>}
                <div className="billing-preview-total flex justify-between gap-3 py-3 text-base"><dt className="font-semibold text-ink">Total due now</dt><dd className="m-0 font-semibold tabular-nums text-ink">{formatMoney(trialFlow ? 0 : preview.amountDueMinor / 100, preview.currency)}</dd></div>
              </dl>
              <div className="mt-2 flex flex-col gap-1 rounded-lg bg-subtle px-3.5 py-3 text-[13px] text-ink-2">
                <p className="m-0">Billing email: {preview.billingEmail ?? 'Not set'}</p>
                {!trialFlow && preview.nextBillingDate && <p className="m-0">Next billing date: {formatDate(preview.nextBillingDate)}</p>}
              </div>
              <Button onClick={startCheckout} loading={busy} className="btn-lg mt-5 w-full">{trialFlow ? 'Confirm free trial' : 'Continue to secure payment'}</Button>
            </Card>
          </>
        )}

        {step === 'payment' && (
          <Card className="sm:p-8">
            <Pill tone="warn">Payment verification</Pill>
            <h1 className="m-0 mt-3 text-2xl font-semibold leading-8 tracking-tight text-ink">Your setup is saved</h1>
            <p className="m-0 mt-2 text-sm leading-[22px] text-ink-2">Your business and plan progress are safe. Check the payment again, or return to the plan list to start another checkout.</p>
            {pendingReference && <p className="m-0 mt-4 break-all rounded-lg bg-subtle px-3.5 py-2.5 text-[13px] text-ink-2">Reference: <span className="font-mono text-ink">{pendingReference}</span></p>}
            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <Button onClick={() => void checkPendingPayment()} loading={busy}>Check payment status</Button>
              <Button variant="outline" onClick={() => { setError(null); setStep('plan'); }}>Return to plans</Button>
            </div>
          </Card>
        )}

        {step === 'complete' && (
          <Card className="px-6 py-8 text-center sm:px-10 sm:py-12">
            <span aria-hidden="true" className="mx-auto inline-flex size-14 items-center justify-center rounded-full bg-success-soft text-success">
              <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
            </span>
            <p className="m-0 mt-5 text-[13px] font-medium text-ink-3">Setup complete</p>
            <h1 className="m-0 mt-1 text-2xl font-semibold leading-8 tracking-tight text-ink">{trial ? 'Your free trial has started' : <>You’re ready to use {APP_NAME}</>}</h1>
            <p className="m-0 mx-auto mt-2 max-w-[400px] text-sm leading-[22px] text-ink-2">{trial ? `You now have access to ${trial.planName} for ${trial.trialDays} days.` : 'Your business is set up and your access is active.'}</p>
            {trial && <p className="m-0 mt-1 text-[13px] text-ink-3">Trial ends {formatDate(trial.trialEndsAt)}</p>}
            <div className="mt-8 flex justify-center"><Button onClick={() => void enterTrackOja()} loading={busy} className="btn-lg w-full sm:w-auto">Go to Dashboard</Button></div>
          </Card>
        )}
      </div>
    </OnboardingShell>
  );
}

function OnboardingShell({ children, progress }: { children: ReactNode; progress?: ReactNode }) {
  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-16 max-w-[960px] items-center justify-between gap-4 px-4 sm:px-6">
          <BrandLockup size="sm" className="shrink-0" />
          {progress}
        </div>
      </header>
      <main className="px-4 pb-16 pt-6 sm:px-6 sm:pt-10">{children}</main>
    </div>
  );
}

function StepHeader({ title, subtitle, badge }: { title: ReactNode; subtitle?: ReactNode; badge?: ReactNode }) {
  return (
    <div className="mb-6 text-center">
      {badge}
      <h1 className="m-0 text-2xl font-semibold leading-8 tracking-tight text-ink sm:text-[28px] sm:leading-9">{title}</h1>
      {subtitle && <p className="m-0 mx-auto mt-2 max-w-[560px] text-sm leading-[22px] text-ink-2">{subtitle}</p>}
    </div>
  );
}

function BackButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="-ml-2 mb-3 inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-ink-2 hover:bg-hover hover:text-ink">
      <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 3.5L5.5 8l4.5 4.5" /></svg>
      {children}
    </button>
  );
}
