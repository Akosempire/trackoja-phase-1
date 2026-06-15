import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { PageLoader } from '../components/ui/PageLoader';

export function ProtectedRoute() {
  const { user, profile, loading } = useAuth();
  const location = useLocation();

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

  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (profile?.currentOrgId) return <Navigate to="/dashboard" replace />;
  if (profile?.isPlatformAdmin) return <Navigate to="/platform" replace />;

  return <Outlet />;
}

export function PlatformAdminRoute() {
  const { user, profile, loading } = useAuth();

  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (!profile?.isPlatformAdmin) return <Navigate to="/dashboard" replace />;

  return <Outlet />;
}
