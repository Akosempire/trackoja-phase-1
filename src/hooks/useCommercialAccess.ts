import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { SubscriptionService, type CommercialAccess } from '../services/subscription.service';

/** Server-backed TrackOja entitlement gate. UI routing never grants access. */
export function useCommercialAccess() {
  const { user, profile } = useAuth();
  const [access, setAccess] = useState<CommercialAccess | null>(null);
  const [loading, setLoading] = useState(Boolean(user));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user || profile?.isPlatformAdmin) {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    SubscriptionService.getCommercialAccess()
      .then((value) => { if (alive) { setAccess(value); setError(null); } })
      .catch((cause) => { if (alive) { setAccess(null); setError(cause instanceof Error ? cause.message : 'Access could not be verified'); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [user?.id, profile?.currentOrgId, profile?.isPlatformAdmin]);

  return {
    access,
    loading: loading || Boolean(user && !profile?.isPlatformAdmin && access === null && error === null),
    error,
  };
}
