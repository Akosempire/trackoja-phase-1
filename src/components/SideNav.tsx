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

  const initials = profile
    ? (((profile.firstName?.[0] ?? '') + (profile.lastName?.[0] ?? '')) || (profile.email?.[0] ?? '?')).toUpperCase()
    : '?';

  const displayName = profile?.firstName
    ? `${profile.firstName}${profile.lastName ? ' ' + profile.lastName : ''}`
    : profile?.email?.split('@')[0] ?? 'User';

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

        <div className="side-nav-profile">
          <div className="side-nav-avatar">{initials}</div>
          <div className="side-nav-profile-info">
            <span className="side-nav-profile-name">{displayName}</span>
            <span className="side-nav-profile-email">{profile?.email}</span>
          </div>
          <button
            type="button"
            className="side-nav-profile-logout"
            onClick={onLogout}
            title="Log out"
          >
            ↪
          </button>
        </div>
      </div>
    </aside>
  );
}
