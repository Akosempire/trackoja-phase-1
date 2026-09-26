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
import { useEffect, useRef, useState } from 'react';
import { containDialogFocus } from '../utils/dialog-focus';

export function AppLayout() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const drawer = useRef<HTMLDialogElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!menuOpen) return;
    drawer.current?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const desktop = matchMedia('(min-width: 901px)');
    const closeOnDesktop = () => { if (desktop.matches) setMenuOpen(false); };
    desktop.addEventListener('change', closeOnDesktop);
    return () => { drawer.current?.close(); document.body.style.overflow = overflow; desktop.removeEventListener('change', closeOnDesktop); };
  }, [menuOpen]);

  const handleLogout = async () => {
    await AuthService.logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      {/* ── Mobile top header (hidden on desktop) ── */}
      <header className="app-header">
        <button className="icon-button" aria-label="Open navigation" aria-expanded={menuOpen} aria-controls="mobile-navigation" onClick={() => setMenuOpen(true)}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>
        <span className="app-header-logo">TrackOja</span>
        <div className="app-header-actions">
          <StoreSwitcher />
          {profile?.isPlatformAdmin && (
            <NavLink to="/platform" className={({ isActive }) => `app-nav-link${isActive ? ' active' : ''}`}>
              Platform
            </NavLink>
          )}
          <Button variant="ghost" onClick={handleLogout} style={{ width: 'auto', height: 36, padding: '0 14px' }}>
            Log out
          </Button>
        </div>
      </header>

      <BusinessProvider>
        {/* ── Desktop sidebar (hidden on mobile) ── */}
        <SideNav onLogout={handleLogout} />
        <dialog ref={drawer} id="mobile-navigation" className="mobile-nav-dialog" aria-label="Navigation" onKeyDown={containDialogFocus} onCancel={() => setMenuOpen(false)} onClick={event => { if (event.target === event.currentTarget) setMenuOpen(false); }}>
          {menuOpen && <SideNav mobile onClose={() => setMenuOpen(false)} onLogout={handleLogout} />}
        </dialog>

        {/* ── Main content area ── */}
        <div className="app-main">
          <DeveloperModeBanner />
          <OfflineBanner />
          <main className="app-content" id="main-content" tabIndex={-1}>
            <Outlet />
          </main>
          {/* Mobile bottom nav only */}
          <BottomNav />
        </div>
      </BusinessProvider>
    </div>
  );
}
