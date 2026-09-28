import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { PageLoader } from '../components/ui/PageLoader';
import { StateBlock } from '../components/ui/StateBlock';
import { Button } from '../components/ui/Button';
import type { EntryResolution } from '../services/entry.service';

function ResolutionFailure() {
  const { entryError, refreshEntry } = useAuth();
  return <main className="auth-shell"><StateBlock variant="error" centred
    title="We could not open your workspace"
    body={entryError ?? 'Your account relationship could not be resolved.'}
    actions={<Button onClick={() => void refreshEntry()}>Try again</Button>} /></main>;
}

function merchantDestination(entry: EntryResolution) {
  return entry.kind === 'platform_admin' ? entry.merchantDestination : entry.destination;
}

/** Waits for the server-owned account decision after password, OTP or callback
 * authentication. Auth screens use this instead of guessing `/dashboard`. */
export function AuthEntryRedirect() {
  const { user, loading, entry, entryLoading, entryError } = useAuth();
  if (loading || (user && entryLoading)) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (entryError || !entry) return <ResolutionFailure />;
  return <Navigate to={entry.destination} replace />;
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
    if (location.pathname.startsWith('/platform')) return <Outlet />;
    const destination = merchantDestination(entry);
    if (destination === '/dashboard') return <Outlet />;
    if (destination === '/billing' && location.pathname === '/billing') return <Outlet />;
    return <Navigate to={destination ?? '/platform'} replace />;
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
  const destination = merchantDestination(entry);
  if (entry.kind === 'new_user' || entry.kind === 'onboarding_in_progress' || destination === '/onboarding') return <Outlet />;
  return <Navigate to={entry.destination} replace />;
}

export function WorkspaceRoute() {
  const { user, loading, entry, entryLoading, entryError } = useAuth();
  if (loading || (user && entryLoading)) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (entryError || !entry) return <ResolutionFailure />;
  const destination = merchantDestination(entry);
  if (entry.kind === 'workspace_selection_required' || destination === '/workspace') return <Outlet />;
  return <Navigate to={entry.destination} replace />;
}

export function PlatformAdminRoute() {
  const { user, profile, loading, entryLoading } = useAuth();
  if (loading || entryLoading) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (!profile?.isPlatformAdmin) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}
