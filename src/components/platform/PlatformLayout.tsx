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
import { ThemeToggle } from '../ThemeToggle';
import { PLATFORM_AREAS, canSeeArea, platformAreaPath } from '../../config/platformAreas';
import { useToast } from '../ui/Toast';
import { Drawer } from '../ui/Drawer';
import { APP_MARK, APP_NAME } from '../../config/brand';
import { cn } from '../kit';

/**
 * Shell for the Platform Owner dashboard.
 *
 * Deliberately separate from the merchant shell: a platform operator has no
 * store, so the store switcher, bottom tabs and merchant sidebar have no meaning
 * here. It mirrors the merchant shell's structure (white sidebar, grey canvas,
 * sticky top bar, modal drawer on small screens) so the two halves of the product
 * still read as one system.
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

  // Module width stays fixed while loading data or switching billing tabs.
  const wide = pathname === '/platform' || platformUsesWideLayout(pathname);

  return (
    <div className="flex min-h-dvh bg-canvas text-ink">
      <a className="skip-link" href="#platform-content">
        Skip to content
      </a>

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

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Phone and tablet header */}
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-surface/95 px-3 backdrop-blur lg:hidden">
          <button
            type="button"
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-ink-2 hover:bg-hover"
            aria-label="Open navigation"
            aria-expanded={menuOpen}
            aria-controls="platform-navigation"
            onClick={(event) => { event.currentTarget.focus(); setMenuOpen(true); }}
          >
            <MenuIcon width={20} height={20} />
          </button>
          <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-ink text-[13px] font-bold text-surface" aria-hidden="true">{APP_MARK}</span>
          <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{APP_NAME} Platform</span>
          <div className="flex shrink-0 items-center gap-1">
            <CommandSearch items={searchItems} label="Search platform" />
            <ThemeToggle />
          </div>
        </header>

        {/* Desktop top bar */}
        <div className="sticky top-0 z-20 hidden h-16 items-center gap-4 border-b border-line bg-canvas/90 px-8 backdrop-blur lg:flex" aria-label="Platform controls">
          <span className="shrink-0 text-[13px] font-semibold text-ink-2">Platform console</span>
          <div className="w-full max-w-md"><CommandSearch items={searchItems} label="Search platform" /></div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <EnvironmentBadge environment={environment} />
            <ThemeToggle />
            <Button variant="ghost" className="btn-sm" onClick={handleLogout} disabled={loggingOut}>{loggingOut ? 'Logging out…' : 'Log out'}</Button>
          </div>
        </div>
        <DeveloperModeBanner />
        <OfflineBanner />
        <main className="min-w-0 flex-1" id="platform-content" tabIndex={-1}>
          <div className={cn('mx-auto flex w-full min-w-0 flex-col gap-4 px-4 pb-16 pt-5 sm:px-6 lg:gap-6 lg:px-8 lg:pb-12 lg:pt-8', wide ? 'max-w-[1440px]' : 'max-w-[1120px]')}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
