import { platformUsesWideLayout } from '../../utils/navigation-layout';
import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { AuthService } from '../../services/auth.service';
import { Button } from '../ui/Button';
import { DeveloperModeBanner } from '../DeveloperModeBanner';
import { OfflineBanner } from '../OfflineBanner';
import { PlatformSideNav } from './PlatformSideNav';
import { EnvironmentBadge } from './EnvironmentBadge';
import { usePlatform } from './PlatformContext';
import { CommandSearch } from '../CommandSearch';
import { MenuIcon } from '../icons';
import { PLATFORM_AREAS, canSeeArea, platformAreaPath } from '../../config/platformAreas';
import { useToast } from '../ui/Toast';
import { Drawer } from '../ui/Drawer';

/**
 * Shell for the Platform Owner dashboard.
 *
 * Deliberately separate from the merchant shell: a platform operator has no
 * store, so the store switcher, bottom tabs and merchant sidebar have no meaning
 * here. It reuses the same WAYA shell classes, header and drawer behaviour, so
 * the two halves of the product still read as one system.
 */
export function PlatformLayout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const toast = useToast();
  const { access, environment } = usePlatform();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const searchItems = access ? PLATFORM_AREAS.filter((area) => canSeeArea(area, access)).map((area) => ({
    id: `platform-${area.id}`,
    label: area.label,
    description: area.description,
    group: area.group ? 'Platform' : 'Overview',
    to: platformAreaPath(area),
  })) : [];

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    const toastId = toast.loading('Logging out…', { dedupeKey: 'platform-logout' });
    try {
      await AuthService.logout();
      toast.dismiss(toastId);
      navigate('/login', { replace: true });
    } catch (cause) {
      toast.update(toastId, {
        variant: 'error',
        message: 'Could not log out',
        description: cause instanceof Error ? cause.message : 'Please try again.',
      });
      setLoggingOut(false);
    }
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#platform-content">
        Skip to content
      </a>

      <header className="app-header">
        <button
          type="button"
          className="icon-button"
          aria-label="Open navigation"
          aria-expanded={menuOpen}
          aria-controls="platform-navigation"
          onClick={() => setMenuOpen(true)}
        >
          <MenuIcon width={18} height={18} />
        </button>
        <span className="app-header-logo">TrackOja Platform</span>
        <div className="app-header-actions">
          <CommandSearch items={searchItems} label="Search platform" />
          <EnvironmentBadge environment={environment} />
          <Button variant="ghost" className="btn-sm" onClick={handleLogout} disabled={loggingOut}>
            {loggingOut ? 'Logging out…' : 'Log out'}
          </Button>
        </div>
      </header>

      <PlatformSideNav onLogout={() => void handleLogout()} loggingOut={loggingOut} />

      <Drawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        id="platform-navigation"
        label="Platform navigation"
        closeAtDesktop
      >
        {menuOpen && <PlatformSideNav mobile onClose={() => setMenuOpen(false)} onLogout={() => void handleLogout()} loggingOut={loggingOut} />}
      </Drawer>

      <div className="app-main">
        <div className="workspace-topbar" aria-label="Platform controls">
          <span className="workspace-topbar-title">Platform console</span>
          <div className="workspace-topbar-search"><CommandSearch items={searchItems} label="Search platform" /></div>
          <div className="workspace-topbar-actions">
            <EnvironmentBadge environment={environment} />
            <Button variant="ghost" className="btn-sm" onClick={handleLogout} disabled={loggingOut}>{loggingOut ? 'Logging out…' : 'Log out'}</Button>
          </div>
        </div>
        <DeveloperModeBanner />
        <OfflineBanner />
        {/* Module width stays fixed while loading data or switching billing tabs. */}
        <main className="app-content" id="platform-content" tabIndex={-1}>
          <div className={`page plat-page${pathname === '/platform' || platformUsesWideLayout(pathname) ? ' is-wide' : ''}`}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
