import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { PageLoader } from '../components/ui/PageLoader';

export function ProtectedRoute() {
  const { user, profile, loading } = useAuth();

  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (!profile?.currentOrgId) return <Navigate to="/onboarding" replace />;

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

  return <Outlet />;
}

export function PlatformAdminRoute() {
  const { user, profile, loading } = useAuth();

  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (!profile?.isPlatformAdmin) return <Navigate to="/dashboard" replace />;

  return <Outlet />;
}
