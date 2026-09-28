import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useAppNav } from '../hooks/useAppNav';
import { StoreSwitcher } from './StoreSwitcher';
import { ArrowLeftIcon, LogoutIcon, ScanIcon, SettingsIcon, SidebarIcon } from './icons';
import { ThemeSelect } from './ThemeSelect';

interface SideNavProps { onLogout: () => void; mobile?: boolean; onClose?: () => void; }

export function SideNav({ onLogout, mobile = false, onClose }: SideNavProps) {
  const { profile } = useAuth();
  const { allItems, handleScan, canScan } = useAppNav();
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('trackoja-sidebar-collapsed') === 'true'; } catch { return false; }
  });
  const [tooltipTop, setTooltipTop] = useState(0);
  const compact = collapsed && !mobile;
  const initials = profile
    ? (((profile.firstName?.[0] ?? '') + (profile.lastName?.[0] ?? '')) || (profile.email?.[0] ?? '?')).toUpperCase()
    : '?';
  const displayName = profile?.firstName
    ? `${profile.firstName}${profile.lastName ? ' ' + profile.lastName : ''}`
    : profile?.email?.split('@')[0] ?? 'User';

  return (
    <aside className={`side-nav${compact ? ' is-collapsed' : ''}${mobile ? ' is-mobile' : ''}`} aria-label="Workspace">
      <div className="side-nav-brand">
        <span className="workspace-mark" aria-label="TrackOja">T</span>
        <span className="side-nav-logo nav-label">TrackOja</span>
        {mobile && <button type="button" className="icon-button" onClick={onClose} aria-label="Back to current page"><ArrowLeftIcon width={18} height={18} /></button>}
      </div>
      {!mobile && <button className="sidebar-toggle" aria-label={compact ? 'Expand navigation' : 'Collapse navigation'} aria-expanded={!compact} onClick={() => {
        setCollapsed(!collapsed);
        try { localStorage.setItem('trackoja-sidebar-collapsed', String(!collapsed)); } catch { /* Session-only is fine. */ }
      }}><SidebarIcon width={17} height={17} /><span className="nav-label">Collapse sidebar</span></button>}
      <div className="side-nav-store nav-label"><StoreSwitcher /></div>
      <nav className="side-nav-items" aria-label="Main navigation">
        {allItems.map((item) => (
          <span key={item.to} className="nav-tooltip-wrap t-tt-wrap" onMouseEnter={event => setTooltipTop(event.currentTarget.getBoundingClientRect().top)} onFocus={event => setTooltipTop(event.currentTarget.getBoundingClientRect().top)}>
            <NavLink to={item.to} end={item.end} aria-label={item.label} onClick={onClose} className={({ isActive }) => `side-nav-link t-tt-trigger${isActive ? ' active' : ''}`}>
              <item.icon width={17} height={17} /><span className="nav-label">{item.label}</span>
            </NavLink>
            {compact && <span className="t-tt nav-tooltip" role="tooltip" style={{ top: tooltipTop }}>{item.label}</span>}
          </span>
        ))}
      </nav>
      <button type="button" className="side-nav-scan" aria-label="Scan barcode" title={compact ? 'Scan barcode' : undefined} disabled={!canScan} onClick={() => { handleScan(); onClose?.(); }}>
        <ScanIcon width={17} height={17} /><span className="nav-label">Scan barcode</span>
      </button>
      <div className="side-nav-footer">
        {profile?.isPlatformAdmin && <NavLink to="/platform" aria-label="Platform" title={compact ? 'Platform' : undefined} onClick={onClose} className={({ isActive }) => `side-nav-link${isActive ? ' active' : ''}`}><SettingsIcon width={17} height={17} /><span className="nav-label">Platform</span></NavLink>}
        <div className="nav-label"><ThemeSelect /></div>
        <div className="side-nav-profile">
          <div className="side-nav-avatar" title={displayName}>{initials}</div>
          <div className="side-nav-profile-info nav-label"><span className="side-nav-profile-name">{displayName}</span><span className="side-nav-profile-email">{profile?.email}</span></div>
          <button type="button" className="side-nav-profile-logout" onClick={onLogout} aria-label="Log out" title="Log out"><LogoutIcon width={17} height={17} /></button>
        </div>
      </div>
    </aside>
  );
}
