import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { AuthService } from '../services/auth.service';
import { Button } from './ui/Button';
import { BottomNav } from './BottomNav';
import { SideNav } from './SideNav';
import { OfflineBanner } from './OfflineBanner';
import { DeveloperModeBanner } from './DeveloperModeBanner';
import { useAuth } from '../contexts/AuthContext';
import { BusinessProvider } from '../contexts/BusinessContext';
import { Suspense, useEffect, useState } from 'react';
import { PageLoader } from './ui/PageLoader';
import { prefetchPages } from '../utils/prefetch-pages';
import { MenuIcon } from './icons';
import { MerchantCommandSearch } from './MerchantCommandSearch';
import { ThemeToggle } from './ThemeToggle';
import { Drawer } from './ui/Drawer';
import { RouteBackBar } from './RouteBackBar';
import { useToast } from './ui/Toast';
import { APP_MARK, APP_NAME } from '../config/brand';
import { btn } from './kit';
import { useUsageBeat } from '../hooks/useUsageBeat';
import { AccessGate } from './access/AccessGate';

/**
 * The merchant workspace shell.
 *
 * The platform console deliberately does not render inside this: a platform
 * operator has no store, so the store switcher, merchant sidebar and bottom tabs
 * are meaningless there. `PlatformLayout` is a sibling of this shell rather than
 * a child, which is why there is no platform branch here.
 */
export function AppLayout() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const toast = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  // once signed in, fetch the other screens in the background so moving around is instant
  useEffect(() => { prefetchPages(); }, []);
  const [loggingOut, setLoggingOut] = useState(false);
  // time in the app by screen (Platform → Usage); platform staff aren't counted
  useUsageBeat(profile?.currentStoreId, Boolean(profile?.currentStoreId) && !profile?.isPlatformAdmin);

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    const toastId = toast.loading('Logging out…', { dedupeKey: 'merchant-logout' });
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
  };

  return (
    <BusinessProvider>
    <div className="tl-shell flex min-h-dvh bg-canvas text-ink">
      <a className="skip-link" href="#main-content">Skip to content</a>

      <SideNav onLogout={handleLogout} />
      <Drawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        id="mobile-navigation"
        label="Navigation"
        closeAtDesktop
      >
        {menuOpen && <SideNav mobile onClose={() => setMenuOpen(false)} onLogout={handleLogout} />}
      </Drawer>

      <div className="tl-main flex min-w-0 flex-1 flex-col">
        {/* Phone and tablet header */}
        <header className="tl-header sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-surface/95 px-3 backdrop-blur lg:hidden">
          <button
            type="button"
            className="inline-flex size-10 items-center justify-center rounded-lg text-ink-2 hover:bg-hover"
            aria-label="Open navigation"
            aria-expanded={menuOpen}
            aria-controls="mobile-navigation"
            onClick={event => { event.currentTarget.focus(); setMenuOpen(true); }}
          >
            <MenuIcon width={20} height={20} />
          </button>
          <span className="inline-flex size-7 items-center justify-center rounded-lg bg-brand text-[13px] font-bold text-white" aria-hidden="true">{APP_MARK}</span>
          <span className="flex-1 truncate text-[15px] font-semibold">{APP_NAME}</span>
          <div className="tl-header-actions flex items-center gap-1">
            <MerchantCommandSearch />
            <ThemeToggle />
          </div>
        </header>

        {/* Desktop top bar */}
        <div className="tl-topbar sticky top-0 z-20 hidden h-16 items-center gap-4 border-b border-line bg-canvas/90 px-8 backdrop-blur lg:flex" aria-label="Workspace controls">
          <div className="tl-topbar-search w-full max-w-md"><MerchantCommandSearch /></div>
          <div className="ml-auto flex items-center gap-2">
            {profile?.isPlatformAdmin && (
              <NavLink to="/platform" className={btn('ghost', 'sm')}>Platform</NavLink>
            )}
            <ThemeToggle />
            <NavLink to="/more" className="tl-account inline-flex size-9 items-center justify-center rounded-full bg-brand text-sm font-semibold text-white no-underline" aria-label="Account and tools" title="Account and tools">{profile?.firstName?.[0]?.toUpperCase() ?? APP_MARK}</NavLink>
            <Button variant="ghost" className="btn-sm" onClick={handleLogout} disabled={loggingOut}>
              {loggingOut ? 'Logging out…' : 'Log out'}
            </Button>
          </div>
        </div>
        <DeveloperModeBanner />
        <OfflineBanner />
        <main className="tl-content min-w-0 flex-1" id="main-content" tabIndex={-1}>
          <RouteBackBar />
          {/* Only the page area waits while a screen loads; the sidebar and tabs stay put */}
          <Suspense fallback={<PageLoader />}>
            <AccessGate><Outlet /></AccessGate>
          </Suspense>
        </main>
        <BottomNav />
      </div>
    </div>
    </BusinessProvider>
  );
}
