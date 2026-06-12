import { Outlet, useNavigate } from 'react-router-dom';
import { AuthService } from '../services/auth.service';
import { Button } from './ui/Button';
import { StoreSwitcher } from './StoreSwitcher';

// Shared shell for authenticated pages. Hosts the persistent global store
// switcher so it is available everywhere in the app, per the Phase 1
// multi-store support requirement.
export function AppLayout() {
  const navigate = useNavigate();

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
          <Button
            variant="ghost"
            onClick={handleLogout}
            style={{ width: 'auto', height: 36, padding: '0 14px' }}
          >
            Log out
          </Button>
        </div>
      </header>
      <Outlet />
    </div>
  );
}
