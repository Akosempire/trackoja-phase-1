import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { BusinessProvider } from '../../contexts/BusinessContext';
import { useAuth } from '../../contexts/AuthContext';
import { OfflineBanner } from '../OfflineBanner';
import { PageLoader } from '../ui/PageLoader';
import { useUsageBeat } from '../../hooks/useUsageBeat';

/**
 * Register mode: the till screen on its own, without the admin sidebar, global
 * search, branch switcher or Log out. The register draws its own slim top bar.
 */
export function RegisterLayout() {
  const { profile } = useAuth();
  useUsageBeat(profile?.currentStoreId, Boolean(profile?.currentStoreId) && !profile?.isPlatformAdmin);
  return (
    <BusinessProvider>
      <div className="register-shell flex min-h-dvh flex-col bg-canvas text-ink">
        <OfflineBanner />
        <Suspense fallback={<PageLoader />}>
          <Outlet />
        </Suspense>
      </div>
    </BusinessProvider>
  );
}
