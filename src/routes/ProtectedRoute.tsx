import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { PageLoader } from '../components/ui/PageLoader';
import { StateBlock } from '../components/ui/StateBlock';
import { Button } from '../components/ui/Button';

function ResolutionFailure() {
  const { entryError, refreshEntry } = useAuth();
  return <main className="auth-shell"><StateBlock variant="error" centred
    title="We could not open your workspace"
    body={entryError ?? 'Your account relationship could not be resolved.'}
    actions={<Button onClick={() => void refreshEntry()}>Try again</Button>} /></main>;
}

/** The single authenticated routing decision, evaluated only after auth,
 * invitations, memberships, workspace, onboarding and access have resolved. */
export function ProtectedRoute() {
  const { user, profile, loading, entry, entryLoading, entryError } = useAuth();
  const location = useLocation();
  if (loading || (user && entryLoading)) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (entryError || !entry) return <ResolutionFailure />;
  if (entry.kind === 'platform_admin' || profile?.isPlatformAdmin) {
    return location.pathname.startsWith('/platform') ? <Outlet /> : <Navigate to="/platform" replace />;
  }
  if (entry.kind === 'workspace_selection_required') return <Navigate to="/workspace" replace />;
  if (entry.kind === 'new_user' || entry.kind === 'onboarding_in_progress') {
    return <Navigate to="/onboarding" replace state={{ from: location.pathname }} />;
  }
  if (!entry.hasAccess && location.pathname !== '/billing') return <Navigate to="/billing" replace />;
  return <Outlet />;
}

export function GuestRoute() {
  const { user, loading, entry, entryLoading, entryError } = useAuth();
  if (loading || (user && entryLoading)) return <PageLoader />;
  if (user && entryError) return <ResolutionFailure />;
  if (user && entry) return <Navigate to={entry.destination} replace />;
  return <Outlet />;
}

export function OnboardingRoute() {
  const { user, loading, entry, entryLoading, entryError } = useAuth();
  if (loading || (user && entryLoading)) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (entryError || !entry) return <ResolutionFailure />;
  if (entry.kind === 'new_user' || entry.kind === 'onboarding_in_progress') return <Outlet />;
  return <Navigate to={entry.destination} replace />;
}

export function WorkspaceRoute() {
  const { user, loading, entry, entryLoading, entryError } = useAuth();
  if (loading || (user && entryLoading)) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (entryError || !entry) return <ResolutionFailure />;
  if (entry.kind === 'workspace_selection_required') return <Outlet />;
  return <Navigate to={entry.destination} replace />;
}

export function PlatformAdminRoute() {
  const { user, profile, loading, entryLoading } = useAuth();
  if (loading || entryLoading) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (!profile?.isPlatformAdmin) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}
