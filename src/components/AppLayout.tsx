import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { AuthService } from '../services/auth.service';
import { Button } from './ui/Button';
import { StoreSwitcher } from './StoreSwitcher';
import { BottomNav } from './BottomNav';
import { OfflineBanner } from './OfflineBanner';
import { useAuth } from '../contexts/AuthContext';

// Shared shell for authenticated pages. Mobile-first: the primary navigation
// is the bottom tab bar (see BottomNav), and the top bar is reduced to
// branding, the store switcher, and account actions.
export function AppLayout() {
  const navigate = useNavigate();
  const { profile } = useAuth();

  const handleLogout = async () => {
    await AuthService.logout();
    navigate('/login', { replace: true });
  };

  return (
    <div>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 24px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 15 }}>TrackOja</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <StoreSwitcher />
          {profile?.isPlatformAdmin && (
            <NavLink to="/platform" className={({ isActive }) => `app-nav-link${isActive ? ' active' : ''}`}>
              Platform
            </NavLink>
          )}
          <Button
            variant="ghost"
            onClick={handleLogout}
            style={{ width: 'auto', height: 36, padding: '0 14px' }}
          >
            Log out
          </Button>
        </div>
      </header>
      <OfflineBanner />
      <div className="app-content">
        <Outlet />
      </div>
      <BottomNav />
    </div>
  );
}
