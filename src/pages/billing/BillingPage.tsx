import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Link, useSearchParams } from 'react-router-dom';
import { useBillingAvailability } from '../../hooks/useBillingAvailability';
import { OrganizationService } from '../../services/organization.service';
import {
  SubscriptionService,
  type MyEntitlement,
  type PublishedPlan,
  type CheckoutPreview,
  type BillingDocument,
} from '../../services/subscription.service';
import { Button } from '../../components/ui/Button';
import { PageLoader } from '../../components/ui/PageLoader';
import { Badge } from '../../components/ui/Badge';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Disclosure } from '../../components/ui/Disclosure';
import type { MeterItem } from '../../components/ui/MeterList';
import { StateBlock } from '../../components/ui/StateBlock';
import { useToast } from '../../components/ui/Toast';
import { Dialog } from '../../components/ui/Dialog';
import { FormField } from '../../components/ui/FormField';
import { Card, CardHead, Page, PageHeader, btn, cn } from '../../components/kit';
import { CheckIcon } from '../../components/icons';
import { formatDate, formatMoney, formatMoneyMinor, formatNumber, formatRelative, formatSeatLimit } from '../../utils/format';
import type { SubscriptionTransaction } from '../../types';

type BillingCycle = 'monthly' | 'annual';

/**
 * The customer's Billing page.
 *
 * Hierarchy is deliberate, because the previous version was three unrelated
 * cards: status and the one action that matters, then what this plan actually
 * includes with real usage, then the published plans to compare, then payments.
 *
 * Every plan and price on this page comes from `list_published_plans` — the same
 * published catalogue the public pricing page reads and the platform console
 * edits. The page previously read the legacy `subscription_plans` table, which
 * held only Starter, so the customer could never buy the Standard or Premium
 * tiers the rest of the product advertised.
 */
export default function BillingPage() {
  const { user, profile, refreshEntry } = useAuth();
  const { billing, error: billingError, reload: reloadBilling } = useBillingAvailability();
  const trialFlow = billing?.paymentSystem !== 'LIVE';
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const orgId = profile?.currentOrgId;
  const compareRef = useRef<HTMLElement>(null);

  const [entitlement, setEntitlement] = useState<MyEntitlement | null>(null);
  const [organizationOwnerId, setOrganizationOwnerId] = useState<string | null>(null);
  const [billingEmail, setBillingEmail] = useState('');
  const [savingBillingEmail, setSavingBillingEmail] = useState(false);
  const [plans, setPlans] = useState<PublishedPlan[]>([]);
  const [transactions, setTransactions] = useState<SubscriptionTransaction[]>([]);
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkoutPlanId, setCheckoutPlanId] = useState<string | null>(null);
  const [checkoutPreview, setCheckoutPreview] = useState<CheckoutPreview | null>(null);
  const [documents, setDocuments] = useState<BillingDocument[]>([]);
  const [catalogueProblem, setCatalogueProblem] = useState<string | null>(null);

  // Checkout is owner-only server-side; this only decides whether to offer it.
  const isOwner = !!user && !!organizationOwnerId && organizationOwnerId === user.id;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    // The catalogue is not permission-bound the way the entitlement is: if the
    // business has no plan yet, the page must still be able to offer one.
    const [ent, org, catalogue, txns, docs] = await Promise.allSettled([
      SubscriptionService.getMyEntitlement(),
      orgId ? OrganizationService.getOrganization(orgId) : Promise.resolve(null),
      SubscriptionService.getPublishedPlans(),
      orgId ? SubscriptionService.getTransactions(orgId) : Promise.resolve([]),
      orgId ? SubscriptionService.getBillingDocuments() : Promise.resolve([]),
    ]);

    if (ent.status === 'fulfilled') setEntitlement(ent.value);
    else setError(ent.reason instanceof Error ? ent.reason.message : 'Could not load your subscription.');

    if (org.status === 'fulfilled' && org.value) {
      setOrganizationOwnerId(org.value.ownerId);
      setBillingEmail(org.value.billingEmail ?? '');
    }

    if (catalogue.status === 'fulfilled') {
      setPlans(catalogue.value);
      setCatalogueProblem(null);
    } else {
      setCatalogueProblem(
        catalogue.reason instanceof Error ? catalogue.reason.message : 'The plan catalogue could not be loaded.',
      );
    }

    if (txns.status === 'fulfilled') setTransactions(txns.value);
    if (docs.status === 'fulfilled') setDocuments(docs.value);
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const reference = searchParams.get('reference') ?? searchParams.get('trxref');
    if (!reference) return;
    const toastId = toast.loading('Verifying payment…', { dedupeKey: 'billing-verification' });
    SubscriptionService.verifyPayment(reference)
      .then((result) => {
        if (!result.settled) throw new Error('Payment has not been confirmed yet. Please try again shortly.');
        toast.update(toastId, { variant: 'success', message: result.testData ? 'Test payment verified' : 'Payment verified' });
        setSearchParams({}, { replace: true });
        void load();
      })
      .catch((cause) => toast.update(toastId, { variant: 'error', message: 'Payment not verified', description: cause instanceof Error ? cause.message : 'Try again later.' }));
  }, [searchParams, setSearchParams, load, toast]);

  const state = useMemo(() => {
    if (!entitlement) {
      return {
        headline: 'No plan yet',
        detail: 'Choose a plan to activate TrackOja for this business.',
        tone: 'warning' as const,
        action: 'Choose a plan',
        nextDate: null as string | null,
        nextDateLabel: null as string | null,
      };
    }

    const { status, trialEndsAt, expiresAt, daysRemaining } = entitlement;
    const date = status === 'trialing' ? trialEndsAt : expiresAt;
    const lapsed = daysRemaining !== null && daysRemaining < 0;

    if (status === 'trialing') return {
      headline: lapsed ? (trialFlow ? 'Trial access extended' : 'Trial ended') : 'Free trial',
      detail: lapsed && trialFlow ? 'You can keep working while online payments are unavailable.' : `${entitlement.planName ?? 'TrackOja'} trial`,
      tone: lapsed && !trialFlow ? 'warning' as const : 'success' as const,
      action: 'View plans', nextDate: trialEndsAt, nextDateLabel: 'Trial ends',
    };

    if (status === 'past_due' || status === 'suspended' || lapsed) {
      return {
        headline: 'Payment needed',
        detail:
          status === 'suspended'
            ? 'Access is suspended until the subscription is settled.'
            : lapsed
              ? 'This subscription has passed its end date.'
              : 'The last payment did not complete.',
        tone: 'danger' as const,
        action: 'Fix payment',
        nextDate: date,
        nextDateLabel: lapsed ? 'Ended' : 'Due',
      };
    }

    if (status === 'pending') {
      return {
        headline: 'Payment pending',
        detail: entitlement.planName ? `${entitlement.planName} is awaiting verified payment.` : 'Awaiting verified payment.',
        tone: 'warning' as const,
        action: 'Choose a plan',
        nextDate: date,
        nextDateLabel: null,
      };
    }

    if (status === 'cancelled' || status === 'expired') {
      return {
        headline: 'Subscription ended',
        detail: 'Reactivate to restore access.',
        tone: 'danger' as const,
        action: 'Choose a plan',
        nextDate: null,
        nextDateLabel: null,
      };
    }

    return {
      headline: 'Active',
      detail: entitlement.planName ?? 'Subscribed',
      tone: 'success' as const,
      action: daysRemaining !== null && daysRemaining <= 30 ? 'Renew' : 'Change plan',
      nextDate: date,
      nextDateLabel: date ? 'Renews' : null,
    };
  }, [entitlement, trialFlow]);

  const usage = useMemo<MeterItem[]>(() => {
    if (!entitlement) return [];

    /*
     * A bar only means something when there is a ceiling. `user_limit` is -1 for
     * unlimited and NULL for a bespoke deal, and in both cases drawing a bar
     * would imply a limit that does not exist — worse, filling it to 100% would
     * read as "at capacity". With no ceiling the row shows the count alone.
     *
     * The two limits read differently when unset: a NULL user limit is a
     * negotiated seat count, whereas no plan defines a store limit at all, so
     * calling that "agreed per deal" would imply a bargain that was never struck.
     */
    function usageItem(
      label: string,
      used: number,
      limit: number | null,
      unsetLabel: string,
    ): MeterItem {
      const ceiling = limit !== null && limit > 0 ? limit : null;
      return {
        label,
        value: used,
        display: ceiling
          ? `${formatNumber(used)} of ${formatNumber(ceiling)}`
          : limit === -1
            ? `${formatNumber(used)} · unlimited`
            : `${formatNumber(used)} · ${unsetLabel}`,
        max: ceiling ?? 0,
        warnAt: 0.8,
        dangerAt: 1,
        tone: ceiling === null ? 'muted' : undefined,
      };
    }

    return [
      usageItem('Users', entitlement.seatsUsed, entitlement.agreedUserLimit, 'agreed per deal'),
      usageItem('Stores', entitlement.storesUsed, entitlement.agreedStoreLimit, 'no plan limit'),
    ];
  }, [entitlement]);

  const currentPlanId = entitlement?.planId ?? null;
  const currentPlan = plans.find((plan) => plan.id === currentPlanId) ?? null;
  const featureList = currentPlan?.features ?? [];

  function priceFor(plan: PublishedPlan, which: BillingCycle): number | null {
    return which === 'monthly' ? plan.monthlyPrice : plan.annualPrice;
  }

  async function handleCheckout(plan: PublishedPlan) {
    setError(null);
    setCheckoutPlanId(plan.id);
    try {
      if (!isOwner) throw new Error('Only the business owner can change the subscription.');
      const versionId = cycle === 'monthly' ? plan.monthlyVersionId : plan.annualVersionId;
      if (!versionId) throw new Error(`No published ${cycle} version exists for this plan.`);
      setCheckoutPreview(await SubscriptionService.getCheckoutPreview(versionId));
      setCheckoutPlanId(null);
    } catch (cause) {
      const message = cause && typeof cause === 'object' && 'message' in cause
        ? String((cause as { message: unknown }).message)
        : 'Could not start checkout.';
      toast.error(message);
      setCheckoutPlanId(null);
    }
  }

  async function confirmCheckout() {
    if (!checkoutPreview) return;
    const planId = checkoutPreview.planId;
    setCheckoutPlanId(planId);
    const toastId = toast.loading(trialFlow ? 'Starting your free trial…' : 'Opening secure checkout…', { dedupeKey: 'billing-checkout' });
    try {
      if (trialFlow) {
        const trial = await SubscriptionService.startTrial(checkoutPreview.planVersionId);
        setCheckoutPreview(null);
        setCheckoutPlanId(null);
        toast.update(toastId, { variant: 'success', message: 'Your free trial has started', description: `${trial.planName} · ends ${formatDate(trial.trialEndsAt)}` });
        await load();
        await refreshEntry();
        return;
      }
      const { authorizationUrl } = await SubscriptionService.startPlanCheckout(
        checkoutPreview.planVersionId,
        `${window.location.origin}/billing`,
      );
      toast.dismiss(toastId);
      window.location.assign(authorizationUrl);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not start checkout.';
      toast.update(toastId, { variant: 'error', message: 'Checkout unavailable', description: message });
      setCheckoutPlanId(null);
    }
  }

  function scrollToPlans() {
    compareRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function saveBillingEmail() {
    if (!orgId || !billingEmail.trim()) return;
    setSavingBillingEmail(true);
    const toastId = toast.loading('Saving billing email…');
    try {
      await OrganizationService.updateOrganization(orgId, { billingEmail: billingEmail.trim() });
      toast.update(toastId, { variant: 'success', message: 'Billing email saved' });
    } catch (cause) {
      toast.update(toastId, { variant: 'error', message: 'Could not save billing email', description: cause instanceof Error ? cause.message : 'Try again.' });
    } finally {
      setSavingBillingEmail(false);
    }
  }

  if (loading) return <PageLoader />;

  const featureItem = (feature: PublishedPlan['features'][number]) => (
    <li key={feature.key} className="flex items-start gap-2.5 text-sm text-ink">
      <span className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-success-soft text-success-ink" aria-hidden="true">
        <CheckIcon width={11} height={11} />
      </span>
      <span className="min-w-0">
        {feature.label}
        {feature.upcoming && <> <Badge tone="outline">soon</Badge></>}
      </span>
    </li>
  );
  const listHead = (id: string, title: string) => (
    <h2 id={id} className="m-0 px-4 pb-3 pt-4 text-[15px] font-semibold text-ink sm:px-5">{title}</h2>
  );
  const previewRow = 'flex items-baseline justify-between gap-4 py-2.5';

  return (
    <Page>
      <PageHeader title="Billing" subtitle="Your TrackOja plan, payments and invoices" />

      {error && <div className="mb-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">{error}</div>}

      <div className="flex flex-col gap-4 lg:gap-6">
        {billingError && <Card><StateBlock variant="error" title="Plan availability could not be loaded" body={billingError} actions={<Button variant="outline" className="btn-sm" onClick={reloadBilling}>Retry</Button>} /></Card>}
        {billing && trialFlow && (
          <section className="flex flex-col gap-3 rounded-xl bg-brand-soft p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5" aria-labelledby="payments-soon-title">
            <div className="min-w-0">
              <h2 id="payments-soon-title" className="m-0 text-[15px] font-semibold text-brand-ink">Payments & subscriptions are coming soon</h2>
              <p className="m-0 mt-0.5 text-sm text-ink-2">{entitlement?.status === 'trialing' ? 'Your trial is active. Keep working while online payments are unavailable.' : billing.trialEnabled ? `Start a ${billing.trialDays}-day free trial. No card or payment is required.` : 'Online payments are unavailable. Contact support for access.'}</p>
            </div>
            {entitlement?.status === 'trialing' && <Link className={cn(btn('outline'), 'shrink-0 self-start sm:self-auto')} to="/dashboard">Go to dashboard</Link>}
          </section>
        )}

        {/* ── Status, the one action that matters, and what the plan includes ── */}
        <Card padded={false} className="overflow-hidden">
          <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="m-0 text-[13px] font-medium text-ink-3">Current plan</p>
              <p className="m-0 mt-1 flex flex-wrap items-center gap-2 text-2xl font-semibold leading-8 tracking-tight text-ink">
                {entitlement?.planName ?? 'No plan'} <StatusBadge status={entitlement?.status ?? 'none'} />
              </p>
              <p className="m-0 mt-1 text-sm text-ink-2">
                {state.detail}
                {state.nextDate && state.nextDateLabel
                  ? ` · ${state.nextDateLabel} ${formatDate(state.nextDate)} (${formatRelative(state.nextDate)})`
                  : ''}
                {entitlement?.billingCycle ? ` · billed ${entitlement.billingCycle}` : ''}
              </p>
            </div>
            {isOwner && <Button className="shrink-0" variant={state.tone === 'danger' ? 'danger' : 'primary'} onClick={scrollToPlans}>
              {state.action}
            </Button>}
          </div>

          <section className="border-t border-line bg-subtle/60 p-5" aria-labelledby="plan-includes-title">
            <h2 id="plan-includes-title" className="m-0 mb-4 text-[15px] font-semibold text-ink">What your plan includes</h2>
            {entitlement ? (
              <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-10">
                <ul className="m-0 flex list-none flex-col gap-4 p-0" aria-label="Usage">
                  {usage.map((item) => {
                    const ceiling = item.max && item.max > 0 ? item.max : null;
                    const ratio = ceiling ? item.value / ceiling : 0;
                    const tone = item.tone === 'muted' || !ceiling ? 'bg-ink-3'
                      : item.dangerAt !== undefined && ratio >= item.dangerAt ? 'bg-danger'
                        : item.warnAt !== undefined && ratio >= item.warnAt ? 'bg-warn' : 'bg-brand';
                    return (
                      <li key={item.label}>
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-sm font-medium text-ink">{item.label}</span>
                          <span className="text-[13px] tabular-nums text-ink-2">{item.display}</span>
                        </div>
                        {ceiling && (
                          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-tray" aria-hidden="true">
                            <span className={cn('block h-full rounded-full', tone)} style={{ width: `${Math.max(2, Math.min(100, ratio * 100))}%` }} />
                          </div>
                        )}
                      </li>
                    );
                  })}
                  {entitlement.agreedMonthlyPrice !== null && (
                    <li className="text-[13px] text-ink-3">
                      {formatMoney(entitlement.agreedMonthlyPrice)} per month, agreed when this subscription was activated.
                    </li>
                  )}
                </ul>
                {featureList.length > 0 ? (
                  <div className="min-w-0">
                    <ul className="m-0 grid list-none gap-2.5 p-0 sm:grid-cols-2">
                      {featureList.slice(0, 6).map(featureItem)}
                    </ul>
                    {featureList.length > 6 && (
                      <div className="mt-4">
                        <Disclosure summary={`All ${featureList.length} features`}>
                          <ul className="m-0 grid list-none gap-2.5 p-0 sm:grid-cols-2">
                            {featureList.slice(6).map(featureItem)}
                          </ul>
                        </Disclosure>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="m-0 text-sm text-ink-3">This plan lists no individual features.</p>
                )}
              </div>
            ) : (
              <StateBlock
                variant="empty"
                title="No plan on this business"
                body={isOwner ? 'Choose a plan below to switch TrackOja on.' : 'The business owner needs to activate or restore the subscription.'}
              />
            )}
          </section>
        </Card>

        {/* ── Compare published plans ──────────────────────────────── */}
        {isOwner ? <section ref={compareRef} className="scroll-mt-20" aria-labelledby="plans-title">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="plans-title" className="m-0 text-lg font-semibold text-ink">Plans</h2>
              <p className="m-0 text-[13px] text-ink-3">Prices in naira. Change or cancel any time.</p>
            </div>
            <div className="inline-flex rounded-lg bg-tray p-1" role="group" aria-label="Billing cycle">
              <button
                type="button"
                className={cn('h-8 rounded-md px-3.5 text-[13px] font-medium transition-colors', cycle === 'monthly' ? 'bg-surface text-ink shadow-card' : 'text-ink-2 hover:text-ink')}
                aria-pressed={cycle === 'monthly'}
                onClick={() => setCycle('monthly')}
              >
                Monthly
              </button>
              <button
                type="button"
                className={cn('h-8 rounded-md px-3.5 text-[13px] font-medium transition-colors', cycle === 'annual' ? 'bg-surface text-ink shadow-card' : 'text-ink-2 hover:text-ink')}
                aria-pressed={cycle === 'annual'}
                onClick={() => setCycle('annual')}
              >
                Annual
              </button>
            </div>
          </div>

          {catalogueProblem ? (
            <Card>
              <StateBlock
                variant="error"
                title="Could not load the plans"
                body={catalogueProblem}
                actions={
                  <Button variant="outline" className="btn-sm" onClick={load}>
                    Try again
                  </Button>
                }
              />
            </Card>
          ) : plans.length === 0 ? (
            <Card>
              <StateBlock
                variant="unavailable"
                title="No published plans"
                body="Nothing is published for sale yet."
              />
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 lg:gap-4">
              {plans.map((plan) => {
                const isCurrent = plan.id === currentPlanId && entitlement?.status !== 'pending';
                const price = priceFor(plan, cycle);
                const otherCycle = priceFor(plan, cycle === 'monthly' ? 'annual' : 'monthly');
                const saving =
                  cycle === 'annual' && plan.monthlyPrice && plan.annualPrice
                    ? plan.monthlyPrice * 12 - plan.annualPrice
                    : 0;

                return (
                  <article
                    className={cn('flex min-w-0 flex-col rounded-xl border bg-surface p-5 shadow-card',
                      isCurrent ? 'border-brand ring-1 ring-brand' : 'border-line')}
                    key={plan.id}
                    aria-label={plan.name}
                  >
                    <div className="flex min-h-6 items-center justify-between gap-2">
                      <h3 className="m-0 text-[15px] font-semibold text-ink">{plan.name}</h3>
                      {isCurrent && <Badge tone="brand">Current</Badge>}
                      {plan.isDefault && !isCurrent && <Badge tone="neutral">Most chosen</Badge>}
                    </div>

                    <p className="m-0 mt-3 flex items-baseline gap-1">
                      {price === null ? (
                        <span className="text-[26px] font-semibold leading-8 tracking-tight text-ink-2">Custom</span>
                      ) : (
                        <>
                          <span className="text-[26px] font-semibold leading-8 tracking-tight tabular-nums text-ink">{formatMoney(price)}</span>
                          <span className="text-[13px] text-ink-3">/{cycle === 'monthly' ? 'month' : 'year'}</span>
                        </>
                      )}
                    </p>

                    <div className="mb-5 mt-2 flex flex-1 flex-col gap-1 text-[13px] leading-5 text-ink-2">
                      {price === null ? (
                        <p className="m-0">{plan.onboardingNote ?? 'Priced per implementation.'}</p>
                      ) : (
                        <p className="m-0">
                          {formatSeatLimit(plan.userLimit)} included
                          {saving > 0 && <> · <span className="font-medium text-success-ink">saves {formatMoney(saving)} a year</span></>}
                          {otherCycle !== null && cycle === 'monthly' && plan.annualPrice !== null && (
                            <> · {formatMoney(plan.annualPrice)} a year</>
                          )}
                        </p>
                      )}

                      <p className="m-0 text-ink-3">
                        Setup fee: {((cycle === 'monthly' ? plan.monthlySetupFee : plan.annualSetupFee) || 0) > 0
                          ? formatMoney(cycle === 'monthly' ? plan.monthlySetupFee : plan.annualSetupFee, plan.currency)
                          : 'none'}{trialFlow && billing?.trialEnabled ? ` · ${billing.trialDays}-day free trial` : ''}
                      </p>
                    </div>

                    {isCurrent ? (
                      <Button variant="ghost" className="w-full" disabled>
                        Your plan
                      </Button>
                    ) : price === null ? (
                      <a className={cn(btn('outline'), 'w-full')} href={`mailto:${CONTACT_FALLBACK}?subject=TrackOja%20${encodeURIComponent(plan.name)}`}>
                        Talk to us
                      </a>
                    ) : (
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => handleCheckout(plan)}
                        loading={checkoutPlanId === plan.id}
                        disabled={!isOwner || !billing || (trialFlow && (!billing.trialEnabled || (entitlement !== null && entitlement.status !== 'pending')))}
                      >
                        {trialFlow ? 'Start Free Trial' : entitlement ? 'Switch to this plan' : 'Choose this plan'}
                      </Button>
                    )}
                  </article>
                );
              })}
            </div>
          )}

        </section> : <Card><StateBlock variant="unavailable"
          title="The business owner manages billing"
          body="Your membership is recognized. Ask the business owner to activate or restore TrackOja access; you do not need to create another business." /></Card>}

        <div className="grid items-start gap-4 lg:grid-cols-2 lg:gap-6">
          {/* ── Invoices and receipts ──────────────────────────────── */}
          <Card padded={false} className="overflow-hidden" aria-labelledby="documents-title">
            {listHead('documents-title', 'Invoices and receipts')}
            {documents.length === 0 ? <p className="m-0 px-4 pb-5 text-sm text-ink-3 sm:px-5">No commercial documents issued yet.</p> : (
              <ul className="m-0 list-none divide-y divide-line border-t border-line p-0">
                {documents.map((document) => (
                  <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-5" key={document.invoiceId}>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-mono text-[13px] font-medium text-ink">{document.invoiceNumber}</span>
                        <StatusBadge status={document.status} />
                        {document.isTestData && <Badge tone="warning">Test payment</Badge>}
                      </div>
                      <p className="m-0 mt-1 text-xs text-ink-3">
                        {document.planName} · {document.billingCycle} · <span className="font-medium tabular-nums text-ink-2">{formatMoneyMinor(document.totalMinor, document.currency)}</span>
                        {document.receiptNumber ? ` · receipt ${document.receiptNumber}` : ''}
                      </p>
                      <p className="m-0 mt-0.5 truncate text-xs text-ink-3">Issued {formatDate(document.issuedAt)} · {document.billingEmail ?? 'No billing email recorded'}</p>
                    </div>
                    {/* The document itself, rendered from its stored rows and printed
                        from the browser: the list can only say that it exists. */}
                    <Link
                      className={cn(btn('outline', 'sm'), 'shrink-0 self-start sm:self-auto')}
                      to={`/billing/documents/${encodeURIComponent(document.invoiceNumber)}`}
                    >
                      View or print
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <div className="flex min-w-0 flex-col gap-4 lg:gap-6">
            {/* ── Payments ─────────────────────────────────────────────── */}
            <Card padded={false} className="overflow-hidden" aria-labelledby="payments-title">
              {listHead('payments-title', 'Payments')}
              {transactions.length === 0 ? (
                <p className="m-0 px-4 pb-5 text-sm text-ink-3 sm:px-5">No payments recorded.</p>
              ) : (
                <ul className="m-0 list-none divide-y divide-line border-t border-line p-0">
                  {transactions.slice(0, 8).map((txn) => (
                    <li className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5" key={txn.id}>
                      <div className="min-w-0">
                        <p className="m-0 text-sm font-semibold tabular-nums text-ink">{formatMoney(txn.amount, txn.currency ?? 'NGN')}</p>
                        <p className="m-0 mt-0.5 truncate text-xs text-ink-3">
                          {formatDate(txn.createdAt)} · <span className="font-mono">{txn.reference}</span>
                        </p>
                      </div>
                      <StatusBadge status={txn.status} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <form aria-labelledby="billing-contact-title" onSubmit={(event) => { event.preventDefault(); void saveBillingEmail(); }}>
                <CardHead title={<span id="billing-contact-title">Billing contact</span>} />
                <FormField id="billing-email" label="Invoice and receipt email" type="email" value={billingEmail}
                  onChange={setBillingEmail} disabled={!isOwner || savingBillingEmail} required
                  hint={isOwner ? 'Used for invoices, receipts, and billing notices.' : 'Only the business owner can change billing details.'} />
                <div className="flex justify-end">
                  <Button type="submit" variant="outline" disabled={!isOwner || savingBillingEmail || !billingEmail.trim()} loading={savingBillingEmail}>
                    {savingBillingEmail ? 'Saving…' : 'Save billing email'}
                  </Button>
                </div>
              </form>
            </Card>
          </div>
        </div>
      </div>

      <Dialog
        open={checkoutPreview !== null}
        onClose={() => { setCheckoutPreview(null); setCheckoutPlanId(null); }}
        title={trialFlow ? 'Confirm your free trial' : 'Review billing'}
        description={checkoutPreview ? `${checkoutPreview.planName} · ${checkoutPreview.billingCycle}` : undefined}
        footer={checkoutPreview && <><Button variant="outline" onClick={() => setCheckoutPreview(null)}>Back</Button><Button onClick={confirmCheckout} loading={checkoutPlanId !== null}>{trialFlow ? 'Confirm free trial' : 'Continue to payment'}</Button></>}
      >
        {checkoutPreview && (
          <dl className="m-0 divide-y divide-line text-sm">
            <div className={previewRow}><dt className="text-ink-2">Subscription</dt><dd className="m-0 font-medium tabular-nums text-ink">{formatMoney(checkoutPreview.recurringAmountMinor / 100, checkoutPreview.currency)}</dd></div>
            <div className={previewRow}><dt className="text-ink-2">Setup fee</dt><dd className="m-0 font-medium tabular-nums text-ink">{checkoutPreview.setupFeeMinor ? formatMoney(checkoutPreview.setupFeeMinor / 100, checkoutPreview.currency) : 'None'}</dd></div>
            {trialFlow && <div className={previewRow}><dt className="text-ink-2">Free trial</dt><dd className="m-0 font-medium text-ink">{billing?.trialDays} days</dd></div>}
            <div className={cn(previewRow, 'text-base')}><dt className="font-semibold text-ink">Total due now</dt><dd className="m-0 font-semibold tabular-nums text-ink">{formatMoney(trialFlow ? 0 : checkoutPreview.amountDueMinor / 100, checkoutPreview.currency)}</dd></div>
            <div className={previewRow}><dt className="text-ink-2">Billing email</dt><dd className="m-0 min-w-0 truncate text-ink">{checkoutPreview.billingEmail ?? 'Not set'}</dd></div>
            {!trialFlow && <div className={previewRow}><dt className="text-ink-2">Next billing date</dt><dd className="m-0 text-ink">{checkoutPreview.nextBillingDate ? formatDate(checkoutPreview.nextBillingDate) : 'Not scheduled'}</dd></div>}
          </dl>
        )}
      </Dialog>
    </Page>
  );
}

/**
 * Fallback contact for the Custom tier, which has no price to check out with.
 * The published catalogue carries no contact address, so this is the only
 * customer-facing place one is needed.
 */
const CONTACT_FALLBACK = 'mercuriusmerchandise@gmail.com';
