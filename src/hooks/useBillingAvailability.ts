import { useCallback, useEffect, useState } from 'react';
import { SubscriptionService, type BillingAvailability } from '../services/subscription.service';

export function useBillingAvailability() {
  const [billing, setBilling] = useState<BillingAvailability | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try { setBilling(await SubscriptionService.getBillingAvailability()); setError(null); }
    catch { setError('Plan availability could not be loaded. Please try again.'); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  return { billing, error, reload };
}
