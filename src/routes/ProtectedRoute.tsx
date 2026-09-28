import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { PageLoader } from '../components/ui/PageLoader';
import { useCommercialAccess } from '../hooks/useCommercialAccess';

export function ProtectedRoute() {
  const { user, profile, loading } = useAuth();
  const location = useLocation();
  const commercial = useCommercialAccess();

  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (!profile?.currentOrgId) {
    // Platform admins manage the whole platform and don't need a store of
    // their own, so they're exempt from the "Set up your business" flow.
    if (profile?.isPlatformAdmin) {
      if (location.pathname.startsWith('/platform')) return <Outlet />;
      return <Navigate to="/platform" replace />;
    }
    return <Navigate to="/onboarding" replace />;
  }
  if (!profile.isPlatformAdmin && commercial.loading) return <PageLoader />;
  if (!profile.isPlatformAdmin && (!commercial.access?.hasAccess || commercial.error)) {
    return <Navigate to="/onboarding" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}

export function GuestRoute() {
  const { user, loading } = useAuth();

  if (loading) return <PageLoader />;
  if (user) return <Navigate to="/dashboard" replace />;

  return <Outlet />;
}

export function OnboardingRoute() {
  const { user, profile, loading } = useAuth();
  const commercial = useCommercialAccess();

  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (profile?.isPlatformAdmin) return <Navigate to="/platform" replace />;
  if (commercial.loading) return <PageLoader />;
  if (commercial.access?.hasAccess) return <Navigate to="/dashboard" replace />;

  return <Outlet />;
}

export function PlatformAdminRoute() {
  const { user, profile, loading } = useAuth();

  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (!profile?.isPlatformAdmin) return <Navigate to="/dashboard" replace />;

  return <Outlet />;
}
