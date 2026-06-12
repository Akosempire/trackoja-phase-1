import { useEffect, useState } from 'react';
import { PageLoader } from '../components/ui/PageLoader';
import { OrganizationService } from '../services/organization.service';
import { StoreService } from '../services/store.service';
import { useAuth } from '../contexts/AuthContext';
import type { Organization, Store } from '../types';

export default function DashboardPage() {
  const { user, profile } = useAuth();
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [store, setStore] = useState<Store | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile?.currentOrgId) {
      setLoading(false);
      return;
    }

    Promise.all([
      OrganizationService.getOrganization(profile.currentOrgId),
      profile.currentStoreId ? StoreService.getStore(profile.currentStoreId) : Promise.resolve(null),
    ])
      .then(([org, currentStore]) => {
        setOrganization(org);
        setStore(currentStore);
      })
      .finally(() => setLoading(false));
  }, [profile?.currentOrgId, profile?.currentStoreId]);

  if (loading) return <PageLoader />;

  return (
    <div style={{ padding: 24, maxWidth: 480, margin: '0 auto' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
        {organization?.name ?? 'Welcome to TrackOja'}
      </h1>
      <p style={{ color: 'var(--t2)', marginBottom: 4 }}>Signed in as {user?.email}</p>
      {store && (
        <p style={{ color: 'var(--t2)', marginBottom: 24 }}>
          Current store: <strong style={{ color: 'var(--t1)' }}>{store.name}</strong>
        </p>
      )}
    </div>
  );
}
