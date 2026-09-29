import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { BusinessCategoryPicker } from '../../components/BusinessCategoryPicker';
import { BusinessCategoryIllustration } from '../../components/BusinessCategoryIllustration';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { PageLoader } from '../../components/ui/PageLoader';
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
          description: 'TrackOja access is active for this business.',
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

  if (!loading && !billing) return <div className="onboarding-shell"><p role="alert">{error ?? 'Plan availability could not be loaded.'}</p><Button onClick={() => setLoadAttempt((value) => value + 1)}>Retry</Button></div>;

  if (loading || step === 'verifying') return <PageLoader />;

  return (
    <div className="onboarding-shell commercial-onboarding">
      <div className="onboarding-progress" aria-label="Onboarding progress">
        {['Business', 'Plan', 'Review', 'Activate'].map((label, index) => (
          <span key={label} className={index <= ({ welcome: 0, category: 0, business: 0, plan: 1, preview: 2, payment: 3, verifying: 3, complete: 3 }[step]) ? 'is-active' : ''}>{label}</span>
        ))}
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      {step === 'welcome' && (
        <section className="onboarding-header">
          <span className="eyebrow">TrackOja</span>
          <h1 className="onboarding-title">Welcome to TrackOja</h1>
          <p className="onboarding-subtitle">Set up your business, choose your plan, and start working. Once your business is created, you can leave and continue later.</p>
          <div className="onboarding-footer"><Button onClick={() => setStep('category')}>Set up my business</Button></div>
        </section>
      )}

      {step === 'category' && (
        <>
          <div className="onboarding-header">
            <h1 className="onboarding-title">What type of business do you run?</h1>
            <p className="onboarding-subtitle">This shapes your TrackOja workspace. It does not choose or activate a paid plan.</p>
          </div>
          <BusinessCategoryPicker value={selectedCategory} onChange={setSelectedCategory} />
          <div className="onboarding-footer"><Button onClick={continueFromCategory} disabled={!selectedCategory}>Continue</Button></div>
        </>
      )}

      {step === 'business' && (
        <>
          <div className="onboarding-header">
            <button type="button" className="onboarding-back" onClick={() => setStep('category')}>Back</button>
            <div className="onboarding-chosen-badge">{chosen && <BusinessCategoryIllustration category={chosen.value} compact />}<span>{chosen?.label}</span></div>
            <h1 className="onboarding-title">Create your business</h1>
            <p className="onboarding-subtitle">Your billing email will appear on checkout, invoices, and receipts.</p>
          </div>
          <form className="card onboarding-form-card" onSubmit={createBusiness}>
            <FormField id="organizationName" label="Business name" value={organizationName} onChange={setOrganizationName} autoComplete="organization" required />
            <FormField id="storeName" label="First store or branch" value={storeName} onChange={setStoreName} required />
            <FormField id="billingEmail" label="Billing email" type="email" value={billingEmail} onChange={setBillingEmail} autoComplete="email" required hint="Used for commercial documents and billing notices." />
            <Button type="submit" loading={busy}>Create business</Button>
          </form>
        </>
      )}

      {step === 'plan' && (
        <>
          <div className="onboarding-header">
            <h1 className="onboarding-title">Choose your TrackOja plan</h1>
            <p className="onboarding-subtitle">{trialFlow ? `Online subscription payments are not available yet. ${billing?.trialEnabled ? `Start with a ${billing.trialDays}-day free trial. No payment is required.` : 'Please contact support for access.'}` : 'Choose the plan that fits your business.'}</p>
          </div>
          <div className="billing-cycle-control" role="group" aria-label="Billing cycle">
            <button type="button" className={cycle === 'monthly' ? 'active' : ''} onClick={() => setCycle('monthly')}>Monthly</button>
            <button type="button" className={cycle === 'annual' ? 'active' : ''} onClick={() => setCycle('annual')}>Annual</button>
          </div>
          <div className="onboarding-plan-grid">
            {plans.map((plan) => {
              const price = cycle === 'monthly' ? plan.monthlyPrice : plan.annualPrice;
              const setup = cycle === 'monthly' ? plan.monthlySetupFee : plan.annualSetupFee;
              return (
                <article className="card onboarding-plan-card" key={plan.id}>
                  <div><h2>{plan.name}</h2><p>{plan.description}</p></div>
                  <p className="onboarding-plan-price">{price === null ? 'Contact sales' : formatMoney(price, plan.currency)}<small>{price === null ? '' : ` / ${cycle === 'monthly' ? 'month' : 'year'}`}</small></p>
                  <dl><div><dt>Users</dt><dd>{formatSeatLimit(plan.userLimit)}</dd></div><div><dt>Setup fee</dt><dd>{setup ? formatMoney(setup, plan.currency) : 'None'}</dd></div>{trialFlow && billing?.trialEnabled && <div><dt>Free trial</dt><dd>{billing.trialDays} days</dd></div>}</dl>
                  <ul>{plan.features.map((feature) => <li key={feature.key}>{feature.label}{feature.upcoming ? ' (coming soon)' : ''}</li>)}</ul>
                  <Button onClick={() => review(plan)} loading={busy && selectedPlan?.id === plan.id} disabled={busy || !versionFor(plan, cycle) || price === null || !billing || (trialFlow && !billing.trialEnabled)}>{trialFlow ? 'Start Free Trial' : 'Review billing'}</Button>
                </article>
              );
            })}
          </div>
        </>
      )}

      {step === 'preview' && preview && (
        <>
          <div className="onboarding-header">
            <button type="button" className="onboarding-back" onClick={() => setStep('plan')}>Back to plans</button>
            <h1 className="onboarding-title">{trialFlow ? 'Confirm your free trial' : 'Review your billing'}</h1>
            <p className="onboarding-subtitle">{trialFlow ? `${billing?.trialDays} days to try your plan. No payment or card required.` : 'Check your plan and total before continuing.'}</p>
          </div>
          <section className="card billing-preview-card">
            <div className="split-head"><div><h2>{preview.planName}</h2><p>{preview.billingCycle}</p></div><span className="badge badge-brand">{preview.currency}</span></div>
            <dl className="billing-preview-lines">
              <div><dt>Subscription</dt><dd>{formatMoney(preview.recurringAmountMinor / 100, preview.currency)}</dd></div>
              <div><dt>Setup fee</dt><dd>{preview.setupFeeMinor ? formatMoney(preview.setupFeeMinor / 100, preview.currency) : 'None'}</dd></div>
              {trialFlow && <div><dt>Free trial</dt><dd>{billing?.trialDays} days</dd></div>}
              <div className="billing-preview-total"><dt>Total due now</dt><dd>{formatMoney(trialFlow ? 0 : preview.amountDueMinor / 100, preview.currency)}</dd></div>
            </dl>
            <p className="page-subtitle">Billing email: {preview.billingEmail ?? 'Not set'}</p>
            {!trialFlow && preview.nextBillingDate && <p className="page-subtitle">Next billing date: {formatDate(preview.nextBillingDate)}</p>}
            <Button onClick={startCheckout} loading={busy}>{trialFlow ? 'Confirm free trial' : 'Continue to secure payment'}</Button>
          </section>
        </>
      )}

      {step === 'payment' && (
        <section className="card billing-preview-card">
          <span className="eyebrow">Payment verification</span>
          <h1 className="onboarding-title">Your setup is saved</h1>
          <p className="onboarding-subtitle">Your business and plan progress are safe. Check the payment again, or return to the plan list to start another checkout.</p>
          {pendingReference && <p className="page-subtitle">Reference: {pendingReference}</p>}
          <div className="toolbar-group">
            <Button onClick={() => void checkPendingPayment()} loading={busy}>Check payment status</Button>
            <Button variant="outline" onClick={() => { setError(null); setStep('plan'); }}>Return to plans</Button>
          </div>
        </section>
      )}

      {step === 'complete' && (
        <section className="card billing-preview-card">
          <span className="eyebrow">Setup complete</span>
          <h1 className="onboarding-title">{trial ? 'Your free trial has started' : 'You’re ready to use TrackOja'}</h1>
          <p className="onboarding-subtitle">{trial ? `You now have access to ${trial.planName} for ${trial.trialDays} days.` : 'Your business is set up and your access is active.'}</p>
          {trial && <p className="page-subtitle">Trial ends {formatDate(trial.trialEndsAt)}</p>}
          <Button onClick={() => void enterTrackOja()} loading={busy}>Go to Dashboard</Button>
        </section>
      )}
    </div>
  );
}
