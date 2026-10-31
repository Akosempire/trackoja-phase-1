import type { ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { checkRouteAccess } from '../../config/routeAccess';
import { CashierSwitch } from '../till/CashierSwitch';
import { Page, btn } from '../kit';
import { PageLoader } from '../ui/PageLoader';

/**
 * Shows the screen only if the person working on this device (the signed-in
 * account, or whoever switched in with a PIN) may use it. Otherwise a friendly
 * "You don't have access" page with a way to switch user. The database checks
 * every read and write on its own; this keeps people out of half-broken screens.
 */
export function AccessGate({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { hasPermission, roleName, loading } = usePermissions();
  if (loading) return <PageLoader />;
  const access = checkRouteAccess(pathname, hasPermission, roleName);
  if (access.allowed) return <>{children}</>;
  if (access.redirect) return <Navigate to={access.redirect} replace />;
  return <AccessDenied what={access.label} />;
}

export function AccessDenied({ what }: { what: string }) {
  const { profile } = useAuth();
  const { acting, hasPermission } = usePermissions();
  const storeId = profile?.currentStoreId;
  const home = hasPermission('sales:create') ? '/sales/checkout' : hasPermission('inventory:view') ? '/inventory/products' : '/more';
  return (
    <Page width="form">
      <section className="mx-auto mt-10 flex max-w-md flex-col items-center gap-4 rounded-2xl border border-line bg-surface px-6 py-10 text-center" aria-labelledby="no-access-title">
        <span className="inline-flex size-14 items-center justify-center rounded-full bg-hover text-2xl" aria-hidden="true">🔒</span>
        <h1 id="no-access-title" className="text-xl font-semibold text-ink">You don't have access</h1>
        <p className="text-[15px] leading-relaxed text-ink-2">
          {acting ? <><strong className="text-ink">{acting.name}</strong>'s role</> : 'Your role'} can't open {what}.
          {' '}Ask a manager or the owner to switch in, or go back to your work.
        </p>
        <div className="mt-2 flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
          {storeId && (
            <CashierSwitch storeId={storeId} accountName={profile?.firstName || undefined}
              trigger={(open) => <button type="button" className={`${btn('primary')} min-h-[44px]`} onClick={open}>Switch user</button>} />
          )}
          <Link to={home} className={`${btn('outline')} min-h-[44px]`}>Go back</Link>
        </div>
      </section>
    </Page>
  );
}
