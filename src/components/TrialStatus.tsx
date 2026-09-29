import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useBillingAvailability } from '../hooks/useBillingAvailability';
import { SubscriptionService, type MyEntitlement } from '../services/subscription.service';
import { formatDate } from '../utils/format';

export function TrialStatus() {
  const { profile } = useAuth();
  const { billing } = useBillingAvailability();
  const [trial, setTrial] = useState<MyEntitlement | null>(null);
  useEffect(() => {
    let current = true;
    setTrial(null);
    SubscriptionService.getMyEntitlement().then((value) => {
      if (current) setTrial(value);
    }).catch(() => { /* The billing screen provides detailed retry controls. */ });
    return () => { current = false; };
  }, [profile?.currentOrgId]);
  if (!billing || trial?.status !== 'trialing' || !trial.trialEndsAt) return null;
  const expired = Date.parse(trial.trialEndsAt) <= Date.now();
  return <div className="healthy-strip" role="status">
    <span>{expired && billing.paymentSystem !== 'LIVE'
      ? 'Trial access extended while payments are unavailable.'
      : `${trial.planName ?? 'TrackOja'} free trial · ${expired ? 'ended' : 'ends'} ${formatDate(trial.trialEndsAt)}`}</span>
    <Link to="/billing">View plan</Link>
  </div>;
}
