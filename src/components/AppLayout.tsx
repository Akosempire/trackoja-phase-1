import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { AuthService } from '../services/auth.service';
import { Button } from './ui/Button';
import { StoreSwitcher } from './StoreSwitcher';
import { BottomNav } from './BottomNav';
import { SideNav } from './SideNav';
import { OfflineBanner } from './OfflineBanner';
import { useAuth } from '../contexts/AuthContext';
import { BusinessProvider } from '../contexts/BusinessContext';

export function AppLayout() {
  const navigate = useNavigate();
  const { profile } = useAuth();

  const handleLogout = async () => {
    await AuthService.logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="app-shell">
      {/* ── Mobile top header (hidden on desktop) ── */}
      <header className="app-header">
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

        {/* ── Main content area ── */}
        <div className="app-main">
          <OfflineBanner />
          <div className="app-content">
            <Outlet />
          </div>
          {/* Mobile bottom nav only */}
          <BottomNav />
        </div>
      </BusinessProvider>
    </div>
  );
}
