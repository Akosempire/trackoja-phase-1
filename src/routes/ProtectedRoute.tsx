import { useEffect } from 'react';
import { allowedReturn, rememberRoute, restoredRoute, safeReturnPath } from '../utils/session-continuity';
import { StartupScreen } from '../components/StartupScreen';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
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
  const location = useLocation();
  const { user, loading, entry, entryLoading, entryError } = useAuth();
  if (loading || (user && entryLoading)) return <StartupScreen />;
  if (entryError && !entry) return <ResolutionFailure />;
  if (!user) return <SignInRedirect />;
  if (!entry) return <ResolutionFailure />;
  return <Navigate to={resumeDestination(user.id, entry, location.search)} replace />;
}

/** The single authenticated routing decision, evaluated only after auth,
 * invitations, memberships, workspace, onboarding and access have resolved. */
export function ProtectedRoute() {
  const { user, profile, loading, entry, entryLoading, entryError } = useAuth();
  const location = useLocation();
  if (loading || (user && entryLoading)) return <StartupScreen />;
  if (entryError && !entry) return <ResolutionFailure />;
  if (!user) return <SignInRedirect />;
  if (!entry) return <ResolutionFailure />;
  if (entry.kind === 'platform_admin' || profile?.isPlatformAdmin) {
    if (location.pathname.startsWith('/platform')) return <RememberedOutlet />;
    const destination = merchantDestination(entry);
    if (destination === '/dashboard') return <RememberedOutlet />;
    if (destination === '/billing' && location.pathname === '/billing') return <RememberedOutlet />;
    return <Navigate to={destination ?? '/platform'} replace />;
  }
  if (entry.kind === 'workspace_selection_required') return <Navigate to="/workspace" replace />;
  if (entry.kind === 'new_user' || entry.kind === 'onboarding_in_progress') {
    return <Navigate to="/onboarding" replace state={{ from: location.pathname }} />;
  }
  // A billing document is the record of money this business already paid, and a
  // customer in arrears is exactly who needs to retrieve one, so the printable
  // document is exempt from the access redirect for the same reason /billing is.
  // It is still behind this guard: no session and no resolved entry, no document.
  if (
    !entry.hasAccess &&
    location.pathname !== '/billing' &&
    !location.pathname.startsWith('/billing/documents/')
  ) return <Navigate to="/billing" replace />;
  return <RememberedOutlet />;
}

export function GuestRoute() {
  const location = useLocation();
  const { user, loading, entry, entryLoading, entryError } = useAuth();
  if (loading || (user && entryLoading)) return <StartupScreen />;
  if (entryError && !entry) return <ResolutionFailure />;
  if (user && entry) return <Navigate to={resumeDestination(user.id, entry, location.search)} replace />;
  return <RememberedOutlet />;
}

export function OnboardingRoute() {
  const { user, loading, entry, entryLoading, entryError } = useAuth();
  if (loading || (user && entryLoading)) return <StartupScreen />;
  if (entryError && !entry) return <ResolutionFailure />;
  if (!user) return <SignInRedirect />;
  if (!entry) return <ResolutionFailure />;
  const destination = merchantDestination(entry);
  if (entry.kind === 'new_user' || entry.kind === 'onboarding_in_progress' || destination === '/onboarding') return <RememberedOutlet />;
  return <Navigate to={entry.destination} replace />;
}

export function WorkspaceRoute() {
  const { user, loading, entry, entryLoading, entryError } = useAuth();
  if (loading || (user && entryLoading)) return <StartupScreen />;
  if (entryError && !entry) return <ResolutionFailure />;
  if (!user) return <SignInRedirect />;
  if (!entry) return <ResolutionFailure />;
  const destination = merchantDestination(entry);
  if (entry.kind === 'workspace_selection_required' || destination === '/workspace') return <RememberedOutlet />;
  return <Navigate to={entry.destination} replace />;
}

export function PlatformAdminRoute() {
  const { user, profile, loading, entryLoading, entryError, entry } = useAuth();
  if (loading || entryLoading) return <StartupScreen />;
  if (entryError && !entry) return <ResolutionFailure />;
  if (!user) return <SignInRedirect />;
  if (!profile?.isPlatformAdmin) return <Navigate to="/dashboard" replace />;
  return <RememberedOutlet />;
}

function resumeDestination(userId: string, entry: EntryResolution, search: string) {
  return allowedReturn(new URLSearchParams(search).get('next'), entry) ?? restoredRoute(userId, entry) ?? entry.destination;
}
function SignInRedirect() {
  const location = useLocation();
  const next = safeReturnPath(location.pathname + location.search);
  return <Navigate to={next ? `/login?next=${encodeURIComponent(next)}` : '/login'} replace />;
}
function RememberedOutlet() {
  const { user, profile, entry, entryError, refreshEntry } = useAuth();
  const location = useLocation();
  useEffect(() => {
    if (user && entry) rememberRoute(user.id, profile?.currentOrgId, profile?.currentStoreId, location.pathname + location.search);
  }, [user?.id, profile?.currentOrgId, profile?.currentStoreId, entry, location.pathname, location.search]);
  return <>{entryError && entry && <div className="alert alert-warning" role="status">Connection interrupted. Your current page is preserved. <Button variant="ghost" onClick={() => void refreshEntry()}>Retry</Button></div>}<Outlet /></>;
}
