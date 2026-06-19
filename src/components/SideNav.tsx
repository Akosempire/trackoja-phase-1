import { NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useAppNav } from '../hooks/useAppNav';
import { StoreSwitcher } from './StoreSwitcher';
import { ScanIcon } from './icons';

interface SideNavProps {
  onLogout: () => void;
}

export function SideNav({ onLogout }: SideNavProps) {
  const { profile } = useAuth();
  const { allItems, handleScan } = useAppNav();

  return (
    <aside className="side-nav">
      <div className="side-nav-logo">TrackOja</div>

      <div className="side-nav-store">
        <StoreSwitcher />
      </div>

      <nav className="side-nav-items">
        {allItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `side-nav-link${isActive ? ' active' : ''}`}
          >
            <item.icon width={18} height={18} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <button type="button" className="side-nav-scan" onClick={handleScan}>
        <ScanIcon width={16} height={16} />
        <span>Scan barcode</span>
      </button>

      <div className="side-nav-footer">
        {profile?.isPlatformAdmin && (
          <NavLink
            to="/platform"
            className={({ isActive }) => `side-nav-link${isActive ? ' active' : ''}`}
          >
            <span style={{ fontSize: 16 }}>⚙️</span>
            <span>Platform</span>
          </NavLink>
        )}
        <button type="button" className="side-nav-logout" onClick={onLogout}>
          Log out
        </button>
      </div>
    </aside>
  );
}
