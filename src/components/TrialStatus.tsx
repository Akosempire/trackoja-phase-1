import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useBillingAvailability } from '../hooks/useBillingAvailability';
import { SubscriptionService, type MyEntitlement } from '../services/subscription.service';
import { formatDate } from '../utils/format';
import { btn, cn } from './kit';

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
  const extended = expired && billing.paymentSystem !== 'LIVE';
  return (
    <div role="status" className={cn('mb-4 flex items-center gap-3 rounded-xl px-4 py-3 lg:mb-6',
      expired && !extended ? 'bg-warn-soft text-warn-ink' : 'bg-brand-soft text-brand-ink')}>
      <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', expired && !extended ? 'bg-warn' : 'bg-brand')} />
      <span className="min-w-0 flex-1 text-[13px] font-medium leading-5">
        {extended
          ? 'Trial access extended while payments are unavailable.'
          : `${trial.planName ?? 'TrackOja'} free trial · ${expired ? 'ended' : 'ends'} ${formatDate(trial.trialEndsAt)}`}
      </span>
      <Link to="/billing" className={cn(btn('ghost', 'sm'), 'shrink-0 text-inherit hover:bg-surface/60 hover:text-inherit')}>View plan</Link>
    </div>
  );
}
