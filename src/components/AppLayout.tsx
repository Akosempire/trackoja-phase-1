import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { AuthService } from '../services/auth.service';
import { Button } from './ui/Button';
import { StoreSwitcher } from './StoreSwitcher';
import { usePermissions } from '../hooks/usePermissions';
import { useAuth } from '../contexts/AuthContext';

// Shared shell for authenticated pages. Hosts the persistent global store
// switcher so it is available everywhere in the app, per the Phase 1
// multi-store support requirement.
export function AppLayout() {
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
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
          <Button
            variant="ghost"
            onClick={handleLogout}
            style={{ width: 'auto', height: 36, padding: '0 14px' }}
          >
            Log out
          </Button>
        </div>
      </header>
      <nav className="app-nav">
        <NavLink to="/dashboard" className={({ isActive }) => `app-nav-link${isActive ? ' active' : ''}`}>
          Dashboard
        </NavLink>
        {hasPermission('inventory:view') && (
          <>
            <NavLink to="/inventory/products" className={({ isActive }) => `app-nav-link${isActive ? ' active' : ''}`}>
              Products
            </NavLink>
            <NavLink to="/inventory/categories" className={({ isActive }) => `app-nav-link${isActive ? ' active' : ''}`}>
              Categories
            </NavLink>
            {hasPermission('inventory:adjust') && (
              <NavLink to="/inventory/stock" className={({ isActive }) => `app-nav-link${isActive ? ' active' : ''}`}>
                Stock
              </NavLink>
            )}
          </>
        )}
        {hasPermission('sales:create') && (
          <NavLink to="/sales/checkout" className={({ isActive }) => `app-nav-link${isActive ? ' active' : ''}`}>
            Checkout
          </NavLink>
        )}
        {hasPermission('sales:view') && (
          <NavLink to="/sales" className={({ isActive }) => `app-nav-link${isActive ? ' active' : ''}`} end>
            Sales
          </NavLink>
        )}
        {hasPermission('customer:view') && (
          <NavLink to="/customers" className={({ isActive }) => `app-nav-link${isActive ? ' active' : ''}`}>
            Customers
          </NavLink>
        )}
        {hasPermission('sales:refund') && (
          <NavLink to="/payments" className={({ isActive }) => `app-nav-link${isActive ? ' active' : ''}`}>
            Payments
          </NavLink>
        )}
        {hasPermission('devices:view') && (
          <NavLink to="/devices" className={({ isActive }) => `app-nav-link${isActive ? ' active' : ''}`}>
            Devices
          </NavLink>
        )}
        {hasPermission('reports:view') && (
          <NavLink to="/reports" className={({ isActive }) => `app-nav-link${isActive ? ' active' : ''}`}>
            Reports
          </NavLink>
        )}
        {hasPermission('member:invite') && (
          <NavLink to="/staff" className={({ isActive }) => `app-nav-link${isActive ? ' active' : ''}`}>
            Staff
          </NavLink>
        )}
        <NavLink to="/billing" className={({ isActive }) => `app-nav-link${isActive ? ' active' : ''}`}>
          Billing
        </NavLink>
        {profile?.isPlatformAdmin && (
          <NavLink to="/platform" className={({ isActive }) => `app-nav-link${isActive ? ' active' : ''}`}>
            Platform
          </NavLink>
        )}
      </nav>
      <Outlet />
    </div>
  );
}
