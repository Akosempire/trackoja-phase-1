import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { AuthService } from '../services/auth.service';
import { Button } from './ui/Button';
import { StoreSwitcher } from './StoreSwitcher';
import { BottomNav } from './BottomNav';
import { SideNav } from './SideNav';
import { OfflineBanner } from './OfflineBanner';
import { DeveloperModeBanner } from './DeveloperModeBanner';
import { useAuth } from '../contexts/AuthContext';
import { BusinessProvider } from '../contexts/BusinessContext';
import { useState } from 'react';
import { MenuIcon } from './icons';
import { MerchantCommandSearch } from './MerchantCommandSearch';
import { Drawer } from './ui/Drawer';
import { RouteBackBar } from './RouteBackBar';

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
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = async () => {
    await AuthService.logout();
    navigate('/login', { replace: true });
  };

  return (
    <BusinessProvider>
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>

      <header className="app-header">
        <button
          type="button"
          className="icon-button"
          aria-label="Open navigation"
          aria-expanded={menuOpen}
          aria-controls="mobile-navigation"
          onClick={() => setMenuOpen(true)}
        >
          <MenuIcon width={18} height={18} />
        </button>
        <span className="app-header-logo">TrackOja</span>
        <div className="app-header-actions">
          <MerchantCommandSearch />
          <StoreSwitcher />
          {profile?.isPlatformAdmin && (
            <NavLink to="/platform" className={({ isActive }) => `app-nav-link${isActive ? ' active' : ''}`}>
              Platform
            </NavLink>
          )}
          <Button variant="ghost" className="btn-sm" onClick={handleLogout}>
            Log out
          </Button>
        </div>
      </header>

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

        <div className="app-main">
          <DeveloperModeBanner />
          <OfflineBanner />
          <main className="app-content" id="main-content" tabIndex={-1}>
            <RouteBackBar />
            <Outlet />
          </main>
          <BottomNav />
        </div>
    </div>
    </BusinessProvider>
  );
}
