import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { OrganizationService } from '../../services/organization.service';
import { SubscriptionService } from '../../services/subscription.service';
import { Button } from '../../components/ui/Button';
import { PageLoader } from '../../components/ui/PageLoader';
import { formatFeatureSummary } from '../../utils/subscription-plan';
import type { Organization, Subscription, SubscriptionPlan, SubscriptionTransaction } from '../../types';

const SUBSCRIPTION_STATUS_LABELS: Record<string, string> = {
  trialing: 'Trial',
  active: 'Active',
  past_due: 'Past due',
  canceled: 'Canceled',
  unpaid: 'Unpaid',
  paused: 'Paused',
  expired: 'Expired',
};

const TRANSACTION_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  success: 'Paid',
  failed: 'Failed',
  abandoned: 'Abandoned',
};

const ACTIVE_SUBSCRIPTION_STATUSES = ['trialing', 'active'];
const SUCCESS_TRANSACTION_STATUSES = ['success'];

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString();
}

export default function BillingPage() {
  const { user, profile } = useAuth();
  const orgId = profile?.currentOrgId;

  const [organization, setOrganization] = useState<Organization | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [transactions, setTransactions] = useState<SubscriptionTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkoutPlanId, setCheckoutPlanId] = useState<string | null>(null);

  const isOwner = !!user && !!organization && organization.ownerId === user.id;

  useEffect(() => {
    if (!orgId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    Promise.all([
      OrganizationService.getOrganization(orgId),
      SubscriptionService.getOrgSubscription(orgId),
      SubscriptionService.getPlans(),
      SubscriptionService.getTransactions(orgId),
    ])
      .then(([org, sub, plansList, txns]) => {
        setOrganization(org);
        setSubscription(sub);
        setPlans(plansList);
        setTransactions(txns);
      })
      .catch((err) => setError(err.message ?? 'Failed to load billing information'))
      .finally(() => setLoading(false));
  }, [orgId]);

  const handleUpgrade = async (planId: string) => {
    if (!orgId) return;
    setError(null);
    setCheckoutPlanId(planId);
    try {
      const { authorizationUrl } = await SubscriptionService.initiateCheckout(
        orgId,
        planId,
        `${window.location.origin}/billing`
      );
      window.location.href = authorizationUrl;
    } catch (err: any) {
      setError(err.message ?? 'Failed to start checkout');
      setCheckoutPlanId(null);
    }
  };

  if (loading) return <PageLoader />;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Billing</h1>
          <p className="page-subtitle">Manage your subscription plan</p>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="card">
        <p className="list-item-title" style={{ marginBottom: 8 }}>
          Current plan
        </p>
        <div className="total-row">
          <span>Plan</span>
          <span>{subscription?.plan?.name ?? '—'}</span>
        </div>
        <div className="total-row">
          <span>Status</span>
          <span
            className={`badge ${
              subscription && ACTIVE_SUBSCRIPTION_STATUSES.includes(subscription.status)
                ? 'badge-default'
                : 'badge-warning'
            }`}
          >
            {subscription ? SUBSCRIPTION_STATUS_LABELS[subscription.status] ?? subscription.status : '—'}
          </span>
        </div>
        {subscription?.status === 'trialing' && (
          <div className="total-row">
            <span>Trial ends</span>
            <span>{formatDate(subscription.trialEnd)}</span>
          </div>
        )}
        <div className="total-row grand">
          <span>Current period ends</span>
          <span>{formatDate(subscription?.currentPeriodEnd ?? null)}</span>
        </div>
      </div>

      <div className="card">
        <p className="list-item-title" style={{ marginBottom: 8 }}>
          Available plans
        </p>
        <div className="list">
          {plans.map((plan) => {
            const isCurrent = plan.id === subscription?.planId;
            return (
              <div key={plan.id} className="list-item">
                <div>
                  <div className="list-item-title">
                    {plan.name} {isCurrent && <span className="badge badge-default">Current</span>}
                  </div>
                  {plan.description && <div className="page-subtitle">{plan.description}</div>}
                  <div>
                    ₦{plan.price.toLocaleString()}
                    {plan.price > 0 ? ` / ${plan.billingInterval === 'yearly' ? 'year' : 'month'}` : ''}
                  </div>
                  <div className="page-subtitle">{formatFeatureSummary(plan.featureSet)}</div>
                </div>
                {isOwner && !isCurrent && plan.price > 0 && (
                  <Button
                    className="btn-sm"
                    onClick={() => handleUpgrade(plan.id)}
                    loading={checkoutPlanId === plan.id}
                  >
                    Upgrade
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <p className="list-item-title" style={{ marginBottom: 8 }}>
          Payment history
        </p>
        {transactions.length === 0 ? (
          <p className="page-subtitle">No payments yet.</p>
        ) : (
          transactions.map((txn) => (
            <div key={txn.id} className="movement-row">
              <div>
                <div>{formatDate(txn.createdAt)}</div>
                <div className="page-subtitle">{txn.reference}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div>₦{txn.amount.toLocaleString()}</div>
                <span
                  className={`badge ${
                    SUCCESS_TRANSACTION_STATUSES.includes(txn.status) ? 'badge-default' : 'badge-warning'
                  }`}
                >
                  {TRANSACTION_STATUS_LABELS[txn.status] ?? txn.status}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
