import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useSearchParams } from 'react-router-dom';
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
import { MeterList, type MeterItem } from '../../components/ui/MeterList';
import { SectionHead } from '../../components/ui/SectionHead';
import { StateBlock } from '../../components/ui/StateBlock';
import { useToast } from '../../components/ui/Toast';
import { Dialog } from '../../components/ui/Dialog';
import { FormField } from '../../components/ui/FormField';
import { formatDate, formatMoney, formatNumber, formatRelative, formatSeatLimit } from '../../utils/format';
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
  const { user, profile } = useAuth();
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
        if (!result.settled) throw new Error(result.detail ?? 'Payment has not been confirmed.');
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
    const date = trialEndsAt ?? expiresAt;
    const lapsed = daysRemaining !== null && daysRemaining < 0;

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
  }, [entitlement]);

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
    const toastId = toast.loading('Opening secure checkout…', { dedupeKey: 'billing-checkout' });
    try {
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

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Billing</h1>
        </div>
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <section className="card">
        <SectionHead title="Billing contact" />
        <div className="plat-form-row">
          <FormField id="billing-email" label="Invoice and receipt email" type="email" value={billingEmail}
            onChange={setBillingEmail} disabled={!isOwner || savingBillingEmail} />
          <Button onClick={() => void saveBillingEmail()} disabled={!isOwner || savingBillingEmail || !billingEmail.trim()}>
            {savingBillingEmail ? 'Saving…' : 'Save billing email'}
          </Button>
        </div>
        {!isOwner && <p className="form-hint">Only the business owner can change billing details.</p>}
      </section>

      {/* ── Status and the one action that matters ───────────────── */}
      <section className="card">
        <div className="split-head">
          <div className="split-head-text">
            <p className="attention-title">
              {entitlement?.planName ?? 'No plan'} <StatusBadge status={entitlement?.status ?? 'none'} />
            </p>
            <p className="attention-meta">
              {state.detail}
              {state.nextDate && state.nextDateLabel
                ? ` · ${state.nextDateLabel} ${formatDate(state.nextDate)} (${formatRelative(state.nextDate)})`
                : ''}
              {entitlement?.billingCycle ? ` · billed ${entitlement.billingCycle}` : ''}
            </p>
          </div>
          <Button variant={state.tone === 'danger' ? 'danger' : 'primary'} onClick={scrollToPlans}>
            {state.action}
          </Button>
        </div>
      </section>

      {/* ── What this plan includes ──────────────────────────────── */}
      <section className="card">
        <SectionHead title="What your plan includes" />
        {entitlement ? (
          <>
            <MeterList items={usage} />
            {featureList.length > 0 ? (
              <>
                <ul className="feature-list">
                  {featureList.slice(0, 6).map((feature) => (
                    <li key={feature.key}>
                      {feature.label}
                      {feature.upcoming && <> <Badge tone="outline">soon</Badge></>}
                    </li>
                  ))}
                </ul>
                {featureList.length > 6 && (
                  <Disclosure summary={`All ${featureList.length} features`}>
                    <ul className="feature-list">
                      {featureList.slice(6).map((feature) => (
                        <li key={feature.key}>
                          {feature.label}
                          {feature.upcoming && <> <Badge tone="outline">soon</Badge></>}
                        </li>
                      ))}
                    </ul>
                  </Disclosure>
                )}
              </>
            ) : (
              <p className="section-sub">This plan lists no individual features.</p>
            )}
            {entitlement.agreedMonthlyPrice !== null && (
              <p className="section-sub">
                {formatMoney(entitlement.agreedMonthlyPrice)} per month, agreed when this subscription was activated.
              </p>
            )}
          </>
        ) : (
          <StateBlock
            variant="empty"
            title="No plan on this business"
            body="Choose a plan below to switch TrackOja on."
          />
        )}
      </section>

      {/* ── Compare published plans ──────────────────────────────── */}
      <section className="card" ref={compareRef}>
        <SectionHead
          title="Plans"
          actions={
            <div className="toolbar-group">
              <button
                type="button"
                className={`chip${cycle === 'monthly' ? ' active' : ''}`}
                aria-pressed={cycle === 'monthly'}
                onClick={() => setCycle('monthly')}
              >
                Monthly
              </button>
              <button
                type="button"
                className={`chip${cycle === 'annual' ? ' active' : ''}`}
                aria-pressed={cycle === 'annual'}
                onClick={() => setCycle('annual')}
              >
                Annual
              </button>
            </div>
          }
        />

        {catalogueProblem ? (
          <StateBlock
            variant="error"
            title="Could not load the plans"
            body={catalogueProblem}
            actions={
              <Button variant="outline" onClick={load}>
                Try again
              </Button>
            }
          />
        ) : plans.length === 0 ? (
          <StateBlock
            variant="unavailable"
            title="No published plans"
            body="Nothing is published for sale yet."
          />
        ) : (
          <div className="plan-grid">
            {plans.map((plan) => {
              const isCurrent = plan.id === currentPlanId;
              const price = priceFor(plan, cycle);
              const otherCycle = priceFor(plan, cycle === 'monthly' ? 'annual' : 'monthly');
              const saving =
                cycle === 'annual' && plan.monthlyPrice && plan.annualPrice
                  ? plan.monthlyPrice * 12 - plan.annualPrice
                  : 0;

              return (
                <div className={`plan-card${isCurrent ? ' is-current' : ''}`} key={plan.id}>
                  <div className="plan-card-head">
                    <span className="plan-card-name">{plan.name}</span>
                    {isCurrent && <Badge tone="brand">Current</Badge>}
                    {plan.isDefault && !isCurrent && <Badge tone="neutral">Most chosen</Badge>}
                  </div>

                  <p className="plan-card-price">
                    {price === null ? (
                      <span className="metric-value is-muted">Custom</span>
                    ) : (
                      <>
                        <span className="metric-value">{formatMoney(price)}</span>
                        <span className="plan-card-period">/{cycle === 'monthly' ? 'month' : 'year'}</span>
                      </>
                    )}
                  </p>

                  {price === null ? (
                    <p className="plan-card-note">{plan.onboardingNote ?? 'Priced per implementation.'}</p>
                  ) : (
                    <p className="plan-card-note">
                      {formatSeatLimit(plan.userLimit)} included
                      {saving > 0 && <> · saves {formatMoney(saving)} a year</>}
                      {otherCycle !== null && cycle === 'monthly' && plan.annualPrice !== null && (
                        <> · {formatMoney(plan.annualPrice)} a year</>
                      )}
                    </p>
                  )}

                  <p className="plan-card-note">
                    Setup fee: {((cycle === 'monthly' ? plan.monthlySetupFee : plan.annualSetupFee) || 0) > 0
                      ? formatMoney(cycle === 'monthly' ? plan.monthlySetupFee : plan.annualSetupFee, plan.currency)
                      : 'none'} · no trial
                  </p>

                  {isCurrent ? (
                    <Button variant="outline" disabled>
                      Your plan
                    </Button>
                  ) : price === null ? (
                    <a className="btn btn-outline" href={`mailto:${CONTACT_FALLBACK}?subject=TrackOja%20${encodeURIComponent(plan.name)}`}>
                      <span className="btn-label">Talk to us</span>
                    </a>
                  ) : (
                    <Button
                      onClick={() => handleCheckout(plan)}
                      loading={checkoutPlanId === plan.id}
                      disabled={!isOwner}
                    >
                      {entitlement ? 'Switch to this plan' : 'Choose this plan'}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {!isOwner && (
          <p className="section-sub">Only the business owner can change the subscription.</p>
        )}
      </section>

      {/* ── Payments ─────────────────────────────────────────────── */}
      <section className="card">
        <SectionHead title="Payments" />
        {transactions.length === 0 ? (
          <p className="section-sub">No payments recorded.</p>
        ) : (
          <div className="payment-list">
            {transactions.slice(0, 8).map((txn) => (
              <div className="payment-row" key={txn.id}>
                <div className="payment-row-main">
                  <span className="payment-amount">{formatMoney(txn.amount, txn.currency ?? 'NGN')}</span>
                  <StatusBadge status={txn.status} />
                </div>
                <p className="attention-meta">
                  {formatDate(txn.createdAt)} · <span className="mono">{txn.reference}</span>
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <SectionHead title="Invoices and receipts" />
        {documents.length === 0 ? <p className="section-sub">No commercial documents issued yet.</p> : (
          <div className="payment-list">
            {documents.map((document) => (
              <div className="payment-row" key={document.invoiceId}>
                <div className="payment-row-main">
                  <span className="payment-amount">{document.invoiceNumber}</span>
                  <StatusBadge status={document.status} />
                  {document.isTestData && <Badge tone="warning">Test payment</Badge>}
                </div>
                <p className="attention-meta">
                  {document.planName} · {document.billingCycle} · {formatMoney(document.totalMinor / 100, document.currency)}
                  {document.receiptNumber ? ` · receipt ${document.receiptNumber}` : ''}
                </p>
                <p className="attention-meta">Issued {formatDate(document.issuedAt)} · {document.billingEmail ?? 'No billing email recorded'}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <Dialog
        open={checkoutPreview !== null}
        onClose={() => { setCheckoutPreview(null); setCheckoutPlanId(null); }}
        title="Review billing"
        description={checkoutPreview ? `${checkoutPreview.planName} · version ${checkoutPreview.version} · ${checkoutPreview.billingCycle}` : undefined}
        footer={checkoutPreview && <><Button variant="outline" onClick={() => setCheckoutPreview(null)}>Back</Button><Button onClick={confirmCheckout} loading={checkoutPlanId !== null}>Continue to payment</Button></>}
      >
        {checkoutPreview && (
          <dl className="billing-preview-lines">
            <div><dt>Subscription</dt><dd>{formatMoney(checkoutPreview.recurringAmountMinor / 100, checkoutPreview.currency)}</dd></div>
            <div><dt>Setup fee</dt><dd>{checkoutPreview.setupFeeMinor ? formatMoney(checkoutPreview.setupFeeMinor / 100, checkoutPreview.currency) : 'None'}</dd></div>
            <div><dt>Trial</dt><dd>Not offered</dd></div>
            <div className="billing-preview-total"><dt>Total due now</dt><dd>{formatMoney(checkoutPreview.amountDueMinor / 100, checkoutPreview.currency)}</dd></div>
            <div><dt>Billing email</dt><dd>{checkoutPreview.billingEmail ?? 'Not set'}</dd></div>
            <div><dt>Next billing date</dt><dd>{checkoutPreview.nextBillingDate ? formatDate(checkoutPreview.nextBillingDate) : 'Not scheduled'}</dd></div>
          </dl>
        )}
      </Dialog>
    </div>
  );
}

/**
 * Fallback contact for the Custom tier, which has no price to check out with.
 * The published catalogue carries no contact address, so this is the only
 * customer-facing place one is needed.
 */
const CONTACT_FALLBACK = 'mercuriusmerchandise@gmail.com';
